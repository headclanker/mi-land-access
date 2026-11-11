import { describe, expect, it } from 'vitest';
import { area, intersect, featureCollection, polygon } from '@turf/turf';
import type { Polygon } from 'geojson';
import { contains, coverage, prepare, samplePoints, type Prepared } from '../layers/coverage';

const sq = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

const P = (g: Polygon): Prepared => prepare(g)!;

describe('point in polygon', () => {
  it('handles holes and multipolygons', () => {
    const donut: Polygon = { type: 'Polygon', coordinates: [sq(0, 0, 10, 10).coordinates[0], sq(4, 4, 6, 6).coordinates[0]] };
    const p = P(donut);
    expect(contains(p, 1, 1)).toBe(true);
    expect(contains(p, 5, 5)).toBe(false);
    expect(contains(p, 11, 5)).toBe(false);
    const multi = prepare({ type: 'MultiPolygon', coordinates: [sq(0, 0, 1, 1).coordinates, sq(2, 0, 3, 1).coordinates] })!;
    expect(contains(multi, 0.5, 0.5)).toBe(true);
    expect(contains(multi, 1.5, 0.5)).toBe(false);
    expect(contains(multi, 2.5, 0.5)).toBe(true);
  });

  it('samples only inside the polygon, densifying slivers', () => {
    const sliver = P(sq(0, 0, 10, 0.05));
    const pts = samplePoints(sliver);
    expect(pts.length / 2).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < pts.length; i += 2) expect(contains(sliver, pts[i], pts[i + 1])).toBe(true);
  });
});

describe('coverage', () => {
  it('estimates overlap fractions close to exact intersection', () => {
    const parcel = sq(-85.5, 42.6, -85.49, 42.61);
    const pub = [sq(-85.6, 42.5, -85.4975, 42.7), sq(-85.4975, 42.605, -85.3, 42.7), sq(-85.3, 42.0, -85.2, 42.1)];
    const res = coverage([{ key: 'p', prep: P(parcel) }], pub.map((g, i) => ({ key: i, prep: P(g) })));
    const got = new Map(res.get('p')!.map((r) => [r.key, r.fraction]));
    const exact = (g: Polygon): number => {
      const i = intersect(featureCollection([polygon(parcel.coordinates), polygon(g.coordinates)]));
      return i ? area(i) / area(polygon(parcel.coordinates)) : 0;
    };
    expect(got.get(0)!).toBeCloseTo(exact(pub[0]), 1);
    expect(got.get(1)!).toBeCloseTo(exact(pub[1]), 1);
    expect(got.has(2)).toBe(false);
  });

  it('handles thousands of parcels against a large polygon quickly', () => {
    const ring: [number, number][] = [];
    for (let i = 0; i < 20000; i++) {
      const a = (i / 20000) * Math.PI * 2;
      ring.push([-85.5 + 0.2 * Math.cos(a) * (1 + 0.05 * Math.sin(a * 40)), 42.6 + 0.15 * Math.sin(a)]);
    }
    ring.push(ring[0]);
    const big = P({ type: 'Polygon', coordinates: [ring] });
    const parcels = [];
    for (let i = 0; i < 60; i++) for (let j = 0; j < 50; j++) parcels.push({ key: `${i}-${j}`, prep: P(sq(-85.7 + i * 0.006, 42.45 + j * 0.006, -85.7 + i * 0.006 + 0.005, 42.45 + j * 0.006 + 0.005)) });
    const t0 = performance.now();
    const res = coverage(parcels, [{ key: 'big', prep: big }]);
    const ms = performance.now() - t0;
    expect(res.size).toBeGreaterThan(500);
    expect(ms).toBeLessThan(1500);
  });
});
