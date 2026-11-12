// Pure logic for the 3D view (terrain + buildings): persisted settings, exaggeration clamp,
// data URLs and credits, the camera targets for entering / leaving 3D, DEM decoding and the
// clipped data-loading box for a tilted camera. No MapLibre or DOM imports, so it unit-tests in node.

export type HillshadeMode = 'off' | '3d' | 'always';

export interface View3DPrefs {
  /** 3D mode (terrain + tilt) on. */
  on: boolean;
  /** Terrain height multiplier. */
  exaggeration: number;
  /** Extruded buildings while in 3D. */
  buildings: boolean;
  /** Shaded relief: never, only in 3D, or on the flat map too. */
  hillshade: HillshadeMode;
  /** Camera tilt / bearing last used in 3D (restored on reload). */
  pitch: number;
  bearing: number;
}

/** Michigan is flat: 1× reads as almost nothing, 3× is the most before dunes look silly. */
export const EXAGGERATION_STEPS = [1, 1.5, 2, 3] as const;
export const EXAGGERATION_MIN = 1;
export const EXAGGERATION_MAX = 3;
export const DEFAULT_EXAGGERATION = 1.5;

/** Tilt used when entering 3D, and the most the user may tilt while in 3D. */
export const PITCH_3D = 58;
export const MAX_PITCH_3D = 72;
/** Buildings appear from this zoom (OpenMapTiles carries them from z13; z14 is the source max). */
export const BUILDINGS_MINZOOM = 14;
/** Default building height (m) when OpenStreetMap has no height or levels (about two storeys). */
export const DEFAULT_BUILDING_HEIGHT = 6;

export const DEFAULT_3D: View3DPrefs = {
  on: false,
  exaggeration: DEFAULT_EXAGGERATION,
  buildings: true,
  hillshade: '3d',
  pitch: PITCH_3D,
  bearing: 0,
};

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Clamps a terrain exaggeration to 1–3× (rounded to 0.1); anything unusable gives the default. */
export function clampExaggeration(x: unknown): number {
  const n = typeof x === 'string' ? Number(x) : x;
  if (!isNum(n) || n <= 0) return DEFAULT_EXAGGERATION;
  return Math.round(Math.min(EXAGGERATION_MAX, Math.max(EXAGGERATION_MIN, n)) * 10) / 10;
}

export function clampPitch3D(p: unknown): number {
  if (!isNum(p)) return PITCH_3D;
  // A saved near-flat tilt would make "3D" look broken after a reload; start at a readable tilt.
  if (p < 20) return PITCH_3D;
  return Math.min(MAX_PITCH_3D, p);
}

/** Saved settings → a complete, valid settings object (old or hand-edited storage is tolerated). */
export function normalizePrefs(raw: unknown): View3DPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof View3DPrefs, unknown>>;
  const hs = r.hillshade;
  return {
    on: r.on === true,
    exaggeration: clampExaggeration(r.exaggeration),
    buildings: r.buildings !== false,
    hillshade: hs === 'off' || hs === '3d' || hs === 'always' ? hs : DEFAULT_3D.hillshade,
    pitch: clampPitch3D(r.pitch),
    bearing: isNum(r.bearing) ? ((r.bearing % 360) + 360) % 360 : 0,
  };
}

// ---------- mode state machine ----------

/** What the map should have for a given set of settings. */
export interface View3DPlan {
  terrain: boolean;
  hillshade: boolean;
  buildings: boolean;
  /** Elevation tiles are needed at all (otherwise none are requested). */
  dem: boolean;
  maxPitch: number;
}

export function planFor(p: View3DPrefs): View3DPlan {
  const hillshade = p.hillshade === 'always' || (p.hillshade === '3d' && p.on);
  return {
    terrain: p.on,
    hillshade,
    buildings: p.on && p.buildings,
    dem: p.on || hillshade,
    maxPitch: p.on ? MAX_PITCH_3D : 0,
  };
}

export type View3DAction =
  | { type: 'toggle' }
  | { type: 'set'; on: boolean }
  | { type: 'exaggeration'; value: unknown }
  | { type: 'buildings'; on: boolean }
  | { type: 'hillshade'; mode: HillshadeMode }
  | { type: 'camera'; pitch: number; bearing: number };

/** Next settings after a user action. Pure; the caller persists and applies the result. */
export function reduce(p: View3DPrefs, a: View3DAction): View3DPrefs {
  switch (a.type) {
    case 'toggle':
      return { ...p, on: !p.on };
    case 'set':
      return p.on === a.on ? p : { ...p, on: a.on };
    case 'exaggeration':
      return { ...p, exaggeration: clampExaggeration(a.value) };
    case 'buildings':
      return { ...p, buildings: a.on };
    case 'hillshade':
      return { ...p, hillshade: a.mode };
    case 'camera':
      // Only remembered while in 3D, and only a real tilt (the leave animation passes through 0).
      if (!p.on || a.pitch < 20) return p;
      return { ...p, pitch: clampPitch3D(a.pitch), bearing: normalizePrefs({ bearing: a.bearing }).bearing };
  }
}

/**
 * Camera for entering / leaving 3D. Leaving returns to a flat, north-up map unless the compass
 * "heading up" mode owns the bearing, in which case only the tilt changes.
 */
export function cameraFor(on: boolean, p: View3DPrefs, headingUp: boolean): { pitch: number; bearing?: number } {
  if (on) return headingUp ? { pitch: clampPitch3D(p.pitch) } : { pitch: clampPitch3D(p.pitch), bearing: p.bearing };
  return headingUp ? { pitch: 0 } : { pitch: 0, bearing: 0 };
}

// ---------- data sources ----------

export const DEM_TILE_TEMPLATE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const DEM_MAXZOOM = 15;
/** The PNGs are 256 px. Hillshade draws them at that size (crisp relief); the terrain mesh treats
 *  them as 512 px — one zoom level coarser, a quarter of the requests, and it avoids needle-like
 *  mesh spikes MapLibre 6 draws at some tile seams with 256-px elevation tiles. */
export const DEM_TILE_SIZE = 256;
export const TERRAIN_TILE_SIZE = 512;
export const BUILDINGS_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const BUILDINGS_SOURCE_LAYER = 'building';

/** One elevation tile URL. */
export function demTileUrl(z: number, x: number, y: number, template = DEM_TILE_TEMPLATE): string {
  if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0)) throw new Error(`Bad tile ${z}/${x}/${y}`);
  const max = 2 ** z;
  if (x >= max || y >= max) throw new Error(`Tile ${z}/${x}/${y} out of range`);
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** True for an AWS Terrain Tiles (terrarium) URL — mirrors the service-worker cache rule. */
export function isDemTileUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.hostname === 's3.amazonaws.com' && url.pathname.startsWith('/elevation-tiles-prod/terrarium/');
  } catch {
    return false;
  }
}

/** True for an OpenFreeMap vector tile or TileJSON URL — mirrors the service-worker cache rule. */
export function isBuildingTileUrl(u: string): boolean {
  try {
    return new URL(u).hostname === 'tiles.openfreemap.org';
  } catch {
    return false;
  }
}

const A = (href: string, text: string): string => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

/** Short map credit for AWS Terrain Tiles; the full source list is in More → Data sources. */
export const TERRAIN_ATTRIBUTION = `Terrain: ${A('https://github.com/tilezen/joerd/blob/master/docs/attribution.md', 'Mapzen / AWS Terrain Tiles')} (USGS 3DEP, SRTM, GMTED2010, NOAA ETOPO1; Canada OGL)`;
export const BUILDINGS_ATTRIBUTION = `Buildings: ${A('https://openfreemap.org', 'OpenFreeMap')} ${A('https://www.openmaptiles.org/', '© OpenMapTiles')}, data ${A('https://www.openstreetmap.org/copyright', '© OpenStreetMap')} contributors`;

/** Plain-text credits for the "Data sources" list (the dataset's standard attribution list, Michigan-relevant first). */
export const TERRAIN_CREDITS_TEXT = [
  'Elevation: Mapzen Terrain Tiles on AWS (Registry of Open Data). United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey; Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration; Canada terrain data contains information licensed under the Open Government Licence – Canada; other regions as listed in the Terrain Tiles attribution.',
  '3D buildings: OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors.',
];

/** Credits the map should show for what is currently drawn (deduplicated, stable order). */
export function attributionsFor(plan: Pick<View3DPlan, 'terrain' | 'hillshade' | 'buildings'>): string[] {
  const out: string[] = [];
  if (plan.terrain || plan.hillshade) out.push(TERRAIN_ATTRIBUTION);
  if (plan.buildings) out.push(BUILDINGS_ATTRIBUTION);
  return out;
}

// ---------- elevation ----------

/** Terrarium-encoded pixel → metres above sea level. */
export function terrariumElevation(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export const metresToFeet = (m: number): number => m / 0.3048;

/** "≈ 1,234 ft" (rounded to 10 ft — the data is not better than that). */
export function formatElevationFt(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '';
  const ft = Math.round(metresToFeet(m) / 10) * 10;
  return `≈ ${ft.toLocaleString('en-US')} ft`;
}

/** Elevation reported by a terrain mesh drawn at an exaggeration → true elevation. */
export function trueElevation(rendered: number | null | undefined, exaggeration: number): number | null {
  if (rendered === null || rendered === undefined || !Number.isFinite(rendered)) return null;
  return rendered / (exaggeration > 0 ? exaggeration : 1);
}

/** Tile and pixel holding a location at zoom z (256-px tiles). */
export function tilePixel(lon: number, lat: number, z: number, size = 256): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const latR = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.max(0, Math.floor(fx)));
  const y = Math.min(n - 1, Math.max(0, Math.floor(fy)));
  return { x, y, px: Math.min(size - 1, Math.floor((fx - x) * size)), py: Math.min(size - 1, Math.floor((fy - y) * size)) };
}

// ---------- data loading with a tilted camera ----------

export type BBox = [number, number, number, number];

/**
 * A tilted camera sees to the horizon, so the viewport's bounds can span a county. Land layers
 * only need detail near the camera: clip the bounds to `factor` times the flat (untilted)
 * viewport around the centre. A flat camera gets its bounds back unchanged.
 */
export function clipBBoxForPitch(bounds: BBox, center: [number, number], zoom: number, size: { width: number; height: number }, pitch: number, factor = 2): BBox {
  if (pitch < 1) return bounds;
  const [lon, lat] = center;
  const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom / 2; // 512-px world (MapLibre)
  const halfW = (size.width / 2) * mpp * factor;
  const halfH = (size.height / 2) * mpp * factor;
  const half = Math.max(halfW, halfH);
  const dLat = half / 111320;
  const dLon = half / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const out: BBox = [Math.max(bounds[0], lon - dLon), Math.max(bounds[1], lat - dLat), Math.min(bounds[2], lon + dLon), Math.min(bounds[3], lat + dLat)];
  // Bounds that do not contain the centre (should not happen) — fall back to the clip box itself.
  if (out[0] >= out[2] || out[1] >= out[3]) return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  return out;
}

/** The bits of a MapLibre map the loader needs (structural, so tests can pass a fake). */
export interface CameraLike {
  getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getPitch(): number;
  getContainer(): { clientWidth: number; clientHeight: number };
}

/** Bounding box the land-data loader should fetch for the current camera (flat or tilted). */
export function loadBBoxFor(map: CameraLike): BBox {
  const b = map.getBounds();
  const bounds: BBox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const c = map.getCenter();
  const el = map.getContainer();
  return clipBBoxForPitch(bounds, [c.lng, c.lat], map.getZoom(), { width: el.clientWidth, height: el.clientHeight }, map.getPitch());
}

// ---------- styling ----------

export interface HillshadePaint {
  'hillshade-exaggeration': number;
  'hillshade-shadow-color': string;
  'hillshade-highlight-color': string;
  'hillshade-accent-color': string;
  'hillshade-illumination-direction': number;
  'hillshade-method': 'standard' | 'igor' | 'combined' | 'basic' | 'multidirectional';
}

/** Subtle on the topo / street maps (they have contours already), stronger on imagery. */
export function hillshadePaint(darkBasemap: boolean, darkTheme: boolean): HillshadePaint {
  if (darkBasemap)
    return {
      'hillshade-exaggeration': 0.5,
      'hillshade-shadow-color': '#000000',
      'hillshade-highlight-color': darkTheme ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.2)',
      'hillshade-accent-color': '#000000',
      'hillshade-illumination-direction': 315,
      'hillshade-method': 'igor',
    };
  return {
    'hillshade-exaggeration': darkTheme ? 0.4 : 0.35,
    'hillshade-shadow-color': '#3b3628',
    'hillshade-highlight-color': 'rgba(255,255,255,0.25)',
    'hillshade-accent-color': '#3b3628',
    'hillshade-illumination-direction': 315,
    'hillshade-method': 'igor',
  };
}

export function buildingColor(darkBasemap: boolean, darkTheme: boolean): string {
  if (darkBasemap) return darkTheme ? '#c9c4b8' : '#dcd7cb';
  return darkTheme ? '#bdb7aa' : '#d8d2c4';
}

export interface SkyColors {
  'sky-color': string;
  'horizon-color': string;
  'fog-color': string;
}

/** Sky / haze so the horizon of a tilted map fades out instead of ending in a hard edge. */
export function skyColors(darkBasemap: boolean, darkTheme: boolean): SkyColors {
  if (darkTheme) return { 'sky-color': '#1d2c3a', 'horizon-color': '#5b6a74', 'fog-color': darkBasemap ? '#46525a' : '#8d968f' };
  return { 'sky-color': '#7fb2e0', 'horizon-color': '#e6edf0', 'fog-color': darkBasemap ? '#b9c3c8' : '#e7e9e2' };
}
