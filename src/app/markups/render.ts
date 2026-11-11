import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { drawWaypointImage } from '../ui/icons';
import { LABEL_FONT } from '../layers/manager';
import { isColor, isWaypointIcon, type Markup } from './model';

export const MARKUP_SOURCE = 'markups';
export const MARKUP_LAYERS = ['mk-fill', 'mk-line', 'mk-line-dash', 'mk-point'];

function toFeature(m: Markup): Feature {
  const props = { id: m.id, kind: m.kind, name: m.name, color: m.color, img: m.kind === 'waypoint' ? `wp:${m.icon}:${m.color}` : '' };
  if (m.kind === 'waypoint') return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [m.coord[0], m.coord[1]] } };
  if (m.kind === 'shape') {
    const ring = m.coords.map((c) => [c[0], c[1]]);
    if (ring.length) ring.push(ring[0]);
    return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } };
  }
  return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: m.coords.map((c) => [c[0], c[1]]) } };
}

export function installMarkupLayers(map: MLMap): void {
  map.addSource(MARKUP_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const before = 'anchor-markups';
  map.addLayer({ id: 'mk-fill', type: 'fill', source: MARKUP_SOURCE, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 } }, before);
  map.addLayer({ id: 'mk-casing', type: 'line', source: MARKUP_SOURCE, filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#000', 'line-opacity': 0.45, 'line-width': 6 }, layout: { 'line-cap': 'round', 'line-join': 'round' } }, before);
  map.addLayer(
    {
      id: 'mk-line',
      type: 'line',
      source: MARKUP_SOURCE,
      filter: ['all', ['!=', ['geometry-type'], 'Point'], ['!=', ['get', 'kind'], 'line']],
      paint: { 'line-color': ['get', 'color'], 'line-width': 3.5 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    },
    before,
  );
  map.addLayer(
    {
      id: 'mk-line-dash',
      type: 'line',
      source: MARKUP_SOURCE,
      filter: ['==', ['get', 'kind'], 'line'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-dasharray': [2, 1.2] },
    },
    before,
  );
  map.addLayer(
    {
      id: 'mk-point',
      type: 'symbol',
      source: MARKUP_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'icon-image': ['get', 'img'],
        'icon-allow-overlap': true,
        'text-field': ['step', ['zoom'], '', 12, ['get', 'name']],
        'text-font': LABEL_FONT,
        'text-size': 12,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-optional': true,
        'text-max-width': 10,
      },
      paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.6 },
    },
    before,
  );
  // Waypoint badges are drawn on demand for each icon/colour combination.
  map.setMissingStyleImageResolver((id) => {
    const [kind, icon, color] = id.split(':');
    if (kind !== 'wp' || !isWaypointIcon(icon) || !isColor(color) || map.hasImage(id)) return;
    const pr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
    map.addImage(id, drawWaypointImage(icon, color, pr), { pixelRatio: pr });
  });
}

export function renderMarkups(map: MLMap, markups: readonly Markup[], hiddenId?: string): void {
  const fc: FeatureCollection = { type: 'FeatureCollection', features: markups.filter((m) => m.id !== hiddenId).map(toFeature) };
  map.getSource<GeoJSONSource>(MARKUP_SOURCE)?.setData(fc);
}
