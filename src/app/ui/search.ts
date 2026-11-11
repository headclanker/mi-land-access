// Name search with no new external service: state parks / recreation areas and state game &
// wildlife areas come from the same DNR ArcGIS layers the map already uses (a `where … LIKE`
// query), counties from the built-in county list + outlines, and markups from the device.
// Coordinates still work. Pure helpers are unit-tested.

import { bbox as turfBbox } from '@turf/turf';
import type { Feature, FeatureCollection } from 'geojson';
import type { LayerSource } from '../../contract';
import { MICHIGAN_COUNTIES } from '../../data/counties';
import type { BBox } from '../layers/arcgis';
import { parseLatLon } from '../util/coords';
import { markupCoords, kindLabel, type Markup } from '../markups/model';

export type ResultKind = 'coord' | 'park' | 'game-area' | 'county' | 'markup';

export interface SearchResult {
  kind: ResultKind;
  label: string;
  sub: string;
  /** Where to fly: a bbox, or a point (coordinates, waypoints). */
  bbox?: BBox;
  point?: [number, number];
  markupId?: string;
}

export const KIND_LABEL: Record<ResultKind, string> = {
  coord: 'Coordinates',
  park: 'State park / rec area',
  'game-area': 'Game / wildlife area',
  county: 'County',
  markup: 'My markup',
};

/** Normalises a query for matching: lower case, single spaces, no SQL wildcards or quotes. Pure. */
export function normQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[%_'"\\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `UPPER(a) LIKE '%WORD1%WORD2%' OR UPPER(b) LIKE …` for an ArcGIS where clause. Each word must
 * appear in order; quotes and wildcards in the input are stripped, so the clause is safe. Pure.
 */
export function likeWhere(fields: readonly string[], q: string): string {
  const words = normQuery(q).toUpperCase().split(' ').filter(Boolean);
  if (!words.length || !fields.length) return '1=0';
  const pattern = `%${words.join('%')}%`;
  return fields.map((f) => `UPPER(${f}) LIKE '${pattern}'`).join(' OR ');
}

/** Scores how well `name` matches `q` (higher is better; 0 = no match). Pure. */
export function matchScore(name: string, q: string): number {
  const n = normQuery(name);
  const nq = normQuery(q);
  if (!nq || !n) return 0;
  if (n === nq) return 100;
  if (n.startsWith(nq)) return 80;
  if (n.split(' ').some((w) => w.startsWith(nq))) return 60;
  const words = nq.split(' ');
  if (words.every((w) => n.includes(w))) return 40;
  return 0;
}

/** Michigan counties matching the query, best first ("St. Joseph" also matches "saint jo"). Pure. */
export function matchCounties(q: string, names: readonly string[] = MICHIGAN_COUNTIES.map((c) => c.name)): string[] {
  const nq = normQuery(q).replace(/\s+county$/, '').replace(/^saint\b/, 'st').replace(/\./g, '');
  if (nq.length < 2) return [];
  return names
    .map((n) => ({ n, s: Math.max(matchScore(n.replace(/\./g, ''), nq), matchScore(`${n} county`, nq)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.n.localeCompare(b.n))
    .map((x) => x.n);
}

/** The user's markups matching the query (name or note), best first. Pure. */
export function matchMarkups(q: string, markups: readonly Markup[], limit = 6): SearchResult[] {
  return markups
    .map((m) => ({ m, s: Math.max(matchScore(m.name, q), matchScore(m.note, q) / 2) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.m.updated - a.m.updated)
    .slice(0, limit)
    .map(({ m }) => {
      const cs = markupCoords(m);
      const xs = cs.map((c) => c[0]);
      const ys = cs.map((c) => c[1]);
      const r: SearchResult = { kind: 'markup', label: m.name || `Untitled ${kindLabel(m.kind).toLowerCase()}`, sub: kindLabel(m.kind), markupId: m.id };
      if (m.kind === 'waypoint') r.point = [m.coord[0], m.coord[1]];
      else r.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      return r;
    });
}

/** Groups features by a name field, merging bounding boxes (game areas come in many pieces). Pure. */
export function groupByName(fc: FeatureCollection, field: string): { name: string; bbox: BBox }[] {
  const out = new Map<string, BBox>();
  for (const f of fc.features as Feature[]) {
    const name = String(f.properties?.[field] ?? '').trim();
    if (!name || !f.geometry) continue;
    const b = turfBbox(f) as number[];
    if (!b.every(Number.isFinite)) continue;
    const prev = out.get(name);
    out.set(name, prev ? [Math.min(prev[0], b[0]), Math.min(prev[1], b[1]), Math.max(prev[2], b[2]), Math.max(prev[3], b[3])] : [b[0], b[1], b[2], b[3]]);
  }
  return [...out].map(([name, bbox]) => ({ name, bbox }));
}

interface RemoteDef {
  kind: 'park' | 'game-area';
  sourceId: string;
  /** Fields searched; the first is shown. */
  fields: string[];
}

const REMOTE: RemoteDef[] = [
  { kind: 'park', sourceId: 'dnr-state-parks', fields: ['Park_Label', 'UNIT_NAME'] },
  { kind: 'game-area', sourceId: 'dnr-wildlife-areas', fields: ['OfficialWLDProjectAreaName'] },
];

export interface SearchDeps {
  sources: readonly LayerSource[];
  markups: () => readonly Markup[];
  countyBBox: (name: string) => BBox | undefined;
}

export class Searcher {
  private readonly deps: SearchDeps;

  constructor(deps: SearchDeps) {
    this.deps = deps;
  }

  /** Instant results: coordinates, counties, markups. */
  local(q: string): SearchResult[] {
    const out: SearchResult[] = [];
    const p = parseLatLon(q);
    if (p) out.push({ kind: 'coord', label: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`, sub: 'Go to these coordinates', point: [p.lon, p.lat] });
    if (normQuery(q).length < 2) return out;
    for (const name of matchCounties(q).slice(0, 4)) {
      out.push({ kind: 'county', label: `${name} County`, sub: KIND_LABEL.county, bbox: this.deps.countyBBox(name) });
    }
    out.push(...matchMarkups(q, this.deps.markups()));
    return out;
  }

  /** Park and game-area names from the DNR layers. Throws when offline / the service fails. */
  async remote(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
    if (normQuery(q).length < 3 || parseLatLon(q)) return [];
    const results = await Promise.all(
      REMOTE.map(async (d) => {
        const src = this.deps.sources.find((s) => s.id === d.sourceId);
        if (!src) return [];
        const params = new URLSearchParams({
          where: likeWhere(d.fields, q),
          outFields: d.fields.join(','),
          returnGeometry: 'true',
          maxAllowableOffset: '0.005',
          geometryPrecision: '4',
          outSR: '4326',
          resultRecordCount: '60',
          f: 'geojson',
        });
        const res = await fetch(`${src.url}/query?${params}`, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const fc = (await res.json()) as FeatureCollection & { error?: { message?: string } };
        if (fc.error) throw new Error(fc.error.message ?? 'Search failed');
        return groupByName(fc, d.fields[0])
          .map((g) => ({ ...g, s: matchScore(g.name, q) || 10 }))
          .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name))
          .slice(0, 6)
          .map((g): SearchResult => ({ kind: d.kind, label: g.name, sub: KIND_LABEL[d.kind], bbox: g.bbox }));
      }),
    );
    return results.flat();
  }
}
