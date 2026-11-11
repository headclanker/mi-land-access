// Shared contract between the data/grading module and the app shell.
// Data agent implements these in src/data/** and src/grading/**.
// App agent consumes them from src/app/** and must not redefine them.

/** Access grade shown on the map. */
export type Grade = 'green' | 'yellow' | 'red' | 'unknown';

export const GRADE_COLORS: Record<Grade, string> = {
  green: '#2e9e4f', // clearly public / legally open to hunting (state forest, SGA, HAP, national forest, CFA...)
  yellow: '#e0b000', // possibly legal but uncertain: MDOT, township/county/city owned, road commission, etc.
  red: '#c8372d', // private or closed: permission required
  unknown: '#8a8f98',
};

/**
 * Who a county parcel's owner string says owns the land, as far as reconciliation needs to know
 * (set by the owner-name grader only; public-land layer grades leave it undefined):
 *   dnr     – Michigan DNR (incl. "state park" owners)
 *   usfs    – U.S. Forest Service
 *   state   – State of Michigan, agency not stated
 *   federal – federal government, agency not stated
 *   other   – a specific other public body, tribe, university, utility or conservancy
 *             (MDOT / State Highway Commission, township, county, city, road commission,
 *             Consumers Energy, FWS, NPS…)
 *   private – private individual, business, trust, club, church, railroad…
 *   none    – blank / missing owner name
 */
export type OwnerKind = 'dnr' | 'usfs' | 'state' | 'federal' | 'other' | 'private' | 'none';

export interface GradeResult {
  grade: Grade;
  /** Short label, e.g. "State Game Area", "Township-owned". */
  category: string;
  /** One or two plain sentences on why, and what to check before going. */
  reason: string;
  /** Optional rule/reg citations or links. */
  references?: { label: string; url?: string }[];
  /** Owner classification behind an owner-name grade (parcels only). See OwnerKind. */
  ownerKind?: OwnerKind;
}

export type LayerGroup = 'public-land' | 'parcels' | 'hunting-units' | 'reference';

/**
 * What a public-land layer's polygons mean, which decides how it is reconciled with county
 * parcels (src/grading/reconcile.ts):
 *   ownership      – who owns the surface (DNR managed lands, USFS, PAD-US)
 *   access-program – a program/zone that decides hunting access regardless of who owns it
 *                    (state park hunting zones, HAP, Commercial Forest)
 *   boundary       – an administrative project/park boundary that can include private
 *                    inholdings; never drawn or reported as a grade
 */
export type LayerRole = 'ownership' | 'access-program' | 'boundary';

/** One queryable map layer backed by an ArcGIS REST Feature/Map service layer. */
export interface LayerSource {
  id: string;
  title: string;
  group: LayerGroup;
  /** Full ArcGIS REST layer URL ending in /FeatureServer/<n> or /MapServer/<n>. */
  url: string;
  geometry: 'polygon' | 'line' | 'point';
  /** Attribution text for the map. */
  attribution: string;
  /** Minimum zoom at which features should be requested (parcels are heavy). */
  minZoom: number;
  /** Shown by default. */
  defaultVisible: boolean;
  /** Fields to request (outFields); keep small. */
  fields: string[];
  /** Optional server-side where clause. */
  where?: string;
  /** Field used as the display name of a feature. */
  nameField?: string;
  /** For hunting-unit layers: species this unit layer applies to (deer, elk, bear, turkey, ...). */
  species?: string[];
  /** For parcel layers: county name and field mapping. */
  parcel?: {
    county: string;
    ownerField?: string;
    ownerAddressFields?: string[];
    siteAddressField?: string;
    /**
     * Site address split over several fields (house number, direction, street, unit), joined in
     * order with spaces; blank and 0 parts are skipped. Takes precedence over siteAddressField.
     */
    siteAddressFields?: string[];
    /** Site city (or "CITY, ST ZIP") field, shown after the street: "921 GREEN, LANSING". */
    siteCityField?: string;
    acresField?: string;
    parcelIdField?: string;
  };
  /** Fixed grade for every feature in the layer, if the layer itself decides it. */
  fixedGrade?: GradeResult;
  /** Public-land layers: what the polygons mean (see LayerRole). */
  role?: LayerRole;
  /** Coarse national compilation: a county parcel with an owner name wins a disagreement. */
  lowConfidence?: boolean;
}

/** Implemented in src/data/sources.ts as `export const LAYER_SOURCES: LayerSource[]`. */
export type LayerCatalog = LayerSource[];

/**
 * Implemented in src/grading/grade.ts as `export function gradeFeature(...)`.
 * Grades one feature from its layer and attributes (owner name heuristics for parcels,
 * layer/attribute rules for public land).
 */
export type GradeFeatureFn = (
  source: LayerSource,
  properties: Record<string, unknown>,
) => GradeResult;
