// Fast approximate polygon-overlap fractions for reconciling parcels with public-land layers.
//
// Exact polygon intersection (turf.intersect) for ~3,000 parcels against a few hundred public
// polygons, some with tens of thousands of vertices, is far too slow to redo on every pan. So:
//   * every polygon is prepared once: bbox + its edges bucketed into horizontal bands, so a
//     point-in-polygon test only looks at the edges in one band (even-odd rule over all rings,
//     which handles holes and multipolygons);
//   * public polygons go in a uniform grid keyed by bbox, so each parcel only meets candidates
//     whose bbox it touches;
//   * a parcel's coverage by a public feature is estimated from a lattice of sample points
//     inside the parcel (about 30–60 points): fraction = points inside the feature / points
//     inside the parcel.
// Resolution is a few percent of the parcel's area on the first pass; any fraction within 8
// points of a decision threshold (10% / 50%) is re-measured with 12× the samples, so threshold
// calls are accurate to well under 1%. Lon/lat distortion is negligible at parcel scale.

import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';

export type BBox = [number, number, number, number];

export interface Prepared {
  bbox: BBox;
  /** x1,y1,x2,y2 per edge. */
  edges: Float64Array;
  bandMinY: number;
  bandH: number;
  bands: Int32Array[];
}

function rings(g: Polygon | MultiPolygon): Position[][] {
  return g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
}

export function isAreal(f: Feature | undefined | null): f is Feature<Polygon | MultiPolygon> {
  const t = f?.geometry?.type;
  return t === 'Polygon' || t === 'MultiPolygon';
}

export function prepare(g: Polygon | MultiPolygon): Prepared | null {
  const rs = rings(g);
  let n = 0;
  for (const r of rs) n += Math.max(0, r.length - 1);
  if (!n) return null;
  const edges = new Float64Array(n * 4);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let k = 0;
  for (const r of rs) {
    for (let i = 0; i < r.length - 1; i++) {
      const [x1, y1] = r[i];
      const [x2, y2] = r[i + 1];
      edges[k++] = x1; edges[k++] = y1; edges[k++] = x2; edges[k++] = y2;
      if (x1 < minX) minX = x1; if (x1 > maxX) maxX = x1;
      if (y1 < minY) minY = y1; if (y1 > maxY) maxY = y1;
    }
  }
  const nb = Math.max(1, Math.min(512, Math.ceil(n / 8)));
  const bandH = (maxY - minY) / nb || 1;
  const lists: number[][] = Array.from({ length: nb }, () => []);
  for (let e = 0; e < n; e++) {
    const y1 = edges[e * 4 + 1], y2 = edges[e * 4 + 3];
    const a = Math.max(0, Math.min(nb - 1, Math.floor((Math.min(y1, y2) - minY) / bandH)));
    const b = Math.max(0, Math.min(nb - 1, Math.floor((Math.max(y1, y2) - minY) / bandH)));
    for (let j = a; j <= b; j++) lists[j].push(e);
  }
  return { bbox: [minX, minY, maxX, maxY], edges, bandMinY: minY, bandH, bands: lists.map((l) => Int32Array.from(l)) };
}

export function contains(p: Prepared, x: number, y: number): boolean {
  const [w, s, e, n] = p.bbox;
  if (x < w || x > e || y < s || y > n) return false;
  const nb = p.bands.length;
  const bi = Math.max(0, Math.min(nb - 1, Math.floor((y - p.bandMinY) / p.bandH)));
  const band = p.bands[bi];
  const E = p.edges;
  let inside = false;
  for (let i = 0; i < band.length; i++) {
    const o = band[i] * 4;
    const y1 = E[o + 1], y2 = E[o + 3];
    if (y1 > y !== y2 > y) {
      const x1 = E[o], x2 = E[o + 2];
      if (x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
    }
  }
  return inside;
}

// R2 low-discrepancy sequence (Roberts 2018): unlike a regular lattice it does not quantise
// against axis-aligned edges, which are everywhere in PLSS-surveyed Michigan.
const R2A = 0.7548776662466927;
const R2B = 0.5698402909980532;

/**
 * Points inside the polygon (optionally clipped to a bbox) from a low-discrepancy sequence over
 * its bbox: `target` candidates first, up to 16× that for slivers until ≥ 12 points land inside.
 */
export function samplePoints(p: Prepared, target = 64, clip?: BBox): number[] {
  let [w, s, e, n] = p.bbox;
  if (clip) {
    w = Math.max(w, clip[0]); s = Math.max(s, clip[1]); e = Math.min(e, clip[2]); n = Math.min(n, clip[3]);
    if (w >= e || s >= n) return [];
  }
  const out: number[] = [];
  const max = target * 16;
  for (let i = 0; i < max; i++) {
    const x = w + ((0.5 + i * R2A) % 1) * (e - w);
    const y = s + ((0.5 + i * R2B) % 1) * (n - s);
    if (contains(p, x, y)) out.push(x, y);
    if (i + 1 >= target && out.length >= 24 && (i + 1) % target === 0) break;
  }
  return out;
}

/** Uniform grid over bboxes for candidate lookup. */
export class BBoxGrid<T> {
  private readonly cells = new Map<number, T[]>();
  private readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
  private key(i: number, j: number): number {
    return (i + 100000) * 200003 + (j + 100000);
  }
  insert(b: BBox, item: T): void {
    const s = this.size;
    const i0 = Math.floor(b[0] / s), i1 = Math.floor(b[2] / s), j0 = Math.floor(b[1] / s), j1 = Math.floor(b[3] / s);
    // Huge features (whole forests) would fill thousands of cells: cap by inserting per cell only
    // when the span is reasonable, else into a shared overflow list.
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4096) {
      this.overflow.push(item);
      return;
    }
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(item);
      }
  }
  private overflow: T[] = [];
  query(b: BBox): Set<T> {
    const s = this.size;
    const out = new Set<T>(this.overflow);
    const i0 = Math.floor(b[0] / s), i1 = Math.floor(b[2] / s), j0 = Math.floor(b[1] / s), j1 = Math.floor(b[3] / s);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) for (const it of this.cells.get(this.key(i, j)) ?? []) out.add(it);
    return out;
  }
}

export interface Shape<K> {
  key: K;
  prep: Prepared;
}

const prepCache = new WeakMap<object, Prepared | null>();

/** Prepared geometry for a feature, cached per geometry object. */
export function prepared(f: Feature): Prepared | null {
  if (!isAreal(f)) return null;
  const g = f.geometry;
  if (prepCache.has(g)) return prepCache.get(g)!;
  const p = prepare(g);
  prepCache.set(g, p);
  return p;
}

const bboxOverlap = (a: BBox, b: BBox): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** Reconciliation decides at these fractions (PARTIAL_FRACTION, COVER_FRACTION in grading/reconcile.ts). */
export const DECISION_THRESHOLDS = [0.1, 0.5] as const;
const REFINE_MARGIN = 0.08;
const REFINE_FACTOR = 12;

export function nearThreshold(fraction: number): boolean {
  return DECISION_THRESHOLDS.some((t) => Math.abs(fraction - t) < REFINE_MARGIN);
}

function measure<S>(target: Prepared, cands: Shape<S>[], samples: number, clip?: BBox): { key: S; fraction: number }[] {
  const pts = samplePoints(target, samples, clip);
  const total = pts.length / 2;
  const res: { key: S; fraction: number }[] = [];
  if (!total) return res;
  for (const c of cands) {
    let hit = 0;
    for (let i = 0; i < pts.length; i += 2) if (contains(c.prep, pts[i], pts[i + 1])) hit++;
    if (hit) res.push({ key: c.key, fraction: hit / total });
  }
  return res;
}

/**
 * For each target shape, the fraction of its sample points inside each overlapping source
 * shape. Returns only non-zero fractions.
 */
export function coverage<T, S>(targets: Shape<T>[], sources: Shape<S>[], opts: { samples?: number; cell?: number; clip?: BBox } = {}): Map<T, { key: S; fraction: number }[]> {
  const grid = new BBoxGrid<Shape<S>>(opts.cell ?? 0.01);
  for (const s of sources) grid.insert(s.prep.bbox, s);
  const out = new Map<T, { key: S; fraction: number }[]>();
  const clip = opts.clip;
  for (const t of targets) {
    const b = t.prep.bbox;
    const tb: BBox = clip ? [Math.max(b[0], clip[0]), Math.max(b[1], clip[1]), Math.min(b[2], clip[2]), Math.min(b[3], clip[3])] : b;
    if (tb[0] > tb[2] || tb[1] > tb[3]) continue;
    const cands = [...grid.query(tb)].filter((s) => bboxOverlap(s.prep.bbox, tb));
    if (!cands.length) continue;
    const base = opts.samples ?? 64;
    let res = measure(t.prep, cands, base, opts.clip);
    // A fraction close to a decision threshold gets a second, much denser pass so the
    // 10% / 50% calls are not decided by sampling noise (error drops to well under 1%).
    if (res.some((r) => nearThreshold(r.fraction))) res = measure(t.prep, cands, base * REFINE_FACTOR, opts.clip);
    if (res.length) out.set(t.key, res);
  }
  return out;
}
