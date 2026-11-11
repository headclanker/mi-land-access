import type { LngLatBoundsLike } from 'maplibre-gl';

export const APP_NAME = 'MI Land Access';

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
}

const USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services';
const USGS_ATTR = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

export const BASEMAPS: Basemap[] = [
  {
    id: 'usgs-topo',
    title: 'USGS Topo',
    short: 'Topo',
    tiles: [`${USGS}/USGSTopo/MapServer/tile/{z}/{y}/{x}`],
    maxzoom: 16,
    attribution: USGS_ATTR,
    dark: false,
  },
  {
    id: 'usgs-imagery-topo',
    title: 'Imagery + labels',
    short: 'Hybrid',
    tiles: [`${USGS}/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}`],
    maxzoom: 16,
    attribution: `${USGS_ATTR} imagery`,
    dark: true,
  },
  {
    id: 'usgs-imagery',
    title: 'Imagery',
    short: 'Aerial',
    tiles: [`${USGS}/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`],
    maxzoom: 16,
    attribution: `${USGS_ATTR} imagery`,
    dark: true,
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
  debounceMs: 350,
  /** Features kept per layer per query tile. */
  tileCap: 2000,
  /** Features drawn per layer at once. */
  layerCap: 6000,
  pageSize: 1000,
  cacheTiles: 240,
  concurrency: 4,
} as const;
