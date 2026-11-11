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

export interface LayerStatus {
  /** User toggle. */
  visible: boolean;
  /** Actually drawn right now. */
  active: boolean;
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
    for (const s of sources) this.addStyleLayers(s);
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
    return ['fill', 'casing', 'line', 'circle', 'label'].map((k) => `ds-${s.id}-${k}`).filter((id) => this.map.getLayer(id));
  }

  private addStyleLayers(s: LayerSource): void {
    const src = `ds-${s.id}`;
    const map = this.map;
    // Per-layer credits live in the details sheet and More → Data sources (too long for the map).
    map.addSource(src, { type: 'geojson', data: EMPTY, promoteId: P.fid, tolerance: 0.3 });
    const isParcel = s.group === 'parcels';
    const isUnit = s.group === 'hunting-units';
    const isRef = s.group === 'reference';
    const id = (k: string): string => `ds-${s.id}-${k}`;
    const polyFilter: FilterSpecification = ['==', ['geometry-type'], 'Polygon'];
    const lineFilter: FilterSpecification = ['==', ['geometry-type'], 'LineString'];
    const pointFilter: FilterSpecification = ['==', ['geometry-type'], 'Point'];

    if (s.geometry === 'polygon') {
      if (isRef) {
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
              'fill-opacity': isParcel ? ['interpolate', ['linear'], ['zoom'], 14, 0.22, 17, 0.14] : ['interpolate', ['linear'], ['zoom'], 7, 0.5, 13, 0.32, 16, 0.22],
            },
          },
          'anchor-fills',
        );
        if (isParcel) {
          // Property lines: dark casing + bright line reads on both topo and imagery.
          map.addLayer({ id: id('casing'), type: 'line', source: src, paint: { 'line-color': '#000', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2.2, 18, 4] } }, 'anchor-lines');
          map.addLayer({ id: id('line'), type: 'line', source: src, paint: { 'line-color': ['case', ['==', ['get', P.grade], 'red'], '#ffd9d4', '#fffbe6'], 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.9, 18, 2] } }, 'anchor-lines');
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
            'text-color': isUnit ? this.colorForUnitLayer(s.id) : isParcel ? '#ffffff' : isRef ? '#26302a' : '#0f2a17',
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
      const active = st.visible && !st.hiddenReason;
      st.active = active;
      this.setLayerVisibility(s, active);
      if (!active) {
        st.loading = false;
        st.error = undefined;
        if (st.visible && st.hiddenReason) this.setData(s, []); // free memory; refetch from cache later
        continue;
      }
      const tiles = queryTiles(bbox, zoom, s.minZoom);
      for (const t of tiles) wanted.add(tileCacheKey(s.id, t));
      void this.loadLayer(s, tiles, bbox);
    }
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
    const m = layerId.match(/^ds-(.+)-(fill|line|circle|casing|label)$/);
    return m?.[1];
  }

  setDataEmpty(): void {
    for (const s of this.sources) this.setData(s, []);
  }
}
