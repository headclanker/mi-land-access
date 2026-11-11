// Share links: a compact JSON encoding of markups, deflate-raw compressed, base64url, in the hash.
// Format: #m=<v><payload> where v is 'z' (deflate-raw) or 'j' (plain JSON when CompressionStream is missing).

import { type Coord, type Markup, defaultColor, isColor, isWaypointIcon, newId } from './model';

type Compact =
  | ['w', string, string, string, number, number, string] // kind,name,note,color,lon,lat,icon
  | ['l' | 's' | 't', string, string, string, number[]]; // kind,name,note,color,flat delta-encoded coords

const SCALE = 1e5; // ~1.1 m precision keeps links short

function deltaEncode(coords: readonly Coord[]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (const c of coords) {
    const x = Math.round(c[0] * SCALE);
    const y = Math.round(c[1] * SCALE);
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

function deltaDecode(flat: readonly number[]): Coord[] {
  const out: Coord[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
    out.push([x / SCALE, y / SCALE]);
  }
  return out;
}

function toCompact(m: Markup): Compact {
  if (m.kind === 'waypoint') {
    return ['w', m.name, m.note, m.color, Math.round(m.coord[0] * SCALE) / SCALE, Math.round(m.coord[1] * SCALE) / SCALE, m.icon];
  }
  const k = m.kind === 'line' ? 'l' : m.kind === 'shape' ? 's' : 't';
  return [k, m.name, m.note, m.color, deltaEncode(m.coords)];
}

function fromCompact(c: unknown, now: number): Markup | null {
  if (!Array.isArray(c) || c.length < 5) return null;
  const [k, name, note, color] = c as unknown[];
  const base = {
    id: newId(),
    name: typeof name === 'string' ? name : '',
    note: typeof note === 'string' ? note : '',
    created: now,
    updated: now,
  };
  if (k === 'w') {
    const lon = Number(c[4]);
    const lat = Number(c[5]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { ...base, kind: 'waypoint', color: isColor(color) ? color : defaultColor('waypoint'), coord: [lon, lat], icon: isWaypointIcon(c[6]) ? c[6] : 'pin' };
  }
  const flat = c[4];
  if (!Array.isArray(flat) || !flat.every((n) => typeof n === 'number')) return null;
  const coords = deltaDecode(flat as number[]);
  if (k === 'l' && coords.length >= 2) return { ...base, kind: 'line', color: isColor(color) ? color : defaultColor('line'), coords };
  if (k === 's' && coords.length >= 3) return { ...base, kind: 'shape', color: isColor(color) ? color : defaultColor('shape'), coords };
  if (k === 't' && coords.length >= 2) return { ...base, kind: 'track', color: isColor(color) ? color : defaultColor('track'), coords };
  return null;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const hasCompression = (): boolean => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** Encodes markups to the payload used after `#m=`. */
export async function encodeShare(markups: readonly Markup[]): Promise<string> {
  const json = JSON.stringify([1, markups.map(toCompact)]);
  const bytes = new TextEncoder().encode(json);
  if (hasCompression()) return 'z' + bytesToB64url(await pipe(bytes, new CompressionStream('deflate-raw')));
  return 'j' + bytesToB64url(bytes);
}

export async function decodeShare(payload: string, now = Date.now()): Promise<Markup[]> {
  const kind = payload[0];
  const bytes = b64urlToBytes(payload.slice(1));
  let json: string;
  if (kind === 'z') json = new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')));
  else if (kind === 'j') json = new TextDecoder().decode(bytes);
  else throw new Error('Unknown share format');
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || parsed[0] !== 1 || !Array.isArray(parsed[1])) throw new Error('Unsupported share link');
  return (parsed[1] as unknown[]).map((c) => fromCompact(c, now)).filter((m): m is Markup => m !== null);
}

export const SHARE_HASH_KEY = 'm';

export async function buildShareUrl(base: string, markups: readonly Markup[]): Promise<string> {
  const u = new URL(base);
  u.hash = `${SHARE_HASH_KEY}=${await encodeShare(markups)}`;
  return u.toString();
}

/** Extracts the share payload from a location hash like "#m=z...". */
export function sharePayloadFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.get(SHARE_HASH_KEY);
}
