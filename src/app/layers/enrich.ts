// Glue between raw ArcGIS features and the grading module: every feature gets a stable id and
// flat `_`-prefixed properties the map styles and details sheet read.

import { area } from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { Grade, GradeResult, LayerSource, OwnerKind } from '../../contract';
import { gradeFeature } from '../../grading/grade';
import { tierOf } from '../../grading/reconcile';
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
  // Parcels only: the owner-name grade, kept when reconciliation replaces _grade/_category/_reason.
  ownerGrade: '_ownerGrade',
  ownerCategory: '_ownerCategory',
  ownerReason: '_ownerReason',
  ownerRefs: '_ownerRefs',
  ownerKind: '_ownerKind',
  // Parcels only, set by reconciliation (see layers/reconcileLayers.ts).
  /** 'fill' (own tint) | 'none' (colour comes from the adopted public layer) | 'conflict' (hatched). */
  tint: '_tint',
  conflict: '_conflict',
  adopted: '_adopted',
  split: '_split',
  notes: '_notes',
  overlaps: '_overlaps',
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
  if (source.group === 'parcels') {
    props[P.ownerGrade] = g.grade;
    props[P.ownerCategory] = g.category;
    props[P.ownerReason] = g.reason;
    props[P.ownerRefs] = props[P.refs];
    props[P.ownerKind] = g.ownerKind ?? '';
    props[P.tint] = 'fill';
    props[P.conflict] = false;
    props[P.adopted] = '';
  }
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

/** Rebuilds a GradeResult from enriched properties (current verdict, or the owner-name one). */
export function gradeFromProps(props: Record<string, unknown>, which: 'current' | 'owner' = 'current'): GradeResult {
  const o = which === 'owner';
  const g = props[o ? P.ownerGrade : P.grade];
  const refs = parseRefs(props[o ? P.ownerRefs : P.refs]);
  const kind = o ? str(props[P.ownerKind]) : '';
  return {
    grade: isGrade(g) ? g : 'unknown',
    category: str(props[o ? P.ownerCategory : P.category]),
    reason: str(props[o ? P.ownerReason : P.reason]),
    ...(refs.length ? { references: refs } : {}),
    ...(kind ? { ownerKind: kind as OwnerKind } : {}),
  };
}

/**
 * Sorting rank for the tap list: parcels (which carry the resolved verdict) first, then graded
 * public land by reconciliation precedence, then boundaries, units and reference layers.
 */
export function listRank(source: LayerSource | undefined): number {
  if (!source) return 999;
  if (source.group === 'parcels') return source.parcel?.ownerField ? 0 : 1;
  if (source.group === 'public-land') {
    if (source.role === 'boundary') return 50;
    const t = tierOf(source);
    return t === null ? 40 : 10 + t;
  }
  return source.group === 'hunting-units' ? 60 : 70;
}
