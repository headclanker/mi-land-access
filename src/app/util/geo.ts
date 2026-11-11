// Pure geodesy and formatting helpers (no DOM, no map). Unit-tested.

export type LngLat = [number, number];
/** Any [lon, lat, ...] position (elevation etc. ignored). */
export type Pos = readonly [number, number, ...number[]];

const R = 6371008.8; // mean Earth radius, metres
const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

export const M_PER_MILE = 1609.344;
export const M_PER_FOOT = 0.3048;
export const SQM_PER_ACRE = 4046.8564224;

/** Great-circle distance in metres. */
export function haversine(a: Pos, b: Pos): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees clockwise from true north, 0..360. */
export function bearing(a: Pos, b: Pos): number {
  const p1 = toRad(a[1]);
  const p2 = toRad(b[1]);
  const dl = toRad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

export function normalizeDeg(d: number): number {
  const n = d % 360;
  return n < 0 ? n + 360 : n;
}

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-point compass label for a heading in degrees. */
export function cardinal(deg: number): string {
  return CARDINALS[Math.round(normalizeDeg(deg) / 22.5) % 16];
}

/** Sum of segment lengths along a path, metres. */
export function pathLength(coords: readonly Pos[]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}

/** Imperial distance for hunters: feet under 0.1 mi, else miles. */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '–';
  const miles = m / M_PER_MILE;
  if (miles < 0.1) return `${Math.round(m / M_PER_FOOT).toLocaleString('en-US')} ft`;
  return `${miles < 10 ? miles.toFixed(2) : miles.toFixed(1)} mi`;
}

/** h:mm:ss or m:ss. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Minutes per mile, or null when not meaningful (too little distance). */
export function paceMinPerMile(ms: number, meters: number): number | null {
  if (meters < 20 || ms <= 0) return null;
  return ms / 60000 / (meters / M_PER_MILE);
}

export function formatPace(ms: number, meters: number): string {
  const p = paceMinPerMile(ms, meters);
  if (p === null || !Number.isFinite(p) || p > 600) return '–';
  const whole = Math.floor(p);
  let sec = Math.round((p - whole) * 60);
  let min = whole;
  if (sec === 60) {
    min += 1;
    sec = 0;
  }
  return `${min}:${String(sec).padStart(2, '0')} /mi`;
}

export function formatAcres(sqm: number): string {
  const ac = sqm / SQM_PER_ACRE;
  if (!Number.isFinite(ac)) return '–';
  if (ac < 10) return `${ac.toFixed(2)} ac`;
  if (ac < 1000) return `${ac.toFixed(1)} ac`;
  return `${Math.round(ac).toLocaleString('en-US')} ac`;
}

export function formatFeet(m: number): string {
  return `${Math.round(m / M_PER_FOOT).toLocaleString('en-US')} ft`;
}

export interface TrackPoint {
  lon: number;
  lat: number;
  /** Metres above sea level, if known. */
  ele?: number;
  /** Epoch ms. */
  t: number;
  /** Horizontal accuracy, metres. */
  acc?: number;
}

/**
 * Whether a new GPS fix should be appended to a track. Rejects very inaccurate fixes and
 * jitter smaller than the fix accuracy so a stationary hunter doesn't accumulate distance.
 */
export function shouldAcceptPoint(prev: TrackPoint | undefined, next: TrackPoint, maxAccuracy = 50): boolean {
  if (next.acc !== undefined && next.acc > maxAccuracy) return false;
  if (!prev) return true;
  const d = haversine([prev.lon, prev.lat], [next.lon, next.lat]);
  const threshold = Math.max(3, (next.acc ?? 10) * 0.5);
  return d >= threshold;
}

export interface TrackStats {
  distance: number;
  /** Total climb in metres, smoothed by a 3 m hysteresis. */
  gain: number;
  loss: number;
  minEle?: number;
  maxEle?: number;
}

export function trackStats(points: readonly TrackPoint[]): TrackStats {
  let distance = 0;
  let gain = 0;
  let loss = 0;
  let minEle: number | undefined;
  let maxEle: number | undefined;
  let ref: number | undefined;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) distance += haversine([points[i - 1].lon, points[i - 1].lat], [p.lon, p.lat]);
    if (p.ele !== undefined && Number.isFinite(p.ele)) {
      minEle = minEle === undefined ? p.ele : Math.min(minEle, p.ele);
      maxEle = maxEle === undefined ? p.ele : Math.max(maxEle, p.ele);
      if (ref === undefined) ref = p.ele;
      else if (p.ele - ref >= 3) {
        gain += p.ele - ref;
        ref = p.ele;
      } else if (ref - p.ele >= 3) {
        loss += ref - p.ele;
        ref = p.ele;
      }
    }
  }
  return { distance, gain, loss, minEle, maxEle };
}

/** Sum of active (non-paused) time across recorded segments, ms. */
export function activeDuration(segments: readonly { start: number; end?: number }[], now: number): number {
  return segments.reduce((sum, s) => sum + Math.max(0, (s.end ?? now) - s.start), 0);
}
