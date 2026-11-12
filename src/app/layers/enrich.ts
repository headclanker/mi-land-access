// Glue between raw ArcGIS features and the grading module: every feature gets a stable id and
// flat `_`-prefixed properties the map styles and details sheet read.

import { area } from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { Grade, GradeResult, LayerSource, OwnerKind, Researched } from '../../contract';
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
  /** JSON Researched (contract) when the verdict comes from a researched unit rule, else ''. */
  researched: '_researched',
  name: '_name',
  owner: '_owner',
  // Parcels only: the owner-name grade, kept when reconciliation replaces _grade/_category/_reason.
  ownerGrade: '_ownerGrade',
  ownerCategory: '_ownerCategory',
  ownerReason: '_ownerReason',
  ownerRefs: '_ownerRefs',
  ownerKind: '_ownerKind',
  // Public-land features only: the layer's own grade, kept when the city-limits rule replaces
  // _grade/_category/_reason (see layers/reconcileLayers.ts).
  baseGrade: '_baseGrade',
  baseCategory: '_baseCategory',
  baseReason: '_baseReason',
  baseRefs: '_baseRefs',
  baseResearched: '_baseResearched',
  /** City whose limits hold the feature (parcels and public land; set by reconciliation). */
  city: '_city',
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
  props[P.researched] = researchedProp(g);
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
  if (source.group === 'public-land') {
    props[P.baseGrade] = g.grade;
    props[P.baseCategory] = g.category;
    props[P.baseReason] = g.reason;
    props[P.baseRefs] = props[P.refs];
    props[P.baseResearched] = props[P.researched];
    // Same values reconciliation writes outside every city, so it only re-sends layers it changed.
    props[P.city] = '';
    props[P.notes] = '[]';
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

/** Property value for GradeResult.researched ('' when absent). */
export function researchedProp(g: GradeResult): string {
  return g.researched ? JSON.stringify(g.researched) : '';
}

export function parseResearched(raw: unknown): Researched | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const v = JSON.parse(raw) as Researched;
    return v && typeof v.date === 'string' && typeof v.confidence === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
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

/**
 * Rebuilds a GradeResult from enriched properties: the current verdict, the parcel's owner-name
 * grade, or a public-land feature's own layer grade before the city-limits rule ('base'; falls
 * back to the current verdict on features without one).
 */
export function gradeFromProps(props: Record<string, unknown>, which: 'current' | 'owner' | 'base' = 'current'): GradeResult {
  const o = which === 'owner';
  const b = which === 'base' && props[P.baseGrade] !== undefined;
  const g = props[o ? P.ownerGrade : b ? P.baseGrade : P.grade];
  const refs = parseRefs(props[o ? P.ownerRefs : b ? P.baseRefs : P.refs]);
  const kind = o ? str(props[P.ownerKind]) : '';
  const researched = o ? undefined : parseResearched(props[b ? P.baseResearched : P.researched]);
  return {
    grade: isGrade(g) ? g : 'unknown',
    category: str(props[o ? P.ownerCategory : b ? P.baseCategory : P.category]),
    reason: str(props[o ? P.ownerReason : b ? P.baseReason : P.reason]),
    ...(refs.length ? { references: refs } : {}),
    ...(kind ? { ownerKind: kind as OwnerKind } : {}),
    ...(researched ? { researched } : {}),
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
