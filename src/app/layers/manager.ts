// Loads every visible LayerSource for the current viewport from its ArcGIS REST endpoint,
// grades features, and renders them with grade-based styling.

import type { Map as MLMap, GeoJSONSource, ExpressionSpecification, FilterSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { GRADE_COLORS, type LayerSource } from '../../contract';
import { LOADER } from '../config';
import { debounce } from '../util/dom';
import { prefGet, prefSet } from '../util/store';
import {
  LruCache,
  fetchFeatures,
  generalisationOffset,
  queryTiles,
  tileBBox,
  tileCacheKey,
  type BBox,
  type TileCoord,
} from './arcgis';
import { P, enrichFeature } from './enrich';
import { CountyIndex } from './counties';
import { loadsForParcels, reconcileLoaded } from './reconcileLayers';

export interface LayerStatus {
  /** User toggle. */
  visible: boolean;
  /** Actually drawn right now. */
  active: boolean;
  /** Loaded (but not drawn) so parcels can be reconciled against it. */
  loadedForParcels?: boolean;
  hiddenReason?: 'zoom' | 'species' | 'county';
  loading: boolean;
  error?: string;
  count: number;
  truncated: boolean;
}

interface TileEntry {
  features: Feature[];
  truncated: boolean;
}

interface Inflight {
  ctrl: AbortController;
  promise: Promise<TileEntry | null>;
}

const gradeColor: ExpressionSpecification = [
  'match',
  ['get', P.grade],
  'green', GRADE_COLORS.green,
  'yellow', GRADE_COLORS.yellow,
  'red', GRADE_COLORS.red,
  GRADE_COLORS.unknown,
];

const UNIT_COLORS = ['#b15cff', '#00b8d9', '#ff7a1a', '#e2389b', '#5bd16a'];
/** Outline colours for administrative boundary layers (never grade colours). */
const BOUNDARY_COLORS: Record<string, string> = { 'dnr-wildlife-areas': '#0d5c2e', 'dnr-state-parks': '#5a3d8a' };
export const BOUNDARY_DEFAULT_COLOR = '#0d5c2e';
export function boundaryColor(id: string): string {
  return BOUNDARY_COLORS[id] ?? BOUNDARY_DEFAULT_COLOR;
}

/** 12×12 diagonal-stripe pattern in a grade colour, for parcels whose records disagree. */
function hatchImage(hex: string): { width: number; height: number; data: Uint8Array } {
  const n = 12;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 4;
      const stripe = (x + y) % n < 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b;
      data[o + 3] = stripe ? 200 : 40;
    }
  return { width: n, height: n, data };
}
export const LABEL_FONT = ['Noto Sans Bold', 'sans-serif'];

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Global cap on simultaneous ArcGIS requests across all layers (phones on weak signal). */
class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  async run<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve, reject) => {
        const go = (): void => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = (): void => {
          this.queue = this.queue.filter((q) => q !== go);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        this.queue.push(go);
      });
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export class LayerManager {
  readonly sources: LayerSource[];
  private readonly status = new Map<string, LayerStatus>();
  private readonly cache = new LruCache<TileEntry>(LOADER.cacheTiles);
  private readonly inflight = new Map<string, Inflight>();
  /** Currently drawn features per layer, by _fid (full-precision geometry for details). */
  private readonly drawn = new Map<string, Map<string, Feature>>();
  private readonly generation = new Map<string, number>();
  private species: string = prefGet('species', 'all');
  private listeners: (() => void)[] = [];
  private unitColor = new Map<string, string>();
  readonly clickableLayers: string[] = [];
  readonly counties = new CountyIndex();
  private readonly limiter = new Limiter(8);
  /** Low-confidence features whose fill is hidden under parcels, by source id. */
  private readonly masked = new Map<string, Set<string>>();
  private readonly scheduleReconcile: () => void;
  /** Last reconciliation pass duration (ms), for diagnostics. */
  lastReconcileMs = 0;

  private readonly map: MLMap;

  constructor(map: MLMap, sources: LayerSource[]) {
    this.map = map;
    this.sources = sources;
    const saved = prefGet<Record<string, boolean>>('layers', {});
    let u = 0;
    for (const s of sources) {
      this.status.set(s.id, { visible: saved[s.id] ?? s.defaultVisible, active: false, loading: false, count: 0, truncated: false });
      if (s.group === 'hunting-units') this.unitColor.set(s.id, UNIT_COLORS[u++ % UNIT_COLORS.length]);
    }
    for (const g of ['green', 'yellow', 'red', 'unknown'] as const) if (!map.hasImage(`hatch-${g}`)) map.addImage(`hatch-${g}`, hatchImage(GRADE_COLORS[g]));
    for (const s of sources) this.addStyleLayers(s);
    this.scheduleReconcile = debounce(() => this.reconcile(), 120);
    const refresh = debounce(() => this.refresh(), LOADER.debounceMs);
    map.on('moveend', refresh);
    this.refresh();
    void this.counties.load(sources).then(() => this.refresh());
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  getStatus(id: string): LayerStatus {
    const s = this.status.get(id);
    if (!s) throw new Error(`Unknown layer ${id}`);
    return s;
  }

  sourceById(id: string): LayerSource | undefined {
    return this.sources.find((s) => s.id === id);
  }

  getFeature(fid: string): { source: LayerSource; feature: Feature } | undefined {
    const srcId = fid.split(':')[0];
    const feature = this.drawn.get(srcId)?.get(fid);
    const source = this.sourceById(srcId);
    return feature && source ? { source, feature } : undefined;
  }

  colorForUnitLayer(id: string): string {
    return this.unitColor.get(id) ?? UNIT_COLORS[0];
  }

  /** Union of species across hunting-unit layers. */
  allSpecies(): string[] {
    const set = new Set<string>();
    for (const s of this.sources) for (const sp of s.species ?? []) set.add(sp.toLowerCase());
    return [...set].sort();
  }

  getSpecies(): string {
    return this.species;
  }

  setSpecies(sp: string): void {
    this.species = sp;
    prefSet('species', sp);
    this.refresh();
  }

  setVisible(id: string, visible: boolean): void {
    const st = this.getStatus(id);
    st.visible = visible;
    const saved: Record<string, boolean> = {};
    for (const [k, v] of this.status) saved[k] = v.visible;
    prefSet('layers', saved);
    this.refresh();
  }

  private speciesAllows(s: LayerSource): boolean {
    if (s.group !== 'hunting-units' || this.species === 'all' || !s.species?.length) return true;
    return s.species.some((x) => x.toLowerCase() === this.species);
  }

  // ---------- styling ----------

  private layerIds(s: LayerSource): string[] {
    return ['fill', 'hatch', 'casing', 'line', 'dash', 'circle', 'label'].map((k) => `ds-${s.id}-${k}`).filter((id) => this.map.getLayer(id));
  }

  private addStyleLayers(s: LayerSource): void {
    const src = `ds-${s.id}`;
    const map = this.map;
    // Per-layer credits live in the details sheet and More → Data sources (too long for the map).
    map.addSource(src, { type: 'geojson', data: EMPTY, promoteId: P.fid, tolerance: 0.3 });
    const isParcel = s.group === 'parcels';
    const isUnit = s.group === 'hunting-units';
    const isRef = s.group === 'reference';
    const isBoundary = s.role === 'boundary';
    const id = (k: string): string => `ds-${s.id}-${k}`;
    const polyFilter: FilterSpecification = ['==', ['geometry-type'], 'Polygon'];
    const lineFilter: FilterSpecification = ['==', ['geometry-type'], 'LineString'];
    const pointFilter: FilterSpecification = ['==', ['geometry-type'], 'Point'];

    if (s.geometry === 'polygon') {
      if (isBoundary) {
        // Administrative boundaries: labelled outline only, never a grade fill. The near-invisible
        // fill keeps the inside tappable ("Inside the boundary of …").
        const c = boundaryColor(s.id);
        map.addLayer({ id: id('fill'), type: 'fill', source: src, filter: polyFilter, paint: { 'fill-color': '#000', 'fill-opacity': 0.01 } }, 'anchor-fills');
        map.addLayer({ id: id('casing'), type: 'line', source: src, paint: { 'line-color': '#ffffff', 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 15, 4.5] } }, 'anchor-lines');
        map.addLayer({ id: id('line'), type: 'line', source: src, paint: { 'line-color': c, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 15, 2.4], 'line-dasharray': [3, 1.5] } }, 'anchor-lines');
      } else if (isRef) {
        // Reference outlines (counties, PLSS, compartments): neutral, never grade-coloured.
        map.addLayer({ id: id('fill'), type: 'fill', source: src, filter: polyFilter, paint: { 'fill-color': '#000', 'fill-opacity': 0.01 } }, 'anchor-fills');
        map.addLayer({ id: id('casing'), type: 'line', source: src, paint: { 'line-color': '#ffffff', 'line-opacity': 0.6, 'line-width': 3 } }, 'anchor-units');
        map.addLayer({ id: id('line'), type: 'line', source: src, paint: { 'line-color': '#26302a', 'line-width': 1.2, 'line-dasharray': [4, 2] } }, 'anchor-units');
      } else if (isUnit) {
        const c = this.colorForUnitLayer(s.id);
        map.addLayer({ id: id('fill'), type: 'fill', source: src, filter: polyFilter, paint: { 'fill-color': c, 'fill-opacity': 0.04 } }, 'anchor-fills');
        map.addLayer({ id: id('casing'), type: 'line', source: src, paint: { 'line-color': '#000', 'line-opacity': 0.35, 'line-width': 5 } }, 'anchor-units');
        map.addLayer({ id: id('line'), type: 'line', source: src, paint: { 'line-color': c, 'line-width': 2.5, 'line-dasharray': [3, 1.5] } }, 'anchor-units');
      } else {
        map.addLayer(
          {
            id: id('fill'),
            type: 'fill',
            source: src,
            filter: polyFilter,
            paint: {
              'fill-color': gradeColor,
              // Parcels tint only when they own their verdict ('fill'); when it was adopted from a
              // drawn public layer that layer's fill shows instead, and conflicts are hatched.
              // Low-confidence public fills are hidden (feature-state) where parcels cover them.
              'fill-opacity': isParcel
                ? ['interpolate', ['linear'], ['zoom'], 14, ['case', ['==', ['get', P.tint], 'fill'], 0.24, 0], 17, ['case', ['==', ['get', P.tint], 'fill'], 0.16, 0]]
                : ['interpolate', ['linear'], ['zoom'], 7, ['case', ['boolean', ['feature-state', 'masked'], false], 0, 0.5], 13, ['case', ['boolean', ['feature-state', 'masked'], false], 0, 0.32], 16, ['case', ['boolean', ['feature-state', 'masked'], false], 0, 0.22]],
            },
          },
          'anchor-fills',
        );
        if (isParcel) {
          const conflict: FilterSpecification = ['all', polyFilter, ['==', ['get', P.tint], 'conflict']];
          map.addLayer({ id: id('hatch'), type: 'fill', source: src, filter: conflict, paint: { 'fill-pattern': ['concat', 'hatch-', ['get', P.grade]], 'fill-opacity': 0.8 } }, 'anchor-fills');
          // Property lines: dark casing + bright line reads on both topo and imagery.
          map.addLayer({ id: id('casing'), type: 'line', source: src, paint: { 'line-color': '#000', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2.2, 18, 4] } }, 'anchor-lines');
          map.addLayer({ id: id('line'), type: 'line', source: src, paint: { 'line-color': ['case', ['==', ['get', P.grade], 'red'], '#ffd9d4', '#fffbe6'], 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.9, 18, 2] } }, 'anchor-lines');
          map.addLayer({ id: id('dash'), type: 'line', source: src, filter: ['==', ['get', P.tint], 'conflict'], paint: { 'line-color': gradeColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.8, 18, 3], 'line-dasharray': [2, 1.5] } }, 'anchor-lines');
        } else {
          map.addLayer({ id: id('line'), type: 'line', source: src, paint: { 'line-color': gradeColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 14, 2.4] } }, 'anchor-lines');
        }
      }
    } else if (s.geometry === 'line') {
      const color: ExpressionSpecification | string = isUnit ? this.colorForUnitLayer(s.id) : gradeColor;
      map.addLayer({ id: id('casing'), type: 'line', source: src, filter: lineFilter, paint: { 'line-color': '#000', 'line-opacity': 0.4, 'line-width': 5 } }, 'anchor-lines');
      map.addLayer({ id: id('line'), type: 'line', source: src, filter: lineFilter, paint: { 'line-color': color, 'line-width': 2.5 } }, 'anchor-lines');
    } else {
      map.addLayer(
        {
          id: id('circle'),
          type: 'circle',
          source: src,
          filter: pointFilter,
          paint: {
            'circle-color': isUnit ? this.colorForUnitLayer(s.id) : gradeColor,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 15, 7],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2,
          },
        },
        'anchor-points',
      );
    }

    // Labels: unit names, public land names, owner names on parcels at high zoom.
    const labelField = isParcel ? P.owner : P.name;
    if (isParcel || s.nameField) {
      map.addLayer(
        {
          id: id('label'),
          type: 'symbol',
          source: src,
          minzoom: isParcel ? Math.max(15.5, s.minZoom + 1) : isUnit || isRef ? Math.max(6, s.minZoom) : Math.max(10, s.minZoom),
          layout: {
            'text-field': ['get', labelField],
            'text-font': LABEL_FONT,
            'text-size': isParcel ? 11 : isUnit ? 13 : 12,
            'text-max-width': 9,
            'text-padding': 4,
            'symbol-placement': s.geometry === 'line' ? 'line' : 'point',
            'text-transform': isParcel ? 'none' : 'uppercase',
            'text-letter-spacing': isParcel ? 0 : 0.04,
            'text-offset': s.geometry === 'point' ? [0, 1.1] : [0, 0],
            'text-anchor': s.geometry === 'point' ? 'top' : 'center',
          },
          paint: {
            'text-color': isUnit ? this.colorForUnitLayer(s.id) : isParcel ? '#ffffff' : isRef ? '#26302a' : isBoundary ? boundaryColor(s.id) : '#0f2a17',
            'text-halo-color': isParcel || isUnit ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)',
            'text-halo-width': 1.6,
          },
        },
        'anchor-labels',
      );
    }
    for (const lid of [id('fill'), id('line'), id('circle')]) if (map.getLayer(lid)) this.clickableLayers.push(lid);
  }

  private setLayerVisibility(s: LayerSource, on: boolean): void {
    for (const lid of this.layerIds(s)) this.map.setLayoutProperty(lid, 'visibility', on ? 'visible' : 'none');
  }

  // ---------- loading ----------

  private viewBBox(): BBox {
    const b = this.map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  refresh(): void {
    const zoom = this.map.getZoom();
    const bbox = this.viewBBox();
    const wanted = new Set<string>();
    for (const s of this.sources) {
      const st = this.getStatus(s.id);
      st.hiddenReason = !this.speciesAllows(s) ? 'species' : zoom < s.minZoom ? 'zoom' : !this.counties.layerCoversView(s, bbox) ? 'county' : undefined;
      st.active = st.visible && !st.hiddenReason;
    }
    // Parcels shown → the layers that can overrule an owner name must be loaded even when their
    // own fill is switched off, so a hidden layer cannot make a closed park zone look open.
    const parcelsShown = this.sources.some((s) => s.group === 'parcels' && this.getStatus(s.id).active);
    for (const s of this.sources) {
      const st = this.getStatus(s.id);
      const active = st.active;
      st.loadedForParcels = !active && parcelsShown && !st.hiddenReason && loadsForParcels(s);
      this.setLayerVisibility(s, active);
      if (!active && !st.loadedForParcels) {
        st.loading = false;
        st.error = undefined;
        if (this.drawn.get(s.id)?.size) this.setData(s, []); // free memory; refetch from cache later
        continue;
      }
      const tiles = queryTiles(bbox, zoom, s.minZoom);
      for (const t of tiles) wanted.add(tileCacheKey(s.id, t));
      void this.loadLayer(s, tiles, bbox);
    }
    this.scheduleReconcile();
    // Abort requests for tiles no longer needed by any layer.
    for (const [key, inf] of this.inflight) {
      if (!wanted.has(key)) {
        inf.ctrl.abort();
        this.inflight.delete(key);
      }
    }
    this.emit();
  }

  private fetchTile(s: LayerSource, t: TileCoord): Promise<TileEntry | null> {
    const key = tileCacheKey(s.id, t);
    const existing = this.inflight.get(key);
    if (existing) return existing.promise;
    const ctrl = new AbortController();
    const bbox = tileBBox(t);
    const promise = this.limiter
      .run(
        () =>
          fetchFeatures({
      layerUrl: s.url,
      where: s.where,
      fields: s.fields,
      bbox,
      cap: LOADER.tileCap,
      pageSize: LOADER.pageSize,
      maxAllowableOffset: s.geometry === 'point' ? undefined : generalisationOffset(t.z, (bbox[1] + bbox[3]) / 2),
      signal: ctrl.signal,
          }),
        ctrl.signal,
      )
      .then((r) => {
        const entry: TileEntry = { features: r.features.map((f) => enrichFeature(s, f)), truncated: r.truncated };
        this.cache.set(key, entry);
        return entry;
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return null;
        throw err;
      })
      .finally(() => {
        if (this.inflight.get(key)?.ctrl === ctrl) this.inflight.delete(key);
      });
    this.inflight.set(key, { ctrl, promise });
    return promise;
  }

  private async loadLayer(s: LayerSource, tiles: TileCoord[], bbox: BBox): Promise<void> {
    const gen = (this.generation.get(s.id) ?? 0) + 1;
    this.generation.set(s.id, gen);
    const st = this.getStatus(s.id);
    const entries = new Map<string, TileEntry>();
    const missing: TileCoord[] = [];
    // Nearest-to-centre first so the middle of the screen fills in first.
    const cx = (bbox[0] + bbox[2]) / 2;
    const cy = (bbox[1] + bbox[3]) / 2;
    const dist = (t: TileCoord): number => {
      const b = tileBBox(t);
      return Math.hypot((b[0] + b[2]) / 2 - cx, (b[1] + b[3]) / 2 - cy);
    };
    for (const t of [...tiles].sort((a, b) => dist(a) - dist(b))) {
      const hit = this.cache.get(tileCacheKey(s.id, t));
      if (hit) entries.set(tileCacheKey(s.id, t), hit);
      else missing.push(t);
    }
    const publish = (): void => {
      if (this.generation.get(s.id) !== gen) return;
      const merged = new Map<string, Feature>();
      let truncated = false;
      for (const e of entries.values()) {
        truncated ||= e.truncated;
        for (const f of e.features) {
          const fid = String(f.properties?.[P.fid]);
          if (!merged.has(fid)) merged.set(fid, f);
          if (merged.size >= LOADER.layerCap) {
            truncated = true;
            break;
          }
        }
      }
      st.truncated = truncated;
      this.setData(s, [...merged.values()], merged);
    };
    publish();
    if (!missing.length) {
      st.loading = false;
      st.error = undefined;
      this.emit();
      return;
    }
    st.loading = true;
    st.error = undefined;
    this.emit();
    let errors = 0;
    let lastError = '';
    let i = 0;
    const worker = async (): Promise<void> => {
      while (i < missing.length) {
        const t = missing[i++];
        try {
          const e = await this.fetchTile(s, t);
          if (e) {
            entries.set(tileCacheKey(s.id, t), e);
            publish();
          }
        } catch (err) {
          errors++;
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOADER.concurrency, missing.length) }, worker));
    if (this.generation.get(s.id) !== gen) return;
    st.loading = false;
    st.error = errors ? (navigator.onLine ? `Couldn't load ${errors === missing.length ? 'data' : 'some areas'} (${lastError})` : 'Offline: showing cached areas only') : undefined;
    this.emit();
  }

  private setData(s: LayerSource, features: Feature[], index?: Map<string, Feature>): void {
    const src = this.map.getSource<GeoJSONSource>(`ds-${s.id}`);
    src?.setData({ type: 'FeatureCollection', features });
    this.drawn.set(s.id, index ?? new Map());
    this.getStatus(s.id).count = features.length;
    if (s.group === 'parcels' || s.group === 'public-land') this.scheduleReconcile();
  }

  /** Loaded = drawn, or fetched only so parcels can be reconciled against it. */
  isLoaded(id: string): boolean {
    const st = this.status.get(id);
    return Boolean(st && (st.active || st.loadedForParcels));
  }

  /** Resolves one verdict per loaded parcel against loaded public land (see reconcileLayers.ts). */
  private reconcile(): void {
    const loaded = (g: string) =>
      this.sources.filter((s) => s.group === g && this.isLoaded(s.id)).map((source) => ({ source, features: this.drawn.get(source.id)?.values() ? [...this.drawn.get(source.id)!.values()] : [] }));
    const parcels = loaded('parcels');
    const publics = loaded('public-land');
    const out = reconcileLoaded(parcels, publics, { visible: (id) => this.getStatus(id).active, view: this.viewBBox() });
    this.lastReconcileMs = out.ms;
    for (const id of out.changed) {
      const s = this.sourceById(id);
      const idx = this.drawn.get(id);
      if (s && idx) this.map.getSource<GeoJSONSource>(`ds-${id}`)?.setData({ type: 'FeatureCollection', features: [...idx.values()] });
    }
    // Feature-state masks on low-confidence fills.
    for (const s of this.sources) {
      if (!s.lowConfidence) continue;
      const want = out.masked.get(s.id) ?? new Set<string>();
      const had = this.masked.get(s.id) ?? new Set<string>();
      const source = `ds-${s.id}`;
      for (const fid of had) if (!want.has(fid)) this.map.setFeatureState({ source, id: fid }, { masked: false });
      for (const fid of want) if (!had.has(fid)) this.map.setFeatureState({ source, id: fid }, { masked: true });
      this.masked.set(s.id, want);
    }
    if (out.changed.size) this.emit();
  }

  /** Re-applies visibility (e.g. after a basemap swap). */
  reapply(): void {
    this.refresh();
  }

  isDataLayer(layerId: string): boolean {
    return layerId.startsWith('ds-');
  }

  /** Source id for a rendered layer id like ds-<source>-fill. */
  sourceIdForLayer(layerId: string): string | undefined {
    const m = layerId.match(/^ds-(.+)-(fill|hatch|line|dash|circle|casing|label)$/);
    return m?.[1];
  }

  setDataEmpty(): void {
    for (const s of this.sources) this.setData(s, []);
  }
}
