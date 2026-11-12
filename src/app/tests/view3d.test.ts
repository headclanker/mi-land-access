import { describe, expect, it } from 'vitest';
import {
  BUILDINGS_ATTRIBUTION,
  DEFAULT_3D,
  DEFAULT_EXAGGERATION,
  MAX_PITCH_3D,
  PITCH_3D,
  TERRAIN_ATTRIBUTION,
  attributionsFor,
  cameraFor,
  clampExaggeration,
  clipBBoxForPitch,
  demTileUrl,
  formatElevationFt,
  isBuildingTileUrl,
  isDemTileUrl,
  loadBBoxFor,
  normalizePrefs,
  planFor,
  reduce,
  terrariumElevation,
  tilePixel,
  trueElevation,
  type BBox,
} from '../map/view3dModel';

describe('3D settings', () => {
  it('normalizes missing or junk storage to defaults', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_3D);
    expect(normalizePrefs('x')).toEqual(DEFAULT_3D);
    const p = normalizePrefs({ on: 'yes', exaggeration: 'abc', buildings: 0, hillshade: 'sometimes', pitch: 5, bearing: -30 });
    expect(p.on).toBe(false);
    expect(p.exaggeration).toBe(DEFAULT_EXAGGERATION);
    expect(p.buildings).toBe(true);
    expect(p.hillshade).toBe('3d');
    expect(p.pitch).toBe(PITCH_3D);
    expect(p.bearing).toBe(330);
  });

  it('keeps valid saved values', () => {
    const p = normalizePrefs({ on: true, exaggeration: 2, buildings: false, hillshade: 'always', pitch: 65, bearing: 45 });
    expect(p).toEqual({ on: true, exaggeration: 2, buildings: false, hillshade: 'always', pitch: 65, bearing: 45 });
    expect(normalizePrefs({ pitch: 89 }).pitch).toBe(MAX_PITCH_3D);
  });

  it('clamps exaggeration to 1–3×', () => {
    expect(clampExaggeration(0.2)).toBe(1);
    expect(clampExaggeration(9)).toBe(3);
    expect(clampExaggeration('2')).toBe(2);
    expect(clampExaggeration(1.234)).toBe(1.2);
    expect(clampExaggeration(NaN)).toBe(DEFAULT_EXAGGERATION);
    expect(clampExaggeration(-1)).toBe(DEFAULT_EXAGGERATION);
    expect(clampExaggeration(undefined)).toBe(DEFAULT_EXAGGERATION);
  });
});

describe('3D mode state machine', () => {
  it('toggles and sets', () => {
    const on = reduce(DEFAULT_3D, { type: 'toggle' });
    expect(on.on).toBe(true);
    expect(reduce(on, { type: 'toggle' }).on).toBe(false);
    expect(reduce(on, { type: 'set', on: true })).toBe(on);
  });

  it('remembers the camera only in 3D and only for a real tilt', () => {
    expect(reduce(DEFAULT_3D, { type: 'camera', pitch: 40, bearing: 10 })).toBe(DEFAULT_3D);
    const on = reduce(DEFAULT_3D, { type: 'toggle' });
    expect(reduce(on, { type: 'camera', pitch: 3, bearing: 10 })).toBe(on);
    const moved = reduce(on, { type: 'camera', pitch: 45, bearing: -90 });
    expect(moved.pitch).toBe(45);
    expect(moved.bearing).toBe(270);
  });

  it('plans what to draw', () => {
    expect(planFor(DEFAULT_3D)).toEqual({ terrain: false, hillshade: false, buildings: false, dem: false, maxPitch: 0 });
    expect(planFor({ ...DEFAULT_3D, hillshade: 'always' })).toMatchObject({ terrain: false, hillshade: true, dem: true, maxPitch: 0 });
    expect(planFor({ ...DEFAULT_3D, on: true })).toEqual({ terrain: true, hillshade: true, buildings: true, dem: true, maxPitch: MAX_PITCH_3D });
    expect(planFor({ ...DEFAULT_3D, on: true, buildings: false, hillshade: 'off' })).toMatchObject({ hillshade: false, buildings: false, dem: true });
  });

  it('camera: heading-up keeps the bearing', () => {
    const p = { ...DEFAULT_3D, pitch: 60, bearing: 30 };
    expect(cameraFor(true, p, false)).toEqual({ pitch: 60, bearing: 30 });
    expect(cameraFor(true, p, true)).toEqual({ pitch: 60 });
    expect(cameraFor(false, p, false)).toEqual({ pitch: 0, bearing: 0 });
    expect(cameraFor(false, p, true)).toEqual({ pitch: 0 });
  });
});

describe('3D data URLs and credits', () => {
  it('builds terrarium URLs and rejects bad tiles', () => {
    expect(demTileUrl(12, 1068, 1475)).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1068/1475.png');
    expect(() => demTileUrl(2, 4, 0)).toThrow();
    expect(() => demTileUrl(1.5, 0, 0)).toThrow();
    expect(isDemTileUrl(demTileUrl(3, 1, 2))).toBe(true);
    expect(isDemTileUrl('https://s3.amazonaws.com/other/1.png')).toBe(false);
    expect(isBuildingTileUrl('https://tiles.openfreemap.org/planet/20261101_080013_pt/14/1/2.pbf')).toBe(true);
    expect(isBuildingTileUrl('not a url')).toBe(false);
  });

  it('credits only what is drawn', () => {
    expect(attributionsFor({ terrain: false, hillshade: false, buildings: false })).toEqual([]);
    expect(attributionsFor({ terrain: true, hillshade: true, buildings: false })).toEqual([TERRAIN_ATTRIBUTION]);
    expect(attributionsFor({ terrain: false, hillshade: true, buildings: false })).toEqual([TERRAIN_ATTRIBUTION]);
    expect(attributionsFor({ terrain: true, hillshade: false, buildings: true })).toEqual([TERRAIN_ATTRIBUTION, BUILDINGS_ATTRIBUTION]);
    expect(TERRAIN_ATTRIBUTION).toContain('Mapzen');
    expect(BUILDINGS_ATTRIBUTION).toContain('OpenStreetMap');
  });
});

describe('elevation', () => {
  it('decodes terrarium pixels', () => {
    expect(terrariumElevation(128, 0, 0)).toBe(0);
    // Lake Superior surface, as in the real tiles.
    expect(terrariumElevation(128, 179, 0)).toBe(179);
    expect(terrariumElevation(127, 255, 128)).toBeCloseTo(-0.5);
  });

  it('formats feet and undoes exaggeration', () => {
    expect(formatElevationFt(500)).toBe('≈ 1,640 ft');
    expect(formatElevationFt(null)).toBe('');
    expect(trueElevation(750, 1.5)).toBe(500);
    expect(trueElevation(null, 2)).toBeNull();
  });

  it('finds the tile pixel of a point', () => {
    const t = tilePixel(0, 0, 1);
    expect([t.x, t.y, t.px, t.py]).toEqual([1, 1, 0, 0]);
    const p = tilePixel(-89.75, 47.1, 10);
    expect([p.x, p.y, p.px, p.py]).toEqual([256, 359, 182, 192]);
  });
});

describe('data box for a tilted camera', () => {
  const bounds: BBox = [-87, 42, -84, 45];
  it('is unchanged when flat', () => {
    expect(clipBBoxForPitch(bounds, [-85.5, 43.5], 15, { width: 400, height: 700 }, 0)).toBe(bounds);
  });
  it('is clipped near the centre when tilted', () => {
    const b = clipBBoxForPitch(bounds, [-85.5, 43.5], 15, { width: 400, height: 700 }, 58);
    expect(b[0]).toBeGreaterThan(-85.6);
    expect(b[2]).toBeLessThan(-85.4);
    expect(b[0]).toBeLessThan(-85.5);
    expect(b[3]).toBeGreaterThan(43.5);
  });
  it('reads a map-like camera', () => {
    const map = {
      getBounds: () => ({ getWest: () => -86, getSouth: () => 42, getEast: () => -85, getNorth: () => 43 }),
      getCenter: () => ({ lng: -85.5, lat: 42.5 }),
      getZoom: () => 10,
      getPitch: () => 0,
      getContainer: () => ({ clientWidth: 400, clientHeight: 600 }),
    };
    expect(loadBBoxFor(map)).toEqual([-86, 42, -85, 43]);
    expect(loadBBoxFor({ ...map, getZoom: () => 16, getPitch: () => 60 })[0]).toBeGreaterThan(-85.51);
  });
});
