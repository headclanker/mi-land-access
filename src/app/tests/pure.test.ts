import { describe, expect, it } from 'vitest';
import {
  activeDuration,
  bearing,
  cardinal,
  formatDistance,
  formatDuration,
  formatPace,
  haversine,
  paceMinPerMile,
  shouldAcceptPoint,
  trackStats,
} from '../util/geo';
import { formatLatLon, parseLatLon, toDMS } from '../util/coords';
import {
  LruCache,
  buildQueryUrl,
  esriToFeatureCollection,
  fetchFeatures,
  generalisationOffset,
  queryTiles,
  tileBBox,
  tileCacheKey,
  tilesForBBox,
  type BBox,
} from '../layers/arcgis';
import type { Markup } from '../markups/model';
import { geoJSONToMarkups, markupsToGeoJSON } from '../markups/geojson';
import { gpxToMarkups, markupsToGPX } from '../markups/gpx';
import { decodeShare, encodeShare, sharePayloadFromHash, buildShareUrl } from '../markups/share';

const LANSING: [number, number] = [-84.5555, 42.7325];
const GRAYLING: [number, number] = [-84.7147, 44.6614];

describe('distance / bearing / pace', () => {
  it('haversine matches known distance (Lansing → Grayling ≈ 215 km)', () => {
    const d = haversine(LANSING, GRAYLING);
    expect(d).toBeGreaterThan(213_000);
    expect(d).toBeLessThan(217_000);
  });
  it('one degree of latitude ≈ 111.2 km', () => {
    expect(haversine([-85, 44], [-85, 45])).toBeCloseTo(111_195, -2);
  });
  it('bearing north/east/south/west', () => {
    expect(bearing([-85, 44], [-85, 45])).toBeCloseTo(0, 5);
    expect(bearing([-85, 44], [-84, 44])).toBeCloseTo(89.65, 1);
    expect(bearing([-85, 45], [-85, 44])).toBeCloseTo(180, 5);
    expect(bearing([-84, 44], [-85, 44])).toBeCloseTo(270.35, 1);
  });
  it('cardinal labels', () => {
    expect(cardinal(0)).toBe('N');
    expect(cardinal(359)).toBe('N');
    expect(cardinal(45)).toBe('NE');
    expect(cardinal(200)).toBe('SSW');
    expect(cardinal(-90)).toBe('W');
  });
  it('formats distance in feet then miles', () => {
    expect(formatDistance(30.48)).toBe('100 ft');
    expect(formatDistance(1609.344)).toBe('1.00 mi');
    expect(formatDistance(16093.44 * 2)).toBe('20.0 mi');
  });
  it('formats duration', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
  });
  it('pace in min/mi', () => {
    // 1 mile in 20 minutes
    expect(paceMinPerMile(20 * 60_000, 1609.344)).toBeCloseTo(20, 6);
    expect(formatPace(20 * 60_000 + 30_000, 1609.344)).toBe('20:30 /mi');
    expect(formatPace(10_000, 5)).toBe('–');
    expect(formatPace(59.999 * 60_000, 1609.344)).toBe('60:00 /mi');
  });
  it('rejects GPS jitter and inaccurate fixes', () => {
    const a = { lon: -85, lat: 44, t: 0, acc: 5 };
    expect(shouldAcceptPoint(undefined, a)).toBe(true);
    expect(shouldAcceptPoint(a, { lon: -85, lat: 44.00001, t: 1, acc: 5 })).toBe(false); // ~1.1 m
    expect(shouldAcceptPoint(a, { lon: -85, lat: 44.0001, t: 1, acc: 5 })).toBe(true); // ~11 m
    expect(shouldAcceptPoint(a, { lon: -85, lat: 44.01, t: 1, acc: 120 })).toBe(false);
  });
  it('track stats: distance and hysteresis elevation gain', () => {
    const pts = [
      { lon: -85, lat: 44, ele: 300, t: 0 },
      { lon: -85, lat: 44.001, ele: 301, t: 1 },
      { lon: -85, lat: 44.002, ele: 305, t: 2 },
      { lon: -85, lat: 44.003, ele: 300, t: 3 },
    ];
    const s = trackStats(pts);
    expect(s.distance).toBeCloseTo(333.6, 0);
    expect(s.gain).toBe(5);
    expect(s.loss).toBe(5);
    expect(s.minEle).toBe(300);
    expect(s.maxEle).toBe(305);
  });
  it('active duration skips pauses', () => {
    expect(activeDuration([{ start: 0, end: 1000 }, { start: 5000 }], 7000)).toBe(3000);
  });
});

describe('coordinate parsing', () => {
  it('decimal pairs', () => {
    expect(parseLatLon('42.7325, -84.5555')).toEqual({ lat: 42.7325, lon: -84.5555 });
    expect(parseLatLon('42.7325 -84.5555')).toEqual({ lat: 42.7325, lon: -84.5555 });
  });
  it('assumes west longitude in Michigan when sign dropped', () => {
    expect(parseLatLon('44.66, 84.71')).toEqual({ lat: 44.66, lon: -84.71 });
  });
  it('DMS with hemispheres', () => {
    const p = parseLatLon(`42°43'57"N 84°33'20"W`);
    expect(p?.lat).toBeCloseTo(42.7325, 3);
    expect(p?.lon).toBeCloseTo(-84.5556, 3);
  });
  it('lon-first with hemispheres', () => {
    const p = parseLatLon('84.5 W, 42.5 N');
    expect(p).toEqual({ lat: 42.5, lon: -84.5 });
  });
  it('rejects garbage', () => {
    expect(parseLatLon('Grayling')).toBeNull();
    expect(parseLatLon('95, 200')).toBeNull();
  });
  it('formats', () => {
    expect(formatLatLon(42.123456, -84.5)).toBe('42.12346, -84.50000');
    expect(toDMS(42.5, true)).toBe('42°30′00.0″N');
    expect(toDMS(-84.25, false)).toBe('84°15′00.0″W');
  });
});

describe('ArcGIS helpers', () => {
  const bbox: BBox = [-84.6, 42.7, -84.5, 42.76];
  it('tile keys are stable for any viewport inside the same tiles', () => {
    const a = queryTiles(bbox, 14.2, 14).map((t) => tileCacheKey('parcels', t));
    const b = queryTiles([-84.599, 42.701, -84.501, 42.759], 14.8, 14).map((t) => tileCacheKey('parcels', t));
    expect(a).toEqual(b);
    expect(a[0]).toMatch(/^parcels@13\/\d+\/\d+$/);
  });
  it('tile bbox contains the tile corner coordinates', () => {
    const tiles = tilesForBBox(bbox, 12);
    for (const t of tiles) {
      const tb = tileBBox(t);
      expect(tb[0]).toBeLessThan(tb[2]);
      expect(tb[1]).toBeLessThan(tb[3]);
    }
    const all = tiles.map(tileBBox);
    expect(Math.min(...all.map((b) => b[0]))).toBeLessThanOrEqual(bbox[0]);
    expect(Math.max(...all.map((b) => b[3]))).toBeGreaterThanOrEqual(bbox[3]);
  });
  it('caps tile count by coarsening', () => {
    const big: BBox = [-90, 41.7, -82, 48.3];
    expect(queryTiles(big, 9, 5, 12).length).toBeLessThanOrEqual(12);
  });
  it('generalisation only at low zoom', () => {
    expect(generalisationOffset(14)).toBeUndefined();
    const lo = generalisationOffset(6)!;
    const hi = generalisationOffset(10)!;
    expect(lo).toBeGreaterThan(hi);
  });
  it('builds the query url', () => {
    const u = new URL(buildQueryUrl('https://x/arcgis/rest/services/A/FeatureServer/3/', { fields: ['A', 'B'], bbox, offset: 2000, pageSize: 1000, maxAllowableOffset: 0.001 }));
    expect(u.pathname).toBe('/arcgis/rest/services/A/FeatureServer/3/query');
    expect(u.searchParams.get('where')).toBe('1=1');
    expect(u.searchParams.get('geometry')).toBe('-84.6,42.7,-84.5,42.76');
    expect(u.searchParams.get('outFields')).toBe('A,B');
    expect(u.searchParams.get('resultOffset')).toBe('2000');
    expect(u.searchParams.get('outSR')).toBe('4326');
    expect(u.searchParams.get('f')).toBe('geojson');
    expect(u.searchParams.get('maxAllowableOffset')).toBe('0.001');
  });
  it('LRU evicts least recently used', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
  });
  it('paginates with resultOffset while exceededTransferLimit', async () => {
    const offsets: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      const off = Number(u.searchParams.get('resultOffset') ?? 0);
      offsets.push(String(off));
      const feats = Array.from({ length: off < 4 ? 2 : 1 }, (_, i) => ({ type: 'Feature', id: off + i, properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }));
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: feats, exceededTransferLimit: off < 4 }));
    }) as typeof fetch;
    const r = await fetchFeatures({ layerUrl: 'https://x/FeatureServer/0', fields: [], bbox, cap: 100, fetchFn });
    expect(offsets).toEqual(['0', '2', '4']);
    expect(r.features.length).toBe(5);
    expect(r.truncated).toBe(false);
  });
  it('converts Esri JSON polygons with holes', () => {
    const fc = esriToFeatureCollection({
      objectIdFieldName: 'OID',
      features: [
        {
          attributes: { OID: 7 },
          geometry: {
            rings: [
              [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]], // clockwise outer
              [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]], // counter-clockwise hole
            ],
          },
        },
      ],
    });
    expect(fc.features[0].id).toBe(7);
    expect(fc.features[0].geometry.type).toBe('Polygon');
  });
});

const sample = (): Markup[] => [
  { id: 'w1', kind: 'waypoint', name: 'Ridge stand', note: 'Wind: NW <best> & "dry"', color: '#ff6a13', created: 1, updated: 2, coord: [-84.71234, 44.66123, 350.5], icon: 'stand' },
  { id: 'l1', kind: 'line', name: 'Drag route', note: '', color: '#3a86ff', created: 1, updated: 2, coords: [[-84.7, 44.66], [-84.71, 44.67], [-84.72, 44.665]] },
  { id: 's1', kind: 'shape', name: 'Bedding', note: 'thick cedar', color: '#ffd23f', created: 1, updated: 2, coords: [[-84.7, 44.66], [-84.71, 44.66], [-84.71, 44.67]] },
  { id: 't1', kind: 'track', name: 'Morning walk', note: '', color: '#ff2fb3', created: 1, updated: 2, coords: [[-84.7, 44.66, 300], [-84.701, 44.661, 302]], times: [1700000000000, 1700000060000], duration: 60000 },
];

describe('GeoJSON roundtrip', () => {
  it('exports and re-imports all markup kinds unchanged', () => {
    const fc = markupsToGeoJSON(sample());
    const back = geoJSONToMarkups(JSON.parse(JSON.stringify(fc)));
    expect(back).toEqual(sample());
  });
  it('imports foreign GeoJSON with simplestyle colours and multi geometries', () => {
    const ms = geoJSONToMarkups({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'X', 'marker-color': '#123456' }, geometry: { type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] } },
        { type: 'Feature', properties: null, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      ],
    });
    expect(ms.map((m) => m.kind)).toEqual(['waypoint', 'waypoint', 'shape']);
    expect(ms[0].color).toBe('#123456');
    expect(new Set(ms.map((m) => m.id)).size).toBe(3);
  });
});

describe('GPX roundtrip', () => {
  it('exports and re-imports names, notes, icons, colours, elevation and times', () => {
    const xml = markupsToGPX(sample());
    expect(xml).toContain('&lt;best&gt;');
    const back = gpxToMarkups(xml, 2);
    const strip = (ms: Markup[]) => ms.map(({ id: _id, created: _c, updated: _u, ...rest }) => rest);
    expect(strip(back)).toEqual(strip(sample()));
  });
  it('reads a plain third-party GPX (rte, trk without extensions, comments)', () => {
    const xml = `<?xml version="1.0"?><gpx version="1.1" creator="x"><!-- <wpt lat="1" lon="1"/> -->
      <wpt lon="-85.1" lat='44.2'><name>Truck</name><sym>Parking Area</sym></wpt>
      <rte><name>R</name><rtept lat="44" lon="-85"/><rtept lat="44.1" lon="-85.1"/></rte>
      <trk><name>T</name><trkseg><trkpt lat="44" lon="-85"><time>2024-11-15T12:00:00Z</time></trkpt><trkpt lat="44.01" lon="-85"><time>2024-11-15T12:10:00Z</time></trkpt></trkseg></trk></gpx>`;
    const ms = gpxToMarkups(xml);
    expect(ms.map((m) => m.kind)).toEqual(['waypoint', 'track', 'line']);
    const w = ms[0];
    expect(w.kind === 'waypoint' && w.icon).toBe('parking');
    const t = ms[1];
    expect(t.kind === 'track' && t.duration).toBe(600000);
  });
  it('rejects non-GPX', () => {
    expect(() => gpxToMarkups('<kml></kml>')).toThrow();
  });
});

describe('share links', () => {
  it('encode/decode roundtrip keeps geometry to ~1 m and metadata', async () => {
    const payload = await encodeShare(sample());
    expect(payload[0]).toBe('z');
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await decodeShare(payload);
    expect(back.map((m) => [m.kind, m.name, m.note, m.color])).toEqual(sample().map((m) => [m.kind, m.name, m.note, m.color]));
    const w = back[0];
    if (w.kind !== 'waypoint') throw new Error('expected waypoint');
    expect(w.icon).toBe('stand');
    expect(w.coord[0]).toBeCloseTo(-84.71234, 5);
    const s = back[2];
    if (s.kind !== 'shape') throw new Error('expected shape');
    expect(s.coords[2][1]).toBeCloseTo(44.67, 5);
  });
  it('builds a URL whose hash decodes back', async () => {
    const url = await buildShareUrl('https://example.org/app/?x=1', sample().slice(0, 1));
    const payload = sharePayloadFromHash(new URL(url).hash);
    expect(payload).not.toBeNull();
    expect((await decodeShare(payload!))[0].name).toBe('Ridge stand');
  });
  it('compresses long tracks well', async () => {
    const coords: [number, number][] = Array.from({ length: 500 }, (_, i) => [-84.7 + i * 0.0001, 44.66 + Math.sin(i / 10) * 0.0005]);
    const payload = await encodeShare([{ id: 't', kind: 'track', name: 'Long', note: '', color: '#ff2fb3', created: 0, updated: 0, coords }]);
    expect(payload.length).toBeLessThan(3000);
  });
  it('rejects tampered payloads', async () => {
    await expect(decodeShare('qabc')).rejects.toThrow();
  });
});
