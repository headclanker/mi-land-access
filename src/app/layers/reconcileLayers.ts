// Applies src/grading/reconcile.ts to what is loaded on the map: works out which public-land
// features overlap each loaded parcel (approximate, see coverage.ts), resolves one verdict per
// parcel and writes it into the parcel's properties. Also decides which low-confidence (PAD-US)
// fills to hide because parcels with owner names already cover them. Then applies the
// city-limits rule (cityOverride) to every parcel and to every graded public-land feature on its
// own, so a PAD-US local park inside a city draws red even where no parcel layer covers it.

import type { Feature } from 'geojson';
import type { LayerSource } from '../../contract';
import { COVER_FRACTION, cityOverride, cityOverrideFeature, reconcileParcel, tierOf, type Overlap } from '../../grading/reconcile';
import type { CityIndex } from './cities';
import { coverage, prepared, type BBox, type Shape } from './coverage';
import { P, gradeFromProps, researchedProp } from './enrich';
import { RESEARCHED_LAYER_IDS } from '../../data/parkRules';

export interface LoadedLayer {
  source: LayerSource;
  features: Iterable<Feature>;
}

/** Compact overlap summary stored on a parcel for the details sheet. */
export interface OverlapSummary {
  src: string;
  fid: string;
  grade: string;
  category: string;
  name: string;
  pct: number;
}

export interface ReconcileOutcome {
  /** Parcel layers whose feature properties changed (need setData). */
  changed: Set<string>;
  /** Low-confidence public features to hide (fill only), by source id. */
  masked: Map<string, Set<string>>;
  ms: number;
}

/** Overlaps below this share of a parcel are not listed (edge slivers). */
const LIST_MIN = 0.02;
/** A PAD-US feature is hidden under parcels when this share of its visible area is parcelled. */
const MASK_FRACTION = 0.5;

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Reconciliation may take part only for graded public layers (not boundaries). */
export function isReconcilable(s: LayerSource): boolean {
  return s.group === 'public-land' && tierOf(s) !== null;
}

/**
 * Public layers that must load whenever parcels are shown, even with their own fill off: the
 * authoritative ones, and low-confidence (PAD-US) layers that carry researched unit rules
 * (src/data/parkRules.ts), which can decide a parcel's verdict.
 */
export function loadsForParcels(s: LayerSource): boolean {
  return s.group === 'public-land' && (s.role === 'access-program' || (s.role === 'ownership' && (!s.lowConfidence || RESEARCHED_LAYER_IDS.has(s.id))));
}

export function reconcileLoaded(parcels: LoadedLayer[], publics: LoadedLayer[], opts: { visible: (id: string) => boolean; view: BBox; cities?: CityIndex | null }): ReconcileOutcome {
  const t0 = performance.now();
  const srcOf = new Map<Feature, LayerSource>();
  const pubShapes: Shape<Feature>[] = [];
  for (const l of publics) {
    if (!isReconcilable(l.source)) continue;
    for (const f of l.features) {
      const prep = prepared(f);
      if (!prep) continue;
      srcOf.set(f, l.source);
      pubShapes.push({ key: f, prep });
    }
  }
  const parcelShapes: Shape<Feature>[] = [];
  const parcelSrc = new Map<Feature, LayerSource>();
  for (const l of parcels)
    for (const f of l.features) {
      const prep = prepared(f);
      if (!prep) continue;
      parcelShapes.push({ key: f, prep });
      parcelSrc.set(f, l.source);
    }

  const cov = pubShapes.length ? coverage(parcelShapes, pubShapes) : new Map<Feature, { key: Feature; fraction: number }[]>();
  const changed = new Set<string>();
  const cities = opts.cities ?? null;

  // Public-land features on their own: the city rule decides their fill where no parcel does.
  for (const l of publics) {
    if (!isReconcilable(l.source)) continue;
    for (const f of l.features) {
      const props = f.properties as Record<string, unknown>;
      const city = cities?.of(f);
      const r = cityOverrideFeature(l.source, gradeFromProps(props, 'base'), city);
      const next: Record<string, unknown> = {
        [P.grade]: r.result.grade,
        [P.category]: r.result.category,
        [P.reason]: r.result.reason,
        [P.refs]: JSON.stringify(r.result.references ?? []),
        [P.researched]: researchedProp(r.result),
        [P.city]: city ?? '',
        [P.notes]: JSON.stringify(r.notes),
      };
      let diff = false;
      for (const k in next) if (props[k] !== next[k]) diff = true;
      if (diff) {
        Object.assign(props, next);
        changed.add(l.source.id);
      }
    }
  }

  for (const { key: f } of parcelShapes) {
    const props = f.properties as Record<string, unknown>;
    const owner = gradeFromProps(props, 'owner');
    const hits = cov.get(f) ?? [];
    const overlaps: Overlap[] = hits.map(({ key, fraction }) => {
      const pp = key.properties as Record<string, unknown>;
      return { source: srcOf.get(key)!, grade: gradeFromProps(pp, 'base'), fraction, name: str(pp[P.name]) || undefined };
    });
    const city = cities?.of(f);
    const r = cityOverride(reconcileParcel(owner, overlaps, str(props[P.owner])), city);
    const adoptedSrc = r.adoptedFrom ? publics.find((l) => l.source.id === r.adoptedFrom)?.source : undefined;
    // A verdict the city rule changed is the parcel's own: it draws its own fill.
    const tint = r.conflict ? 'conflict' : r.cityRule !== 'closed' && adoptedSrc && !adoptedSrc.lowConfidence && opts.visible(adoptedSrc.id) ? 'none' : 'fill';
    // One line per layer + status + name (a parcel often meets several tracts of the same thing).
    const grouped = new Map<string, OverlapSummary & { f: number }>();
    for (const { key, fraction } of hits) {
      const pp = key.properties as Record<string, unknown>;
      const own = gradeFromProps(pp, 'base');
      const o = { src: srcOf.get(key)!.id, fid: str(pp[P.fid]), grade: own.grade as string, category: own.category, name: str(pp[P.name]), pct: 0, f: 0 };
      const k = `${o.src}|${o.grade}|${o.category}|${o.name}`;
      const g = grouped.get(k) ?? o;
      g.f = Math.min(1, g.f + fraction);
      grouped.set(k, g);
    }
    const summary: OverlapSummary[] = [...grouped.values()]
      .filter((g) => g.f >= LIST_MIN)
      .sort((a, b) => b.f - a.f)
      .map(({ f, ...o }) => ({ ...o, pct: Math.round(f * 100) }));
    const next: Record<string, unknown> = {
      [P.grade]: r.result.grade,
      [P.category]: r.result.category,
      [P.reason]: r.result.reason,
      [P.refs]: JSON.stringify(r.result.references ?? []),
      [P.researched]: researchedProp(r.result),
      [P.tint]: tint,
      [P.conflict]: r.conflict,
      [P.adopted]: r.adoptedFrom ?? '',
      // A parcel mostly inside a national wildlife refuge takes the refuge colour.
      [P.refuge]: hits.reduce((sum, { key, fraction }) => sum + ((key.properties as Record<string, unknown>)[P.refuge] === true ? fraction : 0), 0) >= COVER_FRACTION,
      [P.split]: r.split,
      [P.city]: city ?? '',
      [P.notes]: JSON.stringify(r.notes),
      [P.overlaps]: JSON.stringify(summary),
    };
    let diff = false;
    for (const k in next) if (props[k] !== next[k]) diff = true;
    if (diff) {
      Object.assign(props, next);
      changed.add(parcelSrc.get(f)!.id);
    }
  }

  // Low-confidence fills under parcels: hide them, the parcels carry the colour.
  const masked = new Map<string, Set<string>>();
  const lowConf = publics.filter((l) => l.source.lowConfidence && opts.visible(l.source.id));
  for (const l of lowConf) masked.set(l.source.id, new Set());
  if (lowConf.length && parcelShapes.length) {
    const lcShapes: Shape<Feature>[] = [];
    for (const l of lowConf)
      for (const f of l.features) {
        const prep = prepared(f);
        if (prep) lcShapes.push({ key: f, prep });
      }
    const under = coverage(lcShapes, parcelShapes, { clip: opts.view, cell: 0.005 });
    for (const [f, parts] of under) {
      const share = Math.min(1, parts.reduce((a, p) => a + p.fraction, 0));
      if (share >= MASK_FRACTION) masked.get(str(f.properties?.[P.src]))?.add(str(f.properties?.[P.fid]));
    }
  }
  return { changed, masked, ms: performance.now() - t0 };
}

export function parseOverlaps(raw: unknown): OverlapSummary[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as OverlapSummary[]) : [];
  } catch {
    return [];
  }
}

export function parseNotes(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
