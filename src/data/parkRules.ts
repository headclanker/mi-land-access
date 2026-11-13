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
const NOT_A_PARK: Record<string, FieldTest> = { Des_Tp: ['LRMA', 'LOTH'], Unit_Nm: /fairground|^local forest$|^land$|gravel pit|soil cons|conservation district/i };

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
    category: 'National wildlife refuge – hunting open',
    text: 'boat-access island open to hunting on Michigan state seasons and species (no night hunting). One portable stand or blind per hunter, labelled with the license number.',
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
    text: 'open to hunting for all game on state seasons, except no hunting from 1 May to 15 August (warbler breeding season; this also cuts off spring turkey after 1 May). No trapping; no baiting.',
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
    category: 'National wildlife refuge – open units, deer by lottery',
    text: 'partly open. Deer hunting is by DNR reserved-hunt lottery only (DMU 273). Turkey, small game and furbearers are open on state seasons in Units A and C, and migratory birds on set days in Unit A. Other units are closed; check the refuge hunt map before going.',
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
    category: 'National wildlife refuge – designated units open',
    text: 'partly open, unit by unit. Open on state seasons for the species listed in the refuge brochure: Humbug open water, Humbug, Calf and Sugar islands, Strong unit north, Fix, Plum Creek, North Maumee Bay and the Brancheau coastal wetlands. Permit only: Humbug mainland deer and the Brancheau diked-unit waterfowl hunts. Strong unit south is closed. No access from private property.',
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
    category: 'Military training area – open except when closed for training',
    text: 'most of the training area is state land open to public hunting under state rules, but the cantonment, impact and live-fire ranges are closed and any area gated for training is closed while gated. In 2026 about 21,600 acres (the Range 30 Complex and adjoining land) are closed 7–22 November, overlapping the firearm deer season. Check current closures before going.',
    confidence: 'medium',
    sources: [
      { label: 'MUCC – what the DNR/Guard Camp Grayling agreement means', url: 'https://www.mucc.org/what-does-the-dnr-and-national-guards-camp-grayling-agreement-really-mean' },
      { label: 'DNR Camp Grayling proposal FAQ', url: 'https://content.govdelivery.com/attachments/MIDNR/2022/06/09/file_attachments/2181063/CG-proposal-FAQ.pdf' },
      { label: 'Michigan Public – Camp Grayling temporary closure, Nov 7–22, 2026', url: 'https://www.michiganpublic.org/environment-climate-change/2026-10-27/camp-grayling-to-test-combat-drones-towns-hunters-fear-impact-on-area' },
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
    id: 'keweenaw-nhp',
    name: 'Keweenaw National Historical Park',
    layers: PADUS_FED,
    where: { Unit_Nm: 'Keweenaw National Historical Park' },
    grade: 'red',
    category: 'National historical park – no hunting',
    text: 'hunting is prohibited in National Park Service units unless a federal law specifically authorises it (36 CFR 2.2); none was found for this park and its compendium has no hunting provision.',
    confidence: 'low',
    sources: [
      { label: 'Keweenaw NHP – Superintendent’s Compendium', url: 'https://www.nps.gov/kewe/learn/management/superintendent-s-compendium.htm' },
      { label: '36 CFR 2.2 – Wildlife protection', url: 'https://www.ecfr.gov/current/title-36/chapter-I/part-2/section-2.2' },
    ],
  }),
  r({
    id: 'north-country-trail-nps',
    name: 'North Country National Scenic Trail (NPS-owned parcel)',
    layers: PADUS_FED,
    where: { Unit_Nm: 'North Country National Scenic Trail' },
    grade: 'red',
    category: 'National Park Service parcel – no hunting',
    text: "the NPS-owned trail property is closed: 'The property is closed to hunting and trapping' (Superintendent’s Compendium, December 2025). Trail segments crossing other public land follow that land's rules.",
    confidence: 'high',
    sources: [{ label: 'North Country NST – Superintendent’s Compendium', url: 'https://www.nps.gov/noco/learn/management/superintendent-s-compendium.htm' }],
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
    id: 'ottawa-hunting-open-county',
    name: 'Ottawa County hunting properties (no special permit) – Grand River open spaces',
    layers: PADUS_LOCAL,
    // PAD-US lists these three Ottawa County properties under the bare manager name "County".
    where: { Loc_Mang: 'County', Unit_Nm: ['Grand River Open Space', 'Marne Bog', 'Bend Area Open Space'] },
    grade: 'green',
    category: 'County hunting property – open',
    text: 'one of Ottawa County Parks’ hunting properties, open under DNR rules plus county rules: no trapping, no bait, stay 30 yards from property lines (red stakes) and 450 ft from occupied buildings, no vehicles off the parking areas.',
    confidence: 'medium',
    sources: OTTAWA_SOURCES,
  }),
  r({
    id: 'ottawa-parks-closed',
    name: 'Ottawa County parks closed to hunting',
    layers: PADUS_LOCAL,
    where: {
      Loc_Mang: OTTAWA,
      Unit_Nm: /^(Adams Street Landing|Deer Creek Park|Connor Bayou|Grand River Park|Grose Park|Hemlock Crossing|Historic Ottawa Beach Parks.*|Kirk Park.*|North Beach Park|Paw Paw Park (East|West)|Pine Bend|Riverside Park|Pigeon Creek County Park|Riley Trails|Rosy Mound Natural Area|Tunnel Park)$/i,
    },
    grade: 'red',
    category: 'County park – closed to hunting',
    text: 'Ottawa County lists this park as closed to hunting; hunting is allowed only on the county’s designated hunting properties.',
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
    where: { Loc_Mang: KENT, Unit_Nm: ['Cooper Creek Park', 'Spencer Forest', 'Long Lake Park', 'Donald Lamoreaux Park', 'Lowell Regional Park', 'Thornapple Riverbend Park'] },
    grade: 'yellow',
    category: 'County park – bow hunting by county permit',
    text: 'bow hunting for deer and turkey only, by Kent County lottery permit ($25 if drawn; the lottery opens in early September). The 2026 program covers Cooper Creek Park / Spencer Forest (458 ac), Lowell Regional Greenspace (about 330 ac of the park), Long Lake Park, Donald J. Lamoreaux Park, Thornapple Riverbend Greenspace and Two Rivers Greenspace, with a set number of hunters per park. No hunting without the permit; no firearms.',
    confidence: 'medium',
    sources: KENT_SOURCES,
  }),
  r({
    id: 'cass-russ-forest',
    name: 'Fred Russ Forest Park (Cass County)',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'Cass County Parks Department', Unit_Nm: 'Russ Forest Park' },
    grade: 'yellow',
    category: 'Permit archery hunts only (MSU forest)',
    text: "the county park itself has no hunting rule; hunting here is on MSU's Fred Russ research forest and only with an MSU permit: archery only, no firearms, $55 per hunter, applications 1 May–15 June.",
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
  r({
    id: 'alpena-parks-closed',
    name: 'Alpena County parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: ['Alpena County Parks', 'County of Alpena'] },
    not: NOT_A_PARK,
    grade: 'red',
    category: 'County park – closed to hunting',
    text: "Alpena County Parks Ordinance: 'No person, while on County Park property, shall remove, hunt, trap, wound, kill, molest, or in any other way harm any living thing, unless prior written permission is obtained from the County.'",
    confidence: 'high',
    sources: [{ label: 'Alpena County Parks Ordinance (adopted Oct. 14, 2025; amended Dec. 17, 2025)', url: 'https://alpenacounty.org/583/Alpena-County-Parks-Ordinance-PDF' }],
  }),
  r({
    id: 'calhoun-parks-closed',
    name: 'Calhoun County parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'County of Calhoun' },
    not: NOT_A_PARK,
    grade: 'red',
    category: 'County park – closed to hunting',
    text: "Calhoun County park rules: 'No person shall hunt, trap, catch, wound, kill … any bird or animal … in or upon any park.'",
    confidence: 'high',
    sources: [{ label: 'Calhoun County Parks – Rules and Regulations', url: 'https://www.calhouncountymi.gov/Parks/CCParksRules.pdf' }],
  }),
  r({
    id: 'gratiot-parks-closed',
    name: 'Gratiot County parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'County of Gratiot', Des_Tp: 'LP' },
    grade: 'red',
    category: 'County park – closed to hunting',
    text: "Gratiot County Parks ordinance #2005-2: 'No person shall hunt, trap, catch, wound or kill … any bird or animal … in or upon Commission property', and no firearms may be brought onto it.",
    confidence: 'high',
    sources: [{ label: 'Gratiot County Parks Rules and Ordinance (#2005-2)', url: 'https://www.gratiotmi.com/DocumentCenter/View/3295/Gratiot-County-Parks-Rules-and-Ordinance-PDF' }],
  }),
  r({
    id: 'eaton-parks-closed',
    name: 'Eaton County parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: ['County of Eaton', 'Eaton County Parks'] },
    not: NOT_A_PARK,
    grade: 'red',
    category: 'County park – closed to hunting',
    text: 'Eaton County’s parks ordinance (amended April 2021) bans hunting and trapping on park property. The one exception is archery hunting by county permit at Crandell Park, which is not mapped here.',
    confidence: 'high',
    sources: [{ label: 'Eaton County Parks – Rules, Regulations & Policy', url: 'https://www.eatoncounty.org/1552/Rules-Regulations-Policy' }],
  }),
  // Third research round: county parks whose own ordinance or park rules ban hunting.
  ...(
    [
      ['huron', 'Huron', ['County of Huron'], "Huron County park rules: 'No hunting on any County Park Property'; firearms, air guns and bows are prohibited except where designated.", 'high', 'Huron County Parks – Park Rules', 'https://huroncountyparks.com/park-rules'],
      ['isabella', 'Isabella', ['County of Isabella'], "Isabella County park ordinance (revised October 2024): 'No person shall hunt, trap, catch, wound, kill … any bird or animal … in or upon Commission property.'", 'high', 'Isabella County Park Rules & Ordinance', 'https://www.isabellacounty.org/wp-content/uploads/2025/02/2025-Ordinance-New-Template-for-Website-12.17.24-approved-ordinance.pdf'],
      ['jackson', 'Jackson', ['County of Jackson', 'Jackson County', 'Jackson County Parks'], 'Jackson County parks ordinance (2018): no hunting or trapping on commission property without the Director’s permission; no designated hunting areas were found.', 'medium', 'Jackson County Parks and Recreation Commission Ordinance', 'https://mijackson.org/DocumentCenter/View/23663/Jackson-County-Park-Ordinance-2018878'],
      ['kalamazoo', 'Kalamazoo', ['County of Kalamazoo', 'Kalamazoo County Parks'], "Kalamazoo County park rules: 'It is unlawful to kill, trap, hunt, pursue, or disturb any bird or animal, except fish, on park grounds.'", 'medium', 'Kalamazoo County park rules', 'https://www.kalcounty.gov/DocumentCenter/View/1093/Dog-Parks-PDF'],
      ['mecosta', 'Mecosta', ['County of Mecosta'], 'Mecosta County Park Commission rules (March 2025) ban hunting on park property. The one exception is the 200-acre White Pine Valley Recreation Area, which is not mapped here.', 'high', 'Mecosta County Park Commission Rules and Regulations', 'https://www.mecostacountyparks.com/uploads/9/2/6/3/92633552/2025_rules_and_regs_-_approved.pdf'],
      ['monroe', 'Monroe', ['County of Monroe'], "Monroe County park rules: 'No fishing or hunting allowed except where clearly designated'; no weapons except by special permit. No designated hunting areas were found.", 'medium', 'Monroe County – Park Rules', 'https://www.co.monroe.mi.us/327/Park-Rules'],
      ['montcalm', 'Montcalm', ['County of Montcalm'], "Montcalm County Parks Ordinance of 2026: 'Hunting and trapping are prohibited unless posted otherwise.' (The copy read was marked draft.)", 'medium', 'Montcalm County Parks Ordinance of 2026', 'https://www.montcalm.us/DocumentCenter/View/5735/Final-BOC---Montcalm-Co-Parks-Ordinance-22326'],
      ['osceola', 'Osceola', ['County of Osceola'], 'Osceola County Parks 2026 rules ban hunting, trapping and any discharge of a firearm or bow in the parks.', 'high', 'Osceola County Parks 2026 Rules and Regulations', 'https://www.osceola-county.org/document_center/Parks/Policy%20-%20Parks%202026%20Rules%20and%20Regs%20(BOC%20approved%205-5-26).pdf'],
      ['oscoda', 'Oscoda', ['Oscoda County'], "Oscoda County Park rules: 'NO HUNTING OR USE OF FIREARMS OR FIREWORKS ARE PERMITTED.'", 'high', 'Oscoda County Park Rules & Regulations 2024', 'https://www.oscodacountymi.com/wp-content/uploads/OCP-RULES-REGULATIONS-2024.pdf'],
      ['otsego', 'Otsego', ['County of Otsego'], 'Otsego County park rules ban the discharge of firearms, bows, air guns and slingshots (campground rules; the other county sites are small day-use facilities).', 'medium', 'Otsego County – Campground Policies/Rules', 'https://www.otsegocountymi.gov/453/Campground-PolicesRules'],
      ['saginaw', 'Saginaw', ['County of Saginaw'], 'Saginaw County park rules ban hunting and trapping on commission property; hunters may only cross the Saginaw Valley Rail Trail unarmed to reach other land.', 'high', 'Saginaw County Park Rules (2025)', 'https://www.saginawcountymi.gov/media/ex2lj5qo/park-rules-draft-2025.pdf'],
      ['shiawassee', 'Shiawassee', ['County of Shiawassee'], "Shiawassee County park rules: 'No person shall hunt, trap, catch, wound, or kill any bird or other animals upon any land or water owned by the County.'", 'high', 'Shiawassee County Park Rules (2023)', 'https://shiawassee.net/wp-content/uploads/2023/10/2023-Park-Rules.pdf'],
    ] as const
  ).map(([id, county, managers, text, confidence, label, url]) =>
    r({
      id: `${id}-parks-closed`,
      name: `${county} County parks`,
      layers: PADUS_LOCAL,
      where: { Loc_Mang: managers },
      not: NOT_A_PARK,
      grade: 'red',
      category: 'County park – closed to hunting',
      text,
      confidence,
      sources: [{ label, url }],
    }),
  ),
  r({
    id: 'newaygo-parks-authorisation',
    name: 'Newaygo County parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: ['County of Newaygo', 'County of Newaygo Parks and Recreation D'] },
    not: NOT_A_PARK,
    grade: 'yellow',
    category: 'County park – hunting only if the commission authorises it',
    text: "Newaygo County parks ordinance #01/2020 (amended 2024): 'No Person shall hunt any animal in or upon any Commission property unless authorized by the Commission.' No authorised areas were found — ask the parks commission first.",
    confidence: 'high',
    sources: [{ label: 'Newaygo County Parks Ordinance #01/2020, amended 2024', url: 'https://www.newaygocountymi.gov/wp-content/uploads/2026/08/Final-Newaygo-County-Parks-Ordinance-2024200502290.2.pdf' }],
  }),
  // Fourth research round (West Michigan, park by park): township, city, county and conservancy rules.
  ...(
    [
      ['cascade-twp', 'Cascade Charter Township parks', ['Cascade Charter Township', 'Cascade Township', 'Township of Cascade'], undefined, "Cascade Township parks ordinance (Ordinance 1 of 2025): 'Hunting shall only be permitted in Cascade Peace Park' — archery only, by township permit lottery. Every other township park is closed to hunting.", 'high', 'Cascade Charter Township – Parks Ordinance', 'https://cascadetwp.com/parks/parks-ordinance/'],
      ['plainfield-twp', 'Plainfield Township parks', ['Township of Plainfield'], undefined, "Plainfield Township's General Offenses Code makes every township park a wildlife sanctuary: no hunting and no discharge of weapons.", 'medium', 'Plainfield Township – Ordinance No. 24, General Offenses Code', 'https://plainfieldtwpmi.com/wp-content/uploads/2018/07/ORDINANCE-NO-24-GENERAL-OFFENSES-CODE.pdf'],
      ['east-grand-rapids', 'East Grand Rapids parks', ['City of East Grand Rapids'], undefined, "East Grand Rapids park rules: 'No hunting or trapping shall occur within a public park or in any waters adjacent thereto unless a permit has been obtained from the Parks & Recreation Director.' No permit program was found.", 'high', 'City of East Grand Rapids – park rules', 'https://eastgrmi.gov/DocumentCenter/View/57'],
      ['grand-rapids', 'Grand Rapids city parks', ['City of Grand Rapids'], undefined, "Grand Rapids city code: 'No person shall hunt or trap or attempt to hunt or trap any animal or bird in any City Park or other area under the jurisdiction of the Parks and Recreation Department.' The city's deer program is bow hunting on private land only.", 'medium', 'Grand Rapids Code of Ordinances, Title III ch. 41 (Parks)', 'https://library.municode.com/mi/grand_rapids/codes/code_of_ordinances?nodeId=TITIII--PARKS_PUBLIC_GROUNDS_CH41PARE_S3.5MOWASTEN'],
      ['kentwood', 'Kentwood city parks', ['City of Kentwood', 'City of Kentwood Parks'], undefined, 'Firearm hunting is prohibited in the City of Kentwood; bow hunting is allowed only on private sites of at least 5 contiguous acres with the owner’s written agreement. No city park is known to qualify.', 'medium', 'City of Kentwood Police – neighbourhood concerns (hunting)', 'https://www.kentwood.us/city_services/city_departments/police/neighborhood_concerns.php'],
      ['holland-charter-twp', 'Holland Charter Township parks', ['Holland Charter Township'], undefined, "Holland Charter Township: 'The hunting, trapping or killing of animals in Holland Charter Township Parks is prohibited.'", 'high', 'Holland Charter Township – Parks', 'https://hct.holland.mi.us/departments/parks'],
      ['port-sheldon-kouw', 'Kouw Park (Port Sheldon Township)', ['Port Sheldon Township'], ['Kouw Park'], 'Port Sheldon Township’s hunting policy (November 2025) lists Kouw Park as closed to both firearm and archery hunting. (The township allows hunting on three other parcels that are not mapped here.)', 'high', 'Port Sheldon Township – Hunting and Target Practice Policy and Map', 'https://www.portsheldontwp.org/wp-content/uploads/2025/11/Hunting-and-Target-Practice-Policy-and-Map-PST-updated.pdf'],
      ['hudsonville', 'Hudsonville city parks', ['City of Hudsonville'], undefined, "Hudsonville park rules: 'Hunting and target practice is prohibited in all city parks.'", 'medium', 'City of Hudsonville – Park & Facility Rental Guidelines 2022', 'https://www.hudsonville.org/media/Parks%20&%20Recreation/Feb%202022/Park%20_%20Facility%20Rental%20Guidelines%202022.pdf'],
      ['ottawa-county-more', 'Ottawa County parks closed to hunting', ['County'], ['Grand River Ravines - North', 'Grand River Ravines - South', 'Hager Park', 'Spring Grove Park'], 'Ottawa County lists this park as closed to hunting; hunting is allowed only on the county’s designated hunting properties.', 'high', 'Ottawa County Parks – Hunting on Parks & Recreation Properties', 'https://miottawa.org/Parks/hunting.htm'],
      ['ottawa-eastmanville-farm', 'Eastmanville Farm (Ottawa County)', ['Municipal'], ['Eastmanville Farm'], 'Ottawa County lists Eastmanville Farm as closed to hunting; hunting is allowed only on the county’s designated hunting properties.', 'high', 'Ottawa County Parks – Hunting on Parks & Recreation Properties', 'https://miottawa.org/Parks/hunting.htm'],
      ['muskegon-county', 'Muskegon County parks', ['Muskegon County Parks', 'County of Muskegon'], undefined, "Muskegon County Parks ordinance (adopted June 2022): 'No person, while on County Park Property, shall remove, hunt, trap, wound, kill, molest, or in any other way harm any living thing, unless prior written permission is obtained.'", 'high', 'Muskegon County Parks Ordinance', 'https://muskegoncountyparks.org/wp-content/uploads/2025/04/ParksOrdinance_Adopted061422-1.pdf'],
      ['laketon-twp', 'Laketon Township parks', ['Township of Laketon'], undefined, "Laketon Township parks ordinance: 'No person may hunt, trap, kill or pursue any wildlife in any Park. Shooting into park areas from beyond the Park Property is prohibited.'", 'high', 'Laketon Township – Parks and Public Property Ordinance', 'https://www.laketontwpmi.gov/wp-content/uploads/2024/03/2013-parks-adn-public-property-ordinance-final.pdf'],
      ['laketon-twp-park', 'Laketon Township Park', ['Township of Laketown'], ['Laketon Township Park'], "Laketon Township parks ordinance: 'No person may hunt, trap, kill or pursue any wildlife in any Park.'", 'high', 'Laketon Township – Parks and Public Property Ordinance', 'https://www.laketontwpmi.gov/wp-content/uploads/2024/03/2013-parks-adn-public-property-ordinance-final.pdf'],
      ['egelston-twp', 'Egelston Township property', ['Township of Egelston'], undefined, "Egelston Township ordinance (effective 4 April 2024): 'It is unlawful for any person to hunt on Township property.'", 'high', 'Egelston Township – ordinance prohibiting hunting on township property', 'https://www.egelstontwp.org/wp-content/uploads/2026/02/Prohibit-Hunting-Eff-April-4-2024.pdf'],
      ['fruitland-twp', 'Fruitland Township parks', ['Township of Fruitland'], undefined, 'Fruitland Township’s park ordinance prohibits hunting, trapping, shooting and archery in Nestrom, Marcus and Duck Lake Road parks.', 'medium', 'Fruitland Township – Park Ordinance (Article R-21)', 'https://fruitlandmi.gov/wp-content/uploads/2021/11/ARTICLE-R-21-NESTROM-PARK-MARCUS-PARK-AND-DUCK-LAKE-ROAD-PARK-ORDINANCE.pdf'],
      ['newaygo-city', 'City of Newaygo parks', ['City of Newaygo'], undefined, "City of Newaygo park rules (Resolution 2024-18): 'No hunting or trapping shall occur within a public park.' Weapons are banned in the parks.", 'high', 'City of Newaygo – Resolution 2024-18, Park Rules', 'https://newaygo.gov/documents/Resolution_2024-18__Park_Rules__Epr6g.pdf'],
      ['allegan-county', 'Allegan County parks', ['County of Allegan'], undefined, 'Allegan County parks are closed to hunting. The county issues resident lottery permits for deer and waterfowl on its County Services Complex only, which is not a mapped park.', 'medium', 'Allegan County – Parks FAQs', 'https://www.allegancounty.org/departments/parks-recreation-and-tourism/parks-faqs'],
    ] as const
  ).map(([id, name, managers, units, text, confidence, label, url]) =>
    r({
      id: `${id}-closed`,
      name,
      layers: PADUS_LOCAL,
      where: units ? { Loc_Mang: managers, Unit_Nm: units } : { Loc_Mang: managers },
      not: NOT_A_PARK,
      grade: 'red',
      category: 'Park – closed to hunting',
      text,
      confidence,
      sources: [{ label, url }],
    }),
  ),
  r({
    id: 'whitehall-funnell-field',
    name: 'Funnell Field (City of Whitehall)',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'City of Whitehall', Unit_Nm: 'Funnell Field' },
    grade: 'yellow',
    category: 'City land – lottery bow hunt only',
    text: 'part of Funnell Field is a designated site in the City of Whitehall’s controlled deer hunt (Ordinance 25-01): bow or crossbow only, by city lottery ($10, background check), 1 October–1 January, elevated stands only. No firearms; no hunting without the city permit.',
    confidence: 'high',
    sources: [{ label: 'City of Whitehall – hunting ordinance with maps and FAQs', url: 'https://cityofwhitehall.org/wp-content/uploads/2026/07/Updated-Hunting-Ord-with-Maps.FAQsa_.pdf' }],
  }),
  r({
    id: 'mna-sanctuaries',
    name: 'Michigan Nature Association sanctuaries',
    layers: ['padus-ngo'],
    where: { Loc_Mang: 'Michigan Nature Association' },
    grade: 'red',
    category: 'Nature sanctuary – no hunting',
    text: "Michigan Nature Association rules: 'Hunting and trapping are not allowed on any MNA sanctuaries', unless by special written agreement with MNA.",
    confidence: 'high',
    sources: [{ label: 'Michigan Nature Association – Sanctuary visitation rules', url: 'https://www.michigannature.org/menus/sanctuary-visitation-rules.html' }],
  }),
  r({
    id: 'lcwm-preserves',
    name: 'Land Conservancy of West Michigan preserves',
    layers: ['padus-ngo'],
    where: { Loc_Mang: 'Land Conservancy of West Michigan' },
    grade: 'red',
    category: 'Nature preserve – no hunting unless posted',
    text: 'Land Conservancy of West Michigan preserve guidelines: no hunting or trapping unless otherwise posted at the preserve.',
    confidence: 'medium',
    sources: [{ label: 'Land Conservancy of West Michigan – Nature preserve guidelines', url: 'https://naturenearby.org/nature-preserve-guidelines/' }],
  }),
  r({
    id: 'swmlc-preserves',
    name: 'Southwest Michigan Land Conservancy preserves',
    layers: ['padus-ngo'],
    where: { Loc_Mang: 'Southwest Michigan Land Conservancy' },
    grade: 'yellow',
    category: 'Nature preserve – hunting by permission only',
    text: "Southwest Michigan Land Conservancy: 'Hunting and/or trapping are not allowed on SWMLC preserves without permission from SWMLC staff.' The conservancy says its hunting slots are currently full, with a waitlist.",
    confidence: 'high',
    sources: [{ label: 'Southwest Michigan Land Conservancy – FAQs', url: 'https://swmlc.org/swmlc-faqs/' }],
  }),
  // Fifth research round (cheap pass over the West Michigan checklist).
  r({
    id: 'howard-city-parks',
    name: 'Village of Howard City parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'City of Howard City' },
    grade: 'red',
    category: 'Village park – no weapon discharge',
    text: "Howard City's village rules: 'The discharge of Bows, Firearms & Pneumatic / Air Guns is a prohibited activity within the Village Limits unless a permit is issued to a landowner.' No hunting is possible in a village park without that permit.",
    confidence: 'medium',
    sources: [{ label: 'Village of Howard City – Bows, Firearms & Air Guns permit (Chapter 134)', url: 'https://www.howardcity.org/_files/ugd/8717e5_036ce88f87c04b69abee9bd3a78d9c4b.pdf' }],
  }),
  r({
    id: 'nashville-parks',
    name: 'Village of Nashville parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'Village of Nashville' },
    grade: 'yellow',
    category: 'Village park – no firearms',
    text: "Nashville's firearms ordinance (No. 11-8-2012) makes it unlawful 'to discharge a firearm … within four hundred fifty (450) feet of a … public park or recreation area', so no firearm hunting here. The ordinance does not mention bows, and no park hunting rule was found — check with the village.",
    confidence: 'high',
    sources: [{ label: 'Village of Nashville – Firearms Ordinance (11-8-2012)', url: 'https://nashvillemi.us/wp-content/uploads/2023/04/8-Firearms-Ordinance-11-8-2012.pdf' }],
  }),
  r({
    id: 'spring-lake-village-parks',
    name: 'Village of Spring Lake parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'Village of Spring Lake' },
    grade: 'yellow',
    category: 'Village park – no firearms',
    text: 'Spring Lake’s village parks ordinance prohibits possessing a firearm of any kind in village parks without written permission, so no firearm hunting. Bow hunting is not addressed in what could be read (search summaries only) — check with the village.',
    confidence: 'low',
    sources: [{ label: 'Village of Spring Lake Code – Parks (via search summary)', url: 'https://ecode360.com/45277249' }],
  }),
  r({
    id: 'wyoming-city-parks',
    name: 'City of Wyoming parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'City of Wyoming' },
    grade: 'red',
    category: 'City park – closed except city deer hunts',
    text: "Wyoming's city code prohibits hunting in the city unless permitted; the only exception is the city's deer-management hunt, bow or crossbow only, with a city-issued pass. No park is named as open to the public.",
    confidence: 'medium',
    sources: [{ label: 'City of Wyoming Code – hunting (via search summary)', url: 'https://ecode360.com/14594225' }],
  }),
  r({
    id: 'ionia-city-parks',
    name: 'City of Ionia parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: ['City of Ionia', 'City of Ionia, MI'] },
    grade: 'red',
    category: 'City park – no weapon discharge',
    text: "City of Ionia code ch. 664.01 bans discharging any firearm, air gun or bow and arrow in the city, with limited exceptions; hunting is possible only on private parcels of 20 acres or more with a permit.",
    confidence: 'medium',
    sources: [{ label: 'City of Ionia Codified Ordinances 664.01 (via search summary)', url: 'https://codelibrary.amlegal.com/codes/ionia/latest/ionia_mi/0-0-0-28603' }],
  }),
  r({
    id: 'douglas-city-parks',
    name: 'City of Douglas parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'City of Douglas' },
    grade: 'red',
    category: 'City park – closed (archery permits on private land only)',
    text: "Douglas: 'ONLY ARCHERY EQUIPMENT is permitted for all hunts in the City of the Village of Douglas. The use of firearms is strictly prohibited in the City limits at all times.' Archery deer hunts are by city permit, mainly on HOA and private land; no city park is listed.",
    confidence: 'medium',
    sources: [
      { label: 'City of the Village of Douglas – Hunting guidelines', url: 'https://www.douglasmi.gov/1325/Hunting-Guidelines' },
      { label: 'Douglas – HOA / private property archery hunting guidelines', url: 'https://www.douglasmi.gov/DocumentCenter/View/595/City-of-the-Village-of-Douglas-HOA-Private-Property-Owner-Archery-Hunting-Guidelines' },
    ],
  }),
  r({
    id: 'montague-city-parks',
    name: 'City of Montague parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'City of Montague' },
    grade: 'red',
    category: 'City park – closed except designated bow-hunt areas',
    text: "Montague code sec. 14-202: 'The City may allow limited and controlled bow (bow / archery / cross-bow) hunting within the boundaries of the City' — only on areas of at least 6 contiguous acres the city council designates each year. No city park is named as designated.",
    confidence: 'high',
    sources: [{ label: 'City of Montague Code, Chapter 14 – Animals', url: 'https://catchmarkcommunity.com/wp-content/uploads/2025/06/Chapter_14_ANIMALS_20241118.pdf' }],
  }),
  r({
    id: 'norton-shores-archery',
    name: 'Norton Shores archery-program parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'City of Norton Shores', Unit_Nm: ['Lake Harbor Park', 'Ross Park', 'Black Lake Park'] },
    grade: 'yellow',
    category: 'City park – volunteer archery deer program only',
    text: "reported to be one of the parks in Norton Shores' managed archery deer program (up to about 25–30 city-selected volunteer hunters; not open to the public). The program is confirmed to run in city parks, but which parks is from a single news summary — confirm with the city.",
    confidence: 'low',
    sources: [
      { label: 'Limited deer hunting in Norton Shores parks part of management plan (news summary)', url: 'https://ground.news/article/limited-deer-hunting-in-norton-shores-parks-part-of-management-plan' },
      { label: 'With 2023 deer harvest down, W. MI cities weigh options', url: 'https://news.yahoo.com/2023-deer-harvest-down-w-193646086.html' },
    ],
  }),
  r({
    id: 'barry-county-parks',
    name: 'Barry County parks (Charlton Park)',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'County of Barry' },
    not: NOT_A_PARK,
    grade: 'red',
    category: 'County park – closed to hunting',
    text: "Barry County Parks & Recreation rules: 'No hunting or shooting is permitted on or across the trails or in parks.'",
    confidence: 'high',
    sources: [{ label: 'Barry County Parks & Recreation – fees and rules', url: 'https://www.barrycounty.org/departments_and_officials/advisory_boards_and_commissions/parks_and_recreation/fees_and_rules.php' }],
  }),
  r({
    id: 'georgetown-twp-parks',
    name: 'Georgetown Charter Township parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: ['GEORGETOWN CHARTER TOWNSHIP', 'Township of Georgetown'] },
    grade: 'red',
    category: 'Township park – closed to hunting',
    text: "Georgetown Township park rules: 'No person shall hunt within the Township park or shall fire, shoot, or prepare to fire or shoot any rifle, gun, pistol, or other firearm, or bow and arrow within the Township park.'",
    confidence: 'medium',
    sources: [{ label: 'Georgetown Charter Township – park pavilion reservation agreement (park rules)', url: 'https://gtwp.com/DocumentCenter/View/7451/Parks-Pavilion-Reservation-Agreement-' }],
  }),
  r({
    id: 'wayland-city-parks',
    name: 'City of Wayland parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'City of Wayland' },
    grade: 'red',
    category: 'City park – closed to hunting',
    text: "Wayland City Park Rules: 'Hunting is not permitted in any City of Wayland Park.'",
    confidence: 'high',
    sources: [{ label: 'City of Wayland – City Park Rules (PDF)', url: 'https://www.cityofwayland.org/wp-content/uploads/New-City-Park-Rules.pdf' }],
  }),
  r({
    id: 'saugatuck-city-parks',
    name: 'City of Saugatuck parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'City of Saugatuck' },
    grade: 'red',
    category: 'City park – closed to hunting',
    text: "Saugatuck regulates hunting in its city code and posts 'No hunting or trapping' at its nature preserve; deer control is by a planned city cull, not public hunting.",
    confidence: 'medium',
    sources: [
      { label: 'City of Saugatuck – Parks & Recreation rules', url: 'https://www.saugatuckcity.com/parks--recreation.html' },
      { label: 'City of Saugatuck – Saugatuck Wilds Nature Preserve', url: 'https://www.saugatuckcity.com/saugatuck-wilds-nature-preserve.html' },
    ],
  }),
  // Seventh round (2026-11-13): ordinance text read in a browser (ecode360) and the bodies' own PDFs.
  r({
    id: 'grand-haven-twp-parks',
    name: 'Grand Haven Charter Township parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'Grand Haven Charter Township' },
    not: NOT_A_PARK,
    grade: 'red',
    category: 'Township park – closed to hunting',
    text: "Grand Haven Township Park Rules and Regulations Ordinance (No. 59, amended 2015): no person shall 'Hunt or trap any animals or birds within any portion of a Township Park or recreation area', and firearms and weapons, bows included, are banned there.",
    confidence: 'high',
    sources: [{ label: 'Grand Haven Charter Township – Park Rules and Regulations Ordinance (Ord. 59)', url: 'https://ghtmi.gov/wp-content/uploads/2026/10/20.0300-Ordinance-59-Park-Rules-Regulations-Ordinance.pdf' }],
  }),
  r({
    id: 'allendale-twp-parks',
    name: 'Allendale Charter Township parks',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'Township of Allendale' },
    not: NOT_A_PARK,
    grade: 'red',
    category: 'Township park – closed to hunting',
    text: "Allendale Township Code § 300-3(D), conduct in Township parks: 'No person shall hunt, trap, catch, wound, kill … or attempt to … any bird or animal.'",
    confidence: 'high',
    sources: [{ label: 'Charter Township of Allendale Code, Ch. 300 Parks and Recreation Areas', url: 'https://ecode360.com/38007559' }],
  }),
  r({
    id: 'port-sheldon-twp-hall',
    name: 'Port Sheldon Township Hall grounds',
    layers: PADUS_LOCAL,
    where: { Loc_Mang: 'Township of Port Sheldon', Unit_Nm: 'Port Sheldon Park' },
    grade: 'yellow',
    category: 'Township land – archery only',
    text: 'Port Sheldon Township’s hunting policy (November 2025) allows archery hunting but not firearm hunting on the Port Sheldon Street parcel (Township Hall, fire station and recreation centre); no target practice. The mapped “Port Sheldon Park” sits on that parcel.',
    confidence: 'medium',
    sources: [{ label: 'Port Sheldon Township – Hunting and Target Practice Policy and Map', url: 'https://www.portsheldontwp.org/wp-content/uploads/2025/11/Hunting-and-Target-Practice-Policy-and-Map-PST-updated.pdf' }],
  }),
  // Owner's decision (2026-11-13): every township, village and city park still open on the West
  // Michigan checklist is presumed closed. No ordinance was read for these, and the text says so.
  // Matched on manager AND park name so generic manager strings cannot reach other parks.
  // Earlier rules win (first match), so any body with a researched rule keeps it.
  ...(
    [
      ['Ada Township', 'Kent', 'township', ['Grand River Nature Area', 'Ada Park', 'Leonard Field', 'Roselle Park']],
      ['LOWELL CHARTER TOWNSHIP PARK', 'Kent', 'township', ['Grand River Riverfront Park']],
      ['Township of Byron Center', 'Kent', 'township', ['Whistlestop Park']],
      ['Township of Cannon', 'Kent', 'township', ['Cannon Township Center Property']],
      ['Byron Township', 'Kent', 'township', ['Cutler Park']],
      ['Alpine Township', 'Kent', 'township', ['Westgate Neighborhood Park']],
      ['Sparta Township', 'Kent', 'township', ['Bettes Memorial Park']],
      ['Township of Grattan', 'Kent', 'township', ['Grattan Township Roadside Park']],
      ['Village of Sparta', 'Kent', 'village', ['Balyeat Field', 'Lamoreaux Park', 'Library Memorial Park', 'Nash Park', 'Rogers Park', 'Spartan Park', 'Buth Field']],
      ['Village of Sand Lake', 'Kent', 'village', ['Salisbury Park']],
      ['City of Lowell', 'Kent', 'city', ['Richards Park', 'Creekside Park', 'Recreation Park', 'Stoney Lakeside Park', 'Mcmahon Park', 'Rogers Field', 'Upper Bridge Property']],
      ['City of Walker', 'Kent', 'city', ['City Central Park', 'Harmon Field', 'Walker Community Park']],
      ['City of Grandville', 'Kent', 'city', ['Calvin Crest Park', 'Heritage Park', 'Lee St Park', 'Mill Race Park', 'Peck St Park', 'Grandville Little League Complex']],
      ['City of Rockford', 'Kent', 'city', ['Glen Park', 'Heritage Parkland', 'Heritage Parkland And Nature Trail', 'Rotary Park']],
      ['City of Cedar Springs', 'Kent', 'city', ['Riggle Park', 'Veterans Memorial Park']],
      ['Park Township', 'Ottawa', 'township', ['Chief Waukazoo Park', 'Cooper-Vanwieren Park', 'Fair Grounds/Park Township Community Center', 'Ransom Street Park', 'Stu Visser Trails', 'Virginia Park/Maatman Center', 'Wendt Park', 'Winstrom Park/Preserve']],
      ['Polkton Township', 'Ottawa', 'township', ['Sheridan Park']],
      ['Township of Spring Lake', 'Ottawa', 'township', ['Rycenga Park']],
      ['TALLMADGE TWP', 'Ottawa', 'township', ['Tallmadge Township Park']],
      ['Township', 'Ottawa', 'township', ['Port Sheldon Sports Complex']],
      ['Township of Spring Lake Parks', 'Ottawa', 'township', ['Rycenga Recreation Park']],
      ['Township of Holland', 'Ottawa', 'township', ['Roadside Park']],
      ['Spring Lake Township', 'Ottawa', 'township', ['River Run Park']],
      ['Grand Haven', 'Ottawa', 'city', ['Bicentennial Park', 'Bolt Park', 'Central Park', 'Chinook Pier Park', 'Duncan Woods', 'East Grand River Park', 'Escanaba Park', 'Harbor Island', 'Harbor Island Linear Park', 'Hatton Park', 'Johnston Park', 'Klaver Park', 'Klempel Park', 'Lighthouse Connector Park', "Mulligan'S Hollow", 'Rix Robinson Park', 'Sluka Field', "Veteran'S Memorial Park", 'Willow Park']],
      ['City of Holland', 'Ottawa', 'city', ['Morton Park', 'Albert C. Keppel Forest Preserve', 'Degraaf Nature Center', 'Centennial Park', 'Holland Heights Park', 'Kollen Park', 'Lakeview Park', 'Moran Park', 'Prospect Park', 'Riverview Park', 'Van Bragt Park', 'Van Raalte Farm Park', 'Matt Urban Sports Complex']],
      ['City of HOlland', 'Ottawa', 'city', ['Smallenburg Park']],
      ['City of Ferrysburg', 'Ottawa', 'city', ['Ferrysburg Nature Preserve', 'Ferry Park', 'Fire Barn Park', 'Mike Herman Memorial Field']],
      ['City of Zeeland', 'Ottawa', 'city', ['Hoogland Park', 'Huizenga Park', 'Lawrence Street Park', 'Michigan Street Tot Lot', 'Paw Paw Drive Park', 'Three Corner Park']],
      ['City of Grand Haven', 'Ottawa', 'city', ['Adams Street Park', 'East Grand River Park', 'Rix Robinson Park', 'Bi-Centennial Park', 'Hatton Park', 'Grand Haven City Beach']],
      ['City of Coopersville', 'Ottawa', 'city', ['Coopersville Sports Complex', 'Dda Pavillion', 'Grove St Park/ Main St Park']],
      ['City of Hoilland', 'Ottawa', 'city', ['College Avenue Park']],
      ['City of Belding', 'Ionia', 'city', ['Central Riverside Park', 'East Riverside Park', 'Water Street Park', 'Demorest Field', 'Lightning Bend Park']],
      ['City of Portland', 'Ionia', 'city', ['Alton Park', 'Bogue Flats Recreation Area', 'Brush Street School Park', 'Community Lake', 'Joe Tichvon Park', 'Powers Park', 'Riverfront Park', 'Scout Park', 'Thompson Park']],
      ['Township of Orangeville', 'Barry', 'township', ['Orangeville Township Park']],
      ['Township of Prairieville', 'Barry', 'township', ['Gull Lake Park', 'Lower Crooked Lake Park', 'Pine Lake Park', 'Prairieville Recreation Area']],
      ['Village of Middleville', 'Barry', 'village', ['Calvin Hill Park', 'Lions Sesquicentennial Park', 'Spring Park', 'Stage Coach Park', 'The Crane Road Ball Fields', 'Wildwood Trails Park']],
      ['Village of Freeport', 'Barry', 'village', ['Moore Park']],
      ['Village of Woodland', 'Barry', 'village', ['Classic Memorial Park']],
      ['CITY OF HASTINGS', 'Barry', 'city', ['Bob King', 'Dog Park', 'First Ward Park', 'Fish Hatchery Park', 'Second Ward Park', 'Tyden Park']],
      ['City of Middleville', 'Barry', 'city', ['Rivercide Park']],
      ['Fillmore Township', 'Allegan', 'township', ['Cottonwood Park']],
      ['SAUGATUCK TOWNSHIP', 'Allegan', 'township', ['River Bluff Park']],
      ['City of Allegan', 'Allegan', 'city', ['Hanson Park', 'Jaycee Park', 'Mahan Park', 'Rossman Esplanade Park', 'Allegan Sports Complex', 'Cook Street Park', 'Sue Lange Memorial Park', 'Water Street Riverfront Park']],
      ['City of Plainwell', 'Allegan', 'city', ['Bandshell Park', 'Darrow Park', 'Fannie Pell Park', 'Hicks Park', 'Kenyon Park', 'Sherwood Park', 'Thurl Cook Park']],
      ['City of Otsego', 'Allegan', 'city', ['Brookside Park', 'Memorial Park', 'North Side Park', 'Unknown Park']],
      ['City of Holland', 'Allegan', 'city', ['Maplewood Recreation Area', 'Matt Urban Sports Complex']],
      ['Township of Fruitport', 'Muskegon', 'township', ['South Fruitport Township Park', 'Farr Park', 'Prine Park']],
      ['Township of Muskegon', 'Muskegon', 'township', ['Parslow Park', 'Riverside Park']],
      ['WHITEHALL TOWNSHIP', 'Muskegon', 'township', ['Durham Road Playground']],
      ['Township of Dalton', 'Muskegon', 'township', ['Browns Field Park', 'Padley Park']],
      ['Muskegon Charter Township', 'Muskegon', 'township', ['Buel Avenue Park']],
      ['Village of Fruitport', 'Muskegon', 'village', ['Pomona Park']],
      ['City of Muskegon', 'Muskegon', 'city', ['Beukema Playfield', "Fisherman's Landing", 'Lake Michigan Park', 'Richards Park', 'Kruse Park', 'Aamodt Park', 'Beachwood Park', 'Campbell Playground', 'Green Acres Park', 'Hackley Park', 'Heritage Landing Park', 'Margaret Drake Elliot Park', 'Mccrea Playground', 'Mcgraft Park', 'Reese Playground', 'Seyferth Playground', 'Sheldon Park', 'Smith Playground', 'Marsh Field', "Veterans' Memorial Park", 'Veterans Memorial Park']],
      ['City of Muskegon Heights', 'Muskegon', 'city', ['Johnny Harris Park', 'Mona Lake Park', 'Rowan City Park', 'West Heights Park', 'Harris Nature Park']],
      ['City of North Muskegon', 'Muskegon', 'city', ['Bear Lake Beach Park', 'Custer Park', 'East End Park', 'Walker Park', 'West End Park', 'Park', 'Waterfront Sports Park']],
      ['City of Roosevelt Park', 'Muskegon', 'city', ['City Park', 'Unknown Park', 'Wells Park', 'Davies Park', 'Lambert Park']],
      ['Township of Reynolds', 'Montcalm', 'township', ['Park', 'Township of Reynolds Park']],
      ['Township of Montcalm', 'Montcalm', 'township', ['Township Land']],
      ['Township of Crystal', 'Montcalm', 'township', ['Park']],
      ['City of Greenville', 'Montcalm', 'city', ['Greenville City Land', 'Baldwin Lake Beach', 'City of Greenville Park', 'Pearl Street Park', 'Alan G Davis Park', 'Franklin Street Park', 'Hawthorne Park', 'Jacksons Landing Park', 'Tower Park', 'Veterans Memorial Park']],
      ['City of Stanton', 'Montcalm', 'city', ['City of Stanton Park']],
      ['City of Carson City', 'Montcalm', 'city', ['City of Carson City Park']],
      ['Township of Croton', 'Newaygo', 'township', ['Croton Township Park']],
      ['Township of Sheridan', 'Newaygo', 'township', ['Sheridan Park']],
      ['Township of Ensley', 'Newaygo', 'township', ['Baptist Lake Township Park']],
      ['City of Fremont', 'Newaygo', 'city', ['Arboretum Park', 'Branstrom Park', 'Fremont Lake Park', 'Unknown Park', 'Unknown Parl', 'Veterans Memorial Park']],
      ['City of White Cloud', 'Newaygo', 'city', ['City Park']],
      ['City of Grant', 'Newaygo', 'city', ['Blanch Lake City Park']],
    ] as const
  ).map(([manager, county, kind, units]) =>
    r({
      // First park name too: PAD-US has "City of Holland" and "City of HOlland" as separate managers.
      id: `presumed-closed-${county}-${manager}-${units[0]}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, ''),
      name: `${manager} parks (${county} County)`,
      layers: PADUS_LOCAL,
      where: { Loc_Mang: manager, Unit_Nm: units },
      not: NOT_A_PARK,
      grade: 'red',
      category: `${kind[0].toUpperCase()}${kind.slice(1)} park – presumed closed`,
      text: `Presumed closed to hunting. This ${kind}'s own park or firearms rule has not been read (its code is on a site that refuses automated access, or is not online), and most ${kind} parks in West Michigan ban hunting. Ask the ${kind} before hunting here.`,
      confidence: 'low',
      sources: [{ label: 'West Michigan checklist of bodies not yet checked', url: 'https://github.com/headclanker/mi-land-access/blob/main/docs/research/west-michigan/CHECKLIST.md' }],
    }),
  ),
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
