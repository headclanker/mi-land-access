#!/usr/bin/env node
// Builds public/cities/city-limits.json: the boundaries of Michigan's 280 incorporated cities,
// used by the "inside a city, treat non-program land as closed" grading rule
// (src/grading/reconcile.ts cityOverride) and drawn as the optional "City limits" reference layer.
// scripts/build-overview.mjs reads the same file.
//
// Run manually (Node 22+):
//
//   node scripts/build-city-limits.mjs
//
// Behind an HTTP proxy, Node's fetch also needs NODE_USE_ENV_PROXY=1 (and NODE_EXTRA_CA_CERTS
// for a TLS-intercepting proxy). The output is committed so the app works offline and never
// depends on the state server's CORS; re-run it when city boundaries change (annexations).
//
// Source: State of Michigan "Minor Civil Divisions" (Michigan Geographic Framework), TYPE='City'.
// Villages are not in that layer (they sit inside townships), so village land is not covered.
// Generalised on the server with maxAllowableOffset ≈ 13 m N–S / 10 m E–W, 5-decimal coordinates.

import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const URL_MCD = 'https://gisagocss.state.mi.us/arcgis/rest/services/OpenData/michigan_geographic_framework/MapServer/2';
const OUT = new URL('../public/cities/city-limits.json', import.meta.url);
const OFFSET_DEG = Number(process.env.CITY_OFFSET_DEG ?? 0.00012);

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

/** "The Village of Grosse Pointe Shores A Michigan City" → "Grosse Pointe Shores"; "Village of Clarkston" → "Clarkston". */
export function cityDisplayName(name) {
  return String(name ?? '')
    .replace(/^the\s+/i, '')
    .replace(/^village of\s+/i, '')
    .replace(/,?\s+a michigan city$/i, '')
    .trim();
}

function cleanRing(ring) {
  const out = [];
  for (const p of ring) {
    const q = [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0]);
  return out.length >= 4 ? out : null;
}

function cleanGeometry(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const kept = [];
  for (const rings of polys) {
    const outer = cleanRing(rings[0]);
    if (!outer) continue;
    kept.push([outer, ...rings.slice(1).map(cleanRing).filter(Boolean)]);
  }
  if (!kept.length) return null;
  return kept.length === 1 ? { type: 'Polygon', coordinates: kept[0] } : { type: 'MultiPolygon', coordinates: kept };
}

async function main() {
  const started = Date.now();
  const where = "TYPE='City'";
  const { count } = await getJson(`${URL_MCD}/query?${new URLSearchParams({ where, returnCountOnly: 'true', f: 'json' })}`);
  const features = [];
  for (let o = 0; o < count; o += 1000) {
    const q = new URLSearchParams({
      where,
      outFields: 'NAME,LABEL,FIPSCODE',
      returnGeometry: 'true',
      outSR: '4326',
      maxAllowableOffset: String(OFFSET_DEG),
      geometryPrecision: '5',
      orderByFields: 'OBJECTID',
      resultOffset: String(o),
      resultRecordCount: '1000',
      f: 'geojson',
    });
    const fc = await getJson(`${URL_MCD}/query?${q}`);
    features.push(...(fc.features ?? []));
  }
  if (features.length !== count) throw new Error(`Expected ${count} cities, got ${features.length}`);
  const out = [];
  for (const f of features) {
    const geometry = cleanGeometry(f.geometry ?? {});
    const n = cityDisplayName(f.properties?.NAME);
    if (!geometry || !n) {
      console.error('Skipped', f.properties);
      continue;
    }
    out.push({ type: 'Feature', properties: { n, fips: String(f.properties?.FIPSCODE ?? '') }, geometry });
  }
  out.sort((a, b) => a.properties.n.localeCompare(b.properties.n));
  const built = new Date().toISOString().slice(0, 10);
  const fc = { type: 'FeatureCollection', built, source: URL_MCD, where, offsetDeg: OFFSET_DEG, count: out.length, features: out };
  const json = JSON.stringify(fc);
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, json);
  console.error(`Wrote ${OUT.pathname}: ${out.length} cities, ${(json.length / 1024).toFixed(0)} KB raw, ${(gzipSync(json, { level: 9 }).length / 1024).toFixed(0)} KB gzipped, in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
