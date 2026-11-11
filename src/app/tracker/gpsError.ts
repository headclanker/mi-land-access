// Which geolocation errors are worth showing. Pure (unit-tested).

/** Fixes newer than this mean the GPS is working, whatever error just fired. */
export const GPS_ERROR_GRACE_MS = 20_000;

/**
 * Message for a GeolocationPositionError code (1 denied, 2 unavailable, 3 timeout), or null when
 * it should be ignored. Browsers fire "unavailable" / timeout blips between good fixes (under
 * canopy, and Chromium's location emulation fires code 2 on every position change), so those
 * only count once fixes have actually stopped. Permission denied always counts.
 */
export function describeGpsError(code: number, msSinceLastFix: number): string | null {
  if (code === 1) return 'Location permission denied. Enable it in your browser settings.';
  if (msSinceLastFix < GPS_ERROR_GRACE_MS) return null;
  return code === 3 ? 'Still waiting for a GPS fix…' : 'Location unavailable — check that location is on for this site';
}
