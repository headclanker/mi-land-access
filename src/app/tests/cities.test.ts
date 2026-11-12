import { describe, expect, it } from 'vitest';
import type { Feature, Polygon } from 'geojson';
import { CityIndex, type CityLimitsFile } from '../layers/cities';
import raw from '../../../public/cities/city-limits.json?raw';

const file = JSON.parse(raw) as CityLimitsFile;
const idx = new CityIndex(file);

const square = (lon: number, lat: number, d: number): Feature<Polygon> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] },
});

describe('city limits asset', () => {
  it('has all 280 Michigan cities with display names', () => {
    expect(idx.size).toBe(280);
    expect(file.built).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const names = new Set(idx.shapes.map((s) => s.key));
    for (const n of ['Grand Rapids', 'Detroit', 'Grosse Pointe Shores', 'Clarkston', 'Bay City', 'Traverse City']) expect(names.has(n), n).toBe(true);
  });

  it.each([
    ['downtown Grand Rapids', -85.668, 42.963, 'Grand Rapids'],
    ['Riverside Park', -85.669, 43.0, 'Grand Rapids'],
    ['Huff Park', -85.636, 43.017, 'Grand Rapids'],
    ['Fallasburg Park (Vergennes Twp)', -85.326, 42.983, undefined],
    ['rural Allegan County', -85.8, 42.55, undefined],
  ])('point: %s', (_n, lon, lat, city) => {
    expect(idx.at(lon, lat)).toBe(city);
  });

  it('polygon membership needs at least half the area inside', () => {
    expect(idx.of(square(-85.668, 42.963, 0.001))).toBe('Grand Rapids');
    expect(idx.of(square(-85.8, 42.55, 0.001))).toBeUndefined();
    // Same geometry object → cached answer.
    const f = square(-85.668, 42.963, 0.001);
    expect(idx.of(f)).toBe(idx.of(f));
  });
});
