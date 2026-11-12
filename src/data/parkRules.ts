// Researched hunting rules for specific parks, refuges and county land (November 2026).
//
// The layers' own attributes cannot say whether a particular county park, refuge or state park
// allows hunting; docs/PARK_HUNTING_RESEARCH.md records what each unit's own rules say. The
// rules below are the findings the owner approved for the map: each one names the features it
// applies to (layer id + exact field values), the grade it sets and the plain-language rule.
//
// gradeFeature() (src/grading/grade.ts) grades a feature from its layer as usual, then, if a rule
// here matches, replaces the grade with the researched one (see applyParkRule). The result carries
// `researched` so the details sheet can say where the verdict came from.
//
// This is a snapshot: re-check the sources and update `RESEARCHED` when refreshing. Every matcher
// is checked against the real PAD-US / DNR names in parkRules.test.ts (no dead rules).
//
// Matching: every field in `where` must match; any field in `not` excludes. A string or list of
// strings matches the trimmed value case-insensitively and exactly; a RegExp is tested as written.
// Rules are tried in order and the first match wins, so specific rules come before broad ones.

import type { Grade, GradeResult } from '../contract.ts';

export const RESEARCHED = '2026-11-12';

export type Confidence = 'high' | 'medium' | 'low';
type FieldTest = string | readonly string[] | RegExp;
type Source = { label: string; url: string };

export interface ParkRule {
  id: string;
  /** Human name of what the rule covers. */
  name: string;
  /** Layer ids the rule applies to. */
  layers: readonly string[];
  /** Field → test; all must match. */
  where: Readonly<Record<string, FieldTest>>;
  /** Field → test; any match excludes the feature. */
  not?: Readonly<Record<string, FieldTest>>;
  grade: Grade;
  category: string;
  /** Plain-language rule, shown after the unit's name. */
  text: string;
  confidence: Confidence;
  researched: string;
  sources: readonly Source[];
  /** Also quote the layer's own record (e.g. the DNR park zone note) after the rule. */
  keepLayerReason?: boolean;
}

// ---------------------------------------------------------------------------
// Shared names and sources
// ---------------------------------------------------------------------------

const PADUS_LOCAL = ['padus-local'];
const PADUS_FED = ['padus-federal-other'];
const PARK_ZONES = ['dnr-park-hunting'];

/** PAD-US manager strings for each county park system (exact; checked against the data). */
const KENT = ['Kent County', 'Kent County Parks', 'County of Kent']; // not "City of Kentwood", not Kent City
const OAKLAND = ['Oakland County Parks Commission', 'County of Oakland']; // not Oakland Township / University
const WAYNE = ['Wayne County', 'Wayne County Parks', 'Wayne Parks', 'Wayne', 'County of Wayne Parks Department']; // not "City of Wayne"
const OTTAWA = ['County of Ottawa', 'County of Ottowa', 'Ottawa County', 'Ottawa County Parks and Recreation']; // "Ottowa" is a PAD-US misspelling
const IONIA = ['Ionia County', 'County of Ionia']; // not "City of Ionia"
const BAY = ['County of Bay']; // not "City of Bay City"
const GOGEBIC = ['County of Gogebic', 'Gogebic County']; // not the road commission

/** County land that is not a park: a "parks are closed" finding does not cover it. */
const NOT_A_PARK: Record<string, FieldTest> = { Des_Tp: ['LRMA', 'LOTH'], Unit_Nm: /fairground|^local forest$|^land$|gravel pit/i };

const WCO7: Source = {
  label: 'Wildlife Conservation Order, Chapter VII – State Parks and Recreation Areas (amended through Sept. 9, 2026)',
  url: 'https://www.michigan.gov/dnr/-/media/Project/Websites/dnr/Documents/Orders/Wildlife-Conservation-Order/ChapterVII.pdf',
};
const R318_143: Source = {
  label: 'Mich. Admin. Code R 318.143 – Camping and hunting (Mackinac Island State Park Commission)',
  url: 'https://www.law.cornell.edu/regulations/michigan/Mich-Admin-Code-R-318-143',
};
const HCMA_SOURCES: Source[] = [
  { label: 'HCMA 2022–2026 Deer Herd and Ecosystem Management Plan', url: 'https://www.metroparks.com/wp-content/uploads/2021/12/FINAL_2022-2026-Deer-Herd-and-Ecosystem-Management-Plan.pdf' },
  { label: 'Outdoor Life – Michigan parks authority culls deer', url: 'https://outdoorlife.com/conservation/michigan-parks-deer-culls' },
];
const KENT_SOURCES: Source[] = [
  { label: 'Kent County Parks – Bow hunting on Kent County parks property', url: 'https://www.kentcountymi.gov/1861/Bow-Hunting' },
  { label: 'FOX17 – Kent County opens some parks to bow hunters', url: 'https://www.fox17online.com/news/local-news/rockford-cedar-springs-sparta/kent-county-opens-some-parks-to-bow-hunters-for-deer-management' },
];
const OAKLAND_SOURCES: Source[] = [
  { label: 'Oakland County Parks – Hunting', url: 'https://www.oakgov.com/community/oakland-county-parks/recreation/hunting' },
  { label: 'Oakland County Parks deer management FAQ', url: 'https://www.oakgov.com/home/showpublisheddocument/30095/639051166274530000' },
];
const OTTAWA_SOURCES: Source[] = [
  { label: 'Ottawa County Parks – Hunting on Parks & Recreation Properties', url: 'https://miottawa.org/parks/hunting/' },
  { label: 'Ottawa County Parks hunting rules', url: 'https://www.miottawa.org/Parks/pdf/hunting_rules.pdf' },
];

const r = (rule: Omit<ParkRule, 'researched'>): ParkRule => ({ ...rule, researched: RESEARCHED });

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

export const PARK_RULES: readonly ParkRule[] = [
  // ---- State parks (Wildlife Conservation Order ch. VII, read in full) -----------------------
  r({
    id: 'gete-mino-mshkiigan',
    name: 'Gete Mino Mshkiigan State Park',
    layers: PARK_ZONES,
    where: { Facility: 'Gete Mino Mshkiigan State Park' },
    grade: 'green',
    category: 'State park – hunting open (WCO 7.74)',
    text: 'open to hunting and trapping in established seasons. Wildlife Conservation Order 7.74 opened all state-owned land here in March 2025; the DNR park hunting map still shows it closed and has not caught up. The 450-ft safety zone around occupied buildings applies.',
    confidence: 'high',
    sources: [WCO7],
  }),
  r({
    id: 'hoffmaster',
    name: 'P.J. Hoffmaster State Park',
    layers: PARK_ZONES,
    where: { Facility: 'P.J. Hoffmaster State Park' },
    keepLayerReason: true,
    grade: 'red',
    category: 'State park – closed to hunting',
    text: 'closed to general hunting. The only hunting is the designated lottery firearm deer hunt run with Ottawa County (20–23 November 2026, assigned zones, by permit only); the park is closed to other visitors on those days.',
    confidence: 'high',
    sources: [WCO7, { label: 'DNR – Hoffmaster State Park to close Nov. 20–23 for managed deer hunt', url: 'https://www.michigan.gov/dnr/about/newsroom/releases/2026/08/26/hoffmaster-state-park' }],
  }),
  r({
    id: 'metamora-hadley',
    name: 'Metamora-Hadley Recreation Area',
    layers: PARK_ZONES,
    where: { Facility: 'Metamora-Hadley Recreation Area' },
    keepLayerReason: true,
    grade: 'green',
    category: 'State park – hunting open (with closed areas)',
    text: 'open to hunting and trapping, but Wildlife Conservation Order 7.68 closes the campground, headquarters, day-use and wastewater-treatment areas all year (not mapped here), bars waterfowl hunting from 1 September to Labor Day, and bars it within 450 ft of campsites, launches, parking, picnic areas and the beach until 15 September.',
    confidence: 'high',
    sources: [WCO7],
  }),
  r({
    id: 'old-mission',
    name: 'Old Mission Peninsula State Park',
    layers: PARK_ZONES,
    where: { Facility: 'Old Mission Peninsula State Park' },
    keepLayerReason: true,
    grade: 'green',
    category: 'State park – hunting open (with closed areas)',
    text: 'open to hunting, except within 450 ft of a picnic area or parking lot (Wildlife Conservation Order 7.22a, which opens state land in sections 23–26, T30N R10W; not confirmed to be exactly this mapped land). The 450-ft safety zone around occupied buildings also applies.',
    confidence: 'medium',
    sources: [WCO7],
  }),
  r({
    id: 'mackinac-island',
    name: 'Mackinac Island State Park',
    layers: ['padus-state-researched'],
    where: { Unit_Nm: 'Mackinac State Park' },
    grade: 'red',
    category: 'State historic park – closed to hunting',
    text: 'Mackinac Island State Park is closed to hunting (Mackinac Island State Park Commission rule R 318.143). The only shooting allowed is at a permit-only range.',
    confidence: 'high',
    sources: [R318_143],
  }),
  r({
    id: 'michilimackinac',
    name: 'Colonial Michilimackinac (Michilimackinac State Park)',
    layers: ['padus-state-researched'],
    where: { Unit_Nm: 'Fort Michilimackinac State Park' },
    grade: 'red',
    category: 'State historic park – closed to hunting',
    text: 'Michilimackinac State Park is closed to hunting (Mackinac Island State Park Commission rule R 318.143).',
    confidence: 'high',
    sources: [R318_143],
  }),

  // ---- Federal land ------------------------------------------------------------------------
  r({
    id: 'isle-royale',
    name: 'Isle Royale National Park',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Isle Royale National Park' },
    grade: 'red',
    category: 'National park – closed to hunting',
    text: "hunting is prohibited by the park's enabling statute.",
    confidence: 'high',
    sources: [
      { label: 'Isle Royale NP – Laws & Policies', url: 'https://www.nps.gov/isro/learn/management/lawsandpolicies.htm' },
      { label: '16 U.S.C. 408j', url: 'https://www.govinfo.gov/link/uscode/16/408j' },
    ],
  }),
  r({
    id: 'sleeping-bear',
    name: 'Sleeping Bear Dunes National Lakeshore',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Sleeping Bear Dunes National Lakeshore' },
    grade: 'green',
    category: 'National lakeshore – hunting open (with closed areas)',
    text: "most of the lakeshore is open to hunting under Michigan seasons. Developed and high-use areas and a 450-ft safety zone around them are closed (South Manitou campgrounds, the Manitou village areas, Pierce Stocking Scenic Drive while open to cars, Glen Lake and Good Harbor picnic areas and other sites on the park's compendium maps). North Manitou Island has a permit deer hunt. Trapping and dog training are prohibited.",
    confidence: 'high',
    sources: [
      { label: 'Sleeping Bear Dunes – Hunting', url: 'https://www.nps.gov/slbe/planyourvisit/hunting.htm' },
      { label: 'Sleeping Bear Dunes compendium maps', url: 'https://www.nps.gov/slbe/learn/management/upload/Sleeping-Bear-Dunes-Compendium-Maps.pdf' },
    ],
  }),
  r({
    id: 'pictured-rocks',
    name: 'Pictured Rocks National Lakeshore',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Pictured Rocks National Lakeshore' },
    grade: 'green',
    category: 'National lakeshore – hunting open (seasonal closure)',
    text: 'open to hunting under Michigan regulations, except park-wide from 1 April to Labor Day, and never in the zones listed in 36 CFR 7.32(c) (e.g. within 150 yards of the Miners Castle overlooks and parking, and of campsites at Little Beaver, Twelvemile Beach and Hurricane River campgrounds).',
    confidence: 'medium',
    sources: [
      { label: 'Hunting & fishing at Pictured Rocks', url: 'https://nps.gov/piro/planyourvisit/hunting-fishing.htm' },
      { label: '36 CFR 7.32 – Pictured Rocks National Lakeshore', url: 'https://www.law.cornell.edu/cfr/text/36/7.32' },
    ],
  }),
  r({
    id: 'fws-wpa',
    name: 'Waterfowl Production Areas (Barry, Jackson, Van Buren)',
    layers: PADUS_FED,
    where: { Unit_Nm: /^(Barry|Jackson|Van Buren) County Waterfowl Production Area( Of Mi)?$/i },
    grade: 'green',
    category: 'Waterfowl Production Area – hunting open',
    text: 'U.S. Fish & Wildlife Service Waterfowl Production Area, open to hunting and trapping under state regulations. Non-toxic shot is required for small game and upland birds hunted with a shotgun.',
    confidence: 'medium',
    sources: [
      { label: 'Michigan Wetland Management District – Hunting', url: 'https://www.fws.gov/refuge/michigan-wetland-management-district/visit-us/activities/hunting' },
      { label: 'Michigan Wetland Management District – Rules', url: 'https://www.fws.gov/refuge/michigan-wetland-management-district/visit-us/rules-policies' },
    ],
  }),
  r({
    id: 'harbor-island',
    name: 'Harbor Island National Wildlife Refuge',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Harbor Island National Wildlife Refuge' },
    grade: 'green',
    category: 'National wildlife refuge – deer and bear hunting',
    text: 'boat-access island open to white-tailed deer (archery and firearm, state seasons) and black bear hunting. One portable stand or blind per hunter, labelled with the license number.',
    confidence: 'medium',
    sources: [
      { label: 'Harbor Island NWR hunt brochure 2026', url: 'https://www.fws.gov/sites/default/files/documents/2026-08/harborisland_huntbrochures_26-online.pdf' },
      { label: 'Harbor Island NWR – Hunting', url: 'https://www.fws.gov/refuge/harbor-island/visit-us/activities/hunting' },
    ],
  }),
  r({
    id: 'kirtlands-warbler',
    name: "Kirtland's Warbler Wildlife Management Area",
    layers: PADUS_FED,
    where: { Unit_Nm: /^Kirtland'?s Warbler Wildlife Management Area$/i },
    grade: 'green',
    category: 'FWS wildlife management area – hunting open (seasonal closure)',
    text: 'open to hunting under state seasons, except that occupied warbler tracts are closed to entry and hunting from 1 May to 15 August. No trapping at any time; no baiting.',
    confidence: 'medium',
    sources: [
      { label: "Kirtland's Warbler WMA hunting regulations 2026", url: 'https://www.fws.gov/sites/default/files/documents/2026-08/kirtlandswarblerwma_hunt26_online.pdf' },
      { label: "Kirtland's Warbler WMA – Hunting", url: 'https://www.fws.gov/refuge/kirtlands-warbler-wildlife-management-area/visit-us/activities/hunting' },
    ],
  }),
  r({
    id: 'seney',
    name: 'Seney National Wildlife Refuge',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Seney National Wildlife Refuge' },
    grade: 'yellow',
    category: 'National wildlife refuge – designated hunt areas',
    text: "hunting with a Michigan license is allowed only in Hunt Areas A, B and C on the refuge map. The headquarters / visitor-centre area on the west end is closed. No bait, and no hunting within 200 yards of structures. Check the refuge's hunt map.",
    confidence: 'medium',
    sources: [
      { label: 'Seney NWR hunting regulations 2026', url: 'https://www.fws.gov/sites/default/files/documents/2026-08/seney-hunt26-online.pdf' },
      { label: 'Seney NWR – Rules and policies', url: 'https://www.fws.gov/refuge/seney/visit-us/rules-policies' },
    ],
  }),
  r({
    id: 'shiawassee',
    name: 'Shiawassee National Wildlife Refuge',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Shiawassee National Wildlife Refuge' },
    grade: 'yellow',
    category: 'National wildlife refuge – lottery hunts only',
    text: 'no walk-in hunting. Deer hunting only by reserved-access lottery (DNR drawing, DMU 273), and waterfowl only by the refuge’s self-registration lottery on designated units.',
    confidence: 'medium',
    sources: [
      { label: 'Shiawassee NWR hunting regulations 2026', url: 'https://www.fws.gov/sites/default/files/documents/2026-08/shiawassee_hunt26_online.pdf' },
      { label: 'DMU 273 reserved deer hunting information', url: 'https://www.michigan.gov/dnr/things-to-do/hunting/deer/reserved-deer-hunts/dmu-273-reserved-deer-hunting-information' },
    ],
  }),
  r({
    id: 'detroit-river',
    name: 'Detroit River International Wildlife Refuge',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Detroit River International Wildlife Refuge' },
    grade: 'yellow',
    category: 'National wildlife refuge – lottery and designated units',
    text: 'deer hunting only by lottery archery permit (antlerless only) on designated units; waterfowl only in designated units on set days with refuge permits. Other units are closed; no access from private property.',
    confidence: 'medium',
    sources: [
      { label: 'Detroit River IWR hunt brochure 2026', url: 'https://www.fws.gov/sites/default/files/documents/2026-08/detroitriver_hunt-online-26.pdf' },
      { label: 'Detroit River IWR – Rules and policies', url: 'https://www.fws.gov/refuge/detroit-river/visit-us/rules-policies' },
    ],
  }),
  r({
    id: 'fish-hatcheries',
    name: 'Jordan River and Pendills Creek National Fish Hatcheries',
    layers: PADUS_FED,
    where: { Unit_Nm: /^(Jordan River|Pendills Creek) National Fish Hatchery$/i },
    grade: 'yellow',
    category: 'National fish hatchery – mapped hunting areas only',
    text: "hunting under Michigan seasons only in the areas mapped open in the hatchery's hunting brochure; buildings, rearing facilities and the rest of the property are closed. No shooting on or over hatchery roads.",
    confidence: 'medium',
    sources: [
      { label: 'Jordan River NFH – Hunting', url: 'https://www.fws.gov/fish-hatchery/jordan-river/visit-us/activities/hunting' },
      { label: 'Pendills Creek NFH hunting brochure 2026', url: 'https://www.fws.gov/sites/default/files/documents/2026-08/pendillscreek_2026-online_0.pdf' },
    ],
  }),
  r({
    id: 'camp-grayling',
    name: 'Camp Grayling',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Camp Grayling Military Reservation' },
    grade: 'yellow',
    category: 'Military training area – open except when gated',
    text: 'most of the training area is state land open to public hunting under state rules, but the cantonment, impact and live-fire ranges are closed and any area gated for training is closed while gated. The Guard has said it does not train on leased land during the regular firearm deer season (15–30 Nov).',
    confidence: 'medium',
    sources: [
      { label: 'MUCC – what the DNR/Guard Camp Grayling agreement means', url: 'https://www.mucc.org/what-does-the-dnr-and-national-guards-camp-grayling-agreement-really-mean' },
      { label: 'DNR Camp Grayling proposal FAQ', url: 'https://content.govdelivery.com/attachments/MIDNR/2022/06/09/file_attachments/2181063/CG-proposal-FAQ.pdf' },
    ],
  }),
  r({
    id: 'michigan-islands',
    name: 'Michigan Islands National Wildlife Refuge',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Michigan Islands National Wildlife Refuge' },
    grade: 'red',
    category: 'National wildlife refuge – closed to hunting',
    text: 'all refuge islands are closed to public entry (nesting colonial waterbirds); entry only by special-use permit.',
    confidence: 'high',
    sources: [{ label: 'Michigan Islands NWR – Visit us', url: 'https://www.fws.gov/refuge/michigan-islands/visit-us' }],
  }),
  r({
    id: 'huron-nwr',
    name: 'Huron National Wildlife Refuge',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Huron National Wildlife Refuge' },
    grade: 'red',
    category: 'National wildlife refuge – closed to hunting',
    text: 'no hunting program; all islands except Lighthouse Island (daylight visits only) are closed to entry.',
    confidence: 'medium',
    sources: [{ label: 'Huron NWR – Visit us', url: 'https://www.fws.gov/refuge/huron/visit-us' }],
  }),
  r({
    id: 'green-bay-nwr',
    name: 'Green Bay National Wildlife Refuge (Michigan land)',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Green Bay National Wildlife Refuge' },
    grade: 'red',
    category: 'National wildlife refuge – closed to hunting',
    text: "the refuge's Michigan land (St. Martin Island) is closed to all public use; the refuge's hunts are on Wisconsin islands only.",
    confidence: 'high',
    sources: [
      { label: 'Green Bay NWR – Visit us', url: 'https://fws.gov/refuge/green-bay/visit-us' },
      { label: 'Green Bay NWR hunt/fish public-use regulations', url: 'https://www.fws.gov/sites/default/files/documents/Green-Bay-national-wildlife-refuge-hunt-fish-public-use-regulations_0.pdf' },
    ],
  }),
  r({
    id: 'river-raisin',
    name: 'River Raisin National Battlefield Park',
    layers: PADUS_FED,
    where: { Unit_Nm: 'River Raisin National Battlefield Park' },
    grade: 'red',
    category: 'National battlefield – closed to hunting',
    text: 'hunting is prohibited (National Park Service default rule, 36 CFR 2.2; no statute authorises it here).',
    confidence: 'medium',
    sources: [
      { label: 'River Raisin NBP – Safety', url: 'https://www.nps.gov/rira/planyourvisit/safety.htm' },
      { label: "River Raisin NBP superintendent's compendium", url: 'https://www.nps.gov/rira/learn/management/superintendent-s-compendium.htm' },
    ],
  }),

  // ---- Huron-Clinton Metroparks ------------------------------------------------------------
  // Four Metroparks are filed under "CITY OF DETROIT-RECREATION DEPT" in PAD-US, so these match on
  // the park name alone (the names are unique in Michigan).
  r({
    id: 'lake-erie-metropark',
    name: 'Lake Erie Metropark',
    layers: PADUS_LOCAL,
    where: { Unit_Nm: 'Lake Erie Metropark' },
    grade: 'yellow',
    category: 'Metropark – waterfowl access only',
    text: 'hunting on park land is prohibited; the park map allows crossing the park to reach Lake Erie for waterfowl hunting during DNR seasons.',
    confidence: 'low',
    sources: [{ label: 'Lake Erie Metropark map', url: 'https://www.metroparks.com/wp-content/uploads/2017/05/2017-Lake-Erie-Map1.pdf' }],
  }),
  r({
    id: 'hcma-closed',
    name: 'Huron-Clinton Metroparks (12 parks)',
    layers: PADUS_LOCAL,
    where: {
      Unit_Nm:
        /^((Delhi|Dexter-Huron|Hudson Mills|Huron Meadows|Indian Springs|Kensington|Metro Beach|Lake St\.? Clair|Lower Huron|Oakwoods|Stoney? Creek|Willow|Wolcott Mill) Metropark( Golf Course)?|Huron Meadows Golf Course)$/i,
    },
    grade: 'red',
    category: 'Metropark – closed to hunting',
    text: 'Huron-Clinton Metroparks allow no public hunting; deer are managed only by staff or contracted culls, with the park closed during culls.',
    confidence: 'medium',
    sources: HCMA_SOURCES,
  }),

  // ---- County land that is open ------------------------------------------------------------
  r({
    id: 'gogebic-county-forest',
    name: 'Gogebic County Forest',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: GOGEBIC, Unit_Nm: ['Local Forest', 'Forest Management'] },
    grade: 'green',
    category: 'County forest – hunting open',
    text: 'part of the ~50,000-acre Gogebic County Forest, managed for multiple use and open to public hunting under state seasons (including the Mosinee grouse walk-in trails). Developed county parks are not included.',
    confidence: 'medium',
    sources: [
      { label: 'Daily Globe – Mosinee GEMS trail open (county forest, public hunting)', url: 'https://yourdailyglobe.com/story/2016/10/22/news/mosinee-grade-gems-trail-open/7414.html' },
      { label: 'American Tree Farm System – Gogebic County Forest', url: 'https://treefarmsystem.org/gogebic-county-forest-celebrates-76-years-of-forest-management' },
      { label: 'Gogebic County Recreation Plan 2023–2027', url: 'https://wuppdr.squarespace.com/s/GoCoRecPlan2023-27_FINAL.pdf' },
    ],
  }),
  r({
    id: 'antrim-natural-areas',
    name: 'Antrim County natural areas',
    // Mohrmann Natural Area is filed as "Mohrmann Park" (manager "Municipal") in PAD-US; Grass River
    // Natural Area is in the conservancy layer.
    layers: ['padus-local', 'padus-ngo'],
    where: { Unit_Nm: ['Mohrmann Park', 'Grass River Natural Area'] },
    grade: 'green',
    category: 'County natural area – hunting open (some restrictions)',
    text: "Antrim County says hunting is allowed, with some restrictions, on most county properties, naming this natural area. Restricted areas are listed in the county's ordinances; check them before going.",
    confidence: 'medium',
    sources: [
      { label: 'Antrim County bulletin – hunting allowed on most county properties', url: 'https://files.constantcontact.com/4a9f3212501/6c73d9fb-76b0-4d35-8663-d8b58f44812b.pdf?rdr=true' },
      { label: 'Antrim County – Mohrmann Natural Area', url: 'https://antrimcounty.org/departments___services_/parks___recreation/natural_areas/mohrmann_natural_area.php' },
    ],
  }),
  r({
    id: 'ottawa-hunting-open',
    name: 'Ottawa County hunting properties (no special permit)',
    layers: PADUS_LOCAL,
    where: {
      Loc_Mang: OTTAWA,
      Unit_Nm: ['Bur Oak Landing', 'Eastmanville Bayou', 'Hiawatha Forest', 'Johnson Street Wildlife Management Area', 'Kuits Bayou', 'Port Sheldon Natural Area', 'Ripps Bayou Site', 'Robinson Forest', 'Van Buren Street Dunes'],
    },
    grade: 'green',
    category: 'County hunting property – open',
    text: 'one of Ottawa County Parks’ hunting properties, open under DNR rules plus county rules: no trapping, no bait, stay 30 yards from property lines (red stakes) and 450 ft from occupied buildings, tree stands and type-1 ground blinds only (labelled), no vehicles off the parking areas.',
    confidence: 'high',
    sources: OTTAWA_SOURCES,
  }),
  r({
    id: 'ottawa-hunting-lottery',
    name: 'Ottawa County lottery hunting properties',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: OTTAWA, Unit_Nm: ['Crockery Creek Site', 'Upper Macatawa Natural Area - East', 'Upper Macatawa Natural Area - West', 'Ottawa Sands County Park'] },
    grade: 'yellow',
    category: 'County park – lottery permit hunts only',
    text: 'hunting only by Ottawa County special permit drawn by lottery: archery deer at Crockery Creek and Upper Macatawa (15 Oct–15 Nov and 1 Dec–1 Jan; Crockery Creek also has a boat-access waterfowl permit), and the Lakeshore firearm deer hunt at Ottawa Sands. No hunting without the permit.',
    confidence: 'high',
    sources: OTTAWA_SOURCES,
  }),
  r({
    id: 'oakland-archery-part',
    name: 'Oakland County archery parks (Addison Oaks, Independence Oaks)',
    layers: PADUS_LOCAL,
    where: { Unit_Nm: ['Addison Oaks County Park', 'Independence Oaks County Park'], Mang_Name: 'CNTY' },
    grade: 'yellow',
    category: 'County park – archery deer only (part of park)',
    text: 'Oakland County Parks allow archery deer hunting only in the East section of Addison Oaks and the North section of Independence Oaks, as shown on the park archery maps (1 Oct–1 Jan; deer only; harvest report within 24 h). The rest of the park is closed. No firearms.',
    confidence: 'high',
    sources: OAKLAND_SOURCES,
  }),
  r({
    id: 'oakland-archery',
    name: 'Oakland County archery parks (Orion Oaks, Rose Oaks)',
    layers: PADUS_LOCAL,
    where: { Unit_Nm: ['Orion Oaks County Park', 'Rose Oaks County Park'], Mang_Name: 'CNTY' },
    grade: 'yellow',
    category: 'County park – archery deer only',
    text: 'archery deer hunting only, in the areas on the park archery map (1 Oct–1 Jan; deer only; harvest report within 24 h). No firearms.',
    confidence: 'high',
    sources: OAKLAND_SOURCES,
  }),
  r({
    id: 'kent-bow-permit',
    name: 'Kent County bow-permit parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: KENT, Unit_Nm: ['Cooper Creek Park', 'Spencer Forest', 'Long Lake Park', 'Donald Lamoreaux Park'] },
    grade: 'yellow',
    category: 'County park – bow hunting by county permit',
    text: 'bow hunting for deer and turkey only, by Kent County permit (about 40 a year, drawn from applications due around Labor Day); deer only in the state archery season. No hunting without the permit; no firearms.',
    confidence: 'high',
    sources: KENT_SOURCES,
  }),
  r({
    id: 'cass-russ-forest',
    name: 'Fred Russ Forest Park (Cass County)',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'Cass County Parks Department', Unit_Nm: 'Russ Forest Park' },
    grade: 'yellow',
    category: 'County park – bow hunting with sign-in',
    text: "bow hunting during deer season only, with daily sign-in and sign-out at the forest office kiosk and only in the areas on the posted maps (the hunting areas may be MSU's surrounding research forest).",
    confidence: 'medium',
    sources: [
      { label: 'MSU Fred Russ Forest – Visitor information', url: 'https://www.canr.msu.edu/fredruss/fredruss_visitor_information' },
      { label: 'Cass County – Fred Russ Forest Park', url: 'https://casscountymi.org/1397/Fred-Russ-Forest-Park' },
    ],
  }),
  r({
    id: 'midland-pine-haven',
    name: 'Pine Haven Recreation Area (Midland County)',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'County of Midland', Unit_Nm: 'Pine Haven Recreational Area' },
    grade: 'yellow',
    category: 'County-managed state land – reported open',
    text: 'state-owned land managed by Midland County, reported (by a tourism listing only) to be open to hunting under state rules. Confirm with Midland County Parks before hunting.',
    confidence: 'low',
    sources: [
      { label: 'Go Great Lakes Bay – Pine Haven Recreational Area', url: 'https://www.gogreat.com/directory/pine-haven-recreational-area/' },
      { label: 'Midland County Parks and Recreation', url: 'https://midlandcountymi.gov/parks-and-recreation' },
    ],
  }),
  r({
    id: 'genesee-managed-archery',
    name: 'Genesee Recreation Area (E.A. Cummings Center managed hunt)',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'County of Genesee', Unit_Nm: 'Genessee Recreation Area' },
    grade: 'yellow',
    category: 'County park – managed lottery hunt only',
    text: 'Genesee County Parks run a lottery-based managed archery deer hunt in the E.A. Cummings Event Center area (early November; in-person registration and drawing). Park rules otherwise prohibit hunting and firearms. Which part of this mapped area the hunt covers is not confirmed.',
    confidence: 'low',
    sources: [
      { label: 'Genesee County Parks – Hunting', url: 'https://geneseecountyparks.org/hunting/' },
      { label: 'Genesee County Parks hunting rules', url: 'https://geneseecountyparks.org/wp-content/uploads/2023/04/HUNTING-rules.pdf' },
    ],
  }),
  r({
    id: 'washtenaw-sharon-mills',
    name: 'Sharon Mills Preserve (Washtenaw County)',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'Washtenaw County Parks & Recreation Commission', Unit_Nm: 'Sharon Mills Preserve' },
    grade: 'yellow',
    category: 'County preserve – workshop hunt only',
    text: "Washtenaw County generally bars public hunting on its parks and preserves; the exception here is the DNR's Beyond BOW archery deer hunt workshop (1–4 October 2026), by registration only.",
    confidence: 'medium',
    sources: [
      { label: 'DNR – Beyond BOW archery deer hunt in Washtenaw County', url: 'https://content.govdelivery.com/accounts/MIDNR/bulletins/3690811' },
      { label: 'DNR calendar – Beyond BOW archery deer hunt workshop', url: 'https://www.michigan.gov/dnr/things-to-do/calendar/2026/10/01/beyond-bow-archery-deer-hunt-workshop' },
    ],
  }),

  // ---- Park systems that are closed (after the open/permit rules above) --------------------
  r({
    id: 'kent-parks-closed',
    name: 'Kent County parks not on the bow-hunting list',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: KENT },
    not: NOT_A_PARK,
    grade: 'red',
    category: 'County park – closed to hunting',
    text: 'Kent County allows hunting only by bow permit at Cooper Creek Park / Spencer Forest, Long Lake Park and Donald J. Lamoreaux Park; all other Kent County parks are closed to hunting.',
    confidence: 'high',
    sources: KENT_SOURCES,
  }),
  r({
    id: 'oakland-parks-closed',
    name: 'Oakland County parks not on the archery list',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: OAKLAND },
    not: NOT_A_PARK,
    grade: 'red',
    category: 'County park – closed to hunting',
    text: 'Oakland County Parks allow archery deer hunting only in parts of six parks (Addison Oaks-East, Highland Oaks, Independence Oaks-North, Lyon Oaks outside the golf course, Orion Oaks and Rose Oaks); other county parks and the golf courses are closed to hunting.',
    confidence: 'high',
    sources: OAKLAND_SOURCES,
  }),
  r({
    id: 'wayne-parks-closed',
    name: 'Wayne County parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: WAYNE, Mang_Name: 'CNTY' },
    not: NOT_A_PARK,
    grade: 'red',
    category: 'County park – closed to hunting',
    text: "Wayne County Parks have no hunting program (Crosswinds Marsh: 'No hunting!').",
    confidence: 'medium',
    sources: [
      { label: 'Wayne County – Crosswinds Marsh', url: 'https://www.waynecountymi.gov/Parks-Recreation/Explore/Crosswinds-Marsh' },
      { label: '2026 Wayne County Parks brochure', url: 'https://www.waynecountymi.gov/files/assets/mainsite/v/1/community-events-amp-recreation/documents/2026-wayne-county-parks-brochure.pdf' },
    ],
  }),
  r({
    id: 'ionia-parks-closed',
    name: 'Ionia County parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: IONIA },
    not: NOT_A_PARK,
    grade: 'red',
    category: 'County park – closed to hunting',
    text: "Ionia County park rules: 'NO hunting is allowed within this park at any time.'",
    confidence: 'high',
    sources: [{ label: 'Ionia County – Bertha Brock Park Rules 2026', url: 'https://ioniacounty.org/wp-content/uploads/2026/02/Bertha-Brock-Park-Rules-2026.pdf' }],
  }),
  r({
    id: 'bay-parks-closed',
    name: 'Bay County parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: BAY },
    not: NOT_A_PARK,
    grade: 'red',
    category: 'County park – closed to hunting',
    text: 'Bay County parks allow no hunting on park property (Pinconning County Park rules); waterfowl hunters may cross Pinconning Park to reach Saginaw Bay.',
    confidence: 'medium',
    sources: [
      { label: 'Bay County – Pinconning Park FAQ', url: 'https://www.baycountymi.gov/recreation/pinconning_park/faq_frequently_asked_questions.php' },
      { label: 'Bay County – Pinconning Park rules and regulations', url: 'https://baycountymi.gov/recreation/pinconning_park/rules_and_regulations.php' },
    ],
  }),
];

/** Layers that carry at least one researched rule. */
export const RESEARCHED_LAYER_IDS: ReadonlySet<string> = new Set(PARK_RULES.flatMap((x) => x.layers));

function text(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function test(t: FieldTest, v: unknown): boolean {
  const s = text(v);
  if (t instanceof RegExp) return t.test(s);
  const want = typeof t === 'string' ? [t] : t;
  const low = s.toLowerCase();
  return want.some((w) => w.toLowerCase() === low);
}

export function ruleMatches(rule: ParkRule, layerId: string, p: Record<string, unknown>): boolean {
  if (!rule.layers.includes(layerId)) return false;
  for (const k in rule.where) if (!test(rule.where[k], p[k])) return false;
  if (rule.not) for (const k in rule.not) if (test(rule.not[k], p[k])) return false;
  return true;
}

/** The first researched rule for this feature, if any. */
export function findParkRule(layerId: string, p: Record<string, unknown>): ParkRule | undefined {
  if (!RESEARCHED_LAYER_IDS.has(layerId)) return undefined;
  return PARK_RULES.find((x) => ruleMatches(x, layerId, p));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Researched rule (Nov 2026, medium confidence)". */
export function researchedLabel(r: { confidence: string; date: string }): string {
  const [y, m] = r.date.split('-');
  const when = MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : r.date;
  return `Researched rule (${when}, ${r.confidence} confidence)`;
}

/** The researched verdict for a feature: replaces the layer's own grade. */
export function applyParkRule(rule: ParkRule, base: GradeResult, unitName: string): GradeResult {
  const name = unitName || rule.name;
  const layer = rule.keepLayerReason && base.reason ? ` Map record: ${base.reason}` : '';
  const reason = `${name}: ${rule.text}${layer} Researched ${rule.researched} from the sources below — rules change; confirm before hunting.`;
  const seen = new Set<string>();
  const references: NonNullable<GradeResult['references']> = [];
  for (const ref of [...rule.sources, ...(base.references ?? [])]) {
    if (seen.has(ref.label)) continue;
    seen.add(ref.label);
    references.push(ref);
  }
  return {
    grade: rule.grade,
    category: rule.category,
    reason,
    references,
    researched: { confidence: rule.confidence, date: rule.researched, rule: rule.id },
  };
}
