// One verdict per piece of ground.
//
// A county parcel is graded from its owner name; the public-land layers grade the same ground
// independently. reconcileParcel() merges them into a single resolved GradeResult, keeping the
// owner-name grade and every overlapping layer so the details sheet can show its working.
//
// "Covers" means the layer's polygons cover at least half of the parcel (COVER_FRACTION).
// Precedence of covering layers, highest first:
//   1. dnr-park-hunting   – the DNR's per-zone open / restricted / closed status
//   2. dnr-hap            – Hunting Access Program lease
//   3. commercial-forest  – Commercial Forest Act enrollment (public foot access)
//   4. high-confidence ownership layers (dnr-managed-lands, usfs-surface-ownership)
//   5. the parcel's own owner-name grade
//   6. low-confidence ownership layers (PAD-US)
// Within one tier the most restrictive grade wins. Boundary layers never take part.
// Partial overlaps (PARTIAL_FRACTION ≤ f < COVER_FRACTION) never change the grade; they add a note.
//
// Last, cityOverride() applies the city-limits rule: inside an incorporated city, ground that
// would otherwise be yellow is treated as closed (red), because city ordinances generally
// prohibit hunting and firearm discharge; green verdicts from state/federal records and yellow
// state access programs (restricted park zones, restricted HAP) keep their status with a note.
//
// Pure module: no DOM, no map. Tested in reconcile.test.ts.

import type { Grade, GradeResult, LayerSource, OwnerKind } from '../contract.ts';
import { CITY_OWNED_CATEGORY, CITY_RULE_CAVEAT } from './grade.ts';

export const COVER_FRACTION = 0.5;
export const PARTIAL_FRACTION = 0.1;

/** Access-program layers in precedence order. An unlisted access-program layer ranks after these. */
export const ACCESS_PROGRAM_ORDER = ['dnr-park-hunting', 'dnr-hap', 'commercial-forest'] as const;

/** One public-land feature overlapping the parcel. */
export interface Overlap {
  source: LayerSource;
  grade: GradeResult;
  /** Share of the parcel's area inside this feature, 0–1. */
  fraction: number;
  /** Display name of the feature (park, unit, project), if any. */
  name?: string;
}

export interface Reconciled {
  /** The single verdict for this parcel. */
  result: GradeResult;
  /** The parcel's own owner-name grade, unchanged. */
  owner: GradeResult;
  /** Layer id whose verdict was adopted (the parcel's colour comes from that layer). */
  adoptedFrom?: string;
  /** The records disagree in a way the user must check (drawn hatched). */
  conflict: boolean;
  /** The adopted layer splits the parcel into zones with different grades. */
  split: boolean;
  /** Short plain-language notes for the details sheet. */
  notes: string[];
  /** Set by cityOverride(): the city whose limits hold this ground. */
  city?: string;
  /** Set by cityOverride(): 'closed' when the city rule changed the grade, 'note' when it only added a note. */
  cityRule?: 'closed' | 'note';
  /** Set when cityOverride() changed the grade: the verdict without the city rule. */
  beforeCity?: GradeResult;
}

const RESTRICTIVENESS: Record<Grade, number> = { green: 0, unknown: 1, yellow: 2, red: 3 };

export function moreRestrictive(a: Grade, b: Grade): Grade {
  return RESTRICTIVENESS[a] >= RESTRICTIVENESS[b] ? a : b;
}

const GRADE_WORD: Record<Grade, string> = { green: 'open', yellow: 'check first', red: 'private / closed', unknown: 'unknown' };

/** Precedence tier of a layer (lower wins), or null when the layer never grades a parcel. */
export function tierOf(source: LayerSource): number | null {
  if (source.role === 'access-program') {
    const i = (ACCESS_PROGRAM_ORDER as readonly string[]).indexOf(source.id);
    return 1 + (i < 0 ? ACCESS_PROGRAM_ORDER.length : i);
  }
  if (source.role === 'ownership') return source.lowConfidence ? 6 : 4;
  return null;
}

const OWNER_TIER = 5;

/** Owner kinds whose record is generic enough that an authoritative land layer decides. */
const ADOPT_KINDS: ReadonlySet<OwnerKind> = new Set(['dnr', 'usfs', 'state', 'federal', 'none']);

interface LayerAgg {
  source: LayerSource;
  tier: number;
  fraction: number;
  /** Features that matter for the grade (≥ PARTIAL_FRACTION, or the largest one). */
  features: Overlap[];
}

function pct(f: number): number {
  return Math.max(1, Math.min(100, Math.round(f * 100)));
}

function ownerLabel(ownerName: string | undefined): string {
  const n = (ownerName ?? '').trim();
  return n ? n : 'an unnamed owner';
}

function featureLabel(o: Overlap): string {
  return o.name ? `${o.name} (${o.grade.category})` : o.grade.category;
}

function aggregate(overlaps: Overlap[]): LayerAgg[] {
  const byLayer = new Map<string, LayerAgg>();
  for (const o of overlaps) {
    const tier = tierOf(o.source);
    if (tier === null || !(o.fraction > 0) || o.grade.grade === 'unknown') continue;
    let a = byLayer.get(o.source.id);
    if (!a) byLayer.set(o.source.id, (a = { source: o.source, tier, fraction: 0, features: [] }));
    a.fraction = Math.min(1, a.fraction + o.fraction);
    a.features.push(o);
  }
  for (const a of byLayer.values()) {
    a.features.sort((x, y) => y.fraction - x.fraction);
    const big = a.features.filter((f) => f.fraction >= PARTIAL_FRACTION);
    a.features = big.length ? big : a.features.slice(0, 1);
  }
  return [...byLayer.values()];
}

/** The most restrictive feature among covering layers of one tier. */
function strictest(layers: LayerAgg[]): { layer: LayerAgg; feature: Overlap } {
  let best: { layer: LayerAgg; feature: Overlap } | null = null;
  for (const layer of layers)
    for (const feature of layer.features)
      if (!best || RESTRICTIVENESS[feature.grade.grade] > RESTRICTIVENESS[best.feature.grade.grade]) best = { layer, feature };
  return best!;
}

function withRefs(base: GradeResult, extra: GradeResult): GradeResult['references'] {
  const seen = new Set<string>();
  const out: NonNullable<GradeResult['references']> = [];
  for (const r of [...(base.references ?? []), ...(extra.references ?? [])]) {
    if (seen.has(r.label)) continue;
    seen.add(r.label);
    out.push(r);
  }
  return out.length ? out : undefined;
}

function make(grade: Grade, category: string, reason: string, references?: GradeResult['references']): GradeResult {
  return references && references.length ? { grade, category, reason, references } : { grade, category, reason };
}

function resolve(owner: GradeResult, overlaps: Overlap[], ownerName?: string): Reconciled {
  const kind: OwnerKind = owner.ownerKind ?? (owner.grade === 'unknown' ? 'none' : owner.grade === 'red' ? 'private' : 'other');
  const layers = aggregate(overlaps);
  const notes: string[] = [];
  const who = ownerLabel(ownerName);

  // Partial overlaps: never change the grade.
  for (const a of layers) {
    if (a.fraction >= PARTIAL_FRACTION && a.fraction < COVER_FRACTION) {
      notes.push(`About ${pct(a.fraction)}% of this parcel overlaps ${a.source.title} (${a.features[0].grade.category}) — boundary data may be misaligned.`);
    }
  }

  const covering = layers.filter((a) => a.fraction >= COVER_FRACTION);
  const topTier = covering.reduce((t, a) => Math.min(t, a.tier), Infinity);
  const done = (result: GradeResult, extra: Partial<Reconciled> = {}): Reconciled => ({
    result,
    owner,
    conflict: false,
    split: false,
    notes,
    ...extra,
  });

  if (topTier > OWNER_TIER) {
    // Only low-confidence layers (or nothing) cover the parcel.
    if (!covering.length) return done(owner);
    const { layer, feature } = strictest(covering);
    if (kind === 'none') {
      notes.push(`No owner name in the county record; using ${layer.source.title}.`);
      return done(feature.grade, { adoptedFrom: layer.source.id });
    }
    if (feature.grade.grade !== owner.grade) {
      notes.push(`${layer.source.title} lists this as ${featureLabel(feature)} — ${GRADE_WORD[feature.grade.grade]}. That national compilation is coarse; the county parcel record takes precedence.`);
    }
    return done(owner);
  }

  const tierLayers = covering.filter((a) => a.tier === topTier);
  const { layer, feature } = strictest(tierLayers);
  const g = feature.grade;
  const grades = new Set(tierLayers.flatMap((a) => a.features.map((f) => f.grade.grade)));
  const split = grades.size > 1;
  const id = layer.source.id;
  if (split) {
    const shares = new Map<string, number>();
    for (const f of tierLayers.flatMap((a) => a.features)) {
      const k = `${f.name ? `${f.name}: ` : ''}${f.grade.category}`;
      shares.set(k, Math.min(1, (shares.get(k) ?? 0) + f.fraction));
    }
    const parts = [...shares].map(([k, f]) => `${k} (about ${pct(f)}%)`).join('; ');
    notes.push(`This parcel spans zones with different status — ${parts}. The strictest is shown; check the zone lines on the map.`);
  }

  // 1. State park hunting zones.
  if (id === 'dnr-park-hunting') {
    if (kind === 'private' && g.grade !== 'red') {
      return done(
        make(
          'yellow',
          'Records disagree',
          `The county parcel record says this is privately owned by ${who}, but the DNR park hunting map shows it inside ${featureLabel(feature)}. It may be a recent sale, an inholding or a mapping error — verify ownership before entering.`,
          withRefs(g, owner),
        ),
        { conflict: true, split },
      );
    }
    if (kind === 'private') notes.push(`The county parcel record lists a private owner (${who}); the DNR park map shows this zone closed. Either way, do not hunt without permission.`);
    else if (owner.grade !== g.grade && kind !== 'none') notes.push(`The owner name alone suggested “${owner.category}”; the DNR's park hunting zone decides.`);
    return done(g, { adoptedFrom: id, split });
  }

  // 2. Hunting Access Program.
  if (id === 'dnr-hap') {
    const restricted = g.grade !== 'green';
    const category = restricted ? 'HAP – private land, restricted public hunting' : 'HAP – private land open to public hunting';
    const ownerBit = kind === 'none' ? '' : ` County owner record: ${who}.`;
    return done(make(g.grade, category, `${g.reason}${ownerBit}`, g.references), { adoptedFrom: id, split });
  }

  // 3. Commercial Forest.
  if (id === 'commercial-forest') {
    const ownerBit = ` Owner (county record): ${who}.`;
    if (g.grade === 'green') {
      return done(
        make(
          'green',
          'Commercial Forest (private, public foot access)',
          `Privately owned land enrolled in the Commercial Forest program: open to the public on foot for hunting, fishing and trapping only. No motorized access, camping or permanent blinds without the owner's permission.${ownerBit}`,
          g.references,
        ),
        { adoptedFrom: id, split },
      );
    }
    return done(make(g.grade, g.category, `${g.reason}${ownerBit}`, g.references), { adoptedFrom: id, split });
  }

  // 4. High-confidence ownership layers (DNR managed lands, USFS).
  if (topTier === 4) {
    if (ADOPT_KINDS.has(kind)) {
      if (kind !== 'none' && owner.grade !== g.grade) notes.push(`The county record names “${ownerName?.trim() || owner.category}” (${owner.category}); ${layer.source.title} identifies the land.`);
      return done(g, { adoptedFrom: id, split });
    }
    if (kind === 'private') {
      return done(
        make(
          moreRestrictive('yellow', g.grade),
          'Records disagree',
          `The county parcel record says this is privately owned by ${who}, but ${layer.source.title} shows it as public land (${featureLabel(feature)}). It may be a recent sale, an inholding or a mapping error — verify ownership before entering.`,
          withRefs(owner, g),
        ),
        { conflict: true, split },
      );
    }
    // A specific other public body or utility: keep the more restrictive record.
    const keep = moreRestrictive(owner.grade, g.grade);
    notes.push(`County record: ${who} (${owner.category}). ${layer.source.title}: ${featureLabel(feature)}. The more restrictive of the two is shown — check with both before hunting.`);
    if (keep === owner.grade) return done(owner, { conflict: owner.grade !== g.grade, split });
    return done(g, { adoptedFrom: id, split });
  }

  return done(owner);
}

/**
 * Two authoritative public layers can cover the same parcel and disagree (e.g. a DNR trail
 * corridor that is also enrolled Commercial Forest). The higher-precedence layer normally
 * decides, but it must never hide a stricter authoritative record: if a lower-precedence,
 * high-confidence covering layer is more restrictive than the verdict, the stricter grade is
 * shown and the parcel is flagged as a disagreement.
 */
function crossCheck(r: Reconciled, overlaps: Overlap[]): Reconciled {
  if (!r.adoptedFrom) return r;
  const covering = aggregate(overlaps).filter((a) => a.fraction >= COVER_FRACTION && a.tier <= 4 && a.source.id !== r.adoptedFrom);
  if (!covering.length) return r;
  const { layer, feature } = strictest(covering);
  if (RESTRICTIVENESS[feature.grade.grade] <= RESTRICTIVENESS[r.result.grade]) return r;
  const adopted = overlaps.find((o) => o.source.id === r.adoptedFrom)?.source.title ?? 'another layer';
  return {
    ...r,
    result: make(
      feature.grade.grade,
      'Records disagree',
      `${adopted} shows this as ${r.result.category} (${GRADE_WORD[r.result.grade]}), but ${layer.source.title} shows ${featureLabel(feature)} (${GRADE_WORD[feature.grade.grade]}). The stricter record is shown — check with the DNR before hunting.`,
      withRefs(r.result, feature.grade),
    ),
    adoptedFrom: undefined,
    conflict: true,
    notes: [...r.notes, `Two public-land records cover this parcel and disagree: ${adopted} and ${layer.source.title}.`],
  };
}

/**
 * Resolves the parcel's verdict.
 * @param owner the owner-name GradeResult (with ownerKind) — or, for a map point with no
 *   parcel, a blank-owner result ({ownerKind: 'none'}).
 * @param overlaps every public-land feature overlapping the parcel, with its own grade.
 * @param ownerName the raw owner string, for wording.
 */
export function reconcileParcel(owner: GradeResult, overlaps: Overlap[], ownerName?: string): Reconciled {
  return crossCheck(resolve(owner, overlaps, ownerName), overlaps);
}

/** Blank-owner input for resolving a bare map point (no parcel under it). */
export const NO_PARCEL: GradeResult = {
  grade: 'unknown',
  category: 'No ownership record here',
  reason: 'No parcel or land-ownership layer covers this spot. Verify ownership before entering.',
  ownerKind: 'none',
};

// ---------------------------------------------------------------------------
// City limits
// ---------------------------------------------------------------------------

/**
 * State access programs that open land to hunting whoever owns it. A yellow verdict adopted from
 * one of these (a restricted park zone, a restricted HAP lease) is the state's own decision and
 * is not closed by the city rule; it gets the city note instead.
 */
export const CITY_EXEMPT_PROGRAMS: ReadonlySet<string> = new Set(['dnr-park-hunting', 'dnr-hap']);

export function cityNote(city: string): string {
  return `Inside ${city} city limits — local firearm-discharge ordinances may still apply; check before hunting.`;
}

export function cityCategory(category: string, city: string): string {
  return `${category} – inside ${city} city limits`;
}

/**
 * The city-limits rule, applied after reconcileParcel() (or to a bare map point, or to one
 * public-land feature on its own). `city` is the city whose limits hold the parcel (≥ half its
 * area) or the point; undefined outside every city leaves the verdict untouched.
 *   yellow → red, "<category> – inside <City> city limits" (except yellow adopted from a state
 *            access program, see CITY_EXEMPT_PROGRAMS, which keeps its grade with a note);
 *   green / unknown → unchanged, with a note (the state or federal record decides);
 *   red → unchanged; a note only for private land (permission does not lift a city ordinance).
 */
export function cityOverride(r: Reconciled, city: string | undefined): Reconciled {
  const name = city?.trim();
  if (!name) return r;
  const g = r.result;
  const note = cityNote(name);
  if (g.grade === 'yellow' && !(r.adoptedFrom && CITY_EXEMPT_PROGRAMS.has(r.adoptedFrom))) {
    return {
      ...r,
      result: make(
        'red',
        cityCategory(g.category, name),
        `Inside ${name} city limits: city ordinances in Michigan generally prohibit hunting and discharging firearms or bows inside city limits, so this land is treated as closed — verify with the City of ${name}. ${CITY_RULE_CAVEAT} Without the city rule: ${g.reason}`,
        g.references,
      ),
      city: name,
      cityRule: 'closed',
      beforeCity: g,
    };
  }
  const isPrivate = (r.owner.ownerKind ?? (r.owner.grade === 'red' ? 'private' : undefined)) === 'private';
  const wantNote = g.grade !== 'red' || (isPrivate && g.category !== CITY_OWNED_CATEGORY);
  return { ...r, notes: wantNote ? [...r.notes, note] : r.notes, city: name, cityRule: 'note' };
}

/** cityOverride() for one public-land feature graded on its own (no parcel layer under it). */
export function cityOverrideFeature(source: LayerSource, grade: GradeResult, city: string | undefined): Reconciled {
  const base: Reconciled = { result: grade, owner: NO_PARCEL, adoptedFrom: source.id, conflict: false, split: false, notes: [] };
  return cityOverride(base, city);
}
