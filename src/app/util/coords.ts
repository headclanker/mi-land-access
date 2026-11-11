// Coordinate parsing/formatting for the search box and readout. Pure, unit-tested.

export interface ParsedCoord {
  lat: number;
  lon: number;
}

const NUM = String.raw`[-+]?\d+(?:\.\d+)?`;

/** Parses one axis written as decimal degrees or D M S with optional hemisphere letter. */
function parseAxis(raw: string): { value: number; hemi?: string } | null {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  const hemiMatch = s.match(/[NSEW]/g);
  const hemi = hemiMatch ? hemiMatch[hemiMatch.length - 1] : undefined;
  const nums = s.replace(/[NSEW]/g, ' ').match(new RegExp(NUM, 'g'));
  if (!nums || nums.length === 0 || nums.length > 3) return null;
  const [d, m = '0', sec = '0'] = nums;
  const deg = parseFloat(d);
  const sign = deg < 0 || d.startsWith('-') ? -1 : 1;
  let value = Math.abs(deg) + parseFloat(m) / 60 + parseFloat(sec) / 3600;
  if (parseFloat(m) >= 60 || parseFloat(sec) >= 60) return null;
  value *= sign;
  if (hemi === 'S' || hemi === 'W') value = -Math.abs(value);
  return { value, hemi };
}

/**
 * Accepts "42.73, -84.55", "42.73 -84.55", "42°43'48\"N 84°33'W", "N42 43.8 W84 33".
 * A bare pair is read as lat, lon unless hemisphere letters say otherwise.
 * Michigan-friendly: a positive longitude between 82 and 91 with no hemisphere is
 * assumed to be west, since people often drop the minus sign.
 */
export function parseLatLon(input: string): ParsedCoord | null {
  const s = input.trim().replace(/[°º'′"″]/g, ' ');
  if (!s) return null;
  let parts: string[];
  if (s.includes(',')) parts = s.split(',');
  else {
    // Split at hemisphere boundaries first ("N42 43 W84 33" / "42 43 N 84 33 W").
    const hemiSplit = s.toUpperCase().match(/^(.*?[NS])\s*(.*[EW].*)$/) ?? s.toUpperCase().match(/^([NS].*?)\s+([EW].*)$/);
    if (hemiSplit) parts = [hemiSplit[1], hemiSplit[2]];
    else {
      const tokens = s.split(/\s+/);
      if (tokens.length === 2) parts = tokens;
      else if (tokens.length === 4) parts = [tokens.slice(0, 2).join(' '), tokens.slice(2).join(' ')];
      else if (tokens.length === 6) parts = [tokens.slice(0, 3).join(' '), tokens.slice(3).join(' ')];
      else return null;
    }
  }
  if (parts.length !== 2) return null;
  const a = parseAxis(parts[0]);
  const b = parseAxis(parts[1]);
  if (!a || !b) return null;
  let lat = a.value;
  let lon = b.value;
  if ((a.hemi === 'E' || a.hemi === 'W') && (b.hemi === 'N' || b.hemi === 'S' || b.hemi === undefined)) {
    lat = b.value;
    lon = a.value;
  }
  if (!a.hemi && !b.hemi && lon > 82 && lon < 91 && lat > 41 && lat < 49) lon = -lon;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function formatLatLon(lat: number, lon: number, digits = 5): string {
  return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`;
}

export function toDMS(value: number, isLat: boolean): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let s = Math.round(((abs - d) * 60 - m) * 60 * 10) / 10;
  if (s >= 60) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d += 1;
  }
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${hemi}`;
}
