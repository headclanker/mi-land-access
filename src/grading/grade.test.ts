import { describe, expect, it } from 'vitest';
import type { Grade, LayerSource } from '../contract.ts';
import { LAYER_SOURCES } from '../data/sources.ts';
import { MICHIGAN_COUNTIES } from '../data/counties.ts';
import { gradeFeature, gradeOwnerName, normalizeOwner } from './grade.ts';

// Most owner strings below are real values seen in Michigan county parcel layers
// (Allegan, Antrim, Cheboygan, Houghton, Kent, Marquette, Newaygo, Roscommon,
// Schoolcraft, Van Buren...). Category is matched as a substring.
const OWNER_CASES: [owner: string, grade: Grade, category?: string][] = [
  // --- state / DNR -------------------------------------------------------------
  ['STATE OF MICHIGAN DNR', 'green', 'DNR'],
  ['DNR STATE OF MICHIGAN', 'green', 'DNR'],
  ['DNR', 'green', 'DNR'],
  ['MICH DEPT OF NAT RES', 'green', 'DNR'],
  ['Michigan Dept. of Natural Resources', 'green', 'DNR'],
  ['STATE OF MICHIGAN (DNR)', 'green', 'DNR'],
  ['DNR REAL ESTATE DIVISION', 'green', 'DNR'],
  ['STATE OF MICHIGAN CONSERVATION DEPT', 'green', 'DNR'],
  ['STATE OF MICHIGAN', 'yellow', 'State of Michigan'],
  ['STATE', 'yellow', 'State of Michigan'],
  ['STATE OF MICHIGAN - LAND MGT', 'yellow', 'State of Michigan'],
  ['MICHIGAN, STATE OF', 'yellow', 'State of Michigan'],
  ['STATE BUILDING AUTHORITY', 'yellow', 'non-DNR'],
  ['STATE FISH HATCHERY', 'yellow', 'non-DNR'],
  ['INDIAN LAKE STATE PARK', 'yellow', 'State park'],
  ['ALOHA STATE PARK', 'yellow', 'State park'],
  // --- MDOT --------------------------------------------------------------------
  ['MDOT', 'yellow', 'MDOT'],
  ['MICHIGAN DEPT OF TRANSPORTATION', 'yellow', 'MDOT'],
  ['STATE HIGHWAY DEPT', 'yellow', 'MDOT'],
  ['STATE HIGHWAY COMMISSION', 'yellow', 'MDOT'],
  ['MICH STATE HWY COMMISSION', 'yellow', 'MDOT'],
  ['MICHIGAN STATE HWY DEPT', 'yellow', 'MDOT'],
  // --- federal -----------------------------------------------------------------
  ['UNITED STATES OF AMERICA', 'yellow', 'Federal'],
  ['U S GOVERNMENT', 'yellow', 'Federal'],
  ['U.S.A.', 'yellow', 'Federal'],
  ['USA', 'yellow', 'Federal'],
  ['US FOREST SERVICE', 'green', 'National forest'],
  ['USDA FOREST SERVICE', 'green', 'National forest'],
  ['UNITED STATES OF AMERICA - FFS', 'green', 'National forest'],
  ['UNITED STATES OF AMERICA-FFS', 'green', 'National forest'],
  ['HURON-MANISTEE NATIONAL FOREST', 'green', 'National forest'],
  ['UNITED STATES OF AMERICA - F&WS', 'yellow', 'Fish & Wildlife'],
  ['US FISH & WILDLIFE SERVICE', 'yellow', 'Fish & Wildlife'],
  ['NATIONAL PARK SERVICE', 'yellow', 'National Park'],
  ['US DEPT OF THE ARMY', 'yellow', 'Military'],
  ['DEPT OF MILITARY AFFAIRS', 'yellow', 'Military'],
  ['SALVATION ARMY', 'red'],
  // --- tribal ------------------------------------------------------------------
  ['GTB OF OTTAWA & CHIPPEWA INDIANS', 'yellow', 'Tribal'],
  ['KEWEENAW BAY INDIAN COMMUNITY', 'yellow', 'Tribal'],
  ['SAULT STE MARIE TRIBE OF CHIPPEWA INDIANS', 'yellow', 'Tribal'],
  // --- county ------------------------------------------------------------------
  ['COUNTY OF KENT', 'yellow', 'County'],
  ['KENT COUNTY', 'yellow', 'County'],
  ['CHEBOYGAN, COUNTY OF', 'yellow', 'County'],
  ['COUNTY OF NEWAYGO-PARKS DEPT', 'yellow', 'County'],
  ['HOUGHTON COUNTY TREASURER', 'yellow', 'County'],
  ['MQT COUNTY TREASURER', 'yellow', 'County'],
  ['KENT COUNTY DRAIN COMMISSION', 'yellow', 'Drain'],
  ['KENT COUNTY ROAD COMMISSION', 'yellow', 'road commission'],
  ['BOARD OF COUNTY ROAD COMMISSIONERS', 'yellow', 'road commission'],
  ['MARQUETTE COUNTY RD COMMISSION', 'yellow', 'road commission'],
  ['KALAMAZOO COUNTY ROAD', 'yellow', 'road commission'],
  ['KENT COUNTY LAND BANK AUTHORITY', 'yellow', 'Land bank'],
  ['MARQUETTE COUNTY LAND BANK AUTH', 'yellow', 'Land bank'],
  // --- township ----------------------------------------------------------------
  ['TOWNSHIP OF MARQUETTE', 'yellow', 'Township'],
  ['CALEDONIA TWP', 'yellow', 'Township'],
  ['CHARTER TWP OF CALEDONIA', 'yellow', 'Township'],
  ['ADA TOWNSHIP-PARK', 'yellow', 'Township'],
  ['DOYLE & MUELLER TWPS', 'yellow', 'Township'],
  ['MERRILL TOWNSHIP ET AL', 'yellow', 'Township'],
  // --- city / village ----------------------------------------------------------
  ['CITY OF GRAND RAPIDS', 'red', 'City-owned'],
  ['HOUGHTON CITY OF', 'red', 'City-owned'],
  ['VILLAGE OF COPPER CITY', 'yellow', 'Village'],
  ['MACKINAW CITY, VILLAGE OF', 'yellow', 'Village'],
  ['CITY OF NEWAYGO ET AL', 'red', 'City-owned'],
  ['CITY OF THE VILLAGE OF CLARKSTON', 'red', 'City-owned'],
  // A township named after a city is a township, not the city.
  ['GRAND RAPIDS TOWNSHIP', 'yellow', 'Township'],
  ['CHARTER TOWNSHIP OF GRAND RAPIDS', 'yellow', 'Township'],
  ['GRAND RAPIDS CHARTER TWP', 'yellow', 'Township'],
  ['BAY CITY ROD AND GUN CLUB', 'red', 'club'],
  ['TRAVERSE CITY STATE BANK', 'red', 'business'],
  // --- schools, utilities, authorities ----------------------------------------
  ['REED CITY PUBLIC SCHOOLS', 'red', 'School'],
  ['THOMPSON TWP SCHOOLS', 'red', 'School'],
  ['ALLEGAN COUNTY INTERMEDIATE SCHOOL', 'red', 'School'],
  ['COPPER COUNTY ISD', 'red', 'School'],
  ['TRI COUNTY AREA SCHOOLS', 'red', 'School'],
  ['FERRIS STATE UNIVERSITY', 'yellow', 'university'],
  ['BOARD OF TRUSTEES OF MICHIGAN STATE UNIVERSITY', 'yellow', 'university'],
  ['REGENTS OF THE UNIVERSITY OF MICHIGAN', 'yellow', 'university'],
  ['CONSUMERS ENERGY COMPANY', 'yellow', 'Utility'],
  ['CONSUMERS POWER CO', 'yellow', 'Utility'],
  ['DTE ELECTRIC COMPANY', 'yellow', 'Utility'],
  ['AMERICAN TRANSMISSION REAL ESTATE', 'yellow', 'Utility'],
  ['ONTONAGON COUNTY R E A', 'yellow', 'Utility'],
  ['WEST MQT COUNTY SANIT AUTH', 'yellow'],
  // --- conservancies -----------------------------------------------------------
  ['LITTLE TRAVERSE CONSERVANCY INC', 'yellow', 'Conservancy'],
  ['THE NATURE CONSERVANCY', 'yellow', 'Conservancy'],
  ['MICHIGAN NATURE ASSOCIATION', 'yellow', 'Conservancy'],
  ['LEELANAU CONSERVANCY', 'yellow', 'Conservancy'],
  ['SOUTHWEST MICHIGAN LAND CONSERVANCY', 'yellow', 'Conservancy'],
  // --- private: false-positive traps ------------------------------------------
  ['STATE BANK', 'red'],
  ['PEOPLES STATE BANK OF MUNISING', 'red'],
  ['ALDEN STATE BANK', 'red'],
  ['STATE WIDE REAL ESTATE INC', 'red'],
  ['UP STATE TRUCKING', 'red'],
  ['4340 OLD STATE LLC', 'red'],
  ['185-187 STATE LLC', 'red'],
  ['345 STATE STREET LIMITED DIVIDEND', 'red'],
  ['LAKE STATES LAND LLC', 'red'],
  ['HADSTATE ADAM STOLL &', 'red'],
  ['BAPTIST STATE CONVENTION OF MI', 'red'],
  ['COUNTY LINE FARMS LLC', 'red'],
  ['COUNTY LINE SEIF FARMS LLC', 'red'],
  ['COUNTY LINE PROPERTIES HOLDING CO', 'red'],
  ['NORTH COUNTY WOODS LLC', 'red'],
  ['KENT COUNTY CREDIT UNION', 'red'],
  ['KENT COUNTY SELF STORAGE LLC', 'red'],
  ['KENT COUNTY CONSERVATION', 'red'],
  ['MARQUETTE COUNTY TITLE INSURANCE', 'red'],
  ['OTSEGO COUNTY ABSTRACT COMPANY', 'red'],
  ['HABITAT FOR HUMANITY OF KENT COUNTY', 'red'],
  ['ALANO CLUB OF KENT COUNTY INC', 'red'],
  ['YMCA OF MARQUETTE COUNTY', 'red'],
  ['MOOSE COUNTY SNOWMOBILERS', 'red'],
  ['CITY VIEW LLC', 'red'],
  ['QUEEN CITY PROPERTIES LLC', 'red'],
  ['HASTINGS CITY BANK', 'red'],
  ['TRUCK CITY SALES INC', 'red'],
  ['CITY ON A HILL COMMUNITY CHURCH -', 'red', 'religious'],
  ['SPICERS BOAT CITY INC', 'red'],
  ['FOREST TOWNSHIP HUNTING CLUB', 'red', 'club'],
  ['TILDEN TOWNSHIP CLUB', 'red', 'club'],
  ['SANDS TOWNSHIP MOBILE ESTATES LLC', 'red'],
  ['HOME TOWNSHIP 120,LLC', 'red'],
  ['SHINELDECKER RONDA HOME TWP TRUST', 'red', 'trust'],
  ['USA TOWING LLC', 'red'],
  ['US BANK NA', 'red'],
  ['DNR PROPERTIES LLC', 'red'],
  ['GOOD SHEPHERD PARISH OF UBLY', 'red', 'religious'],
  ['ST JOHN LUTHERAN CHURCH', 'red', 'religious'],
  ['ROSS SKIBBE FARMS', 'red', 'business'],
  ['CSX TRANSPORTATION INC', 'red', 'Railroad'],
  ['LAKE STATE RAILWAY CO', 'red', 'Railroad'],
  ['LYME GREAT LAKES TIMBERLANDS LLC', 'red', 'timber'],
  ['WEYERHAEUSER COMPANY', 'red', 'timber'],
  // --- private individuals / trusts / estates ---------------------------------
  ['BRUSH RICHARD N & ANGELA M', 'red', 'Private'],
  ['HIRSCHMAN, WILLIAM & CYNTHIA, TTEES', 'red', 'trust'],
  ['CARMIEN TRUST 3/20/13', 'red', 'trust'],
  ['ALLEN, LESLIE J - LIFE ESTATE', 'red', 'trust'],
  ['STEWART LINDA SUE  (LE)', 'red', 'trust'],
  ['BYCZEK, MARK E / KELLY S / TRUSTEES', 'red', 'trust'],
  ['WITTE THOMAS M ET AL SHERI L WITTE', 'red', 'Private'],
  ['TOWNSEND JOHN', 'red', 'Private'],
  ['COUNTRYMAN JOE', 'red', 'Private'],
  ['MICHIGAN MICHAEL', 'red', 'Private'],
  // --- regressions found by grading ~21k real owner strings ---------------------
  ['STATE OF MICH/DNR/REAL ESTATE', 'green', 'DNR'],
  ['MICHIGAN DEPT OF NATURAL RESOURSES', 'green', 'DNR'],
  ['MICHIGAN DEPT OF NATURAL', 'green', 'DNR'],
  ['STATE OF MICHIGAN (DNRE)', 'green', 'DNR'],
  ['MICH DEPT CONSERVATION', 'green', 'DNR'],
  ['CLIFFS NATURAL RESOURCES', 'red'],
  ['NORTH AMERICAN NATURAL RESOURCES', 'red'],
  ['DNR FARMS LLC', 'red'],
  ['STATE - DNR - FARMLAND & OPEN SPACE', 'red', 'farmland'],
  ['MICHIGAN D.O.T.', 'yellow', 'MDOT'],
  ['MICH STATE TRANSPORTATION COMM', 'yellow', 'MDOT'],
  ['MICHIGAN DEPT OF TRASPORTATION', 'yellow', 'MDOT'],
  ['INGHAM COUNTY DEPT OF TRANS & ROADS', 'yellow', 'road commission'],
  ['MICHIGAN STATE POLICE POST', 'yellow', 'non-DNR'],
  ['MICHIGAN STATE WATERWAY COMMISSION', 'yellow', 'non-DNR'],
  ['ARMORY  STATE OF MICHIGAN', 'yellow', 'Military'],
  ['U S A MANISTEE NATIONAL', 'green', 'National forest'],
  ['UNITED STATES FISH/WILDLIFE SERVICE', 'yellow', 'Fish & Wildlife'],
  ['UNITED STATES POSTAL SERVICE', 'yellow', 'Federal'],
  ['UNITED STATE OF AMERICA', 'yellow', 'Federal'],
  ['UNITED STATES OF AMERICA IN TRUST', 'yellow', 'Tribal'],
  ['CROWN CASTLE USA', 'red'],
  ['MURPHY OIL USA # 6691', 'red'],
  ['U S EQUIPMENT CO', 'red'],
  ['UNITED STATES GYPSUM CO', 'red'],
  ['UNITED STATES STEEL CORP', 'red'],
  ['LAKE MICHIGAN TECHNOLOGY LLC', 'red'],
  ['MICHIGAN STATE UNIVERSITY FEDERAL C', 'red'],
  ['MICHIGAN TECHNOLOGICAL UNIVERSITY', 'yellow', 'university'],
  ['MACOMB COUNTY COMM COLLEGE', 'yellow', 'university'],
  ['POKAGON TOWNSHIP', 'yellow', 'Township'],
  ['POKAGON UNITED METHODIST', 'red', 'religious'],
  ['AMISH PRIVATE SCHOOL', 'red'],
  ['BUTMAN PAROCHIAL SCHOOL', 'red'],
  ['CAPITAL AREA SCHOOL EMPLOYEES C U', 'red'],
  ['COOPERSVILLE SCHOOLS DIST 7', 'red', 'School'],
  ['PLYMOUTH-CANTON SCHOOL DISTRCIT', 'red', 'School'],
  ['VASSAR PUBLIC SCHOOLS TUSCOLA CO.', 'red', 'School'],
  ["JANET'S SCHOOL OF DANCE", 'red'],
  ['SCHOOL JAMES A', 'red'],
  ['SCHOOLCRAFT, BRENDA E', 'red'],
  ['GLADWIN COUNTY COURTHOUSE', 'yellow', 'County'],
  ['WAYNE COUNTY SHERRIFF', 'yellow', 'County'],
  ['IONIA COUNTY TREASRUER', 'yellow', 'County'],
  ['IONIA COUNTY - GREENVIEW PARK', 'yellow', 'County'],
  ['FAMILY PROMISE OF TUSCOLA COUNTY', 'red'],
  ['ARC OF WESTERN WAYNE COUNTY', 'red'],
  ['BARRY COUNTY CHAMBER OF COMMERCE', 'red'],
  ['WAYNE COUNTY LAND BANK CORPORATION', 'yellow', 'Land bank'],
  ['GLADWIN CITY', 'red', 'City-owned'],
  ['SOUTH HAVEN CITY', 'red', 'City-owned'],
  ['OLIVET VILLAGE PARK', 'yellow', 'Village'],
  ['CITY OF DETROIT IN TRUST', 'red', 'City-owned'],
  ['CITY OF PORTLAND (SCOUT PARK)', 'red', 'City-owned'],
  ['VILLAGE OF LAKEWOOD CLUB', 'yellow', 'Village'],
  ['VILLAGE OF OKEMOS LLC', 'red'],
  ['CITY OF REFUGE MINISTRIES INT', 'red', 'religious'],
  ['NEW CITY OF HOPE CHURCH', 'red', 'religious'],
  ['HOWARD TWP BD OF TRUSTEES', 'yellow', 'Township'],
  ['CLINTON TWP HOLDINGS, LLC', 'red'],
  ['COUNTRY CLUB OF CLINTON TWP LLC', 'red'],
  ['CITY OF PORTLAND (RR TRAIL)', 'red', 'City-owned'],
  ['MICHIGAN CENTRAL R.R.', 'red', 'Railroad'],
  ['AEP INDIANA MICHIGAN TRANSMISSION', 'yellow', 'Utility'],
  ['CONSUMER ENERGY', 'yellow', 'Utility'],
  ['TRI-COUNTY ELECT COOP', 'yellow', 'Utility'],
  ['DETROIT EDISON PUBLIC SCHOOL ACADEM', 'red', 'School'],
  ['SIX RIVERS LAND CONSERVACY', 'yellow', 'Conservancy'],
  ['NEWAYGO SOIL CONSERVATION DIST', 'yellow', 'Conservancy'],
  ['BAKER ANNA CONSERVATOR', 'red'],
  ['WOLVERINE SPORTS & CONSERVATION', 'red'],
  // --- empty ------------------------------------------------------------------
  ['', 'unknown'],
  ['   ', 'unknown'],
  ['0', 'unknown'],
];

describe('gradeOwnerName', () => {
  it.each(OWNER_CASES)('%s -> %s', (owner, grade, category) => {
    const r = gradeOwnerName(owner);
    expect(r.grade).toBe(grade);
    if (category) expect(r.category.toLowerCase()).toContain(category.toLowerCase());
    expect(r.reason.length).toBeGreaterThan(20);
  });

  it.each([
    ['STATE OF MICHIGAN DNR', 'dnr'],
    ['MICHIGAN DEPT OF NATURAL RESOURCES', 'dnr'],
    ['STATE OF MICHIGAN', 'state'],
    ['U S GOVT', 'federal'],
    ['UNITED STATES OF AMERICA', 'federal'],
    ['USDA FOREST SERVICE', 'usfs'],
    ['STATE HIGHWAY COMMISSION', 'other'],
    ['MICHIGAN DEPT OF TRANSPORTATION', 'other'],
    ['CONSUMERS ENERGY CO', 'other'],
    ['TOWNSHIP OF ALLEGAN', 'other'],
    ['CITY OF GRAND RAPIDS', 'other'],
    ['VILLAGE OF SPARTA', 'other'],
    ['CITY VIEW LLC', 'private'],
    ['BARRY COUNTY ROAD COMMISSION', 'other'],
    ['SMITH JOHN & MARY', 'private'],
    ['WEYERHAEUSER COMPANY', 'private'],
    ['', 'none'],
  ] as const)('owner kind: %s -> %s', (owner, kind) => {
    expect(gradeOwnerName(owner).ownerKind).toBe(kind);
  });

  it('every owner-name result carries an owner kind', () => {
    for (const [owner] of OWNER_CASES) expect(gradeOwnerName(owner).ownerKind, owner).toBeDefined();
  });

  it('treats null/undefined as unknown', () => {
    expect(gradeOwnerName(null).grade).toBe('unknown');
    expect(gradeOwnerName(undefined).grade).toBe('unknown');
  });

  it('cites the trespass law for private land', () => {
    const r = gradeOwnerName('SMITH JOHN & MARY');
    expect(r.references?.some((x) => x.label.includes('324.73102'))).toBe(true);
  });

  it('normalizes punctuation', () => {
    expect(normalizeOwner("  U.S.A.  -  F&WS ")).toBe('USA F & WS');
    expect(normalizeOwner('HOME TOWNSHIP 120,LLC')).toBe('HOME TOWNSHIP 120 LLC');
  });
});

function src(id: string): LayerSource {
  const s = LAYER_SOURCES.find((l) => l.id === id);
  if (!s) throw new Error(`no source ${id}`);
  return s;
}

describe('gradeFeature – public land layers', () => {
  it('catalog roles', () => {
    const role = (id: string): string | undefined => src(id).role;
    expect(role('dnr-wildlife-areas')).toBe('boundary');
    expect(role('dnr-state-parks')).toBe('boundary');
    for (const id of ['dnr-park-hunting', 'dnr-hap', 'commercial-forest']) expect(role(id)).toBe('access-program');
    for (const id of ['dnr-managed-lands', 'usfs-surface-ownership']) {
      expect(role(id)).toBe('ownership');
      expect(src(id).lowConfidence).toBeFalsy();
    }
    for (const s of LAYER_SOURCES.filter((l) => l.id.startsWith('padus-'))) {
      expect(s.role).toBe('ownership');
      expect(s.lowConfidence).toBe(true);
    }
    for (const s of LAYER_SOURCES.filter((l) => l.group === 'public-land')) expect(s.role, s.id).toBeDefined();
    expect(src('dnr-managed-lands').where).toContain("NOT IN ('State Park','Recreational Areas')");
  });

  it('DNR managed lands by use type', () => {
    const s = src('dnr-managed-lands');
    expect(gradeFeature(s, { ProjectUseType: 'Forests', ProjectName: 'BARAGA MANAGEMENT UNIT' }).grade).toBe('green');
    expect(gradeFeature(s, { ProjectUseType: 'Wildlife Game Areas' }).grade).toBe('green');
    expect(gradeFeature(s, { ProjectUseType: 'State Park' }).grade).toBe('yellow');
    expect(gradeFeature(s, { ProjectUseType: 'Recreational Areas' }).grade).toBe('yellow');
    expect(gradeFeature(s, { ProjectUseType: 'Fish Hatcheries' }).grade).toBe('yellow');
    expect(gradeFeature(s, { ProjectUseType: 'Undedicated', DivisionDepartment: 'Forest Resources Division' }).grade).toBe('green');
    expect(gradeFeature(s, { ProjectUseType: 'Undedicated', DivisionDepartment: 'Michigan Department of Transportation' }).grade).toBe('yellow');
  });

  it('state-owned DNR parcels by division', () => {
    const s = src('parcels-dnr-state-owned');
    expect(gradeFeature(s, { DivisionDepartment: 'Wildlife Division' }).grade).toBe('green');
    expect(gradeFeature(s, { DivisionDepartment: 'Parks and Recreation Division' }).grade).toBe('yellow');
    expect(gradeFeature(s, { DivisionDepartment: 'Wildlife Division' }).ownerKind).toBe('dnr');
  });

  it('boundary layers never carry a grade', () => {
    const s = src('dnr-wildlife-areas');
    expect(s.role).toBe('boundary');
    const sga = gradeFeature(s, { AreaType: 'State Game Area', OfficialWLDProjectAreaName: 'Allegan SGA' });
    expect(sga.grade).toBe('unknown');
    expect(sga.category).toBe('State Game Area');
    expect(sga.reason).toContain('private inholdings');
    expect(gradeFeature(s, { AreaType: null, OfficialWLDProjectAreaName: '(select pvt-owned lands with State reserved hunting rights)' }).grade).toBe('unknown');
    const park = gradeFeature(src('dnr-state-parks'), { Park_Label: 'Yankee Springs RA' });
    expect(park.grade).toBe('unknown');
    expect(park.reason).toContain('Yankee Springs RA');
  });

  it('HAP by status and hunt type', () => {
    const s = src('dnr-hap');
    expect(gradeFeature(s, { ActiveOrInactive: 'Active', HuntType: 'Open to All Hunt Types.' }).grade).toBe('green');
    const youth = gradeFeature(s, { ActiveOrInactive: 'Active', HuntType: 'Only Open to Youth and Apprentice Hunting.' });
    expect(youth.grade).toBe('yellow');
    expect(youth.reason).toContain('Youth');
    expect(gradeFeature(s, { ActiveOrInactive: 'Inactive' }).grade).toBe('red');
  });

  it('state park hunting status', () => {
    const s = src('dnr-park-hunting');
    expect(gradeFeature(s, { Facility: 'Silver Lake State Park', HuntTrap: 'Open' }).grade).toBe('green');
    expect(gradeFeature(s, { Facility: 'X', HuntTrap: 'Open-Restricted', HuntTrapRestrictions: 'Archery only' }).reason).toContain('Archery only');
    expect(gradeFeature(s, { Facility: 'Saugatuck Dunes State Park', HuntTrap: 'Closed' }).grade).toBe('red');
    // Open-Restricted: weapon/date limits are open with the limit stated; game/activity limits stay yellow.
    for (const note of ['Local Controls: No Centerfire Rifles or Rimfire Rifles', 'Local Controls: No Firearms', 'No Firearms from 11/15 - 12/1', "No Rifles or Handguns (Director's Order 5.11).", 'Local Controls: No firearms except for waterfowl hunting']) {
      const r = gradeFeature(s, { Facility: 'Proud Lake Recreation Area', HuntTrap: 'Open-Restricted', HuntTrapRestrictions: note });
      expect(r.grade, note).toBe('green');
      expect(r.reason, note).toContain(note);
    }
    for (const note of ['Open to Waterfowl Only', 'Open to Trapping & Waterfowl Only; Waterfowl hunting allowed from the day after Labor Day through the end of February']) {
      expect(gradeFeature(s, { Facility: 'Sterling State Park', HuntTrap: 'Open-Restricted', HuntTrapRestrictions: note }).grade, note).toBe('yellow');
    }
    expect(gradeFeature(s, { Facility: 'X', HuntTrap: 'Open-Restricted' }).grade).toBe('yellow');
    // Closed zones that carry a DNR note keep the note (audit of all 183 zones, Nov 2026).
    const sterling = gradeFeature(s, { Facility: 'Sterling State Park', HuntTrap: 'Closed', HuntTrapRestrictions: 'Open to Trapping Only' });
    expect(sterling.grade).toBe('red');
    expect(sterling.category).toContain('trapping only');
    expect(sterling.reason).not.toMatch(/closed to hunting and trapping/);
    const hoff = gradeFeature(s, { Facility: 'P.J. Hoffmaster State Park', HuntTrap: 'Closed', Comments: 'Special Hunt Only as designated by DNR-PRD Chief' });
    expect(hoff.grade).toBe('red');
    expect(hoff.reason).toContain('Special Hunt Only');
  });

  it('commercial forest', () => {
    const s = src('commercial-forest');
    const r = gradeFeature(s, { ParcelStatusText: 'Active', FullLegalName: 'JML Heirs, LLC' });
    expect(r.grade).toBe('green');
    expect(r.references?.some((x) => x.label.includes('Part 511'))).toBe(true);
    expect(gradeFeature(s, { ParcelStatusText: 'Under Withdrawal' }).grade).toBe('yellow');
  });

  it('USFS surface ownership', () => {
    const s = src('usfs-surface-ownership');
    expect(gradeFeature(s, { ownerclassification: 'USDA FOREST SERVICE', nfslandunitname: 'Hiawatha National Forest' }).grade).toBe('green');
  });

  it('PAD-US layers', () => {
    expect(gradeFeature(src('padus-federal-other'), { Mang_Type: 'FED', Mang_Name: 'FWS', Des_Tp: 'NWR', Pub_Access: 'RA' }).grade).toBe('yellow');
    expect(gradeFeature(src('padus-federal-other'), { Mang_Type: 'FED', Mang_Name: 'NPS', Des_Tp: 'NP', Pub_Access: 'OA' }).grade).toBe('red');
    expect(gradeFeature(src('padus-federal-other'), { Mang_Type: 'FED', Mang_Name: 'NPS', Des_Tp: 'NLS', Pub_Access: 'OA' }).grade).toBe('yellow');
    expect(gradeFeature(src('padus-local'), { Mang_Type: 'LOC', Mang_Name: 'CNTY', Des_Tp: 'LP', Pub_Access: 'OA' }).category).toContain('County');
    expect(gradeFeature(src('padus-local'), { Mang_Type: 'LOC', Mang_Name: 'CITY', Pub_Access: 'XA' }).grade).toBe('red');
    expect(gradeFeature(src('padus-ngo'), { Mang_Type: 'NGO', Mang_Name: 'NGO', Pub_Access: 'OA' }).grade).toBe('yellow');
  });
});

describe('gradeFeature – parcels and other layers', () => {
  it('uses the layer owner field', () => {
    const kent = src('parcels-kent');
    expect(gradeFeature(kent, { OWNERNAME: 'DNR' }).grade).toBe('green');
    expect(gradeFeature(kent, { OWNERNAME: 'PENNING MARTIN E & CHRISTINA' }).grade).toBe('red');
    expect(gradeFeature(kent, {}).grade).toBe('unknown');
  });

  it('every county parcel layer grades through its owner field', () => {
    for (const s of LAYER_SOURCES.filter((l) => l.group === 'parcels' && l.parcel?.ownerField)) {
      const r = gradeFeature(s, { [s.parcel!.ownerField!]: 'COUNTY OF ' + s.parcel!.county.toUpperCase() });
      expect(r.grade, s.id).toBe('yellow');
    }
  });

  it('hunting units and reference layers are not ownership', () => {
    expect(gradeFeature(src('unit-deer-dmu'), { DeerManagementUnit: '003' }).grade).toBe('unknown');
    expect(gradeFeature(src('ref-counties'), { NAME: 'KENT' }).grade).toBe('unknown');
  });

  it('honours fixedGrade', () => {
    const s: LayerSource = { ...src('ref-counties'), fixedGrade: { grade: 'green', category: 'x', reason: 'y' } };
    expect(gradeFeature(s, {}).grade).toBe('green');
  });
});

describe('catalog sanity', () => {
  it('has unique ids and required fields', () => {
    const ids = LAYER_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of LAYER_SOURCES) {
      expect(s.url).toMatch(/^https:\/\/.+\/(FeatureServer|MapServer)\/\d+$/);
      expect(s.fields.length).toBeGreaterThan(0);
      if (s.nameField) expect(s.fields).toContain(s.nameField);
      if (s.group === 'parcels') expect(s.parcel).toBeDefined();
      if (s.group === 'hunting-units') expect(s.species?.length).toBeGreaterThan(0);
    }
  });

  it('lists all 83 counties and marks parcel coverage', () => {
    expect(MICHIGAN_COUNTIES).toHaveLength(83);
    const covered = MICHIGAN_COUNTIES.filter((c) => c.hasParcels).map((c) => c.name);
    const parcelCounties = LAYER_SOURCES.filter((s) => s.group === 'parcels' && s.parcel?.county !== 'Statewide').map(
      (s) => s.parcel!.county,
    );
    expect(covered.sort()).toEqual([...parcelCounties].sort());
  });
});

describe('wildlife refuge colour flag', () => {
  it('flags only Fish & Wildlife Service units in the PAD-US federal layer', async () => {
    const { isWildlifeRefuge } = await import('./grade');
    expect(isWildlifeRefuge('padus-federal-other', { Mang_Name: 'FWS', Unit_Nm: 'Seney National Wildlife Refuge' })).toBe(true);
    expect(isWildlifeRefuge('padus-federal-other', { Mang_Name: 'NPS', Unit_Nm: 'Sleeping Bear Dunes National Lakeshore' })).toBe(false);
    expect(isWildlifeRefuge('padus-state-other', { Mang_Name: 'FWS' })).toBe(false);
    expect(isWildlifeRefuge('padus-federal-other', null)).toBe(false);
  });
});

describe('state trail corridors', () => {
  it('are treated as closed', async () => {
    const { gradeFeature } = await import('./grade');
    const { LAYER_SOURCES } = await import('../data/sources');
    const dnr = LAYER_SOURCES.find((s) => s.id === 'dnr-managed-lands')!;
    for (const use of ['Rail Trails', 'Trail']) {
      const r = gradeFeature(dnr, { ProjectUseType: use, ProjectName: 'North Central State Trail' });
      expect(r.grade, use).toBe('red');
      expect(r.category).toContain('State trail corridor');
    }
    expect(gradeFeature(dnr, { ProjectUseType: 'Forests', ProjectName: 'X' }).grade).toBe('green');
  });
});
