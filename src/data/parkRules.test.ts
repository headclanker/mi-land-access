import { describe, expect, it } from 'vitest';
import type { LayerSource } from '../contract.ts';
import { LAYER_SOURCES } from './sources.ts';
import { PARK_RULES, RESEARCHED_LAYER_IDS, findParkRule, researchedLabel } from './parkRules.ts';
import fixture from './parkRules.fixture.json';
import { gradeFeature, gradeOwnerName } from '../grading/grade.ts';
import { cityOverride, cityOverrideFeature, reconcileParcel, type Overlap } from '../grading/reconcile.ts';
import { loadsForParcels } from '../app/layers/reconcileLayers.ts';

// parkRules.fixture.json holds every live feature the rules matched on 2026-11-12
// (scripts/check-park-rules.mjs --fixture): real Unit_Nm / Loc_Mang / Facility strings.

function src(id: string): LayerSource {
  const s = LAYER_SOURCES.find((l) => l.id === id);
  if (!s) throw new Error(`no source ${id}`);
  return s;
}

const local = (Unit_Nm: string, Loc_Mang: string, extra: Record<string, unknown> = {}) => ({ Unit_Nm, Loc_Mang, Mang_Type: 'LOC', Mang_Name: 'CNTY', Des_Tp: 'LP', Pub_Access: 'OA', ...extra });
const fed = (Unit_Nm: string, Mang_Name = 'FWS', Des_Tp = 'NWR') => ({ Unit_Nm, Mang_Type: 'FED', Mang_Name, Des_Tp, Pub_Access: 'OA', Loc_Mang: Unit_Nm });
const gl = (p: Record<string, unknown>) => gradeFeature(src('padus-local'), p);
const gf = (p: Record<string, unknown>) => gradeFeature(src('padus-federal-other'), p);
const gp = (Facility: string, HuntTrap: string, HuntTrapRestrictions = '') => gradeFeature(src('dnr-park-hunting'), { Facility, HuntTrap, HuntTrapRestrictions });

describe('park rules – table', () => {
  it('every rule is on a catalog layer and matches at least one real feature', () => {
    for (const id of RESEARCHED_LAYER_IDS) expect(LAYER_SOURCES.some((s) => s.id === id), id).toBe(true);
    const rows = fixture as { layer: string; rule: string; [k: string]: unknown }[];
    for (const rule of PARK_RULES) expect(rows.some((r) => r.rule === rule.id), rule.id).toBe(true);
    for (const row of rows) expect(findParkRule(row.layer, row)?.id, JSON.stringify(row)).toBe(row.rule);
  });

  it('every rule has sources with URLs, a confidence and the research date', () => {
    expect(new Set(PARK_RULES.map((r) => r.id)).size).toBe(PARK_RULES.length);
    for (const r of PARK_RULES) {
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      for (const s of r.sources) expect(s.url, r.id).toMatch(/^https:\/\//);
      expect(['high', 'medium', 'low']).toContain(r.confidence);
      expect(r.researched).toBe('2026-11-12');
    }
    expect(researchedLabel({ confidence: 'medium', date: '2026-11-12' })).toBe('Researched rule (Nov 2026, medium confidence)');
  });
});

describe('park rules – approved state park changes', () => {
  it('Gete Mino Mshkiigan: DNR says closed, WCO 7.74 opened it → green', () => {
    const g = gp('Gete Mino Mshkiigan State Park', 'Closed');
    expect(g.grade).toBe('green');
    expect(g.reason).toContain('March 2025');
    expect(g.reason).toContain('has not caught up');
    expect(g.researched).toEqual({ confidence: 'high', date: '2026-11-12', rule: 'gete-mino-mshkiigan' });
    expect(g.references?.[0].url).toContain('ChapterVII.pdf');
  });
  it('Hoffmaster stays red with the lottery hunt; Metamora-Hadley and Old Mission stay green with their closures', () => {
    const h = gp('P.J. Hoffmaster State Park', 'Closed', 'Special Hunt Only as designated by DNR-PRD Chief');
    expect(h.grade).toBe('red');
    expect(h.reason).toContain('20–23 November 2026');
    expect(h.reason).toContain('Special Hunt Only'); // the DNR note is kept
    const m = gp('Metamora-Hadley Recreation Area', 'Open');
    expect(m.grade).toBe('green');
    expect(m.reason).toMatch(/campground, headquarters, day-use and wastewater-treatment/);
    const o = gp('Old Mission Peninsula State Park', 'Open');
    expect(o.grade).toBe('green');
    expect(o.reason).toContain('450 ft of a picnic area or parking lot');
    expect(gp('Yankee Springs Recreation Area', 'Open').researched).toBeUndefined();
  });
  it('Mackinac Island and Michilimackinac → red', () => {
    const s = src('padus-state-researched');
    expect(s.defaultVisible).toBe(true);
    for (const Unit_Nm of ['Mackinac State Park', 'Fort Michilimackinac State Park']) {
      const g = gradeFeature(s, { Unit_Nm, Mang_Type: 'STAT', Mang_Name: Unit_Nm.startsWith('Fort') ? 'SDNR' : 'OTHS', Pub_Access: 'OA' });
      expect(g.grade, Unit_Nm).toBe('red');
      expect(g.reason).toContain('R 318.143');
    }
    expect(src('padus-state-other').where).toContain("NOT IN ('Mackinac State Park'");
  });
});

describe('park rules – federal', () => {
  it.each([
    ['Sleeping Bear Dunes National Lakeshore', 'NPS', 'NLS', 'green', 'North Manitou'],
    ['Pictured Rocks National Lakeshore', 'NPS', 'NLS', 'green', '1 April to Labor Day'],
    ['Barry County Waterfowl Production Area', 'FWS', 'RMA', 'green', 'Waterfowl Production Area'],
    ['Jackson County Waterfowl Production Area Of Mi', 'FWS', 'RMA', 'green', 'Waterfowl Production Area'],
    ['VAN BUREN COUNTY WATERFOWL PRODUCTION AREA', 'FWS', 'RMA', 'green', 'Waterfowl Production Area'],
    ['Harbor Island National Wildlife Refuge', 'FWS', 'NWR', 'green', 'black bear'],
    ['Kirtlands Warbler Wildlife Management Area', 'FWS', 'NCA', 'green', '1 May to 15 August'],
    ['Seney National Wildlife Refuge', 'FWS', 'NWR', 'yellow', 'Hunt Areas A, B and C'],
    ['Shiawassee National Wildlife Refuge', 'FWS', 'NWR', 'yellow', 'lottery'],
    ['Detroit River International Wildlife Refuge', 'FWS', 'NWR', 'yellow', 'archery'],
    ['Jordan River National Fish Hatchery', 'FWS', 'FOTH', 'yellow', 'mapped open'],
    ['Pendills Creek National Fish Hatchery', 'FWS', 'FOTH', 'yellow', 'mapped open'],
    ['Camp Grayling Military Reservation', 'OTHF', 'SOTH', 'yellow', 'gated'],
    ['Michigan Islands National Wildlife Refuge', 'FWS', 'NWR', 'red', 'closed'],
    ['Huron National Wildlife Refuge', 'FWS', 'NWR', 'red', 'no hunting program'],
    ['Green Bay National Wildlife Refuge', 'FWS', 'NWR', 'red', 'St. Martin Island'],
    ['River Raisin National Battlefield Park', 'NPS', 'HCA', 'red', 'prohibited'],
    ['Isle Royale National Park', 'NPS', 'NP', 'red', 'prohibited'],
  ])('%s → %s', (name, mang, des, grade, text) => {
    const g = gf(fed(name, mang, des));
    expect(g.grade).toBe(grade);
    expect(g.reason).toContain(text);
    expect(g.researched).toBeDefined();
  });
  it('Keweenaw NHP and unlisted federal land keep the layer grade', () => {
    const k = gf(fed('Keweenaw National Historical Park', 'NPS', 'HCA'));
    expect(k.grade).toBe('yellow');
    expect(k.researched).toBeUndefined();
    expect(gf(fed('Farm Service Agency Interest Of Mi')).researched).toBeUndefined();
  });
});

describe('park rules – county and regional land', () => {
  it('open county land → green', () => {
    expect(gl(local('Local Forest', 'County of Gogebic', { Des_Tp: 'LRMA', GIS_Acres: 47843 })).grade).toBe('green');
    expect(gl(local('Forest Management', 'Gogebic County', { Des_Tp: 'LCA' })).grade).toBe('green');
    expect(gl(local('Mohrmann Park', 'Municipal', { Mang_Name: 'CITY' })).grade).toBe('green');
    expect(gradeFeature(src('padus-ngo'), { Unit_Nm: 'Grass River Natural Area', Mang_Type: 'NGO', Mang_Name: 'NGO', Pub_Access: 'XA' }).grade).toBe('green');
    expect(gl(local('Johnson Street Wildlife Management Area', 'County of Ottawa', { Des_Tp: 'LCA' })).grade).toBe('green');
    // "County of Ottowa" is PAD-US's misspelling of the same county.
    expect(gl(local('Hiawatha Forest', 'County of Ottowa', { Des_Tp: 'LOTH' })).grade).toBe('green');
  });

  it('specific rules → yellow with the rule text, not the generic local-government text', () => {
    const cases: [Record<string, unknown>, string][] = [
      [local('Cooper Creek Park', 'Kent County Parks'), 'Kent County permit'],
      [local('Spencer Forest', 'Kent County Parks'), 'Kent County permit'],
      [local('Donald Lamoreaux Park', 'Kent County'), 'Kent County permit'],
      [local('Addison Oaks County Park', 'Oakland County Parks Commission'), 'East section of Addison Oaks'],
      [local('Orion Oaks County Park', 'Unknown County'), 'archery deer hunting only'],
      [local('Upper Macatawa Natural Area - East', 'County of Ottawa', { Des_Tp: 'LCA' }), 'lottery'],
      [local('Ottawa Sands County Park', 'Ottawa County'), 'lottery'],
      [local('Russ Forest Park', 'Cass County Parks Department'), 'sign-in'],
      [local('Pine Haven Recreational Area', 'County of Midland'), 'tourism listing'],
      [local('Genessee Recreation Area', 'County of Genesee'), 'Cummings'],
      [local('Sharon Mills Preserve', 'Washtenaw County Parks & Recreation Commission', { Des_Tp: 'LCA' }), 'Beyond BOW'],
      [local('Lake Erie Metropark', 'CITY OF DETROIT-RECREATION DEPT', { Mang_Name: 'CITY' }), 'waterfowl'],
    ];
    for (const [p, text] of cases) {
      const g = gl(p);
      expect(g.grade, String(p.Unit_Nm)).toBe('yellow');
      expect(g.reason).toContain(text);
      expect(g.reason).not.toContain('local ordinances');
      expect(g.researched).toBeDefined();
    }
  });

  it('closed park systems → red', () => {
    const cases: Record<string, unknown>[] = [
      local('Fallasberg Park', 'Kent County Parks'),
      local('Millennium Park', 'Kent County'),
      local('Lowell Regional Park', 'County of Kent'),
      local('Groveland Oaks County Park', 'Oakland County Parks Commission'),
      local('Red Oaks', 'County of Oakland'),
      local('Lyon Oaks Golf Course', 'Oakland County Parks Commission', { Des_Tp: 'LREC' }),
      local('Hines Parkway', 'Wayne County'),
      local('Crosswinds Marsh County Park', 'County of Wayne Parks Department'),
      local('Inkster Valley Golf Course', 'Wayne', { Des_Tp: 'LREC' }),
      local('Bertha Brock Park', 'Ionia County', { Des_Tp: 'LREC' }),
      local('Pinconning County Park', 'County of Bay'),
      local('Kensington Metropark', 'Huron Clinton Metropark Authority', { Mang_Name: 'CITY' }),
      local('Metro Beach Metropark', 'Huron Clinton Metropark Authority', { Mang_Name: 'CITY' }),
      local('Stoney Creek Metropark Golf Course', 'Huron Clinton Metropark Authority', { Mang_Name: 'CITY', Des_Tp: 'LREC' }),
      local('Willow Metropark', 'CITY OF DETROIT-RECREATION DEPT', { Mang_Name: 'CITY' }),
      local('Delhi Metropark', 'Huron Clinton Metropolitan Authority', { Mang_Type: 'DIST', Mang_Name: 'REG' }),
    ];
    for (const p of cases) {
      const g = gl(p);
      expect(g.grade, String(p.Unit_Nm)).toBe('red');
      expect(g.category).toMatch(/closed to hunting$/);
    }
  });

  it('over-matching traps stay unresearched', () => {
    const traps: Record<string, unknown>[] = [
      local('Long Lake Park', 'Alpena County Parks'), // same name as a Kent bow park
      local('Donald J Lamoreaux Park', 'City of Grand Rapids', { Mang_Name: 'CITY' }),
      local('Kent City Park', 'Village of Kent City', { Mang_Name: 'CITY' }),
      local('Kentwood Park', 'City of Kentwood', { Mang_Name: 'CITY' }),
      local('Wayne Park', 'City of Wayne', { Mang_Name: 'CITY' }),
      local('Veterans Park', 'City of Bay City', { Mang_Name: 'CITY' }),
      local('Local Forest', 'County of Bay', { Des_Tp: 'LRMA' }), // county land, not a park
      local('Bay Fairgrounds', 'County of Bay', { Des_Tp: 'LREC' }),
      local('Ionia Free Fairgrounds', 'County of Ionia', { Des_Tp: 'LREC' }),
      local('Local Forest', 'Gogebic County Road Commission', { Des_Tp: 'LRMA' }),
      local('Little Girls Point County Park', 'County of Gogebic'),
      local('Kirk Park', 'County of Ottowa'),
      local('Whispering Willows Golf Course', 'City of Livonia', { Mang_Name: 'CITY', Des_Tp: 'LREC' }),
      local('Willow Park', 'City of Lincoln Park', { Mang_Name: 'CITY' }),
      local('Land', 'Huron Clinton Metropark Authority', { Mang_Name: 'CITY' }),
      local('Township Park', 'Township of Oakland', { Mang_Name: 'CITY' }),
      local('Lamoreaux Park', 'Village of Sparta', { Mang_Name: 'CITY' }),
      local('Crittenden Park', 'Osceola County Parks'), // unresearched county
    ];
    for (const p of traps) expect(gl(p).researched, `${p.Unit_Nm} / ${p.Loc_Mang}`).toBeUndefined();
    expect(gl(local('Crittenden Park', 'Osceola County Parks')).grade).toBe('yellow');
    // A rule only applies on its own layers.
    expect(gradeFeature(src('padus-ngo'), local('Fallasberg Park', 'Kent County Parks')).researched).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Reconciliation with county parcels, and the city rule
// ---------------------------------------------------------------------------

function hit(id: string, props: Record<string, unknown>, fraction: number): Overlap {
  const source = src(id);
  return { source, grade: gradeFeature(source, props), fraction, name: String(props.Unit_Nm ?? props.Facility ?? '') };
}
const parcel = (owner: string, overlaps: Overlap[]) => reconcileParcel(gradeOwnerName(owner), overlaps, owner);
const cooper = (f: number) => hit('padus-local', local('Cooper Creek Park', 'Kent County Parks'), f);

describe('park rules – reconciliation', () => {
  it('a researched PAD-US unit decides for a public or blank owner record', () => {
    const k = parcel('KENT COUNTY', [cooper(0.9)]);
    expect(k.result.grade).toBe('yellow');
    expect(k.result.reason).toContain('Kent County permit');
    expect(k.result.researched?.rule).toBe('kent-bow-permit');
    expect(k.adoptedFrom).toBe('padus-local');
    expect(k.conflict).toBe(false);

    const o = parcel('COUNTY OF OTTAWA', [hit('padus-local', local('Hiawatha Forest', 'County of Ottowa', { Des_Tp: 'LOTH' }), 0.95)]);
    expect(o.result.grade).toBe('green');
    expect(o.notes.join(' ')).toContain('researched rule');

    const w = parcel('WAYNE COUNTY PARKS', [hit('padus-local', local('Hines Parkway', 'Wayne County'), 0.8)]);
    expect(w.result.grade).toBe('red');

    const blank = parcel('', [hit('padus-local', local('Local Forest', 'County of Gogebic', { Des_Tp: 'LRMA' }), 1)]);
    expect(blank.result.grade).toBe('green');

    // Researched features of one unit add up across tracts.
    expect(parcel('KENT COUNTY', [cooper(0.3), hit('padus-local', local('Spencer Forest', 'Kent County Parks'), 0.3)]).result.grade).toBe('yellow');
  });

  it('a private owner under a researched unit is a disagreement', () => {
    const p = parcel('SMITH JOHN & MARY', [cooper(0.9)]);
    expect(p.conflict).toBe(true);
    expect(p.result.category).toBe('Records disagree');
    expect(p.result.grade).toBe('yellow');
    const red = parcel('SMITH JOHN & MARY', [hit('padus-local', local('Fallasberg Park', 'Kent County Parks'), 0.9)]);
    expect(red.conflict).toBe(true);
    expect(red.result.grade).toBe('red');
  });

  it('partial cover, unresearched PAD-US and authoritative layers behave as before', () => {
    const partial = parcel('KENT COUNTY', [cooper(0.3)]);
    expect(partial.result.category).toBe('County-owned');
    const plain = parcel('KENT COUNTY', [hit('padus-local', local('Some Park', 'Osceola County Parks'), 0.9)]);
    expect(plain.result.category).toBe('County-owned');
    expect(plain.adoptedFrom).toBeUndefined();
    const dnr = parcel('STATE OF MICHIGAN', [hit('dnr-managed-lands', { ProjectUseType: 'Forests', ProjectName: 'X' }, 0.9), cooper(0.9)]);
    expect(dnr.adoptedFrom).toBe('dnr-managed-lands');
  });

  it('city limits: researched open / specific rules keep their grade with the note; researched closed stays red', () => {
    const k = cityOverride(parcel('KENT COUNTY', [cooper(0.9)]), 'Grand Rapids');
    expect(k.result.grade).toBe('yellow');
    expect(k.cityRule).toBe('note');
    expect(k.notes.join(' ')).toContain('Grand Rapids city limits');
    const erie = cityOverrideFeature(src('padus-local'), gl(local('Lake Erie Metropark', 'CITY OF DETROIT-RECREATION DEPT', { Mang_Name: 'CITY' })), 'Gibraltar');
    expect(erie.result.grade).toBe('yellow');
    const green = cityOverrideFeature(src('padus-local'), gl(local('Johnson Street Wildlife Management Area', 'County of Ottawa')), 'Hudsonville');
    expect(green.result.grade).toBe('green');
    const closed = cityOverrideFeature(src('padus-local'), gl(local('Hines Parkway', 'Wayne County')), 'Livonia');
    expect(closed.result.grade).toBe('red');
    expect(closed.result.category).toBe('County park – closed to hunting');
    // Unresearched county park inside a city: the city rule still closes it.
    expect(cityOverrideFeature(src('padus-local'), gl(local('Some Park', 'Osceola County Parks')), 'Reed City').result.grade).toBe('red');
  });

  it('PAD-US layers with researched rules load for parcels even with their fill off', () => {
    for (const id of ['padus-local', 'padus-federal-other', 'padus-state-researched', 'padus-ngo']) expect(loadsForParcels(src(id)), id).toBe(true);
    expect(loadsForParcels(src('padus-state-other'))).toBe(false);
  });
});
