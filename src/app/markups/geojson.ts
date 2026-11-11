// GeoJSON import/export for markups. Pure, unit-tested.

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import {
  type Coord,
  type Markup,
  defaultColor,
  isColor,
  isWaypointIcon,
  newId,
} from './model';

function toCoord(p: Position): Coord {
  const lon = Number(p[0]);
  const lat = Number(p[1]);
  return p.length > 2 && Number.isFinite(Number(p[2])) ? [lon, lat, Number(p[2])] : [lon, lat];
}

export function markupToFeature(m: Markup): Feature {
  const properties: Record<string, unknown> = {
    id: m.id,
    kind: m.kind,
    name: m.name,
    note: m.note,
    color: m.color,
    created: m.created,
    updated: m.updated,
  };
  let geometry: Geometry;
  switch (m.kind) {
    case 'waypoint':
      properties.icon = m.icon;
      properties['marker-color'] = m.color;
      geometry = { type: 'Point', coordinates: [...m.coord] };
      break;
    case 'line':
      properties.stroke = m.color;
      geometry = { type: 'LineString', coordinates: m.coords.map((c) => [...c]) };
      break;
    case 'track':
      properties.stroke = m.color;
      if (m.times) properties.times = m.times;
      if (m.duration !== undefined) properties.duration = m.duration;
      geometry = { type: 'LineString', coordinates: m.coords.map((c) => [...c]) };
      break;
    case 'shape': {
      properties.stroke = m.color;
      properties.fill = m.color;
      const ring = m.coords.map((c) => [...c]);
      if (ring.length) ring.push([...ring[0]]);
      geometry = { type: 'Polygon', coordinates: [ring] };
      break;
    }
  }
  return { type: 'Feature', geometry, properties };
}

export function markupsToGeoJSON(markups: readonly Markup[]): FeatureCollection {
  return { type: 'FeatureCollection', features: markups.map(markupToFeature) };
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Converts arbitrary GeoJSON (Feature, FeatureCollection or bare geometry) into markups. */
export function geoJSONToMarkups(input: unknown, now = Date.now()): Markup[] {
  const out: Markup[] = [];
  const features: Feature[] = [];
  const o = input as { type?: string };
  if (!o || typeof o !== 'object') throw new Error('Not GeoJSON');
  if (o.type === 'FeatureCollection') features.push(...((input as FeatureCollection).features ?? []));
  else if (o.type === 'Feature') features.push(input as Feature);
  else if (typeof o.type === 'string') features.push({ type: 'Feature', geometry: input as Geometry, properties: {} });
  else throw new Error('Not GeoJSON');

  for (const f of features) {
    if (!f || !f.geometry) continue;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const name = str(p.name ?? p.title ?? p.Name);
    const note = str(p.note ?? p.description ?? p.desc);
    const colorCandidate = p.color ?? p['marker-color'] ?? p.stroke;
    const created = num(p.created, now);
    const updated = num(p.updated, now);
    const base = (kind: Markup['kind']) => ({
      id: str(p.id) || newId(),
      name,
      note,
      color: isColor(colorCandidate) ? colorCandidate : defaultColor(kind),
      created,
      updated,
    });
    const geoms: Geometry[] =
      f.geometry.type === 'GeometryCollection' ? f.geometry.geometries : [f.geometry];
    const multi = geoms.length > 1;
    for (const g of geoms) {
      const add = (m: Markup): void => {
        if (multi || out.some((x) => x.id === m.id)) m.id = newId();
        out.push(m);
      };
      switch (g.type) {
        case 'Point':
          add({ ...base('waypoint'), kind: 'waypoint', coord: toCoord(g.coordinates), icon: isWaypointIcon(p.icon) ? p.icon : 'pin' });
          break;
        case 'MultiPoint':
          for (const c of g.coordinates) add({ ...base('waypoint'), id: newId(), kind: 'waypoint', coord: toCoord(c), icon: isWaypointIcon(p.icon) ? p.icon : 'pin' });
          break;
        case 'LineString':
        case 'MultiLineString': {
          const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
          for (const line of lines) {
            if (line.length < 2) continue;
            const coords = line.map(toCoord);
            if (p.kind === 'track') {
              const times = Array.isArray(p.times) && p.times.length === coords.length && p.times.every((t) => typeof t === 'number') ? (p.times as number[]) : undefined;
              add({ ...base('track'), kind: 'track', coords, times, duration: typeof p.duration === 'number' ? p.duration : undefined });
            } else add({ ...base('line'), kind: 'line', coords });
          }
          break;
        }
        case 'Polygon':
        case 'MultiPolygon': {
          const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
          for (const poly of polys) {
            const ring = (poly[0] ?? []).map(toCoord);
            if (ring.length > 1) {
              const a = ring[0];
              const b = ring[ring.length - 1];
              if (a[0] === b[0] && a[1] === b[1]) ring.pop();
            }
            if (ring.length < 3) continue;
            add({ ...base('shape'), kind: 'shape', coords: ring });
          }
          break;
        }
        default:
          break;
      }
    }
  }
  return out;
}
