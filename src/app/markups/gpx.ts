// GPX 1.1 import/export. The parser is a small tolerant tag scanner (no DOMParser) so it runs in
// workers/tests too and copes with the GPX dialects produced by Garmin, onX-style apps, Gaia, etc.

import { type Coord, type Markup, defaultColor, isColor, isWaypointIcon, newId, type WaypointIcon } from './model';

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function unescapeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, x: string) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&amp;/g, '&');
}

const n6 = (v: number): string => String(Math.round(v * 1e7) / 1e7);

function pt(tag: string, c: Coord, time?: number, extra = ''): string {
  const ele = c.length === 3 ? `<ele>${Math.round(c[2] * 10) / 10}</ele>` : '';
  const t = time !== undefined ? `<time>${new Date(time).toISOString()}</time>` : '';
  return `<${tag} lat="${n6(c[1])}" lon="${n6(c[0])}">${ele}${t}${extra}</${tag}>`;
}

function meta(m: Markup): string {
  const desc = m.note ? `<desc>${escapeXml(m.note)}</desc>` : '';
  return `<name>${escapeXml(m.name || '')}</name>${desc}`;
}

function ext(m: Markup, icon?: WaypointIcon): string {
  return `<extensions><mila:kind>${m.kind}</mila:kind><mila:color>${m.color}</mila:color>${icon ? `<mila:icon>${icon}</mila:icon>` : ''}</extensions>`;
}

export function markupsToGPX(markups: readonly Markup[], creator = 'SketchX'): string {
  const parts: string[] = [];
  for (const m of markups) {
    if (m.kind !== 'waypoint') continue;
    parts.push(pt('wpt', m.coord, undefined, `${meta(m)}<sym>${escapeXml(m.icon)}</sym>${ext(m, m.icon)}`));
  }
  for (const m of markups) {
    if (m.kind === 'waypoint') continue;
    const coords = m.kind === 'shape' && m.coords.length ? [...m.coords, m.coords[0]] : m.coords;
    const times = m.kind === 'track' ? m.times : undefined;
    const seg = coords.map((c, i) => pt('trkpt', c, times?.[i])).join('');
    parts.push(`<trk>${meta(m)}<type>${m.kind}</type>${ext(m)}<trkseg>${seg}</trkseg></trk>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="${escapeXml(creator)}" xmlns="http://www.topografix.com/GPX/1/1" ` +
    `xmlns:mila="https://mi-land-access.app/gpx/1">\n` +
    parts.join('\n') +
    `\n</gpx>\n`
  );
}

// ---------- parsing ----------

function attr(tagOpen: string, name: string): string | undefined {
  const m = tagOpen.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3]) : undefined;
}

/** Text of the first direct-ish child element (namespace-insensitive). */
function child(body: string, name: string): string | undefined {
  const m = body.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i'));
  return m ? unescapeXml(m[1].trim()) : undefined;
}

/** Iterates <tag ...>body</tag> and self-closing <tag .../> elements. */
function* elements(xml: string, tag: string): Generator<{ open: string; body: string }> {
  const re = new RegExp(`<${tag}\\b([^>]*?)(/>|>([\\s\\S]*?)</${tag}>)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) yield { open: m[1], body: m[3] ?? '' };
}

function parsePoint(open: string, body: string): { c: Coord; t?: number } | null {
  const lat = parseFloat(attr(open, 'lat') ?? '');
  const lon = parseFloat(attr(open, 'lon') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const eleS = child(body, 'ele');
  const ele = eleS !== undefined ? parseFloat(eleS) : NaN;
  const timeS = child(body, 'time');
  const t = timeS ? Date.parse(timeS) : NaN;
  return { c: Number.isFinite(ele) ? [lon, lat, ele] : [lon, lat], t: Number.isFinite(t) ? t : undefined };
}

const SYM_TO_ICON: [RegExp, WaypointIcon][] = [
  [/stand|tree/i, 'stand'],
  [/blind/i, 'blind'],
  [/camera/i, 'camera'],
  [/park|car/i, 'parking'],
  [/camp|tent/i, 'camp'],
  [/deer|animal|track|sign/i, 'deer'],
  [/blood|drop/i, 'drop'],
  [/gate/i, 'gate'],
  [/flag/i, 'flag'],
];

function iconFor(sym: string | undefined, ext: string | undefined): WaypointIcon {
  if (isWaypointIcon(ext)) return ext;
  if (!sym) return 'pin';
  if (isWaypointIcon(sym)) return sym;
  for (const [re, icon] of SYM_TO_ICON) if (re.test(sym)) return icon;
  return 'pin';
}

export function gpxToMarkups(xml: string, now = Date.now()): Markup[] {
  if (!/<gpx[\s>]/i.test(xml)) throw new Error('Not a GPX file');
  // Strip comments so commented-out points aren't imported.
  const doc = xml.replace(/<!--[\s\S]*?-->/g, '');
  const out: Markup[] = [];
  const baseFrom = (body: string, kind: Markup['kind']) => {
    const color = child(body, 'color');
    return {
      id: newId(),
      name: child(body, 'name') ?? '',
      note: child(body, 'desc') ?? child(body, 'cmt') ?? '',
      color: isColor(color) ? color : defaultColor(kind),
      created: now,
      updated: now,
    };
  };

  for (const { open, body } of elements(doc, 'wpt')) {
    const p = parsePoint(open, body);
    if (!p) continue;
    out.push({ ...baseFrom(body, 'waypoint'), kind: 'waypoint', coord: p.c, icon: iconFor(child(body, 'sym'), child(body, 'icon')) });
  }

  const pushPath = (body: string, pts: { c: Coord; t?: number }[], fallbackKind: 'line' | 'track'): void => {
    if (pts.length < 2) return;
    const declared = child(body, 'kind') ?? child(body, 'type');
    const kind: 'line' | 'track' | 'shape' =
      declared === 'shape' || declared === 'line' || declared === 'track' ? declared : fallbackKind;
    const coords = pts.map((p) => p.c);
    if (kind === 'shape') {
      const a = coords[0];
      const b = coords[coords.length - 1];
      if (coords.length > 3 && a[0] === b[0] && a[1] === b[1]) coords.pop();
      out.push({ ...baseFrom(body, 'shape'), kind: 'shape', coords });
    } else if (kind === 'track') {
      const times = pts.every((p) => p.t !== undefined) ? pts.map((p) => p.t as number) : undefined;
      const duration = times ? times[times.length - 1] - times[0] : undefined;
      out.push({ ...baseFrom(body, 'track'), kind: 'track', coords, times, duration });
    } else out.push({ ...baseFrom(body, 'line'), kind: 'line', coords });
  };

  for (const { body } of elements(doc, 'trk')) {
    const header = body.split(/<trkseg\b/i)[0];
    const segs = [...elements(body, 'trkseg')];
    for (const seg of segs) {
      const pts = [...elements(seg.body, 'trkpt')].map((e) => parsePoint(e.open, e.body)).filter((p): p is { c: Coord; t?: number } => p !== null);
      // Header carries name/desc/type/extensions; segments only points.
      pushPath(header, pts, pts.some((p) => p.t !== undefined) ? 'track' : 'line');
    }
  }

  for (const { body } of elements(doc, 'rte')) {
    const header = body.split(/<rtept\b/i)[0];
    const pts = [...elements(body, 'rtept')].map((e) => parsePoint(e.open, e.body)).filter((p): p is { c: Coord; t?: number } => p !== null);
    pushPath(header, pts, 'line');
  }
  return out;
}
