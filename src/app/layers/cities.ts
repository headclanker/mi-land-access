// Michigan city limits (public/cities/city-limits.json, built by scripts/build-city-limits.mjs).
//
// CityIndex answers "which city is this in?" for the city-limits grading rule
// (src/grading/reconcile.ts cityOverride): a point is in a city when it lies inside its
// boundary; a parcel or public-land polygon when at least half its area does (the same
// COVER_FRACTION reconciliation uses). Cities are few (280) and large, so a coarse bbox grid plus
// the banded point-in-polygon test from coverage.ts keeps this cheap; answers are cached per
// geometry object, which the tile cache keeps stable across pans.
//
// CityLimitsLayer draws the optional "City limits" reference outline (off by default).

import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { COVER_FRACTION } from '../../grading/reconcile';
import { BBoxGrid, contains, fractionsIn, prepare, prepared, type Prepared, type Shape } from './coverage';
import { prefGet, prefSet } from '../util/store';

/** Asset path, relative to the page (works at a domain root and under a sub-path). */
export const CITY_LIMITS_PATH = 'cities/city-limits.json';

export interface CityLimitsFile extends FeatureCollection {
  built?: string;
  count?: number;
}

export class CityIndex {
  readonly shapes: Shape<string>[] = [];
  readonly built: string;
  private readonly grid = new BBoxGrid<Shape<string>>(0.05);
  private readonly cache = new WeakMap<object, string | null>();

  constructor(fc: CityLimitsFile) {
    this.built = typeof fc.built === 'string' ? fc.built : '';
    for (const f of fc.features ?? []) {
      const name = String(f.properties?.n ?? '').trim();
      const g = f.geometry;
      if (!name || !g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
      const prep = prepare(g);
      if (!prep) continue;
      const s = { key: name, prep };
      this.shapes.push(s);
      this.grid.insert(prep.bbox, s);
    }
  }

  get size(): number {
    return this.shapes.length;
  }

  /** The city whose limits contain the point, if any. */
  at(lon: number, lat: number): string | undefined {
    for (const s of this.grid.query([lon, lat, lon, lat])) if (contains(s.prep, lon, lat)) return s.key;
    return undefined;
  }

  /** The city holding at least half of the polygon (or containing the point / first vertex). */
  ofPrepared(p: Prepared): string | undefined {
    const cands = [...this.grid.query(p.bbox)].filter((s) => s.prep.bbox[0] <= p.bbox[2] && s.prep.bbox[2] >= p.bbox[0] && s.prep.bbox[1] <= p.bbox[3] && s.prep.bbox[3] >= p.bbox[1]);
    if (!cands.length) return undefined;
    let best: { key: string; fraction: number } | undefined;
    for (const r of fractionsIn(p, cands)) if (!best || r.fraction > best.fraction) best = r;
    return best && best.fraction >= COVER_FRACTION ? best.key : undefined;
  }

  /** City membership of a map feature, cached per geometry object. */
  of(f: Feature): string | undefined {
    const g = f.geometry as Geometry | null;
    if (!g) return undefined;
    const hit = this.cache.get(g);
    if (hit !== undefined) return hit ?? undefined;
    let city: string | undefined;
    if (g.type === 'Point') city = this.at(g.coordinates[0], g.coordinates[1]);
    else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      const p = prepared(f);
      city = p ? this.ofPrepared(p) : undefined;
    } else if (g.type === 'LineString' && g.coordinates.length) {
      const c = g.coordinates[Math.floor(g.coordinates.length / 2)];
      city = this.at(c[0], c[1]);
    }
    this.cache.set(g, city ?? null);
    return city;
  }
}

export async function loadCityIndex(): Promise<{ index: CityIndex; data: CityLimitsFile }> {
  const res = await fetch(new URL(CITY_LIMITS_PATH, document.baseURI));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as CityLimitsFile;
  return { index: new CityIndex(data), data };
}

const SRC = 'city-limits';
const LINE_COLOR = '#7b2d8e';
const LAYER_IDS = ['city-limits-casing', 'city-limits-line', 'city-limits-label'] as const;

/** The optional "City limits" reference layer: a thin labelled outline, off by default. */
export class CityLimitsLayer {
  visible: boolean = prefGet('cityLimits', false);
  status: 'loading' | 'ready' | 'error' = 'loading';
  index: CityIndex | null = null;
  private listeners: (() => void)[] = [];
  private readonly map: MLMap;

  constructor(map: MLMap) {
    this.map = map;
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0.4 });
    const vis = this.visible ? 'visible' : 'none';
    map.addLayer({ id: 'city-limits-casing', type: 'line', source: SRC, layout: { visibility: vis }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.6, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.6, 14, 3] } }, 'anchor-units');
    map.addLayer({ id: 'city-limits-line', type: 'line', source: SRC, layout: { visibility: vis }, paint: { 'line-color': LINE_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.7, 14, 1.4] } }, 'anchor-units');
    map.addLayer(
      {
        id: 'city-limits-label',
        type: 'symbol',
        source: SRC,
        minzoom: 8,
        layout: {
          visibility: vis,
          'text-field': ['get', 'n'],
          'text-font': ['Noto Sans Bold', 'sans-serif'],
          'text-size': 12,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.06,
          'text-max-width': 9,
          'text-padding': 6,
        },
        paint: { 'text-color': LINE_COLOR, 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.6 },
      },
      'anchor-labels',
    );
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Loads the asset; resolves with the index (or null when it could not be loaded). */
  async load(): Promise<CityIndex | null> {
    try {
      const { index, data } = await loadCityIndex();
      this.index = index;
      this.map.getSource<GeoJSONSource>(SRC)?.setData({ type: 'FeatureCollection', features: data.features ?? [] });
      this.status = 'ready';
    } catch (err) {
      console.warn('City limits unavailable', err);
      this.status = 'error';
    }
    this.emit();
    return this.index;
  }

  setVisible(on: boolean): void {
    this.visible = on;
    prefSet('cityLimits', on);
    for (const id of LAYER_IDS) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    this.emit();
  }

  /** "Nov 11, 2026" for the layer panel. */
  builtLabel(): string {
    const b = this.index?.built;
    if (!b) return '';
    const d = new Date(`${b}T12:00:00`);
    return Number.isNaN(d.getTime()) ? b : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
