import { Map as MapLibreMap, AttributionControl, ScaleControl, setWorkerUrl, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
// MapLibre 6 locates its worker relative to its own module, which a bundler rewrites;
// hand it the emitted asset URL explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(workerUrl);
import { BASEMAPS, MAX_BOUNDS, MICHIGAN_BOUNDS, type Basemap } from '../config';
import { prefGet, prefSet } from '../util/store';

/**
 * Empty placeholder layers that fix the drawing order. Feature layers are inserted *before*
 * the anchor of their slot, so the order below is bottom → top.
 */
export const ANCHORS = ['anchor-fills', 'anchor-lines', 'anchor-units', 'anchor-points', 'anchor-labels', 'anchor-markups', 'anchor-top'] as const;
export type Anchor = (typeof ANCHORS)[number];

/**
 * Placeholder between the basemap and the land fills: shaded relief (3D view) goes just above it,
 * and a re-added basemap goes just below it, so switching styles never covers the relief.
 */
export const RELIEF_ANCHOR = 'anchor-relief';

const BASEMAP_SOURCE = 'basemap';
const BASEMAP_LAYER = 'basemap';

function initialStyle(b: Basemap): StyleSpecification {
  return {
    version: 8,
    sources: {
      [BASEMAP_SOURCE]: { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution },
      empty: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#dfe3da' } },
      { id: BASEMAP_LAYER, type: 'raster', source: BASEMAP_SOURCE, paint: { 'raster-fade-duration': 150 } },
      { id: RELIEF_ANCHOR, type: 'symbol', source: 'empty', layout: { visibility: 'none' } },
      ...ANCHORS.map((id) => ({ id, type: 'symbol' as const, source: 'empty', layout: { visibility: 'none' as const } })),
    ],
  };
}

export function currentBasemap(): Basemap {
  const id = prefGet('basemap', BASEMAPS[0].id);
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

export function createMap(container: HTMLElement): MLMap {
  const saved = prefGet<{ center: [number, number]; zoom: number } | null>('view', null);
  const map = new MapLibreMap({
    container,
    style: initialStyle(currentBasemap()),
    bounds: saved ? undefined : MICHIGAN_BOUNDS,
    center: saved?.center,
    zoom: saved?.zoom,
    fitBoundsOptions: { padding: 20 },
    maxBounds: MAX_BOUNDS,
    minZoom: 4.5,
    maxZoom: 19,
    attributionControl: false,
    dragRotate: true,
    pitchWithRotate: false,
    maxPitch: 0,
    cooperativeGestures: false,
  });
  map.touchZoomRotate.enableRotation();
  const attrib = new AttributionControl({
    compact: true,
    customAttribution: 'Land data: Michigan DNR, county GIS, USGS PAD-US, USDA FS (details in More)',
  });
  map.addControl(attrib, 'bottom-right');
  // Start collapsed on every screen size; the (i) button expands it.
  const collapse = (): void => container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  map.once('load', collapse);
  map.once('idle', collapse);
  map.addControl(new ScaleControl({ unit: 'imperial', maxWidth: 110 }), 'bottom-left');
  map.on('moveend', () => {
    const c = map.getCenter();
    prefSet('view', { center: [Number(c.lng.toFixed(5)), Number(c.lat.toFixed(5))], zoom: Number(map.getZoom().toFixed(2)) });
  });
  return map;
}

export function setBasemap(map: MLMap, b: Basemap): void {
  prefSet('basemap', b.id);
  if (map.getLayer(BASEMAP_LAYER)) map.removeLayer(BASEMAP_LAYER);
  if (map.getSource(BASEMAP_SOURCE)) map.removeSource(BASEMAP_SOURCE);
  map.addSource(BASEMAP_SOURCE, { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution });
  map.addLayer({ id: BASEMAP_LAYER, type: 'raster', source: BASEMAP_SOURCE, paint: { 'raster-fade-duration': 150 } }, RELIEF_ANCHOR);
  document.documentElement.dataset.basemap = b.dark ? 'dark' : 'light';
  window.dispatchEvent(new CustomEvent('basemapchange', { detail: b.id }));
}

export function fitMichigan(map: MLMap): void {
  map.fitBounds(MICHIGAN_BOUNDS, { padding: 20, duration: 600 });
}
