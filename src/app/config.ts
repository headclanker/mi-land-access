import type { LngLatBoundsLike } from 'maplibre-gl';

export const APP_NAME = 'SketchX';

/** Michigan (both peninsulas) extent. */
export const MICHIGAN_BOUNDS: LngLatBoundsLike = [
  [-90.42, 41.69],
  [-82.12, 48.31],
];

/** Pan limit: Michigan plus a generous margin (Great Lakes, borders). */
export const MAX_BOUNDS: LngLatBoundsLike = [
  [-94.5, 39.5],
  [-78.5, 49.9],
];

export interface Basemap {
  id: string;
  title: string;
  short: string;
  tiles: string[];
  maxzoom: number;
  attribution: string;
  /** Dark imagery wants light overlay text/lines. */
  dark: boolean;
  /** Aerial / satellite imagery (the one-tap toggle switches between imagery and maps). */
  satellite?: boolean;
  /** Transparent raster tile sets drawn on top of the base tiles (labels, roads), bottom → top. */
  overlays?: string[][];
}

const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services';
/**
 * Esri World Imagery: served from a global CDN, smaller JPEG tiles and sharper (to z18+) over
 * Michigan than USGS imagery, which renders tiles on demand and is slow on phone connections.
 * Two host names spread requests over more connections.
 */
const ESRI_HOSTS = ['https://server.arcgisonline.com', 'https://services.arcgisonline.com'];
const esri = (service: string): string[] => ESRI_HOSTS.map((h) => `${h}/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`);
const ESRI_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics';
const USGS_ATTR = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

export const BASEMAPS: Basemap[] = [
  {
    id: 'usgs-topo',
    title: 'Topo map',
    short: 'Topo',
    tiles: [`${USGS}/USGSTopo/MapServer/tile/{z}/{y}/{x}`],
    maxzoom: 16,
    attribution: USGS_ATTR,
    dark: false,
  },
  {
    id: 'sat-labels',
    title: 'Satellite + labels',
    short: 'Sat + labels',
    tiles: esri('World_Imagery'),
    maxzoom: 18,
    attribution: ESRI_ATTR,
    dark: true,
    satellite: true,
    overlays: [esri('Reference/World_Transportation'), esri('Reference/World_Boundaries_and_Places')],
  },
  {
    id: 'sat',
    title: 'Satellite',
    short: 'Satellite',
    tiles: esri('World_Imagery'),
    maxzoom: 18,
    attribution: ESRI_ATTR,
    dark: true,
    satellite: true,
  },
  {
    id: 'osm',
    title: 'OpenStreetMap',
    short: 'Streets',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    dark: false,
  },
];

/** Hard limits for the ArcGIS loader. */
export const LOADER = {
  debounceMs: 150,
  /** Features kept per layer per query tile. */
  tileCap: 2000,
  /** Features drawn per layer at once. */
  layerCap: 6000,
  pageSize: 1000,
  cacheTiles: 240,
  /** Tiles fetched at once per layer. */
  concurrency: 6,
  /** Requests in flight at once across all layers (HTTP/2 hosts; several different servers). */
  maxRequests: 16,
} as const;

/** Basemap ids from earlier versions, mapped to their replacement. */
export const RENAMED_BASEMAPS: Record<string, string> = { 'usgs-imagery-topo': 'sat-labels', 'usgs-imagery': 'sat' };

export function findBasemap(id: string | null | undefined): Basemap | undefined {
  if (!id) return undefined;
  const want = RENAMED_BASEMAPS[id] ?? id;
  return BASEMAPS.find((b) => b.id === want);
}
