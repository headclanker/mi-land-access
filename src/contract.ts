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

export interface GradeResult {
  grade: Grade;
  /** Short label, e.g. "State Game Area", "Township-owned". */
  category: string;
  /** One or two plain sentences on why, and what to check before going. */
  reason: string;
  /** Optional rule/reg citations or links. */
  references?: { label: string; url?: string }[];
}

export type LayerGroup = 'public-land' | 'parcels' | 'hunting-units' | 'reference';

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
    acresField?: string;
    parcelIdField?: string;
  };
  /** Fixed grade for every feature in the layer, if the layer itself decides it. */
  fixedGrade?: GradeResult;
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
