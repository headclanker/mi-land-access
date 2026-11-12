#!/usr/bin/env node
// Counts how many live features each researched rule (src/data/parkRules.ts) matches, so dead
// rules (zero matches after a data refresh renames a unit) are caught. Attributes only.
//
//   node scripts/check-park-rules.mjs            # table of rule → matches
//   node scripts/check-park-rules.mjs --fixture  # also print matched rows as JSON (test fixture)
//
// Behind an HTTP proxy Node's fetch needs NODE_USE_ENV_PROXY=1 (and NODE_EXTRA_CA_CERTS).
// Exits 1 if any rule matches nothing.

import { LAYER_SOURCES } from '../src/data/sources.ts';
import { PARK_RULES, RESEARCHED_LAYER_IDS, findParkRule } from '../src/data/parkRules.ts';

async function getJson(url) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error));
      return body;
    } catch (err) {
      if (i >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

async function attributes(source) {
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const q = new URLSearchParams({ where: source.where ?? '1=1', outFields: source.fields.join(','), returnGeometry: 'false', resultOffset: String(offset), resultRecordCount: '1000', f: 'json' });
    const body = await getJson(`${source.url}/query?${q}`);
    all.push(...(body.features ?? []).map((f) => f.attributes));
    if (!body.exceededTransferLimit && (body.features ?? []).length < 1000) break;
  }
  return all;
}

const counts = new Map(PARK_RULES.map((r) => [r.id, 0]));
const rows = [];
for (const id of RESEARCHED_LAYER_IDS) {
  const source = LAYER_SOURCES.find((s) => s.id === id);
  if (!source) throw new Error(`rule layer ${id} is not in the catalog`);
  const attrs = await attributes(source);
  for (const a of attrs) {
    const rule = findParkRule(id, a);
    if (!rule) continue;
    counts.set(rule.id, counts.get(rule.id) + 1);
    rows.push({ layer: id, rule: rule.id, ...Object.fromEntries(['Unit_Nm', 'Loc_Mang', 'Mang_Name', 'Des_Tp', 'Facility'].filter((k) => a[k] != null).map((k) => [k, a[k]])) });
  }
  console.error(`${id}: ${attrs.length} features`);
}
let dead = 0;
for (const r of PARK_RULES) {
  const n = counts.get(r.id);
  if (!n) dead++;
  console.log(`${String(n).padStart(4)}  ${r.grade.padEnd(6)}  ${r.id}  (${r.name})`);
}
if (process.argv.includes('--fixture')) console.log(JSON.stringify(rows, null, 1));
if (dead) {
  console.error(`${dead} rule(s) match nothing`);
  process.exit(1);
}
