// Generic ArcGIS REST query helpers: URL building, tile-snapped cache keys, pagination,
// Esri-JSON → GeoJSON fallback. Network and pure logic kept separate so the pure parts are testable.

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

export type BBox = [west: number, south: number, east: number, north: number];

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

const clampLat = (lat: number): number => Math.max(-85.05112878, Math.min(85.05112878, lat));

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  const r = (clampLat(lat) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export function tileBBox({ z, x, y }: TileCoord): BBox {
  const n = 2 ** z;
  const lon = (xx: number): number => (xx / n) * 360 - 180;
  const lat = (yy: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

/** All tiles at zoom z that intersect bbox. */
export function tilesForBBox(bbox: BBox, z: number): TileCoord[] {
  const max = 2 ** z - 1;
  const x0 = Math.max(0, lonToTileX(bbox[0], z));
  const x1 = Math.min(max, lonToTileX(bbox[2], z));
  const y0 = Math.max(0, latToTileY(bbox[3], z));
  const y1 = Math.min(max, latToTileY(bbox[1], z));
  const out: TileCoord[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  return out;
}

/**
 * Chooses the query tile zoom for a map zoom: one level coarser than the view so a phone
 * screen is covered by ~4–9 tiles, never coarser than `minZoom - 1`, capped at 15, and
 * stepped up until the viewport needs at most `maxTiles` tiles.
 */
export function queryTiles(bbox: BBox, mapZoom: number, minZoom: number, maxTiles = 12): TileCoord[] {
  let z = Math.min(15, Math.max(Math.floor(mapZoom) - 1, Math.max(0, Math.floor(minZoom) - 1), 4));
  let tiles = tilesForBBox(bbox, z);
  while (tiles.length > maxTiles && z > 0) {
    z -= 1;
    tiles = tilesForBBox(bbox, z);
  }
  return tiles;
}

/** Stable cache key for one layer + tile. The tile zoom also fixes the generalisation level. */
export function tileCacheKey(layerId: string, t: TileCoord): string {
  return `${layerId}@${t.z}/${t.x}/${t.y}`;
}

/**
 * maxAllowableOffset (in degrees, since outSR=4326) for a tile zoom: about half a screen pixel
 * at that zoom. Returns undefined at high zoom where full precision is wanted.
 */
export function generalisationOffset(tileZoom: number, lat = 44.5): number | undefined {
  // Map zoom shown for these tiles is ~tileZoom+1.
  const mapZoom = tileZoom + 1;
  if (mapZoom >= 14) return undefined;
  const metresPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** mapZoom;
  const deg = (metresPerPixel * 0.5) / 111320;
  return Number(deg.toPrecision(2));
}

export interface QueryParams {
  where?: string;
  fields: string[];
  bbox: BBox;
  offset?: number;
  pageSize?: number;
  maxAllowableOffset?: number;
  format?: 'geojson' | 'json';
}

/** Builds the `/query` URL for an ArcGIS Feature/Map service layer URL. */
export function buildQueryUrl(layerUrl: string, p: QueryParams): string {
  const base = layerUrl.replace(/\/+$/, '').replace(/\/query$/i, '');
  const r = (n: number): string => String(Math.round(n * 1e6) / 1e6);
  const params = new URLSearchParams();
  params.set('where', p.where && p.where.trim() ? p.where : '1=1');
  params.set('geometry', p.bbox.map(r).join(','));
  params.set('geometryType', 'esriGeometryEnvelope');
  params.set('inSR', '4326');
  params.set('spatialRel', 'esriSpatialRelIntersects');
  params.set('outFields', p.fields.length ? p.fields.join(',') : '*');
  params.set('returnGeometry', 'true');
  params.set('outSR', '4326');
  if (p.maxAllowableOffset !== undefined) params.set('maxAllowableOffset', String(p.maxAllowableOffset));
  if (p.offset) params.set('resultOffset', String(p.offset));
  if (p.pageSize) params.set('resultRecordCount', String(p.pageSize));
  params.set('f', p.format ?? 'geojson');
  return `${base}/query?${params.toString()}`;
}

/** Small LRU used for per-tile feature caching. */
export class LruCache<V> {
  private map = new Map<string, V>();
  private readonly capacity: number;
  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

// ---------- Esri JSON fallback (for servers without f=geojson support) ----------

interface EsriGeometry {
  x?: number;
  y?: number;
  points?: number[][];
  paths?: number[][][];
  rings?: number[][][];
}

interface EsriFeature {
  attributes?: Record<string, unknown>;
  geometry?: EsriGeometry | null;
}

export interface EsriFeatureSet {
  features?: EsriFeature[];
  exceededTransferLimit?: boolean;
  objectIdFieldName?: string;
}

/** Shoelace signed area: positive = counter-clockwise. Esri outer rings are clockwise. */
function ringSignedArea(ring: number[][]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
}

export function esriGeometryToGeoJSON(g: EsriGeometry): Geometry | null {
  if (typeof g.x === 'number' && typeof g.y === 'number') return { type: 'Point', coordinates: [g.x, g.y] };
  if (g.points) return { type: 'MultiPoint', coordinates: g.points.map((p) => [p[0], p[1]]) };
  if (g.paths) {
    const lines = g.paths.map((p) => p.map((c) => [c[0], c[1]] as Position));
    return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
  }
  if (g.rings) {
    const polys: Position[][][] = [];
    for (const ring of g.rings) {
      const r = ring.map((c) => [c[0], c[1]] as Position);
      if (ringSignedArea(ring) < 0 || polys.length === 0) polys.push([r]);
      else polys[polys.length - 1].push(r);
    }
    return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  }
  return null;
}

export function esriToFeatureCollection(fs: EsriFeatureSet): FeatureCollection & { exceededTransferLimit?: boolean } {
  const oidField = fs.objectIdFieldName;
  const features: Feature[] = [];
  for (const f of fs.features ?? []) {
    const geometry = f.geometry ? esriGeometryToGeoJSON(f.geometry) : null;
    if (!geometry) continue;
    const properties = f.attributes ?? {};
    const id = oidField ? properties[oidField] : undefined;
    features.push({
      type: 'Feature',
      geometry,
      properties,
      ...(typeof id === 'number' || typeof id === 'string' ? { id } : {}),
    });
  }
  return { type: 'FeatureCollection', features, exceededTransferLimit: fs.exceededTransferLimit };
}

// ---------- Network ----------

interface GeoJSONPage extends FeatureCollection {
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
  error?: { code?: number; message?: string };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export interface FetchOptions {
  layerUrl: string;
  where?: string;
  fields: string[];
  bbox: BBox;
  maxAllowableOffset?: number;
  /** Stop after this many features (across pages). */
  cap: number;
  pageSize?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

export interface FetchResult {
  features: Feature[];
  truncated: boolean;
}

/** Remembers layers whose server rejected f=geojson so we go straight to f=json next time. */
const esriJsonOnly = new Set<string>();

async function fetchPage(opts: FetchOptions, offset: number): Promise<{ features: Feature[]; more: boolean }> {
  const f = opts.fetchFn ?? fetch;
  const useJson = esriJsonOnly.has(opts.layerUrl);
  const url = buildQueryUrl(opts.layerUrl, {
    where: opts.where,
    fields: opts.fields,
    bbox: opts.bbox,
    offset,
    pageSize: opts.pageSize,
    maxAllowableOffset: opts.maxAllowableOffset,
    format: useJson ? 'json' : 'geojson',
  });
  const res = await f(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!isObject(body)) throw new Error('Bad response');
  if (isObject(body.error)) {
    const msg = String(body.error.message ?? 'ArcGIS error');
    if (!useJson && /geojson|format|invalid/i.test(msg)) {
      esriJsonOnly.add(opts.layerUrl);
      return fetchPage(opts, offset);
    }
    throw new Error(msg);
  }
  if (useJson || ('features' in body && !('type' in body))) {
    const fc = esriToFeatureCollection(body as EsriFeatureSet);
    return { features: fc.features, more: Boolean(fc.exceededTransferLimit) };
  }
  const page = body as unknown as GeoJSONPage;
  const more = Boolean(page.exceededTransferLimit ?? page.properties?.exceededTransferLimit);
  return { features: Array.isArray(page.features) ? page.features : [], more };
}

/** Queries one bbox, following `exceededTransferLimit` with resultOffset until `cap`. */
export async function fetchFeatures(opts: FetchOptions): Promise<FetchResult> {
  const all: Feature[] = [];
  let offset = 0;
  for (let guard = 0; guard < 20; guard++) {
    const { features, more } = await fetchPage(opts, offset);
    all.push(...features);
    if (!more || features.length === 0) return { features: all, truncated: false };
    if (all.length >= opts.cap) return { features: all.slice(0, opts.cap), truncated: true };
    offset += features.length;
  }
  return { features: all, truncated: true };
}
