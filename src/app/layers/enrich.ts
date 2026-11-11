// Glue between raw ArcGIS features and the grading module: every feature gets a stable id and
// flat `_`-prefixed properties the map styles and details sheet read.

import { area } from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { Grade, GradeResult, LayerSource } from '../../contract';
import { gradeFeature } from '../../grading/grade';
import { SQM_PER_ACRE } from '../util/geo';

export const P = {
  fid: '_fid',
  src: '_src',
  grade: '_grade',
  category: '_category',
  reason: '_reason',
  refs: '_refs',
  name: '_name',
  owner: '_owner',
} as const;

const GRADES: readonly Grade[] = ['green', 'yellow', 'red', 'unknown'];

export function isGrade(v: unknown): v is Grade {
  return typeof v === 'string' && (GRADES as readonly string[]).includes(v);
}

export function safeGrade(source: LayerSource, props: Record<string, unknown>): GradeResult {
  try {
    const g = gradeFeature(source, props);
    if (g && isGrade(g.grade)) return g;
  } catch (err) {
    console.warn(`gradeFeature failed for ${source.id}`, err);
  }
  return (
    source.fixedGrade ?? {
      grade: 'unknown',
      category: source.title,
      reason: 'This feature could not be graded. Verify ownership and rules before entering.',
    }
  );
}

function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function firstCoord(f: Feature): string {
  const g = f.geometry;
  if (!g || g.type === 'GeometryCollection') return '';
  let c: unknown = g.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) ? c.slice(0, 2).map((n) => Number(n).toFixed(6)).join(',') : '';
}

const OID_KEYS = ['OBJECTID', 'objectid', 'FID', 'OBJECTID_1', 'ObjectID'];

/** Stable id across overlapping bbox queries so features can be de-duplicated. */
export function featureKey(source: LayerSource, f: Feature): string {
  if (f.id !== undefined && f.id !== null && f.id !== '') return `${source.id}:${String(f.id)}`;
  const props = f.properties ?? {};
  for (const k of OID_KEYS) if (props[k] !== undefined && props[k] !== null) return `${source.id}:${String(props[k])}`;
  const pid = source.parcel?.parcelIdField;
  if (pid && props[pid]) return `${source.id}:p${String(props[pid])}`;
  return `${source.id}:h${hashString(JSON.stringify(props) + firstCoord(f))}`;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Mutates and returns the feature with grade + helper properties attached. */
export function enrichFeature(source: LayerSource, f: Feature): Feature {
  const props: Record<string, unknown> = { ...(f.properties ?? {}) };
  const g = safeGrade(source, props);
  const fid = featureKey(source, f);
  props[P.fid] = fid;
  props[P.src] = source.id;
  props[P.grade] = g.grade;
  props[P.category] = g.category;
  props[P.reason] = g.reason;
  props[P.refs] = JSON.stringify(g.references ?? []);
  const name = source.nameField ? str(props[source.nameField]) : '';
  props[P.name] = name;
  const owner = source.parcel?.ownerField ? str(props[source.parcel.ownerField]) : '';
  props[P.owner] = owner;
  return { type: 'Feature', geometry: f.geometry, properties: props };
}

export function acresOf(source: LayerSource, f: Feature): number | null {
  const field = source.parcel?.acresField;
  const raw = field ? f.properties?.[field] : undefined;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  const g = f.geometry;
  if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
    try {
      return area(f as Feature<Polygon | MultiPolygon>) / SQM_PER_ACRE;
    } catch {
      return null;
    }
  }
  return null;
}

export function parseRefs(raw: unknown): { label: string; url?: string }[] {
  if (typeof raw !== 'string') return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (r): r is { label: string; url?: string } => typeof r === 'object' && r !== null && typeof (r as { label?: unknown }).label === 'string',
    );
  } catch {
    return [];
  }
}

/** Sorting rank for the overlapping-features list: most permissive public land first. */
export function permissivenessRank(source: LayerSource | undefined, grade: Grade): number {
  const g = GRADES.indexOf(grade);
  const groupOrder: Record<string, number> = { 'public-land': 0, parcels: 1, 'hunting-units': 2, reference: 3 };
  const grp = source ? (groupOrder[source.group] ?? 4) : 5;
  // Graded land layers first, ordered by grade; unit/reference layers after.
  if (grp <= 1) return g * 10 + grp;
  return 100 + grp * 10 + g;
}
