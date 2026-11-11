# MI Land Access – data sources and grading rules

All layers live in `src/data/sources.ts` (`LAYER_SOURCES`, 67 layers). Every URL and every
field name in that file was checked live in November 2026: layer metadata (`?f=json`) plus a
`/query?where=…&outFields=<the catalog's fields>&resultRecordCount=1&f=geojson` request. All
67 returned features with every requested field present. Every layer advertises
`supportedQueryFormats: JSON, geoJSON, PBF`, so `f=geojson` works everywhere and no format
hint was needed. The contract has since gained `LayerSource.role`, `LayerSource.lowConfidence`
and `GradeResult.ownerKind` for reconciliation (section 5a).

Bounding-box queries (`geometry=<xmin,ymin,xmax,ymax>&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326`)
were spot-checked on the USFS and parcel services. Most services cap a response at 1,000 or
2,000 records, so the app should page with `resultOffset` or rely on `minZoom`.

Grading is in `src/grading/grade.ts` (`gradeFeature`). Grades are a screening aid, not legal
advice. Every result includes a reason that says what to verify.

---

## 1. Public land (11 layers)

| id | What | URL | Key fields / grading | Caveats |
|---|---|---|---|---|
| `dnr-managed-lands` | **Role: ownership.** Active DNR-managed state land (state forest, game areas, trails, access sites) from the Land Ownership Tracking System (LOTS). State park and recreation-area rows are excluded (`ProjectUseType NOT IN ('State Park','Recreational Areas')`) because `dnr-park-hunting` covers the same ground with the DNR's per-zone status (307,155 vs 307,217 acres statewide) | `services3.arcgis.com/Jdnp1TjADvSDxMAX/…/DNRLOTSParcelsOPENDATA/FeatureServer/2` | `ProjectUseType` (Forests, Wildlife Game Areas, RAIL TRAILS, …), `DivisionDepartment`, `ProjectName`. Forests / Wildlife Game Areas → green; trails, access sites, hatcheries → yellow | About 124k polygons after the park filter (136k before), so `minZoom` is 9. Mineral-only state parcels are **not** in this layer (checked), so the polygons are surface ownership. Checked live in Nov 2026: the new `where` returns features, and park land at 42.618,-85.499 (Yankee Springs) and 42.94,-85.13 (Ionia RA) is still covered by `dnr-park-hunting`. |
| `dnr-wildlife-areas` | **Role: boundary.** State game areas, wildlife management areas, GEMS, research areas | `…/DNRWILDLandsOPENDATA/FeatureServer/2` | `AreaType`, `OfficialWLDProjectAreaName`. Never graded: drawn as a dashed, labelled outline and reported as "Inside the boundary of …" | These are administrative project boundaries, not ownership: the Nov 2026 audit found 192 private parcels fully inside its former green fill and 71 inside its yellow fill (Allegan SGA, Barry SGA…). |
| `dnr-hap` | **Role: access-program.** Hunting Access Program leased private land | `…/DNRWILDLandsOPENDATA/FeatureServer/0` (where `ActiveOrInactive='Active'`) | `HuntType`, `HAPInfo`, `SpecialComment`. "Open to All Hunt Types." → green; restricted types (youth only, deer only, archery only…) → yellow, with the restriction in the reason; inactive → red | 114 of 378 records are active. The layer also contains inactive properties, which the `where` clause filters out. |
| `dnr-park-hunting` | **Role: access-program (highest precedence).** State park and rec area hunting/trapping zones | `…/DNRBoundariesParksHuntableLandsOPENDATA/FeatureServer/2` | `HuntTrap` = Open / Open-Restricted / Closed → green / yellow / red; `HuntTrapRestrictions`, `EarlyGoose*`, `Comments` go into the reason | DNR's own comment notes that 450-ft safety zones around buildings are not shown. |
| `dnr-state-parks` | **Role: boundary.** State park boundaries (off by default) | `…/State_Parks/FeatureServer/2` | Never graded: dashed, labelled outline | Use `dnr-park-hunting` for the actual open or closed status. |
| `commercial-forest` | **Role: access-program.** Commercial Forest Act (CFA) enrolled parcels, with owner | `…/CommercialForestParcels_View/FeatureServer/0` | `ParcelStatusText` Active → green; under listing / withdrawal / split → yellow. `FullLegalName`, `OwnerTypeText` | Public access is foot access for hunting, fishing and trapping only. |
| `usfs-surface-ownership` | **Role: ownership.** National forest land the USFS actually owns (Huron-Manistee, Hiawatha, Ottawa); private inholdings are excluded | `apps.fs.usda.gov/arcx/rest/services/EDW/EDW_SurfaceOwnership_01/MapServer/0` (where `ownerclassification='USDA FOREST SERVICE' AND region='09'`) | Green | Tract-level polygons from the Land Status Record System. `EDW_BasicOwnership_01` was rejected because it returns one huge multipolygon per forest. |
| `padus-federal-other` | **Role: ownership, low confidence.** Federal fee land other than USFS (FWS refuges and WPAs, NPS lakeshores and parks, BLM, …) | `services.arcgis.com/v01gqwM5QqNysAAi/…/Fee_Managers_PADUS/FeatureServer/0` (MI, Fee, `Mang_Type='FED'`, not USFS) | `Mang_Name`, `Des_Tp`, `Pub_Access`. FWS → yellow; NPS lakeshore (`NLS`) → yellow; national park (`NP`, i.e. Isle Royale) → red; `Pub_Access='XA'` → red | PAD-US 4.1 is a national compilation, so boundaries can lag. |
| `padus-state-other` | **Role: ownership, low confidence.** State land not managed by the DNR (`OTHS`, `SDOL`) | same, `Mang_Type='STAT' AND Mang_Name IN ('OTHS','SDOL')` | Yellow | Off by default. |
| `padus-local` | **Role: ownership, low confidence.** County, city, township and regional parks and open space | same, `Mang_Type IN ('LOC','DIST','JNT')` | Yellow (red if `Pub_Access='XA'`) | PAD-US codes townships as `CITY`. This is the only statewide local-government land layer that could be found. |
| `padus-ngo` | **Role: ownership, low confidence.** Conservancy and land-trust preserves | same, `Mang_Type='NGO'` | Yellow (red if closed) | Off by default. |

## 2. Hunting units (18 layers; all have `species`)

All layers except CWD come from `…/WILDGameSpeciesManagementUnitsAndZonesOPENDATA/FeatureServer/<n>`
(DNR Wildlife Division, `Year`=2026). They are graded `unknown` ("unit boundary, not ownership").

| id | n | species | name field |
|---|---|---|---|
| `unit-deer-dmu` | 3 | deer | `MangementUnitName` (the source spells it this way), `DeerManagementUnit` |
| `zone-deer-123` (line) | 0 | deer | `LineTitle` |
| `zone-limited-firearm` (line) | 1 | deer, small game | `LineTitle` |
| `unit-bear` | 2 | bear | `ManagementUnitName` |
| `unit-elk` | 4 | elk | `ManagementUnitName`, `Season` |
| `unit-turkey` | 5 | turkey | `ManagementUnit`, `Season`, `ManagementUnitZZ` |
| `unit-waterfowl` | 13 | waterfowl, duck, goose | `ManagementUnitName` |
| `unit-pheasant` | 14 | pheasant | `ManagementUnitName` |
| `unit-sharptail` | 12 | sharp-tailed grouse | `ManagementUnitName` |
| `unit-quail` | 11 | quail | (no name field) |
| `unit-beaver` | 6 | beaver | `ManagementUnitName` |
| `unit-otter` | 9 | otter | `ManagementUnitName` |
| `unit-bobcat` | 7 | bobcat | `ManagementUnitName`, `Season` |
| `unit-marten` | 8 | marten | `ManagementUnitName` |
| `unit-fisher` | 10 | fisher | `ManagementUnitName` |
| `cwd-lp-surveillance-counties` | `CWD_Zones_2023/FeatureServer/1` | deer, elk | `COUNTYNAME` |
| `cwd-free-kit-counties` | `CWD_Zones_2023/FeatureServer/0` | deer, elk | `COUNTYNAME` |
| `cwd-up-core-area` | `CWD_Zones_2023/FeatureServer/2` | deer, elk | none |

The elk layer currently has only three "Winter" season units, and turkey has three spring
units plus one fall unit. `Deer_Management_Units_for_Deer_Camp_Survey` duplicates layer 3, so
it was left out. The CWD layers are from 2023 and may not match the current CWD regulations.

## 3. Parcels (33 layers; `minZoom` 13, or 11 for DNR)

`parcels-dnr-state-owned` is DNR LOTS `FeatureServer/0`, statewide, with no owner name. It is
graded by `DivisionDepartment` and is off by default.

Each county layer maps `ownerField`, `ownerAddressFields`, `siteAddressField`, `acresField` and
`parcelIdField` to that county's real field names (see `sources.ts`). There are **32
counties**, all with owner names:

| County | Host / item | Owner field | Notes |
|---|---|---|---|
| Allegan | services7 `abcn8A25PPQFVHHF/Parcels/4` (county org) | `ownername1` | |
| Antrim | services6 `ZcCP0G3kEnUDVego/AllParcels_shp/0` | `OWNER_NAME` | Site address is street name only (`P_ADDRESS` holds the number) |
| Barry | services `i0SsdDzLI3mLGmPR/Parcels_PublicViewer_View/14` | `owner_name` | |
| Benzie | services5 `lcdRo4JSOTVu3FMR/Benzie_County_Parcels/1` | `OWNERNAME1` | No acreage |
| Berrien | services5 `v2WhhBBaFU3T6oWm/Berrien_County_Parcels_2024/1` | `ownername1` | 2024 roll |
| Branch | services9 `TwBMgIvGpeiBjKXc/Branch_County_Parcels/0` | `OWNERNAME` | |
| Cass | services6 `o5a9nldztUcivksS/CassCountyParcels/0` | `Owner` | No site address |
| Charlevoix | services9 `1lVQrZMRGwmkesR4/Charlevoix_Parcels_for_viewing/0` | `owner` | **Partial**: about 9k parcels around Charlevoix and Bay Shore only |
| Cheboygan | services6 `j6ueqNZduqQcCpQQ/Relationship_class/0` | `ownername1` | No acreage |
| Eaton | services2 `c9l1e4fKpsCnqD7H/Parcels_AGO/0` (county) | `OWNERNME1` | No owner mailing address |
| Genesee | services2 `PrYwGqAi1wKjoFb1/Parcels2025County/0` | `OwnName` | 2025 |
| Gladwin | services `edGXqVKidagzAIPB/Gladwin_County_Parcels/0` | `OwnerName` | No acreage |
| Houghton | services9 `6EuFgO4fLTqfNOhu/MTU_Map_WFL1/1` | `owner` | Regrid data republished in a Michigan Tech web map; check licence and freshness |
| Huron | services `edGXqVKidagzAIPB/Huron_Parcels_2025/0` | `OWNER1` | Site address is street name only |
| Ingham | services3 `ySzhFSJfYeginRjx/Ingham_Parcels_2026/0` (county) | `OWNERNAME` | 2026 |
| Ionia | services9 `i2awudUyJK8gxxEe/Ionia_County_Tax_Parcels_Public/0` | `Parcel_Data_OWNERNAME` | No acreage; maxRecordCount is 1000 |
| Kent | services5 `X42k956XlfnIoN3d/Kent_Parcels/0` | `OWNERNAME` | Third-party copy; no owner mailing address |
| Leelanau | services `F7SeTaZ2Nijdg6lG/Tax_Parcels/0` | `OWNER_1` | |
| Lenawee | services6 `mjEvhc9AE3ceAXtG/Lenawee_Parcels_Public/2` (county) | `OWNNM1` | No owner mailing address |
| Macomb | services6 `K0qS4r8AEJxrE8em/Macomb_County_Parcel_Data/10` | `ownername1` | No owner mailing address or acreage |
| Marquette | services `oOYhhFJlpjePln8M/Marquette_Landowner_Classification/41` | `Owner_Merg` | Study layer that merges county and city owner fields; also has a `Category` (Private/Public/Timber/…) |
| Midland | services6 `9ALftzD3ElQ7KAgT/Land_Information/0` (county) | `OwnerName` | |
| Montcalm | services6 `GJ2uZAPsEvtmqpe1/Tax_Parcels/0` | `BSAEXPORT_ONERNAME1` | Misspelled field names are real |
| Muskegon | services5 `X42k956XlfnIoN3d/Kent_Ottawa_Muskegon_Parcels/1` | `Owner` | Third-party copy |
| Newaygo | services6 `pcT1Mx8rlQHDmzpy/PivotPointParcelsNewaygo/0` | `OWNER_NAME` | |
| Ottawa | services5 `X42k956XlfnIoN3d/Ottawa_Parcels/0` | `OwnerName` | Third-party copy |
| Roscommon | services `edGXqVKidagzAIPB/Roscommon_County_Parcels/0` | `ownername1` | No acreage |
| Schoolcraft | services `edGXqVKidagzAIPB/SchoolcraftCountyParcels_Updated_20240830/0` | `OwnerName` | August 2024; no site address or acreage |
| Shiawassee | services7 `zssqyzc5LZ9oAgzn/Shiawassee_Parcel_PEA/0` | `OWNER_NAME` | Engineering-firm web layer |
| Tuscola | services6 `FA2StDZ4LO95Cm3q/TuscolaCountyParcelsCurrentYearAddresses/53` | `ownername1` | |
| Van Buren | services3 `fOViEAUKl91t9cT6/Parcels/0` | `OWNERNAME` | |
| Wayne | services1 `b6rkZNtCd6Mx2gvB/Wayne_County_Parcels/0` | `ownername1` | Third-party copy (about 768k parcels); no owner mailing address |

`src/data/counties.ts` lists all 83 counties with `hasParcels`, which is derived from the
catalog so it cannot drift, plus a `parcelNote` where coverage is partial or a source was
found but not usable. The other **51 counties have no parcel layer**.

Sources that were found but not used:
- **County GIS servers outside ArcGIS Online.** Grand Traverse, Emmet, Oakland, Jackson, Kent,
  Macomb, Newaygo and Allegan publish parcels on their own servers. Those hosts are blocked
  from the build sandbox, so they could not be verified. A browser can probably reach them,
  but CORS was not checked.
- **`services8.arcgis.com`.** Iron and Arenac county services live there, and that host is
  blocked from the sandbox.
- **Login required.** The Missaukee and Menominee services need a token.
- **No owner names.** Mackinac, Delta, Clinton and Kalamazoo have parcel layers without
  owner names.
- **Wrong state.** Several search hits were for other states' counties with the same name:
  Clinton NY, Crawford WI, Dickinson TX, Iron UT and WI, Jackson MO and WI, Kent WA, Bay TX,
  St. Clair IL, Van Buren AR, Monroe NY, Osceola FL. They were rejected after an extent check.

## 4. Reference (5 layers)

| id | URL | Notes |
|---|---|---|
| `ref-counties` | `…/Michigan_Counties/FeatureServer/0` | `NAME`, `Co_label`, `CO_NUMBER`, `PENIN` |
| `ref-plss-townships` | `…/DNRPublicLandSurveySystemOPENDATA/FeatureServer/3` | `GeoID` such as `01N01E` |
| `ref-plss-sections` | same, `/1` | `GeoID` such as `68N32W25` |
| `ref-plss-qtrqtr` | same, `/0` | |
| `ref-state-forest-compartments` | `…/Mi_State_Forest/FeatureServer/8` | Management compartments only. They include private inholdings, so they are **not** ownership and are not graded green. |

---

## 5. Grading rules (plain language)

**Green**: clearly public and open to hunting.
- State forest and state game or wildlife area land (DNR LOTS use type). The wildlife
  property *boundary* layer is not graded (section 5a).
- Hunting Access Program properties that are open to all hunt types.
- State park or rec area zones that the DNR marks as "Open".
- Active Commercial Forest parcels. These are open by statute for foot access to hunt, fish
  and trap.
- USFS-owned national forest surface.
- Parcels whose owner string clearly names the DNR (for example "STATE OF MICHIGAN DNR",
  "MICH DEPT OF NAT RES", "DNR"), the Department of Conservation, or the U.S. Forest Service.

**Yellow**: possibly legal, but verify first.
- MDOT and state highway land.
- Plain "STATE OF MICHIGAN" with no agency named. This is usually DNR, but the record does not
  say so.
- Other state agencies: State Police, Treasury, Waterways, Building Authority, hatcheries.
- State parks and rec areas other than the "Open" zones.
- County, township, city and village land, including names like "GLADWIN CITY" and
  "OLIVET VILLAGE PARK".
- Road commissions, drain commissions and land banks.
- School districts, ISDs and public universities or community colleges.
- Utilities: Consumers, DTE, AEP/I&M, SEMCO, co-ops, ITC/ATC/METC.
- Conservancies, land trusts and conservation districts.
- Federal land other than USFS: FWS refuges, NPS lakeshores, postal service, HUD, and federal
  owners whose agency is unknown.
- Military land and tribal land (including "UNITED STATES OF AMERICA IN TRUST").
- HAP properties with restrictions.
- Commercial Forest parcels whose status is changing.

**Red**: private (permission required) or closed.
- Individuals, trusts and estates, LLCs and corporations, banks and credit unions, churches
  and religious orders, clubs, associations and foundations, railroads, and timber companies.
  The timber-company reason points the user to the CFA layer.
- PA 116 farmland agreements.
- Inactive HAP properties.
- State park zones marked "Closed".
- PAD-US areas closed to the public (`XA`) and national parks (Isle Royale).

**Unknown**: no owner data, and hunting-unit or reference layers, which are not ownership.

## 5a. One verdict per piece of ground (layer roles and precedence)

Each layer is graded on its own (above), but the map must not show a red parcel under a green
fill. Wherever county parcels are loaded, `src/grading/reconcile.ts` merges the parcel's
owner-name grade with every public-land layer overlapping it into **one** verdict. The parcel
keeps its own owner-name grade (`_ownerGrade`, `_ownerCategory`) so the details sheet can show
both records.

**Layer roles** (`LayerSource.role`):
- **Boundary** – `dnr-wildlife-areas`, `dnr-state-parks`. Administrative project or park
  boundaries that can include private inholdings. They are drawn as a dashed, labelled outline
  only, never as a colour, and the details sheet says "Inside the boundary of … — an
  administrative boundary that can include private inholdings".
- **Access program** – `dnr-park-hunting`, `dnr-hap`, `commercial-forest`. They decide hunting
  access whoever owns the land (CFA and HAP land is private by definition).
- **Ownership** – `dnr-managed-lands`, `usfs-surface-ownership` (authoritative), and the PAD-US
  layers (`padus-*`, marked `lowConfidence`: a coarse national compilation).

**Precedence.** A layer "covers" a parcel when its polygons cover at least half of it. The
highest covering tier decides; within a tier the strictest grade wins:
1. **State park hunting zones.** The zone's Open / Restricted / Closed status is adopted
   whatever the owner name says, so a closed zone makes a DNR-owned parcel red. If the county
   record names a private owner and the zone is open or restricted, the verdict is yellow
   **"Records disagree"** (a closed zone stays red).
2. **HAP.** The HAP grade is adopted (green, or yellow when hunt types are restricted); the
   category says it is private land enrolled in HAP and the owner is kept.
3. **Commercial Forest.** Green, "Commercial Forest (private, public foot access)": foot access
   for hunting, fishing and trapping only; the owner's name is still shown.
4. **DNR-managed land and USFS ownership.**
   - Owner is the DNR, the Forest Service, a generic "State of Michigan" or "U S Govt", or blank
     → the layer's grade and category are adopted.
   - Owner is a different specific public body or utility (MDOT / State Highway Commission,
     township, county, city, road commission, Consumers Energy, FWS…) → the stricter of the two
     records is kept and a note names both.
   - Owner is private → yellow **"Records disagree"**: the county says privately owned by X, the
     state/federal layer says public land; it may be a recent sale, an inholding or a mapping
     error — verify before entering.
5. **The parcel's own owner-name grade.**
6. **PAD-US.** A parcel with an owner name keeps its own grade (a note mentions the PAD-US
   record); a parcel with a blank owner adopts the PAD-US grade.

A layer covering only 10–50% of a parcel never changes its grade; the details sheet notes
"about N% of this parcel overlaps … — boundary data may be misaligned". A parcel split between
park zones (or other same-tier features) with different grades gets the strictest one, with a
note; tapping it shows the zone under your finger.

**Which layers load.** Whenever parcels are on screen, the park-hunting, HAP, CFA,
DNR-managed and USFS layers are loaded for reconciliation even if their own fill is switched
off, so a hidden layer cannot make a closed park zone look open. PAD-US layers take part only
when switched on.

**Rendering.** A parcel whose verdict was adopted from a public layer that is drawn has no fill
of its own (property line and label only), so the colour comes from one source. A parcel that
owns its verdict draws its own fill. "Records disagree" and other conflicting records are drawn
hatched with a dashed outline in the verdict colour. PAD-US fills are hidden where at least half
of their visible area lies under loaded parcels. Public-land fills where no parcel layer is
loaded look as before. The tap-anywhere details sheet leads with the same resolved verdict; away
from parcels it applies the same precedence to the layers under the finger.

**Approximation.** Coverage is computed in the browser (`src/app/layers/coverage.ts`): each
parcel is sampled with 64+ low-discrepancy points that are tested against the public polygons
(bbox grid + banded point-in-polygon), not by exact polygon intersection. Accuracy is a few
percent of a parcel's area, and it uses the generalised geometry the map already loaded. A pass
over about 900 parcels and a few hundred public polygons takes roughly 5–70 ms.

**Audit result.** Against the November 2026 audit (21,601 county parcels in 18 areas):
723 parcels sat under a public fill of a different colour (≥ 50% cover) before; after
reconciliation 42 are flagged as hatched "records disagree" / conflicting records and 5 still
show two covering public layers that disagree with each other (e.g. a DNR trail corridor
overlapping CFA land; two of the five are artefacts of the audit's per-layer aggregation of
park and non-park LOTS rows). The 17 DNR-owned parcels that showed green under closed or
restricted park zones now follow the zone.

### How owner-name matching works

1. **Normalize** the string: upper-case it, drop periods and apostrophes, turn punctuation
   into spaces and collapse whitespace.
2. **Specific entities** come next because they often carry corporate suffixes: tribal,
   military, public universities, conservancies, utilities, PA 116, land banks, strongly
   worded DNR names, and railroads.
3. **Private-entity guards** come before any government pattern: LLC, INC, CORP, CO at the
   end, BANK (but not LAND BANK), FARMS, TRUST or ESTATE, CHURCH, CLUB, ASSOCIATION, and so
   on. This step catches the false-positive traps such as "STATE BANK", "COUNTY LINE FARMS
   LLC", "CITY VIEW LLC", "FOREST TOWNSHIP HUNTING CLUB" and "KENT COUNTY CREDIT UNION".
   Strings that start with "CITY OF", "TOWNSHIP OF" or "COUNTY OF" skip these guards unless
   they are clearly an LLC, a church or similar.
4. **Government patterns**, all anchored on unambiguous phrases. "STATE" alone never
   matches. "COUNTY" must be followed by a government word or end the string, and "OF … COUNTY"
   organizations such as "ARC OF WAYNE COUNTY" are excluded. "USA" matches only at the start
   of the string.
5. **Default**: red, private.

The rules were tuned against about 21,100 distinct real owner strings pulled from the 32
county layers (queries for STATE, COUNTY, TWP, CITY, VILLAGE, US, SCHOOL, DNR, CONSERV,
ENERGY, FOREST and MICHIGAN). Results: 109 green, 3,753 yellow and 17,241 red, with the
misclassifications found during review fixed and locked in as tests.
`src/grading/grade.test.ts` covers the owner-name cases (each also checked for an `ownerKind`),
layer rules and catalog roles; `src/grading/reconcile.test.ts` covers the precedence rules with
owner strings and coverage fractions taken from the audit.

### References cited in results (only ones we are confident of)
- Recreational trespass: Part 731 of NREPA, MCL 324.73102. Hunting private land requires the
  owner's permission.
- Commercial Forest Act: Part 511 of NREPA, MCL 324.51101 et seq.
- 450-foot firearm safety zone around occupied dwellings and farm buildings (Michigan Hunting
  Regulations Summary).
- DNR Land Use Orders of the Director.
- 50 CFR Part 32, the refuge-specific hunting regulations.

These are labels without URLs. michigan.gov and legislature.mi.gov pages could not be fetched
from the build environment (403 bot check and proxy block), so no link was verified.

---

## 6. Known gaps and caveats

- **Parcels**: 51 of 83 counties have no owner-name parcel layer. That includes most of the
  northern Lower Peninsula and the Upper Peninsula: Alcona, Alger, Alpena, Arenac, Baraga,
  Chippewa, Crawford, Delta, Dickinson, Gogebic, Iron, Kalkaska, Keweenaw, Lake, Luce,
  Mackinac, Manistee, Mason, Menominee, Missaukee, Montmorency, Oceana, Ogemaw, Ontonagon,
  Osceola, Oscoda, Otsego, Presque Isle, Wexford and others. In those counties the app can
  show the public-land layers but cannot grade private parcels.
- **Third-party copies** (Kent, Ottawa, Muskegon, Wayne, Houghton, Marquette, Shiawassee) can
  lag the assessor roll. Treat owner names as a hint and confirm with the county
  equalization office.
- **MDOT owned land**: the MDOT real-estate service (`mdotgis.state.mi.us`) and
  `gisagomdot.state.mi.us` are blocked from the sandbox, so MDOT land is graded only through
  parcel owner names.
- **Local government land**: only what PAD-US contains, plus parcel owner names. There is no
  authoritative statewide township or county land layer.
- **Federal**: PAD-US covers FWS and NPS, but military installations appear in Michigan PAD-US
  only as "Proclamation" records, so they are not in the fee layer.
- **DNR wildlife-area boundaries** can include private inholdings. DNR LOTS managed lands are
  the better ownership test.
- **Safety zones**: the 450-ft zones around buildings are not mapped.
- **Hunting-unit layers** are 2026 boundaries, and the CWD layers are from 2023.
- **Owner-name heuristics** will still misgrade some strings: private developments named
  "X VILLAGE", municipal names without "CITY OF" or "VILLAGE OF", and private schools. Every
  yellow or red reason tells the user to verify.
