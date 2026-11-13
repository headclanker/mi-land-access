#!/usr/bin/env node
// Builds public/overview/public-land.json: a heavily generalised, statewide picture of public
// land for the zoomed-out map (below the zoom where the live ArcGIS layers take over).
//
// Run manually (Node 22.18+ so the .ts catalog/grading modules load without a build step):
//
//   node scripts/build-overview.mjs
//
// Behind an HTTP proxy, Node's fetch also needs NODE_USE_ENV_PROXY=1 (and NODE_EXTRA_CA_CERTS
// for a TLS-intercepting proxy). The output is committed; re-run it when the source data changes.
//
// What it does:
//   1. Pulls every feature of the catalog's dnr-managed-lands (same where clause),
//      dnr-park-hunting, usfs-surface-ownership (inside Michigan) and padus-federal-other layers,
//      plus padus-local and padus-state-researched (only features with a researched green or red
//      rule from src/data/parkRules.ts are painted), generalised on the server
//      (maxAllowableOffset) to keep the download small.
//   2. Grades each feature with the app's own gradeFeature() — the same colours the live layers
//      use, researched unit rules included.
//   3. Paints the grades onto a ~100 m grid clipped to Michigan's county outlines, in reconcile
//      precedence order (PAD-US federal, then USFS, then DNR ownership, then park hunting zones
//      on top), which dissolves overlaps and neighbours of the same grade for free.
//   4. Applies the city-limits rule (src/grading/reconcile.ts cityOverride) cell by cell, using
//      the committed city limits (public/cities/city-limits.json, scripts/build-city-limits.mjs):
//      a yellow cell inside a city turns red, except cells whose grade came from a state park
//      hunting zone (a restricted zone is the state's own decision) or a researched unit rule.
//      Green stays green.
//   5. Traces each grade's connected regions back into polygons (with holes), drops specks,
//      simplifies, and writes one MultiPolygon per grade with 3-decimal coordinates.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { LAYER_SOURCES } from '../src/data/sources.ts';
import { gradeFeature, drawsPurple } from '../src/grading/grade.ts';

const OUT = new URL('../public/overview/public-land.json', import.meta.url);
const CITY_LIMITS = new URL('../public/cities/city-limits.json', import.meta.url);
const W_LON = -90.45, E_LON = -82.1, S_LAT = 41.68, N_LAT = 48.32;
const CELL_M = Number(process.env.OVERVIEW_CELL_M ?? 100); // grid cell size, metres
const MIN_CELLS = 4; // regions (and holes) smaller than this are dropped (~9 ha)
const SIMPLIFY_CELLS = 0.75; // Douglas–Peucker tolerance in cells
const SERVER_OFFSET = 0.0006; // degrees, ~50 m: generalisation done by the ArcGIS server
const GRADE_CODE = { green: 1, yellow: 2, red: 3 };
const CODE_GRADE = ['', 'green', 'yellow', 'red', 'refuge'];
/** Refuges, nature preserves and nature centers get their own colour whatever their grade. */
const REFUGE_CODE = 4;

const LAT0 = (S_LAT + N_LAT) / 2;
const DY = CELL_M / 111320;
const DX = CELL_M / (111320 * Math.cos((LAT0 * Math.PI) / 180));
const W = Math.ceil((E_LON - W_LON) / DX);
const H = Math.ceil((N_LAT - S_LAT) / DY);

const byId = (id) => {
  const s = LAYER_SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`No catalog layer ${id}`);
  return s;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
      return body;
    } catch (err) {
      if (i >= tries) throw err;
      await sleep(1500 * (i + 1));
    }
  }
}

/** Every feature of a layer (paged by resultOffset, ordered by object id). */
async function fetchAll(source, { where = source.where ?? '1=1', envelope, offset = SERVER_OFFSET } = {}) {
  const meta = await getJson(`${source.url}?f=json`);
  const oid = meta.objectIdField ?? meta.fields?.find((f) => f.type === 'esriFieldTypeOID')?.name ?? 'OBJECTID';
  const page = Math.min(meta.maxRecordCount ?? 1000, 2000);
  const base = {
    where,
    outFields: source.fields.join(','),
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: String(offset),
    geometryPrecision: '5',
    orderByFields: oid,
    f: 'geojson',
  };
  if (envelope) Object.assign(base, { geometry: envelope.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' });
  const { orderByFields: _o, ...countBase } = base; // some MapServers reject orderBy on counts
  const countQ = new URLSearchParams({ ...countBase, returnCountOnly: 'true', f: 'json' });
  const { count } = await getJson(`${source.url}/query?${countQ}`);
  const offsets = [];
  for (let o = 0; o < count; o += page) offsets.push(o);
  const all = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < offsets.length) {
      const o = offsets[next++];
      const q = new URLSearchParams({ ...base, resultOffset: String(o), resultRecordCount: String(page) });
      const fc = await getJson(`${source.url}/query?${q}`);
      all.push(...(fc.features ?? []));
      done++;
      if (done % 10 === 0 || done === offsets.length) process.stderr.write(`  ${source.id}: ${done}/${offsets.length} pages\r`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  process.stderr.write('\n');
  return { features: all, count };
}

// ---------- raster ----------

const colOf = (lon) => (lon - W_LON) / DX;
const rowOf = (lat) => (N_LAT - lat) / DY;

function polygonsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

/** Even-odd scanline fill of one polygon (all rings) at cell centres; calls set(index). */
function rasterize(rings, set) {
  let minR = Infinity, maxR = -Infinity;
  const edges = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const x0 = colOf(ring[i][0]), y0 = rowOf(ring[i][1]);
      const x1 = colOf(ring[i + 1][0]), y1 = rowOf(ring[i + 1][1]);
      if (y0 === y1) continue;
      edges.push([x0, y0, x1, y1]);
      minR = Math.min(minR, y0, y1);
      maxR = Math.max(maxR, y0, y1);
    }
  }
  const r0 = Math.max(0, Math.ceil(minR - 0.5));
  const r1 = Math.min(H - 1, Math.floor(maxR - 0.5));
  const xs = [];
  for (let r = r0; r <= r1; r++) {
    const y = r + 0.5;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const c1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let c = c0; c <= c1; c++) set(r * W + c);
    }
  }
}

// ---------- vectorise ----------

/** 4-connected component labels for cells equal to `code`; returns component sizes. */
function label(grid, code, labels) {
  labels.fill(0);
  const sizes = [0];
  const stack = new Int32Array(W * H);
  let n = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== code || labels[i]) continue;
    n++;
    let size = 0;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = n;
    while (sp) {
      const j = stack[--sp];
      size++;
      const r = (j / W) | 0, c = j - r * W;
      if (c > 0 && grid[j - 1] === code && !labels[j - 1]) { labels[j - 1] = n; stack[sp++] = j - 1; }
      if (c < W - 1 && grid[j + 1] === code && !labels[j + 1]) { labels[j + 1] = n; stack[sp++] = j + 1; }
      if (r > 0 && grid[j - W] === code && !labels[j - W]) { labels[j - W] = n; stack[sp++] = j - W; }
      if (r < H - 1 && grid[j + W] === code && !labels[j + W]) { labels[j + W] = n; stack[sp++] = j + W; }
    }
    sizes.push(size);
  }
  return sizes;
}

/** Douglas–Peucker on an open polyline of [x, y] grid points. */
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function simplifyRing(ring, tol) {
  // ring: closed list without the repeated last point. Split at the point farthest from the first.
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = dp(ring.slice(0, far + 1), tol);
  const b = dp([...ring.slice(far), ring[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const toLonLat = ([x, y]) => [r3(W_LON + x * DX), r3(N_LAT - y * DY)];

function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

/** Traces the boundary of every kept component of `code` into GeoJSON polygon coordinates. */
function vectorise(grid, code, labels, minCells = MIN_CELLS) {
  const sizes = label(grid, code, labels);
  // Directed boundary edges, interior on the right (screen coords, y down), grouped by component.
  const edgesBy = new Map();
  const add = (comp, x0, y0, x1, y1) => {
    let e = edgesBy.get(comp);
    if (!e) edgesBy.set(comp, (e = []));
    e.push(x0, y0, x1, y1);
  };
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      const comp = labels[i];
      if (!comp || sizes[comp] < minCells) continue;
      if (r === 0 || labels[i - W] !== comp) add(comp, c, r, c + 1, r);
      if (c === W - 1 || labels[i + 1] !== comp) add(comp, c + 1, r, c + 1, r + 1);
      if (r === H - 1 || labels[i + W] !== comp) add(comp, c + 1, r + 1, c, r + 1);
      if (c === 0 || labels[i - 1] !== comp) add(comp, c, r + 1, c, r);
    }
  const polys = [];
  const key = (x, y) => y * (W + 1) + x;
  for (const e of edgesBy.values()) {
    const n = e.length / 4;
    const out = new Map();
    for (let k = 0; k < n; k++) {
      const kk = key(e[k * 4], e[k * 4 + 1]);
      const l = out.get(kk);
      if (l) l.push(k);
      else out.set(kk, [k]);
    }
    const used = new Uint8Array(n);
    const rings = [];
    for (let s = 0; s < n; s++) {
      if (used[s]) continue;
      const pts = [];
      let k = s;
      while (!used[k]) {
        used[k] = 1;
        const x0 = e[k * 4], y0 = e[k * 4 + 1], x1 = e[k * 4 + 2], y1 = e[k * 4 + 3];
        pts.push([x0, y0]);
        const cand = (out.get(key(x1, y1)) ?? []).filter((j) => !used[j]);
        if (!cand.length) break;
        if (cand.length === 1) k = cand[0];
        else {
          // Saddle: prefer the right turn so diagonal neighbours stay separate rings.
          const dx = x1 - x0, dy = y1 - y0;
          const rx = -dy, ry = dx;
          k = cand.find((j) => e[j * 4 + 2] - e[j * 4] === rx && e[j * 4 + 3] - e[j * 4 + 1] === ry) ?? cand[0];
        }
      }
      // Drop collinear points (keep corners only).
      const corners = pts.filter((p, i) => {
        const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
      });
      if (corners.length >= 4) rings.push(corners);
    }
    if (!rings.length) continue;
    // Outer ring = largest; the rest are holes (drop tiny holes).
    const withArea = rings.map((r) => ({ r, a: Math.abs(signedArea(r)) })).sort((x, y) => y.a - x.a);
    const kept = [withArea[0], ...withArea.slice(1).filter((x) => x.a >= MIN_CELLS)];
    const coords = [];
    kept.forEach(({ r, a: ringArea }, i) => {
      // Tiny regions (a closed campground) would collapse under simplification: keep them exact.
      const simp = ringArea < 16 ? r : simplifyRing(r, SIMPLIFY_CELLS);
      if (simp.length < 3) return;
      let ll = simp.map(toLonLat);
      ll = ll.filter((p, j) => j === 0 || p[0] !== ll[j - 1][0] || p[1] !== ll[j - 1][1]);
      if (ll.length < 3) return;
      // RFC 7946 winding: outer counter-clockwise, holes clockwise (lon/lat space).
      const a = signedArea(ll);
      if ((i === 0 && a < 0) || (i > 0 && a > 0)) ll.reverse();
      if (i > 0 && !coords.length) return;
      coords.push([...ll, ll[0]]);
    });
    if (coords.length) polys.push(coords);
  }
  return polys;
}

// ---------- main ----------

async function main() {
  const started = Date.now();
  console.error(`Grid ${W} × ${H} cells of ${CELL_M} m`);

  // Michigan land mask from the county outlines (clips USFS/PAD-US features in other states).
  const counties = byId('ref-counties');
  const { features: countyFs } = await fetchAll(counties, { where: '1=1', offset: 0.002 });
  const mask = new Uint8Array(W * H);
  for (const f of countyFs) for (const p of polygonsOf(f.geometry)) rasterize(p, (i) => (mask[i] = 1));
  console.error(`Michigan mask: ${countyFs.length} counties`);

  // City limits mask (index + 1 into the city list) for the city-limits rule.
  const cityFile = JSON.parse(await readFile(CITY_LIMITS, 'utf8'));
  const cityNames = cityFile.features.map((f) => f.properties.n);
  const cityMask = new Uint16Array(W * H);
  cityFile.features.forEach((f, k) => {
    for (const p of polygonsOf(f.geometry)) rasterize(p, (i) => (cityMask[i] = k + 1));
  });
  console.error(`City limits: ${cityNames.length} cities (built ${cityFile.built})`);

  const grid = new Uint8Array(W * H);
  /** Cells whose grade was painted by a state access program (park hunting zones): exempt from the city rule. */
  const program = new Uint8Array(W * H);
  const stats = {};
  // Paint order = reconcile precedence, lowest first: PAD-US (low confidence) < USFS / DNR
  // ownership < park hunting zones (an access program decides access regardless of owner).
  // padus-local and padus-state-researched paint features with a researched GREEN or RED rule
  // (src/data/parkRules.ts), e.g. the Gogebic County Forest. padus-local also paints its yellow
  // ("check first") land, however small, so township and county land shows when zoomed out;
  // other unresearched local land stays off the overview.
  const layers = [
    { id: 'padus-local', researchedOnly: true, yellowToo: true },
    { id: 'padus-state-researched', researchedOnly: true },
    { id: 'padus-federal-other' },
    { id: 'usfs-surface-ownership', envelope: [W_LON, S_LAT, E_LON, N_LAT] },
    { id: 'dnr-managed-lands' },
    { id: 'dnr-park-hunting' },
  ];
  for (const l of layers) {
    const src = byId(l.id);
    const { features, count } = await fetchAll(src, { envelope: l.envelope });
    const g = { green: 0, yellow: 0, red: 0, unknown: 0 };
    // Within a layer the strictest grade paints last, so where zones overlap (a closed zone drawn
    // inside an open one) the overview never shows the looser status.
    const STRICT = { green: 0, unknown: 1, yellow: 2, red: 3 };
    const graded = features
      .map((f) => {
        const r = gradeFeature(src, f.properties ?? {});
        return { f, grade: r.grade, researched: Boolean(r.researched), refuge: drawsPurple(l.id, f.properties) };
      })
      .filter((x) => !l.researchedOnly || (x.researched && x.grade !== 'yellow') || (l.yellowToo && x.grade === 'yellow') || x.refuge)
      .sort((a, b) => STRICT[a.grade] - STRICT[b.grade]);
    // The county mask only exists to clip federal data from other states; Michigan DNR layers
    // are in-state by definition, and the generalised mask would clip shoreline parks.
    const useMask = !l.id.startsWith('dnr-');
    const isProgram = l.id === 'dnr-park-hunting';
    const researchedAcres = { green: 0, yellow: 0, red: 0 };
    for (const { f, grade, researched, refuge } of graded) {
      g[grade]++;
      const code = refuge ? REFUGE_CODE : GRADE_CODE[grade];
      if (!code) continue;
      // A researched unit rule is exempt from the city rule, like a park hunting zone.
      const exempt = isProgram || researched;
      let painted = 0;
      const paint = (i) => {
        if (useMask && !mask[i]) return;
        grid[i] = code;
        program[i] = exempt ? 1 : 0;
        painted++;
        if (researched && !refuge) researchedAcres[grade] += (CELL_M * CELL_M) / 4046.86;
      };
      const polys = polygonsOf(f.geometry);
      for (const p of polys) rasterize(p, paint);
      // A yellow area smaller than a cell covers no cell centre: give it the cell it sits in.
      if (!painted && grade === 'yellow' && polys[0]?.[0]?.[0]) {
        const [lon, lat] = polys[0][0][0];
        const c = Math.floor(colOf(lon)), r = Math.floor(rowOf(lat));
        if (c >= 0 && c < W && r >= 0 && r < H) paint(r * W + c);
      }
    }
    stats[l.id] = { features: graded.length, serverCount: count, grades: g };
    if (researchedAcres.green + researchedAcres.yellow + researchedAcres.red) {
      console.error(`  researched rules painted: ${Object.entries(researchedAcres).map(([k, v]) => `${k} ${Math.round(v)} ac`).join(', ')}`);
    }
    console.error(`${l.id}: ${graded.length} painted of ${features.length}/${count} features`, g);
  }

  // City-limits rule: yellow inside a city → red (not park-zone cells); green and red unchanged.
  const acres = (cells) => (cells * CELL_M * CELL_M) / 4046.86;
  const cityStats = { yellowToRed: 0, yellowKeptProgram: 0, greenInCity: 0, redInCity: 0 };
  const greenByCity = new Map();
  for (let i = 0; i < grid.length; i++) {
    const c = cityMask[i];
    if (!c) continue;
    if (grid[i] === GRADE_CODE.yellow) {
      if (program[i]) cityStats.yellowKeptProgram++;
      else {
        grid[i] = GRADE_CODE.red;
        cityStats.yellowToRed++;
      }
    } else if (grid[i] === GRADE_CODE.green) {
      cityStats.greenInCity++;
      const e = greenByCity.get(c) ?? { cells: 0, i };
      e.cells++;
      greenByCity.set(c, e);
    } else if (grid[i] === GRADE_CODE.red) cityStats.redInCity++;
  }
  console.error(
    `City rule: ${acres(cityStats.yellowToRed).toFixed(0)} acres yellow → red; ${acres(cityStats.yellowKeptProgram).toFixed(0)} acres of restricted park zones kept yellow; ` +
      `${acres(cityStats.greenInCity).toFixed(0)} acres green inside cities kept green; ${acres(cityStats.redInCity).toFixed(0)} acres already red inside cities`,
  );
  const topGreen = [...greenByCity].sort((a, b) => b[1].cells - a[1].cells).slice(0, 8);
  for (const [c, e] of topGreen) {
    const r = (e.i / W) | 0, col = e.i - r * W;
    console.error(`  green inside ${cityNames[c - 1]}: ${acres(e.cells).toFixed(0)} acres (e.g. ${(N_LAT - (r + 0.5) * DY).toFixed(4)}, ${(W_LON + (col + 0.5) * DX).toFixed(4)})`);
  }

  const labels = new Int32Array(W * H);
  const features = [];
  for (const code of [1, 2, 3, REFUGE_CODE]) {
    // Closed (red) regions are kept however small; dropping one would let the surrounding open
    // land read as huntable. Restricted (yellow) and refuge regions are kept however small too.
    const polys = vectorise(grid, code, labels, CODE_GRADE[code] === 'green' ? MIN_CELLS : 1);
    let cells = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] === code) cells++;
    console.error(`${CODE_GRADE[code]}: ${polys.length} polygons, ${(cells * CELL_M * CELL_M / 4046.86 / 1e6).toFixed(3)} M acres`);
    if (polys.length) features.push({ type: 'Feature', properties: { g: CODE_GRADE[code] }, geometry: { type: 'MultiPolygon', coordinates: polys } });
  }

  const built = new Date().toISOString().slice(0, 10);
  const fc = {
    type: 'FeatureCollection',
    built,
    cellMeters: CELL_M,
    cityLimitsBuilt: cityFile.built,
    cityRule: { yellowToRedAcres: Math.round(acres(cityStats.yellowToRed)), greenInCityAcres: Math.round(acres(cityStats.greenInCity)) },
    layers: Object.fromEntries(Object.entries(stats).map(([id, s]) => [id, s.features])),
    features,
  };
  const json = JSON.stringify(fc);
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, json);
  console.error(`Wrote ${OUT.pathname}: ${(json.length / 1024).toFixed(0)} KB raw, ${(gzipSync(json, { level: 9 }).length / 1024).toFixed(0)} KB gzipped, in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
