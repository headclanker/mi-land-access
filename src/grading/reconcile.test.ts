import { describe, expect, it } from 'vitest';
import type { GradeResult, LayerSource } from '../contract.ts';
import { LAYER_SOURCES } from '../data/sources.ts';
import { gradeFeature, gradeOwnerName } from './grade.ts';
import { NO_PARCEL, cityNote, cityOverride, cityOverrideFeature, moreRestrictive, reconcileParcel, tierOf, type Overlap } from './reconcile.ts';

// Cases below are taken from the November 2026 audit of 21,601 county parcels against every
// public-land layer (owner strings and coverage fractions are real).

function src(id: string): LayerSource {
  const s = LAYER_SOURCES.find((l) => l.id === id);
  if (!s) throw new Error(`no source ${id}`);
  return s;
}

function hit(id: string, props: Record<string, unknown>, fraction: number, name?: string): Overlap {
  const source = src(id);
  return { source, grade: gradeFeature(source, props), fraction, name };
}

const park = (status: string, fraction: number, facility = 'Yankee Springs Recreation Area'): Overlap =>
  hit('dnr-park-hunting', { Facility: facility, HuntTrap: status }, fraction, facility);
const dnrLand = (use: string, fraction: number, project = 'ALLEGAN'): Overlap =>
  hit('dnr-managed-lands', { ProjectUseType: use, ProjectName: project }, fraction, project);
const usfs = (fraction: number): Overlap =>
  hit('usfs-surface-ownership', { ownerclassification: 'USDA FOREST SERVICE', nfslandunitname: 'Huron-Manistee National Forest' }, fraction, 'Huron-Manistee National Forest');
const cfa = (fraction: number, status = 'Active'): Overlap =>
  hit('commercial-forest', { ParcelStatusText: status, FullLegalName: 'Lyme Great Lakes Timberlands LLC' }, fraction);
const hap = (fraction: number, huntType = 'Open to All Hunt Types.'): Overlap =>
  hit('dnr-hap', { ActiveOrInactive: 'Active', HuntType: huntType }, fraction, 'HAP 123');
const wildlifeBoundary = (fraction: number): Overlap =>
  hit('dnr-wildlife-areas', { AreaType: 'State Game Area', OfficialWLDProjectAreaName: 'Allegan SGA' }, fraction, 'Allegan SGA');
const parkBoundary = (fraction: number): Overlap => hit('dnr-state-parks', { Park_Label: 'Yankee Springs RA' }, fraction);
const padusStateOther = (fraction: number): Overlap =>
  hit('padus-state-other', { Mang_Type: 'STAT', Mang_Name: 'OTHS', Unit_Nm: 'Shiawassee River State Game Area' }, fraction);
const padusLocal = (fraction: number): Overlap =>
  hit('padus-local', { Mang_Type: 'LOC', Mang_Name: 'CNTY', Unit_Nm: 'County Land Parcel' }, fraction);

function parcel(owner: string, overlaps: Overlap[]) {
  return reconcileParcel(gradeOwnerName(owner), overlaps, owner);
}

describe('tiers', () => {
  it('orders layers by precedence and ignores boundaries', () => {
    expect(tierOf(src('dnr-park-hunting'))).toBeLessThan(tierOf(src('dnr-hap'))!);
    expect(tierOf(src('dnr-hap'))).toBeLessThan(tierOf(src('commercial-forest'))!);
    expect(tierOf(src('commercial-forest'))).toBeLessThan(tierOf(src('dnr-managed-lands'))!);
    expect(tierOf(src('dnr-managed-lands'))).toBe(tierOf(src('usfs-surface-ownership')));
    expect(tierOf(src('padus-local'))).toBeGreaterThan(tierOf(src('dnr-managed-lands'))!);
    expect(tierOf(src('dnr-wildlife-areas'))).toBeNull();
    expect(tierOf(src('dnr-state-parks'))).toBeNull();
    expect(tierOf(src('parcels-kent'))).toBeNull();
  });

  it('moreRestrictive', () => {
    expect(moreRestrictive('green', 'red')).toBe('red');
    expect(moreRestrictive('yellow', 'green')).toBe('yellow');
    expect(moreRestrictive('unknown', 'yellow')).toBe('yellow');
    expect(moreRestrictive('green', 'unknown')).toBe('unknown');
  });
});

describe('no covering layer', () => {
  it('keeps the owner grade unchanged', () => {
    const r = parcel('PENNING MARTIN E & CHRISTINA', []);
    expect(r.result).toEqual(r.owner);
    expect(r.result.grade).toBe('red');
    expect(r.conflict).toBe(false);
    expect(r.adoptedFrom).toBeUndefined();
    expect(r.notes).toEqual([]);
  });
});

describe('boundary layers', () => {
  it('private inholding inside a game-area boundary stays red (Allegan SGA)', () => {
    const r = parcel('SCHROEDER ROGER ET AL', [wildlifeBoundary(1)]);
    expect(r.result.grade).toBe('red');
    expect(r.result.category).toBe('Private');
    expect(r.conflict).toBe(false);
    expect(r.notes).toEqual([]);
  });

  it('a park boundary alone never grades a parcel', () => {
    expect(parcel('STATE OF MICHIGAN DNR', [parkBoundary(1)]).result.category).toBe('State land (DNR)');
    expect(parcel('', [parkBoundary(1), wildlifeBoundary(1)]).result.grade).toBe('unknown');
  });
});

describe('state park hunting zones', () => {
  it('a closed zone makes a DNR-owned parcel red (Yankee Springs)', () => {
    const r = parcel('STATE OF MICHIGAN DNR', [park('Closed', 0.99), parkBoundary(0.99)]);
    expect(r.owner.grade).toBe('green');
    expect(r.result.grade).toBe('red');
    expect(r.result.category).toBe('State park – closed to hunting');
    expect(r.adoptedFrom).toBe('dnr-park-hunting');
    expect(r.conflict).toBe(false);
  });

  it('an open zone makes it green and a restricted zone yellow (Ionia SRA)', () => {
    expect(parcel('MICHIGAN DNR', [park('Open', 1, 'Ionia Recreation Area')]).result.grade).toBe('green');
    expect(parcel('MICHIGAN DNR', [park('Open-Restricted', 0.98, 'Ionia Recreation Area')]).result.grade).toBe('yellow');
  });

  it('wins over DNR managed lands and PAD-US covering the same parcel', () => {
    const r = parcel('MICHIGAN DNR', [dnrLand('Forests', 0.95), park('Closed', 0.95), padusStateOther(0.97)]);
    expect(r.result.grade).toBe('red');
    expect(r.adoptedFrom).toBe('dnr-park-hunting');
  });

  it('a parcel split between open and closed zones takes the strictest and says so', () => {
    const r = parcel('STATE OF MICHIGAN DNR', [park('Open', 0.6), park('Closed', 0.4)]);
    expect(r.result.grade).toBe('red');
    expect(r.split).toBe(true);
    expect(r.notes.join(' ')).toMatch(/different status/);
    expect(r.notes.join(' ')).toMatch(/about 60%/);
  });

  it('a 5% sliver of a closed zone does not override a covering open zone', () => {
    const r = parcel('STATE OF MICHIGAN DNR', [park('Open', 0.95), park('Closed', 0.05)]);
    expect(r.result.grade).toBe('green');
    expect(r.split).toBe(false);
  });

  it('a private parcel under an open zone is yellow "records disagree"', () => {
    const r = parcel('SMITH JOHN & MARY', [park('Open', 0.9)]);
    expect(r.result.grade).toBe('yellow');
    expect(r.result.category).toBe('Records disagree');
    expect(r.result.reason).toContain('SMITH JOHN & MARY');
    expect(r.conflict).toBe(true);
  });

  it('a private parcel under a closed zone stays red (never loosened)', () => {
    const r = parcel('SMITH JOHN & MARY', [park('Closed', 0.9)]);
    expect(r.result.grade).toBe('red');
    expect(r.conflict).toBe(false);
    expect(r.notes.join(' ')).toContain('private owner');
  });
});

describe('Hunting Access Program', () => {
  it('a HAP lease over a private parcel adopts the HAP grade and keeps the owner', () => {
    const r = parcel('VANDERMOLEN FARMS LLC', [hap(0.97)]);
    expect(r.owner.grade).toBe('red');
    expect(r.result.grade).toBe('green');
    expect(r.result.category).toMatch(/HAP – private land/);
    expect(r.result.reason).toContain('VANDERMOLEN FARMS LLC');
    expect(r.adoptedFrom).toBe('dnr-hap');
  });

  it('restricted hunt types are yellow', () => {
    const r = parcel('JONES FAMILY TRUST', [hap(0.8, 'Only Open to Youth and Apprentice Hunting.')]);
    expect(r.result.grade).toBe('yellow');
    expect(r.result.category).toMatch(/restricted/);
    expect(r.result.reason).toContain('Youth');
  });

  it('beats Commercial Forest and DNR land', () => {
    expect(parcel('X LLC', [cfa(0.9), hap(0.9, 'Only Open to Youth and Apprentice Hunting.'), dnrLand('Forests', 0.9)]).adoptedFrom).toBe('dnr-hap');
  });
});

describe('Commercial Forest', () => {
  it.each(['LYME GREAT LAKES TIMBERLANDS LLC', 'TILDEN MINING COMPANY LC', 'US MEAD'])('%s under CFA is green with the owner kept (Marquette)', (owner) => {
    const r = parcel(owner, [cfa(1)]);
    expect(r.owner.grade).toBe('red');
    expect(r.result.grade).toBe('green');
    expect(r.result.category).toBe('Commercial Forest (private, public foot access)');
    expect(r.result.reason).toMatch(/on foot for hunting, fishing and trapping only/);
    expect(r.result.reason).toContain(owner);
    expect(r.adoptedFrom).toBe('commercial-forest');
    expect(r.conflict).toBe(false);
  });

  it('a CFA parcel changing status is yellow', () => {
    expect(parcel('LYME GREAT LAKES TIMBERLANDS LLC', [cfa(1, 'Under Withdrawal')]).result.grade).toBe('yellow');
  });

  it('only partly enrolled (30%) keeps the owner grade and adds a note', () => {
    const r = parcel('LYME GREAT LAKES TIMBERLANDS LLC', [cfa(0.3)]);
    expect(r.result.grade).toBe('red');
    expect(r.notes[0]).toMatch(/About 30% of this parcel overlaps Commercial Forest/);
  });
});

describe('high-confidence ownership layers', () => {
  it.each([
    ['STATE OF MICHIGAN', 'Forests'],
    ['STATE OF MICHIGAN DNR', 'Wildlife Game Areas'],
    ['US GOVERNMENT', 'Forests'],
    ['', 'Wildlife Game Areas'],
  ])('%s under DNR %s adopts the layer', (owner, use) => {
    const r = parcel(owner, [dnrLand(use, 0.98)]);
    expect(r.result.grade).toBe('green');
    expect(r.adoptedFrom).toBe('dnr-managed-lands');
    expect(r.conflict).toBe(false);
  });

  it('DNR owner on a DNR boating access site adopts the more specific yellow', () => {
    const r = parcel('MICHIGAN DEPT OF NATURAL RESOURCES', [dnrLand('Boating Access Site', 0.9)]);
    expect(r.result.grade).toBe('yellow');
    expect(r.result.category).toBe('Boating / water access site');
  });

  it('"U S GOVT" under USFS ownership is green (Newaygo)', () => {
    const r = parcel('U S GOVT', [usfs(0.99)]);
    expect(r.owner.grade).toBe('yellow');
    expect(r.result.grade).toBe('green');
    expect(r.result.category).toBe('National forest (USFS)');
    expect(r.adoptedFrom).toBe('usfs-surface-ownership');
  });

  it('STATE HIGHWAY COMMISSION under state forest keeps the more restrictive record and notes both (Roscommon)', () => {
    const r = parcel('STATE HIGHWAY COMMISSION', [dnrLand('Forests', 0.63, 'ROSCOMMON')]);
    expect(r.result.grade).toBe('yellow');
    expect(r.result.category).toBe('MDOT / state highway');
    expect(r.conflict).toBe(true);
    expect(r.adoptedFrom).toBeUndefined();
    const note = r.notes.join(' ');
    expect(note).toContain('STATE HIGHWAY COMMISSION');
    expect(note).toContain('DNR-managed state land');
  });

  it('a township parcel on DNR land that agrees is not a conflict', () => {
    const r = parcel('TOWNSHIP OF ALLEGAN', [dnrLand('Rail Trails', 0.8)]);
    expect(r.result.grade).toBe('yellow');
    expect(r.conflict).toBe(false);
  });

  it.each([
    ['RADAR ELLIOTT & MEGAN', 0.99],
    ['KRANKOTA SHEILA', 0.65],
    ['THE CONNELLY FAMILY TRUST 01-27-15', 0.68],
  ])('private owner %s fully under state land is yellow "records disagree"', (owner, f) => {
    const r = parcel(owner, [dnrLand('Wildlife Game Areas', f)]);
    expect(r.owner.grade).toBe('red');
    expect(r.result.grade).toBe('yellow');
    expect(r.result.category).toBe('Records disagree');
    expect(r.result.reason).toContain(`privately owned by ${owner}`);
    expect(r.result.reason).toMatch(/recent sale, an inholding or a mapping error/);
    expect(r.result.reason).toMatch(/verify/i);
    expect(r.conflict).toBe(true);
    expect(r.adoptedFrom).toBeUndefined();
  });

  it('a 14% boundary overlap with state land keeps a private parcel red, with a note', () => {
    const r = parcel('BATTEN PAMELA L', [dnrLand('Wildlife Game Areas', 0.14), wildlifeBoundary(0.08)]);
    expect(r.result.grade).toBe('red');
    expect(r.conflict).toBe(false);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatch(/About 14% of this parcel overlaps DNR-managed state land.*misaligned/);
  });

  it('overlaps under 10% add nothing', () => {
    expect(parcel('BATTEN PAMELA L', [dnrLand('Forests', 0.07)]).notes).toEqual([]);
  });

  it('two layers covering together (split DNR tracts) count as covering', () => {
    const r = parcel('STATE OF MICHIGAN', [dnrLand('Forests', 0.3), dnrLand('Forests', 0.35)]);
    expect(r.result.grade).toBe('green');
  });
});

describe('low-confidence (PAD-US) layers', () => {
  it.each(['COLBY MICHAEL W & KRISTA K', 'MOSHER WILLIAM H & JULIE A'])('private parcel %s keeps its own grade (Shiawassee)', (owner) => {
    const r = parcel(owner, [padusStateOther(0.98)]);
    expect(r.result.grade).toBe('red');
    expect(r.result.category).toBe('Private');
    expect(r.conflict).toBe(false);
    expect(r.adoptedFrom).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/county parcel record takes precedence/);
  });

  it('a blank owner adopts the PAD-US grade', () => {
    const r = parcel('', [padusLocal(0.9)]);
    expect(r.result.grade).toBe('yellow');
    expect(r.result.category).toContain('County');
    expect(r.adoptedFrom).toBe('padus-local');
  });

  it('a high-confidence layer outranks PAD-US', () => {
    const r = parcel('', [padusStateOther(0.99), dnrLand('Wildlife Game Areas', 0.99)]);
    expect(r.result.grade).toBe('green');
    expect(r.adoptedFrom).toBe('dnr-managed-lands');
  });

  it('an agreeing PAD-US polygon adds no note', () => {
    expect(parcel('ALLEGAN COUNTY', [padusLocal(0.9)]).notes).toEqual([]);
  });
});

describe('robustness', () => {
  it('ignores layers whose grade is unknown', () => {
    const unknown: Overlap = { source: src('usfs-surface-ownership'), grade: { grade: 'unknown', category: 'x', reason: 'y' }, fraction: 1 };
    expect(parcel('SMITH JOHN', [unknown]).result.grade).toBe('red');
  });

  it('works without an ownerKind (falls back on the grade)', () => {
    const legacy: GradeResult = { grade: 'red', category: 'Private', reason: 'r' };
    expect(reconcileParcel(legacy, [dnrLand('Forests', 1)], 'SOMEONE').result.category).toBe('Records disagree');
  });

  it('resolves a bare map point with NO_PARCEL using the same precedence', () => {
    const r = reconcileParcel(NO_PARCEL, [dnrLand('Forests', 1), park('Closed', 1), padusLocal(1)]);
    expect(r.result.grade).toBe('red');
    expect(reconcileParcel(NO_PARCEL, [padusLocal(1)]).result.category).toContain('County');
    expect(reconcileParcel(NO_PARCEL, [wildlifeBoundary(1)]).result.grade).toBe('unknown');
  });

  it('does not mutate its inputs', () => {
    const owner = gradeOwnerName('SMITH JOHN');
    const before = JSON.stringify(owner);
    reconcileParcel(owner, [dnrLand('Forests', 1)], 'SMITH JOHN');
    expect(JSON.stringify(owner)).toBe(before);
  });
});

describe('two public layers that disagree', () => {
  const owner = gradeOwnerName('LYME GREAT LAKES TIMBERLANDS LLC');

  it('shows the stricter authoritative record and flags the parcel', () => {
    // Audit case: Commercial Forest (green) and a DNR trail corridor (yellow) cover the same parcel.
    const r = reconcileParcel(owner, [cfa(0.95), dnrLand('RAIL TRAILS', 0.9, 'TRAIL')], 'LYME GREAT LAKES TIMBERLANDS LLC');
    expect(r.result.grade).toBe('yellow');
    expect(r.result.category).toBe('Records disagree');
    expect(r.conflict).toBe(true);
    expect(r.adoptedFrom).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/disagree/);
  });

  it('leaves the verdict alone when the other layer is no stricter', () => {
    const r = reconcileParcel(owner, [cfa(0.95), dnrLand('FORESTS', 0.9)], 'LYME GREAT LAKES TIMBERLANDS LLC');
    expect(r.result.grade).toBe('green');
    expect(r.conflict).toBe(false);
    expect(r.adoptedFrom).toBe('commercial-forest');
  });

  it('ignores a stricter layer that only partly overlaps', () => {
    const r = reconcileParcel(owner, [cfa(0.95), dnrLand('RAIL TRAILS', 0.3, 'TRAIL')], 'LYME GREAT LAKES TIMBERLANDS LLC');
    expect(r.result.grade).toBe('green');
    expect(r.conflict).toBe(false);
  });

  it('never loosens a closed park zone', () => {
    const r = reconcileParcel(gradeOwnerName('STATE OF MICHIGAN DNR'), [park('Closed', 0.9), dnrLand('FORESTS', 0.9)], 'STATE OF MICHIGAN DNR');
    expect(r.result.grade).toBe('red');
    expect(r.adoptedFrom).toBe('dnr-park-hunting');
  });
});

describe('city limits rule', () => {
  const GR = 'Grand Rapids';
  const inCity = (owner: string, overlaps: Overlap[], city: string | null = GR) => cityOverride(parcel(owner, overlaps), city ?? undefined);

  it('CITY OF GRAND RAPIDS parcel → red, city-owned, wherever it is', () => {
    for (const city of [GR, null]) {
      const r = inCity('CITY OF GRAND RAPIDS', [], city);
      expect(r.result.grade).toBe('red');
      expect(r.result.category).toBe('City-owned – closed to hunting');
      expect(r.result.reason).toMatch(/ordinances/);
      expect(r.notes).toEqual([]);
    }
  });

  it('KENT COUNTY PARKS parcel inside Grand Rapids → red with the city reason; outside any city → yellow', () => {
    const r = inCity('KENT COUNTY PARKS', []);
    expect(r.result.grade).toBe('red');
    expect(r.result.category).toBe('County-owned – inside Grand Rapids city limits');
    expect(r.result.reason).toMatch(/^Inside Grand Rapids city limits: city ordinances/);
    expect(r.result.reason).toMatch(/not a statewide law/);
    expect(r.cityRule).toBe('closed');
    expect(r.beforeCity?.grade).toBe('yellow');
    expect(r.owner.category).toBe('County-owned');
    const out = inCity('KENT COUNTY PARKS', [], null);
    expect(out.result.grade).toBe('yellow');
    expect(out.result.category).toBe('County-owned');
    expect(out.city).toBeUndefined();
  });

  it('townships named after a city stay yellow outside the city', () => {
    for (const owner of ['GRAND RAPIDS TOWNSHIP', 'CHARTER TOWNSHIP OF GRAND RAPIDS']) {
      const r = inCity(owner, [], null);
      expect(r.result.grade, owner).toBe('yellow');
      expect(r.result.category, owner).toBe('Township-owned');
    }
    // …but township land that lies inside a city is closed like any other yellow land.
    expect(inCity('GRAND RAPIDS TOWNSHIP', []).result.grade).toBe('red');
  });

  it('private owners with "CITY" in the name stay private (with the city note inside a city)', () => {
    for (const owner of ['CITY VIEW LLC', 'TRAVERSE CITY STATE BANK', 'BAY CITY ROD AND GUN CLUB']) {
      const out = inCity(owner, [], null);
      expect(out.result.grade, owner).toBe('red');
      expect(out.result.category, owner).toMatch(/^Private/);
      const r = inCity(owner, [], 'Traverse City');
      expect(r.result.category, owner).toMatch(/^Private/);
      expect(r.notes).toContain(cityNote('Traverse City'));
    }
  });

  it('village-owned stays yellow outside a city and mentions village ordinances', () => {
    const r = inCity('VILLAGE OF SPARTA', [], null);
    expect(r.result.grade).toBe('yellow');
    expect(r.result.category).toBe('Village-owned');
    expect(r.result.reason).toMatch(/[Vv]illage ordinances/);
  });

  it('school, road commission, utility, generic State of Michigan land inside a city → red', () => {
    // School property is closed everywhere, in or out of a city.
    expect(inCity('GRAND RAPIDS PUBLIC SCHOOLS', []).result.category).toBe('School property – closed to hunting');
    for (const owner of ['KENT COUNTY ROAD COMMISSION', 'CONSUMERS ENERGY CO', 'STATE OF MICHIGAN', 'KENT COUNTY LAND BANK AUTHORITY']) {
      const r = inCity(owner, []);
      expect(r.result.grade, owner).toBe('red');
      expect(r.result.category, owner).toMatch(/inside Grand Rapids city limits$/);
    }
  });

  it('DNR-managed green inside a city stays green with the note', () => {
    const r = inCity('STATE OF MICHIGAN', [dnrLand('Wildlife Game Areas', 1, 'Grand River')]);
    expect(r.result.grade).toBe('green');
    expect(r.adoptedFrom).toBe('dnr-managed-lands');
    expect(r.notes).toContain(cityNote(GR));
    expect(r.cityRule).toBe('note');
  });

  it('a green verdict from the owner name alone (MICH DNR, no DNR layer) keeps green with the note', () => {
    const r = inCity('MICH DNR', []);
    expect(r.result.grade).toBe('green');
    expect(r.notes).toContain(cityNote(GR));
  });

  it('USFS, open park zone, HAP and Commercial Forest green inside a city are not overridden', () => {
    for (const o of [usfs(1), park('Open', 1), hap(1), cfa(1)]) {
      const r = inCity('', [o]);
      expect(r.result.grade, o.source.id).toBe('green');
      expect(r.notes, o.source.id).toContain(cityNote(GR));
    }
  });

  it('closed park zone inside a city → red, no extra note', () => {
    const r = inCity('STATE OF MICHIGAN', [park('Closed', 1)]);
    expect(r.result.grade).toBe('red');
    expect(r.result.category).toBe('State park – closed to hunting');
    expect(r.notes).not.toContain(cityNote(GR));
  });

  it('restricted park zones and restricted HAP stay yellow (a state program opens them) with the note', () => {
    for (const o of [park('Open-Restricted', 1), hap(1, 'Archery Only')]) {
      const r = inCity('', [o]);
      expect(r.result.grade, o.source.id).toBe('yellow');
      expect(r.notes, o.source.id).toContain(cityNote(GR));
    }
  });

  it('yellow DNR land (boat access, trail) inside a city → red', () => {
    const r = inCity('', [dnrLand('BOATING ACCESS SITE', 1, 'Grand River Access')]);
    expect(r.result.grade).toBe('red');
    expect(r.result.category).toBe('Boating / water access site – inside Grand Rapids city limits');
    expect(r.beforeCity?.grade).toBe('yellow');
  });

  it('unknown stays unknown with the note', () => {
    const r = inCity('', []);
    expect(r.result.grade).toBe('unknown');
    expect(r.notes).toContain(cityNote(GR));
  });

  it('bare map point: PAD-US local polygon inside a city → red; outside → yellow', () => {
    const local = padusLocal(1);
    const r = cityOverride(reconcileParcel(NO_PARCEL, [local]), GR);
    expect(r.result.grade).toBe('red');
    expect(r.result.category).toBe('County land – inside Grand Rapids city limits');
    expect(cityOverride(reconcileParcel(NO_PARCEL, [local]), undefined).result.grade).toBe('yellow');
  });

  it('one public-land feature on its own (map fill where no parcels load)', () => {
    const s = src('padus-local');
    const g = gradeFeature(s, { Mang_Type: 'LOC', Mang_Name: 'CITY', Unit_Nm: 'Riverside Park' });
    expect(cityOverrideFeature(s, g, GR).result.grade).toBe('red');
    expect(cityOverrideFeature(s, g, undefined).result).toEqual(g);
    const dnr = src('dnr-managed-lands');
    const green = gradeFeature(dnr, { ProjectUseType: 'FORESTS' });
    const kept = cityOverrideFeature(dnr, green, 'Gaylord');
    expect(kept.result.grade).toBe('green');
    expect(kept.notes).toEqual([cityNote('Gaylord')]);
  });

  it('records-disagree (private owner vs DNR) inside a city → red, still flagged', () => {
    const r = inCity('SMITH JOHN', [dnrLand('Forests', 1)]);
    expect(r.result.grade).toBe('red');
    expect(r.conflict).toBe(true);
  });
});
