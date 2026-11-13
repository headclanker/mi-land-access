// Legality grading for SketchX.
//
// gradeFeature() turns one map feature (its layer + attributes) into a GradeResult:
//   green   – clearly public and open to hunting
//   yellow  – possibly legal but uncertain; verify before hunting
//   red     – private (permission required) or closed to hunting
//   unknown – no ownership information
//
// This is a screening aid, not legal advice. Every reason tells the user what to verify.

import type { Grade, GradeResult, LayerSource, OwnerKind } from '../contract.ts';
import { applyParkRule, findParkRule } from '../data/parkRules.ts';

type Ref = { label: string; url?: string };

// Only citations we are confident about. michigan.gov pages could not be fetched from the
// build environment, so references are labels without URLs.
export const REFS = {
  trespass: {
    label: 'Recreational trespass – Part 731 of NREPA, MCL 324.73102: hunting private land requires the owner’s permission',
  },
  safetyZone: {
    label: 'Michigan hunting regulations: 450-foot firearm safety zone around occupied dwellings and farm buildings',
  },
  cfa: {
    label: 'Commercial Forest Act – Part 511 of NREPA (MCL 324.51101 et seq.): enrolled land is open to the public for foot access to hunt, fish and trap',
  },
  landUseOrders: {
    label: 'DNR Land Use Orders of the Director (rules for state-managed land)',
  },
  hap: { label: 'DNR Hunting Access Program – property rules and check-in requirements' },
  refuge: { label: 'National wildlife refuges: hunting only where opened by refuge-specific rules (50 CFR Part 32)' },
  huntingDigest: { label: 'Michigan Hunting Regulations Summary (DNR) – current season dates and unit rules' },
} satisfies Record<string, Ref>;

function result(grade: Grade, category: string, reason: string, references?: Ref[]): GradeResult {
  return references && references.length ? { grade, category, reason, references } : { grade, category, reason };
}

/** Tags an owner-name grade with the owner classification reconciliation relies on. */
function owned(kind: OwnerKind, r: GradeResult): GradeResult {
  return { ...r, ownerKind: kind };
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// ---------------------------------------------------------------------------
// Owner-name classification (county parcel layers)
// ---------------------------------------------------------------------------

/** Upper-case, drop periods/apostrophes, turn other punctuation into spaces, collapse whitespace. */
export function normalizeOwner(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[.'’`"]/g, '')
    .replace(/[,;:/\\()[\]{}#*_+=|<>!?~-]/g, ' ')
    .replace(/&/g, ' & ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMPTY_OWNER = /^(|0|NONE|N A|NA|NULL|UNKNOWN|OWNER UNKNOWN|NO OWNER|UNKNOWN OWNER)$/;

// --- Phase A: specific entities recognised before corporate-suffix checks -------------

const RE_TRIBAL =
  /\bINDIANS\b|\bTRIBE\b|\bTRIBAL\b|\bINDIAN COMMUNITY\b|\bBAND OF\b.*\b(ODAWA|OTTAWA|CHIPPEWA|POTAWATOMI|POTTAWATOMI|OJIBWE)\b|\bPOKAGON BAND\b|\bUNITED STATES?\b.*\bIN TRUST\b|\bNOTTAWASEPPI\b|\bMATCH E BE NASH\b|\bGTB\b/;
const RE_MILITARY =
  /\bNATIONAL GUARD\b|\bMILITARY AFFAIRS\b|\bDEP\w* OF (THE )?(ARMY|NAVY|AIR FORCE|DEFENSE|MILITARY)\b|(?<!SALVATION )\bARMY\b|\bAIR FORCE\b|\bNAVAL\b|\bCORPS OF ENGINEERS\b|\bCOAST GUARD\b|\bCAMP GRAYLING\b|\bARMORY\b|\b(STATE|MICH\w*)\b.*\bMILITARY\b/;
const RE_PUBLIC_UNIVERSITY =
  /\bUNIVERSITY OF MICHIGAN\b|\bUNIV OF MICHIGAN\b|\bREGENTS\b|\bMICHIGAN STATE UNIV|\b(WESTERN|EASTERN|CENTRAL|NORTHERN) MICHIGAN UNIV|(?<!LAKE )\bMICHIGAN TECH(NOLOGI?CAL)? (UNIV|BOARD|BD|HOUSING)|\bMICHIGAN TECHNOLOGI?CAL$|\bGRAND ?VALLEY STATE\b|\bFERRIS STATE\b|\bLAKE SUPERIOR STATE\b|\bSAGINAW VALLEY STATE\b|\bOAKLAND UNIVERSITY\b|\bWAYNE STATE\b|\bCOMMUNITY COLLEGE\b|\bCOMM COLLEGE\b|\bJUNIOR COLLEGE\b|\bLAKE MICHIGAN COLLEGE\b|\bSCHOOLCRAFT COLLEGE\b|\bSOUTHWESTERN MICHIGAN COLLEGE\b/;
/** University-affiliated but private (credit unions, foundations). */
const RE_UNIVERSITY_PRIVATE = /\bF ?C ?U\b|\bFEDERAL C|\bCREDIT\b|\bFOUNDATIO/;
const RE_CONSERVATION_ORG =
  /\bCONSERV(A|N)\w*CY\b|\bLAND CONS\w*|\bLAND TRUST\b(?!.*\bAVE\b)|\bNATURE ASS?OC\w*|\bAUDUBON\b|\bNATURE PRES\w*|\bNATURE CENTER\b|\bWATERSHED COUNCIL\b|\bWOODLAND CONSERV\w*|\bCONSERVATION DIST\w*|\bSOIL CONSERVATION\b|\bDUCKS UNLIMITED\b|\bRUFFED GROUSE SOCIETY\b|\bWILD TURKEY FEDERATION\b|\bPHEASANTS FOREVER\b/;
const RE_UTILITY =
  /\bCONSUMERS? (ENERGY|POWER)\b|\bDTE\b|\bDETROIT EDISON\b(?!.*\bSCHOOL)|\bMICHCON\b|\bMICHIGAN CONSOLIDATED GAS\b|\bIND(IANA)? (&|AND)? ?MICH(IGAN)? (POWER|ELEC\w*)\b|\bAEP\b|\bUPPER PENINSULA POWER\b|\bUPPCO\b|\bUPPER MICHIGAN ENERGY\b|\bWE ENERGIES\b|\bWISCONSIN ELECTRIC\b|\bWISCONSIN PUBLIC SERVICE\b|\bNORTHERN STATES POWER\b|\bXCEL ENERGY\b|\bITC\b|\bINTERNATIONAL TRANSMISSION\b|\bAMERICAN TRANSMISSION\b|\bMICHIGAN ELECTRIC TRANSMISSION\b|\bCLOVERLAND ELECTRIC\b|\bGREAT LAKES ENERGY\b|\bENERGY COOP\w*|\bELECT?(RIC)? CO ?OP\w*|\bRURAL ELECTRIC\b|\bR E A\b|\bSEMCO\b|\bALPENA POWER\b|\bMICHIGAN GAS UTILITIES\b|\bMICHIGAN PUBLIC POWER\b/;
const RE_RAILROAD =
  /\bRAIL ?ROADS?\b|\bRAILWAYS?\b|\bRWY\b|\bR ?R CO\b|\bRR\b|\bR R$|\bCSX\b|\bNORFOLK SOUTHERN\b|\bCANADIAN NATIONAL\b|\bSOO LINE\b|\bGRAND TRUNK\b|\bLAKE STATE RAILWAY\b/;

// --- Phase B: private-entity markers (guards against false public matches) -------------

const RE_TIMBER_COMPANY =
  /\bTIMBER(LANDS?)?\b|\bFOREST(LANDS?|S)? (LLC|INC|CO|COMPANY|PRODUCTS|RESOURCES|HOLDINGS|MANAGEMENT|INVESTMENTS?|PARTNERS|INDUSTRIES)\b|\bWEYERHAEUSER\b|\bPLUM CREEK\b|\bLYME\b|\bHEARTWOOD\b|\bMOLPUS\b|\bRAYONIER\b|\bLONGYEAR\b/;
const RE_RELIGIOUS =
  /\bCHURCH\b|\bCH\b|\bCHUR\w*|\bPARISH\b|\bDIOCESE\b|\bCONGREGATION\w*|\bMINISTR(Y|IES)\b|\bBAPTIST\b|\bLUTHERAN\b|\bMETH(ODIST)?\b|\bCATHOLIC\b|\bPRESB(YTERIAN)?\b|\bEVANGELICAL\b|\bCHRISTIAN\b|\bBIBLE\b|\bTEMPLE\b|\bMOSQUE\b|\bSYNAGOGUE\b|\bCONVENTION\b|\bMISSION(ARY)?\b|\bAMISH\b|\bMENNONITE\b|\bADVENT(IST)?S?\b|\bPAROCHIAL\b|\bTABERNACLE\b|\bASSEMBLY OF GOD\b|\bPENTECOSTAL\b|\bREFORMED\b|\bBRETHREN\b|\bHOLINESS\b/;
const RE_CLUB =
  /\bCLUBS?\b|\bHUNTING\b|\bHUNT CLUB\b|\bSPORTSM[AE]NS?\b|\bLODGE\b|\bSOCIETY\b|\bSOC\b|\bFOUNDATION\b|\bASSOCIATION\b|\bASSN\b|\bASSOC\b|\bHABITAT FOR HUMANITY\b|\bY ?M ?C ?A\b|\bY ?W ?C ?A\b|\bSCOUTS?\b|\bCAMP\b|\bCOMMITTEE\b|\bUNITED WAY\b|\bLEAGUE\b|\b4 H\b|\bLEGION\b|\bV ?F ?W\b|\bGRANGE\b|\bSNOWMOBILERS\b|\bCHAMBER OF COMMERCE\b|\bAFL CIO\b|\bCENTRAL COM\w*|\bSTATE BAR\b|\bEMPLOYEES\b|\bPRIVATE\b|\bNON ?PROFIT\b/;
const RE_BUSINESS =
  /\bL ?L ?C\b|\bL ?L ?P\b|\bL ?P\b|\bINC\b|\bINCORPORATED\b|\bCORP(ORATION)?\b|\bCOMPANY\b|\bLTD\b|\bP ?L ?L ?C\b|(?<!LAND )\bBANK\b|\bCREDIT UNION\b|\bCR UN(ION)?\b|\bFARMS?\b|\bFARMLAND\b|\bREALTY\b|\bPROPERTIES\b|\bHOLDINGS?\b|\bINVESTMENTS?\b|\bPARTNERS(HIP)?\b|\bENTERPRISES?\b|\bVENTURES?\b|\bCONDO(MINIUM)?S?\b|\bAPARTMENTS?\b|\bAPTS?\b|\bMOBILE\b|\bSTORAGE\b|\bTITLE\b|\bABSTRACT\b|\bINSURANCE\b|\bMORTGAGE\b|\bLOAN\b|\bSALES\b|\bTRUCKING\b|\bMOTORS?\b|\bRESORT\b|\bGOLF\b|\bMARINA\b|\bSTEEL\b|\bMINING\b|\bAGGREGATES?\b|\bGRAVEL\b|\bLIMITED\b|\bDEVELOPERS?\b|\bBUILDERS?\b|\bHOMES\b|\bHOMEOWNERS?\b|\bTELEPHONE\b|\bTEL CO\b/;
/** A trailing "CO" means company unless the string is clearly governmental ("KENT CO"). */
const RE_TRAILING_CO = /\bCO$/;
const RE_GOV_WORDS = /\bSCHOOLS?\b|\bCOUNTY\b|\bCNTY\b|\bTWPS?\b|\bTOWNSHIPS?\b|\bCITY OF\b|\bVILLAGE OF\b|\bSTATE\b|\bROAD\b|\bRD\b|\bDRAIN\b|\bCOMM\w*/;
/** Unmistakably governmental phrases (used to stop e.g. a city-owned rail trail being graded as a railroad). */
const RE_GOV_STRONG = /\bCITY OF\b|\bVILLAGE OF\b|\bSTATE OF\b|\bTOWNSHIP\b|\bTWP\b|\bCOUNTY\b|\bSCHOOL DIST/;
/** Owner strings that start with a government prefix ("CITY OF ...", "TOWNSHIP OF ...") are public unless clearly a business/church. */
const RE_GOV_PREFIX = /^(CITY|VILLAGE|TOWNSHIP|CHARTER TOWNSHIP|CHARTER TWP|TWP|COUNTY|CHARTER COUNTY) OF\b/;
const RE_GOV_PREFIX_BLOCK = /\b(L ?L ?C|INC|L ?P|CONDO\w*|ASSN|ASSOC\w*|CHURCH|MINISTRIES|CORP\w*)\b/;
/** "BOARD OF TRUSTEES", "IN TRUST" on a government owner are not private trusts. */
const RE_GOV_TRUSTEES = /\b(BOARD|BD) OF TRUSTEES\b|\bTRUSTEES FOR\b|\bIN TRUST\b/;
/** DNR named together with a state context ("STATE OF MICH/DNR/REAL ESTATE"). */
const RE_STRONG_DNR_BLOCK = /\bL ?L ?C\b|\bINC\b|\bFARMLAND\b|\bFARMS?\b|\bHOLDINGS?\b|\bPROPERT\w*/;
// Note: "ET AL" / "ET UX" are deliberately NOT here – "CITY OF NEWAYGO ET AL" is still public.
const RE_TRUST_ESTATE =
  /\bTRUSTS?\b|\bTRUSTEES?\b|\bTTEES?\b|\bTRST\b|\bLIVING TR\b|\bESTATES?\b(?! DIV)|\bLIFE EST\b|\bL E\b|\bLE$|\bHEIRS\b/;

// --- Phase C: government owners ---------------------------------------------------------

const RE_FEDERAL =
  /\bUNITED STATES?\b(?! (GYPSUM|STEEL))|^U ?S ?A\b|^U ?S (GOV\w*|DEPT|DEPARTMENT|POST\w*|ARMY|NAVY|COAST|FOREST|FISH|AMERICA|GENERAL SERV\w*|IMMIGRATION|MARINE|NAVAL|PUBLIC HOUSING|LAND)\b|\bU ?S GOV(ERNMENT|T)?\b|\bUS GOVT\b|\bFEDERAL GOVERNMENT\b|\bUNITED ST POSTAL\b|\bPOSTAL SERV\w*/;
const RE_USFS =
  /\bFOREST SERVICE\b|\bNATIONAL FOREST\b|\b(MANISTEE|HURON|HIAWATHA|OTTAWA) NATIONAL\b|\bU ?S ?F ?S\b|\bUSDA\b|\bDEP\w* OF AGRIC\w*/;
const RE_FFS_ABBR = /\bF ?F ?S\b|\bFOREST\b/;
const RE_FWS = /\bFISH (& |AND )?WILDLIFE\b|\bF ?& ?W ?S\b|\bF ?W ?S\b|\bWILDLIFE REFUGE\b|\bN ?W ?R\b/;
const RE_NPS = /\bNATIONAL PARK\b|\bNATIONAL LAKESHORE\b|\bN ?P ?S\b|\bPARK SERVICE\b/;

const RE_DNR_ABBR = /\bM ?DNR\b|\bDNRE?\b|\bD N R\b/;
const RE_NATRES = /\bNAT(URAL|L)? RES\w*|\bNAT(URAL|L)?$/;
const RE_STATE_CONTEXT = /\bDEP\w*\b|\bMICH\w*\b|\bMI\b|\bSTATE\b|\bST OF\b/;
const RE_DNR_OTHER =
  /\bDEP\w* (OF )?CONSERVATION\b|\bCONSERVATION (DEPT|DEPARTMENT|COMMISSION)\b|\b(MICH\w*|STATE) (STATE )?CONSERVATION\b|\bSTATE FOREST\b|\bSTATE GAME AREA\b|\bSTATE WILDLIFE\b/;
const RE_MDOT =
  /\bM ?DOT\b|\bMICH\w* D ?O ?T\b|\bDEP\w* (OF )?(STATE )?(TRA\w*|HWY|HIGHWAY)\b|\bTRANSPORTATION DEPT\b|\b(STATE|ST) TRANS\w* COMM\w*|\bMICH\w* STATE TRANS\w*|\bSTATE (HIGHWAY|HIGHAY|HWY)\b|\b(HIGHWAY|HWY) (DEPT|DEPARTMENT|COMM|COMMISSION)\b|\bMICH(IGAN)? (STATE )?(HIGHWAY|HWY)\b/;
const RE_STATE_PARK = /\bSTATE PARK\b|\bSTATE RECREATION AREA\b|\bRECREATION AREA\b.*\bSTATE\b|\bSTATE\b.*\bPARK$/;
const RE_STATE_OTHER_AGENCY =
  /\bSTATE FISH HATCHERY\b|\bSTATE BUILDING AUTH|\bDEPT OF CORRECTIONS\b|\bDEPARTMENT OF CORRECTIONS\b|\bCORRECTIONS$|\bDEPT OF (MANAGEMENT|TREASURY|ENVIRONMENT|AG)\b|\bDEPARTMENT OF TREASURY\b|\bEGLE\b|\bDEQ\b|\bSTATE TREASURER\b|\bSTATE POLICE\b|\bPOLICE POST\b|\bWATERWAYS? COMM\w*|\bSTATE BOARD OF AGRICULTURE\b|\bSTATE HOUSING DEV\w*|\bSTRATEGIC FUND\b|\bAERONAUTICS COMM\w*|\bMICHIGAN SENATE\b|\bHOUSE OF REP\w*/;
const RE_STATE_GENERIC =
  /\bSTATE OF MICH(IGAN)?\b|\bMICHIGAN STATE OF\b|\bSTATE OF MI\b|^STATE( OF)?$|^MICHIGAN STATE$|^STATE\b.*\b(LAND|LANDS|MGT|MANAGEMENT)\b|\bMICH(IGAN)? DEP\w*\b|\bMI DEP\w*\b|\bPEOPLE OF THE STATE\b/;

const RE_SCHOOL =
  /\bPUBLIC SCHOOLS?\b|\bSCHOOLS? DIS\w*|\bSCH DIST\b|\bDIST(RICT)? SCHOOL\b|\bI ?S ?D\b|\bINTERMEDIATE( SCHOOLS?)?\b|\bINTM SCHOOL\b|\bAREA SCHOOLS?\b|\bCOMM(UNITY)? SCHOOLS?\b|\bCONSOLIDATED SCHOOLS?\b|\bUNIT SCHOOLS?\b|\bSCHOOL SYSTEM\b|\bSCHOOL BOARD\b|\bBOARD OF EDUCATION\b|\bB(OARD|D)? OF ED(UCATION)?\b|\b(TWP|TOWNSHIP) SCHOOLS?\b|\bSCHOOLS\b|\bSCHOOL NO\b|\bHIGH SCHOOL\b|\bELEM(ENTARY)?\b|\bCOUNTY ESA\b|\bRESA$|\bEDUCATIONAL SERVICE\b|^SCHOOL (SITE|PROPERTY|LAND)\b|\bSCHOOL$/;
const RE_ROAD_COMMISSION =
  /\bROAD COMM|\bRD COMM|\bBOARD OF (COUNTY )?ROAD|\bCOUNTY RO?A?D$|\bBD OF CO(UNTY)? RD|\bCOUNTY (DEPT OF )?(TRANS\w* (&|AND) )?ROADS?\b(?! DRAIN)|\bCOUNTY DPS ROAD|\bROADS DIVISION\b/;
const RE_DRAIN = /\bDRAIN (COMM|DIST|BOARD|BD)|\bDRAINAGE DIST|\bINTERCOUNTY DRAIN\b|\bDRAIN$/;
const RE_LAND_BANK = /\bLAND BANK\b/;
const RE_COUNTY =
  /\bCOUNTY OF\b|\bCOUNTY$|\bCOUNTY OF$|\bCNTY\b|\bCOUNTY (BOARD|TREAS\w*|TRASURER|TREAURER|PARKS?|ROAD|RD|DRAIN|AIRPORT|BUILDING|BUIDING|BLDG|DEPT|DEPARTMENT|COMMISSION|COMMISSIONERS|LAND|PUBLIC|SHER+IF+S?|FAIRGROUNDS?|MEDICAL|HEALTH|COMM(UNITY)? MENTAL|COM MENTAL|MENTAL|AERONAUTICS|ASSET|SOLID|TRANSIT|TRANS|SANIT\w*|SEW\w*|WASTEWATER|WATER|COURTS?|COURTHOUSE|COURT HOUSE|JAIL|GOVERNMENT|PROSECUT\w*|DISPATCH|ANIMAL|LANDFILL|ADM\w*|JUDICIAL|MUSEUM|PIT|ET AL|911|EMERGENCY|HOUSING COMM\w*|PROBATE|DPW|DPS|INVENTORY|BOARD OF|A MICHIGAN)\b|\bCO (ROAD|RD|DRAIN|PARK|PARKS|TREAS|TREASURER)\b|\bCOUNTY\b.*\b(PARK|TRAIL|PRESERVE)\b/;
/** "FAMILY PROMISE OF TUSCOLA COUNTY", "ARC OF WAYNE COUNTY": organisations named after a county. */
const RE_OF_COUNTY_ORG = /^(?!(COUNTY|BOARD|CHARTER COUNTY|BUILDING AUTHORITY|TREASURER)\b).*\b(OF|AND)\b.*\bCOUNTY$/;
const RE_TOWNSHIP = /\bTWPS?\b|\bTOWNSHIPS?\b/;
/** City-owned: "CITY OF X", "X CITY OF", "GLADWIN CITY", "SOUTH HAVEN CITY PARK"… */
const RE_CITY =
  /\bCITY OF\b|^(\w+ ){1,2}CITY$|^(\w+ ){1,2}CITY (HALL|PARK|AIRPORT|DDA|DUMP|DISPOSAL|CEMETERY|LIBRARY|BUILDING AUTH\w*|HOUSING COMM\w*|HSG COMM)\b|^CITY (HALL|DUMP|FAIR GROUNDS)\b/;
/**
 * Village-owned. Checked before RE_CITY so "VILLAGE OF COPPER CITY" and "MACKINAW CITY, VILLAGE OF"
 * stay villages; a string that also says "CITY OF" ("CITY OF THE VILLAGE OF CLARKSTON") is a city.
 */
const RE_VILLAGE = /\bVILLAGE OF\b|^(\w+ ){1,2}VILLAGE (HALL|PARK|DUMP|GARAGE|FIRE|HOUSING COMM\w*)\b|^VILLAGE (HALL|FIRE HALL)\b/;
const RE_LOCAL_AUTHORITY =
  /\bAUTHORITY\b|\bAUTH\b|\bPUBLIC WORKS\b|\bB ?P ?W\b|\bLIBRARY\b|\bFIRE (DEPT|DEPARTMENT|DIST|DISTRICT|AUTH|HALL|STATION)\b|\bSEWER\b|\bWATER (AUTHORITY|DEPT|DEPARTMENT|DIST)\b|\bSANIT|\bDOWNTOWN DEV|\bHOUSING COMM\w*|\bAIRPORT\b/;
const RE_CEMETERY = /\bCEMETE?A?RY\b/;

const PRIVATE_VERIFY =
  'Hunting requires the landowner’s permission (written permission is safest); the 450-ft firearm safety zone around occupied buildings still applies.';

const LOCAL_VERIFY =
  'Hunting on local-government land depends on local ordinances (many prohibit hunting or firearm discharge); contact the owner unit before hunting.';

/** Category of a city-owned parcel (red wherever it is: cities own land outside their limits too). */
export const CITY_OWNED_CATEGORY = 'City-owned – closed to hunting';

/** Shared caveat for the city rule (owner name and city limits). */
export const CITY_RULE_CAVEAT =
  'A conservative default, not a statewide law: each city’s ordinances decide (a few run managed archery deer hunts), and state land inside a city follows state rules.';

function gradeDnrOwner(): GradeResult {
  return result(
    'green',
    'State land (DNR)',
    'Owned by the Michigan DNR. Most DNR land is open to hunting under state regulations and DNR land use orders; check the DNR layers for the specific unit and any closures or safety zones.',
    [REFS.landUseOrders, REFS.safetyZone],
  );
}

/**
 * Classify a parcel by its assessor owner string. Exposed for testing and for
 * any layer that carries an owner name.
 */
/** School property is treated as closed: weapons are generally prohibited there. */
export const SCHOOL_CATEGORY = 'School property – closed to hunting';
const SCHOOL_REASON =
  'School-district property. Treated as closed: Michigan law makes school property a weapon-free school zone (MCL 750.237a), and districts do not open their land to public hunting. Do not hunt here.';

export function gradeOwnerName(rawOwner: unknown): GradeResult {
  const raw = str(rawOwner);
  const o = normalizeOwner(raw);

  if (EMPTY_OWNER.test(o)) {
    return owned('none', result(
      'unknown',
      'No owner data',
      'This parcel has no owner name in the county data. Look it up with the county equalization/treasurer office before hunting.',
    ));
  }

  // ---- Phase A: specific entities ----------------------------------------------------
  if (RE_TRIBAL.test(o)) {
    return owned('other', result(
      'yellow',
      'Tribal land',
      'Owned by or held in trust for a tribe. Tribal land has its own hunting rules and permits, and state licenses may not apply; contact the tribe before entering.',
    ));
  }
  if (RE_MILITARY.test(o)) {
    return owned('other', result(
      'yellow',
      'Military land',
      'Military property. Access and hunting are controlled by the installation (closures for training are common); check with the installation before entering.',
    ));
  }
  if (RE_PUBLIC_UNIVERSITY.test(o) && !RE_UNIVERSITY_PRIVATE.test(o)) {
    return owned('other', result(
      'yellow',
      'Public university / college',
      'Owned by a public university or college. These are generally not open to public hunting unless the institution says so; contact the institution.',
      [REFS.trespass],
    ));
  }
  if (RE_CONSERVATION_ORG.test(o)) {
    return owned('other', result(
      'yellow',
      'Conservancy / land trust',
      'Owned by a conservation organization. Many preserves allow foot access but hunting is often prohibited or allowed only by permit; check the organization’s rules for this preserve.',
      [REFS.trespass],
    ));
  }
  if (RE_UTILITY.test(o)) {
    return owned('other', result(
      'yellow',
      'Utility-owned',
      'Owned by a utility company. A few utility lands are open to public recreation, but most require permission; check with the utility before hunting.',
      [REFS.trespass],
    ));
  }
  if (/\bFARMLAND (& |AND )?OPEN SPACE\b|\bP ?A ?116\b/.test(o)) {
    return owned('private', result(
      'red',
      'Private – farmland agreement',
      `Private farmland enrolled in the state Farmland & Open Space (PA 116) program. The state holds an agreement, not public access. ${PRIVATE_VERIFY}`,
      [REFS.trespass],
    ));
  }
  if (RE_LAND_BANK.test(o)) {
    return owned('other', result('yellow', 'Land bank', `Owned by a land bank (usually tax-foreclosed property awaiting resale). ${LOCAL_VERIFY}`));
  }
  if (RE_DNR_ABBR.test(o) && RE_STATE_CONTEXT.test(o) && !RE_STRONG_DNR_BLOCK.test(o)) {
    return owned('dnr', gradeDnrOwner());
  }
  if (RE_RAILROAD.test(o) && !RE_GOV_STRONG.test(o)) {
    return owned('private', result(
      'red',
      'Railroad (private)',
      'Railroad property is private and active rail corridors are dangerous; do not enter without the railroad’s permission.',
      [REFS.trespass],
    ));
  }

  // ---- Phase B: private entities ----------------------------------------------------
  const govPrefix = RE_GOV_PREFIX.test(o) && !RE_GOV_PREFIX_BLOCK.test(o);
  if (!govPrefix && RE_TIMBER_COMPANY.test(o)) {
    return owned('private', result(
      'red',
      'Private timber company',
      `Private forest/timber company land. If this parcel is enrolled in the Commercial Forest program it is open to foot access for hunting — check the Commercial Forest layer. Otherwise: ${PRIVATE_VERIFY}`,
      [REFS.trespass, REFS.cfa],
    ));
  }
  if (!govPrefix && RE_RELIGIOUS.test(o)) {
    return owned('private', result('red', 'Private – religious organization', PRIVATE_VERIFY, [REFS.trespass, REFS.safetyZone]));
  }
  if (!govPrefix && RE_CLUB.test(o)) {
    return owned('private', result('red', 'Private – club / organization', PRIVATE_VERIFY, [REFS.trespass, REFS.safetyZone]));
  }
  if (!govPrefix && (RE_BUSINESS.test(o) || (RE_TRAILING_CO.test(o) && !RE_GOV_WORDS.test(o)))) {
    return owned('private', result('red', 'Private – business', PRIVATE_VERIFY, [REFS.trespass, REFS.safetyZone]));
  }
  if (!govPrefix && RE_TRUST_ESTATE.test(o) && !(RE_GOV_STRONG.test(o) && RE_GOV_TRUSTEES.test(o))) {
    return owned('private', result('red', 'Private – trust / estate / individuals', PRIVATE_VERIFY, [REFS.trespass, REFS.safetyZone]));
  }

  // ---- Phase C: government ----------------------------------------------------------
  const federal = RE_FEDERAL.test(o);
  if (RE_USFS.test(o) || (federal && RE_FFS_ABBR.test(o))) {
    return owned('usfs', result(
      'green',
      'National forest (USFS)',
      'Owned by the U.S. Forest Service. National forest land is generally open to hunting under state regulations; check for local closures, developed recreation sites and the national forest ownership layer to confirm the boundary.',
      [REFS.huntingDigest, REFS.safetyZone],
    ));
  }
  if (RE_FWS.test(o) && (federal || /\bSERVICE\b|\bREFUGE\b/.test(o))) {
    return owned('other', result(
      'yellow',
      'U.S. Fish & Wildlife Service',
      'Federal refuge / FWS land. Hunting is allowed only where and when the refuge’s own rules open it; check the refuge’s hunting regulations.',
      [REFS.refuge],
    ));
  }
  if (RE_NPS.test(o)) {
    return owned('other', result(
      'yellow',
      'National Park Service',
      'National Park Service land. Hunting is allowed in parts of Michigan’s national lakeshores but prohibited in national parks and developed areas; check the park’s hunting rules.',
    ));
  }
  if (federal) {
    return owned('federal', result(
      'yellow',
      'Federal (agency not stated)',
      'Owned by the federal government, but the owner string does not say which agency. Rules vary widely (forest service, refuge, military, HUD foreclosures…); identify the agency before hunting.',
    ));
  }

  if (RE_DNR_ABBR.test(o) || (RE_NATRES.test(o) && RE_STATE_CONTEXT.test(o)) || RE_DNR_OTHER.test(o)) {
    return owned('dnr', gradeDnrOwner());
  }
  if (RE_MDOT.test(o) && !(/\bCOUNTY\b/.test(o) && !/\bSTATE\b|\bMICH/.test(o))) {
    return owned('other', result(
      'yellow',
      'MDOT / state highway',
      'Owned by the Michigan Department of Transportation (usually highway right-of-way or excess land). Hunting along roads is restricted and firearm discharge near highways can be illegal; treat as off-limits unless MDOT confirms.',
    ));
  }
  if (RE_STATE_PARK.test(o)) {
    return owned('dnr', result(
      'yellow',
      'State park / recreation area',
      'State park or recreation area. Hunting is allowed only in designated parts of some parks; check the DNR park hunting map for this unit.',
      [REFS.landUseOrders],
    ));
  }
  if (RE_STATE_OTHER_AGENCY.test(o)) {
    return owned('other', result(
      'yellow',
      'State land (non-DNR agency)',
      'Owned by a State of Michigan agency other than the DNR (or a DNR facility such as a hatchery). These are not open to hunting by default; contact the agency.',
    ));
  }
  if (RE_STATE_GENERIC.test(o)) {
    return owned('state', result(
      'yellow',
      'State of Michigan (agency not stated)',
      'Owned by the State of Michigan, but the record does not say which agency. Most rural state land is DNR-managed and open to hunting — confirm with the DNR-managed lands layer before relying on it.',
      [REFS.landUseOrders],
    ));
  }

  if (RE_SCHOOL.test(o)) {
    return owned('other', result('red', SCHOOL_CATEGORY, SCHOOL_REASON, [REFS.trespass]));
  }
  if (RE_ROAD_COMMISSION.test(o)) {
    return owned('other', result('yellow', 'County road commission', `Road commission land (often right-of-way or gravel pits). ${LOCAL_VERIFY}`));
  }
  if (RE_DRAIN.test(o)) {
    return owned('other', result('yellow', 'Drain commission', `Drain commission land or easement. ${LOCAL_VERIFY}`));
  }
  if (RE_COUNTY.test(o) && !(RE_OF_COUNTY_ORG.test(o) && !/\bCOUNTY OF\b/.test(o))) {
    return owned('other', result('yellow', 'County-owned', `County-owned land (may include tax-foreclosed parcels). ${LOCAL_VERIFY}`));
  }
  if (RE_TOWNSHIP.test(o)) {
    return owned('other', result('yellow', 'Township-owned', `Township-owned land. ${LOCAL_VERIFY}`));
  }
  if (RE_VILLAGE.test(o) && !/\bCITY OF\b/.test(o)) {
    return owned('other', result(
      'yellow',
      'Village-owned',
      'Village-owned land. Village ordinances often prohibit hunting or discharging firearms or bows on village property and within the village; contact the village before hunting.',
    ));
  }
  if (RE_CITY.test(o)) {
    return owned('other', result(
      'red',
      CITY_OWNED_CATEGORY,
      `City-owned land. City ordinances in Michigan generally prohibit hunting and discharging firearms or bows in city parks and on city property, so treat it as closed unless the city confirms otherwise. A conservative default, not a statewide law: each city’s ordinances decide (a few run managed archery deer hunts).`,
    ));
  }
  if (RE_LOCAL_AUTHORITY.test(o)) {
    return owned('other', result('yellow', 'Local public authority', `Owned by a local public authority (library, utility board, airport, sewer…). ${LOCAL_VERIFY}`));
  }
  if (RE_CEMETERY.test(o)) {
    return owned('other', result('yellow', 'Cemetery', 'Cemetery property; not a hunting area. Contact the owner (often the township).'));
  }

  // ---- Default: private individual(s) --------------------------------------------------
  return owned('private', result('red', 'Private', PRIVATE_VERIFY, [REFS.trespass, REFS.safetyZone]));
}

// ---------------------------------------------------------------------------
// Layer-specific rules
// ---------------------------------------------------------------------------

function gradeDnrDivision(division: string, project: string): GradeResult {
  const d = division.toUpperCase();
  const name = project ? ` (${project})` : '';
  if (d.includes('FOREST RESOURCES')) {
    return result('green', 'State forest', `DNR Forest Resources Division land${name}. State forest land is open to hunting under state regulations and DNR land use orders; watch for posted closures and safety zones.`, [REFS.landUseOrders, REFS.safetyZone]);
  }
  if (d.includes('WILDLIFE')) {
    return result('green', 'State game / wildlife area', `DNR Wildlife Division land${name}. Open to hunting, but some areas have special rules (refuges, managed waterfowl zones, drawings); check the area's rules.`, [REFS.landUseOrders, REFS.safetyZone]);
  }
  if (d.includes('PARKS')) {
    return result('yellow', 'State park / recreation land', `DNR Parks & Recreation land${name}. Hunting is allowed only in designated parts of some parks; check the park hunting layer.`, [REFS.landUseOrders]);
  }
  if (d.includes('LAND ADMINISTRATION')) {
    return result('green', 'State land (DNR, undedicated)', `DNR-administered state land${name} not assigned to a park or facility. Generally open under DNR land use orders; check for posted closures.`, [REFS.landUseOrders, REFS.safetyZone]);
  }
  if (d.includes('FISHERIES')) {
    return result('yellow', 'DNR fisheries facility', `DNR Fisheries land${name} (hatcheries, research stations, access). Often closed to hunting; check signage.`);
  }
  if (d.includes('TRANSPORTATION')) {
    return result('yellow', 'MDOT land', `State land administered by MDOT${name}. Treat as off-limits unless MDOT confirms.`);
  }
  if (d.includes('MILITARY')) {
    return result('yellow', 'Military land (state)', `State land administered by the Dept. of Military & Veterans Affairs${name}. Access is controlled by the military; check before entering.`);
  }
  if (d.includes('FEDERAL')) {
    return result('yellow', 'Federal land (state record)', `State record shows federal administration${name}. Check the federal agency's rules.`);
  }
  return result('yellow', 'State land (other)', `State land administered by ${division || 'an unspecified unit'}${name}. Not necessarily open to hunting; verify with the administering agency.`);
}

function gradeDnrManagedLands(p: Record<string, unknown>): GradeResult {
  const use = str(p.ProjectUseType).toUpperCase();
  const project = str(p.ProjectName);
  const name = project ? ` (${project})` : '';
  switch (use) {
    case 'FORESTS':
      return result('green', 'State forest', `State forest land${name}. Open to hunting under state regulations and DNR land use orders; watch for posted closures and safety zones.`, [REFS.landUseOrders, REFS.safetyZone]);
    case 'WILDLIFE GAME AREAS':
      return result('green', 'State game / wildlife area', `State game/wildlife area land${name}. Open to hunting, but some areas have special rules (refuges, managed waterfowl zones, drawings); check the area's rules.`, [REFS.landUseOrders, REFS.safetyZone]);
    case 'NATIONAL FOREST':
      return result('green', 'State land in national forest', `State-owned land inside a national forest${name}. Generally open to hunting; check for posted closures.`, [REFS.landUseOrders]);
    case 'STATE PARK':
      return result('yellow', 'State park', `State park land${name}. Hunting is allowed only in designated parts of some parks; check the park hunting layer.`, [REFS.landUseOrders]);
    case 'RECREATIONAL AREAS':
      return result('yellow', 'State recreation area', `State recreation area land${name}. Many recreation areas allow hunting outside developed/safety zones; check the park hunting layer for this unit.`, [REFS.landUseOrders]);
    case 'RAIL TRAILS':
    case 'TRAIL':
      // Owner's decision (2026-11-13): trail corridors show as closed.
      return result('red', 'State trail corridor – treated as closed', `State-owned trail corridor${name}. A narrow strip used by trail traffic; treated as closed to hunting on this map.`);
    case 'PUBLIC WATER ACCESS SITE':
    case 'BOATING ACCESS SITE':
      return result('yellow', 'Boating / water access site', `State water access site${name}. Small developed site; usually not a hunting area. Verify with DNR.`);
    case 'FISH HATCHERIES':
      return result('yellow', 'Fish hatchery', `State fish hatchery land${name}. Generally closed to hunting; verify with DNR.`);
    case 'MILITARY':
      return result('yellow', 'Military land (state)', `State land used by the military${name}. Access is controlled by the installation; check before entering.`);
    case 'RIGHT OF WAY PROPERTIES':
      return result('yellow', 'State right-of-way', `State right-of-way property${name}. Treat as off-limits unless the administering agency confirms.`);
    case 'NATIONAL LAKESHORE':
      return result('yellow', 'National lakeshore (state-owned)', `State-owned land within a national lakeshore${name}. Lakeshore hunting rules apply; check with the park.`);
    case 'MUSEUMS':
    case 'FIELD ADMINSTRATION':
    case 'FIELD ADMINISTRATION':
    case 'ENVIRONMENTAL MANAGEMENT SITE':
    case 'BOTTOMLANDS':
      return result('yellow', `State land (${str(p.ProjectUseType).trim()})`, `State land used as ${str(p.ProjectUseType).trim().toLowerCase()}${name}. Not a designated hunting area; verify with DNR.`);
    default:
      return gradeDnrDivision(str(p.DivisionDepartment), project);
  }
}

/** Wording used everywhere an administrative boundary is shown (details sheet, legend). */
export const BOUNDARY_NOTE = 'an administrative boundary that can include private inholdings';

/**
 * Boundary layers (role 'boundary': wildlife project areas, park boundaries) never carry a grade:
 * they are drawn as outlines and reported as "Inside the boundary of …". The category names the
 * kind of area; the reason explains why it is not an access verdict.
 */
function gradeBoundary(source: LayerSource, p: Record<string, unknown>): GradeResult {
  if (source.id === 'dnr-wildlife-areas') {
    const type = str(p.AreaType);
    const name = str(p.OfficialWLDProjectAreaName);
    if (/PVT|PRIVATE/i.test(name)) {
      return result('unknown', 'Private land – state hunting rights (boundary)', `Privately owned land on which the State reserved hunting rights${name ? ` (${name})` : ''}. Boundaries and rules are specific; confirm with the DNR Wildlife Division before hunting.`);
    }
    return result(
      'unknown',
      type || 'Wildlife area',
      `${type || 'DNR wildlife area'} project boundary — ${BOUNDARY_NOTE}. Whether a spot inside it is public comes from the parcel and DNR-managed land records; area rules (refuges, managed waterfowl zones, drawings) apply on the state-owned part.`,
      [REFS.landUseOrders],
    );
  }
  if (source.id === 'dnr-state-parks') {
    return result('unknown', 'State park boundary', `${str(p.Park_Label) || 'State park'} boundary — ${BOUNDARY_NOTE}. The "State parks & rec areas – hunting status" layer shows which zones are open or closed to hunting.`, [REFS.landUseOrders]);
  }
  return result('unknown', source.title, `Administrative boundary — ${BOUNDARY_NOTE}. Not an access verdict.`);
}

function gradeHap(p: Record<string, unknown>): GradeResult {
  const status = str(p.ActiveOrInactive).toUpperCase();
  const huntType = str(p.HuntType);
  const info = [str(p.HAPInfo), str(p.SpecialComment)].filter(Boolean).join(' ');
  if (status && status !== 'ACTIVE') {
    return result('red', 'HAP – inactive', 'This property is no longer enrolled in the Hunting Access Program; it is private land and requires the owner’s permission.', [REFS.trespass]);
  }
  const extra = info ? ` ${info}` : '';
  if (!huntType || /OPEN TO ALL HUNT TYPES/i.test(huntType)) {
    return result('green', 'Hunting Access Program', `Private land leased by the DNR for public hunting. Open to all hunt types; follow the property's check-in/permit rules.${extra}`, [REFS.hap, REFS.safetyZone]);
  }
  return result('yellow', 'Hunting Access Program (restricted)', `Private land leased by the DNR for public hunting, with restrictions: ${huntType.trim()} Follow the property's check-in/permit rules.${extra}`, [REFS.hap, REFS.safetyZone]);
}

/** DNR park-zone notes that limit hunting to particular game or activities (not just weapons). */
export function isActivityLimited(notes: string): boolean {
  return /open to [^.;]*\bonly\b|waterfowl only|trapping only/i.test(notes);
}

function gradeParkHunting(p: Record<string, unknown>): GradeResult {
  const status = str(p.HuntTrap).toUpperCase();
  const facility = str(p.Facility) || 'This park';
  const restr = str(p.HuntTrapRestrictions);
  const comments = str(p.Comments);
  const goose = str(p.EarlyGoose) ? ` Early goose season: ${str(p.EarlyGoose)}${str(p.EarlyGooseDates) ? ` (${str(p.EarlyGooseDates)})` : ''}.` : '';
  const notes = [restr, comments].filter(Boolean).join(' ');
  if (status === 'OPEN') {
    return result('green', 'State park – hunting open', `${facility}: this part of the park is open to hunting and trapping.${notes ? ` ${notes}` : ''}${goose} Safety zones around buildings and use areas still apply.`, [REFS.landUseOrders, REFS.safetyZone]);
  }
  if (status === 'OPEN-RESTRICTED') {
    // DNR uses Open-Restricted for two different things. Where hunting is limited to particular
    // game or activities (waterfowl only, trapping only) the zone stays "check first". Where
    // the limit is on weapons or dates (no rifles, archery only, no firearms in summer) hunting
    // is plainly allowed, so the zone is open — with the limit stated up front.
    // A restricted zone with no note at all stays "check first": the limit is unknown.
    if (notes && !isActivityLimited(notes)) {
      return result('green', 'State park – hunting open (weapon limits)', `${facility}: open to hunting, with limits. ${notes}${goose} Safety zones around buildings and use areas still apply.`, [REFS.landUseOrders, REFS.safetyZone]);
    }
    return result('yellow', 'State park – restricted hunting', `${facility}: hunting is allowed with restrictions.${notes ? ` ${notes}` : ''}${goose} Check the park's hunting map before going.`, [REFS.landUseOrders, REFS.safetyZone]);
  }
  if (status === 'CLOSED') {
    // DNR marks some zones Closed yet attaches a note (trapping only, special hunts by
    // designation, local firearm controls). The zone stays closed for general hunting, but the
    // note must be shown rather than dropped — and "closed to trapping" must not be claimed
    // where the note says trapping is open.
    if (/trapping only/i.test(notes)) {
      return result('red', 'State park – closed to hunting (trapping only)', `${facility}: this area is closed to hunting; the DNR lists it as open to trapping only. DNR note: ${notes}${goose}`, [REFS.landUseOrders]);
    }
    if (notes) {
      return result('red', 'State park – closed to hunting', `${facility}: the DNR lists this area as closed to general hunting and trapping. DNR note: ${notes} Treat it as closed unless the park confirms a special hunt.${goose}`, [REFS.landUseOrders]);
    }
    return result('red', 'State park – closed to hunting', `${facility}: this area is closed to hunting and trapping.${goose}`, [REFS.landUseOrders]);
  }
  return result('yellow', 'State park', `${facility}: hunting status not recorded; check with the park.`, [REFS.landUseOrders]);
}

function gradeCfa(p: Record<string, unknown>): GradeResult {
  const status = str(p.ParcelStatusText);
  const owner = str(p.FullLegalName);
  const who = owner ? ` Owner: ${owner}.` : '';
  if (!status || /^ACTIVE$/i.test(status)) {
    return result('green', 'Commercial Forest (CFA)', `Private land enrolled in the Commercial Forest program, which must allow public foot access for hunting, fishing and trapping. No motorized access, camping or permanent blinds without the owner's permission.${who}`, [REFS.cfa, REFS.safetyZone]);
  }
  return result('yellow', 'Commercial Forest (status change)', `Commercial Forest parcel with status "${status}" — enrollment may be ending or not yet effective, so public access is not certain.${who} Check with DNR Forest Resources Division.`, [REFS.cfa, REFS.trespass]);
}

function gradeUsfs(p: Record<string, unknown>): GradeResult {
  const cls = str(p.ownerclassification).toUpperCase();
  const unit = str(p.nfslandunitname) || 'National forest';
  if (cls && cls !== 'USDA FOREST SERVICE') {
    return result('unknown', 'Not Forest Service land', `${unit}: this tract is not Forest Service-owned. Check the county parcel layer for the actual owner.`);
  }
  return result('green', 'National forest (USFS)', `${unit}: Forest Service-owned surface. Open to hunting under state regulations; check for closures around campgrounds and developed sites.`, [REFS.huntingDigest, REFS.safetyZone]);
}

function gradePadus(p: Record<string, unknown>): GradeResult {
  const mangType = str(p.Mang_Type).toUpperCase();
  const mang = str(p.Mang_Name).toUpperCase();
  const des = str(p.Des_Tp).toUpperCase();
  const access = str(p.Pub_Access).toUpperCase();
  const unit = str(p.Unit_Nm) || 'This area';
  const localMgr = str(p.Loc_Mang);
  const mgr = localMgr ? ` Manager: ${localMgr}.` : '';

  if (access === 'XA') {
    return result('red', 'Closed to public', `${unit}: listed as closed to public access in PAD-US.${mgr}`);
  }
  if (mangType === 'FED') {
    if (mang === 'USFS') return gradeUsfs({ ownerclassification: 'USDA FOREST SERVICE', nfslandunitname: unit });
    if (mang === 'FWS') {
      return result('yellow', 'National wildlife refuge / FWS land', `${unit}: U.S. Fish & Wildlife Service land. Hunting only where and when the refuge's rules allow; check the refuge hunting regulations.`, [REFS.refuge]);
    }
    if (mang === 'NPS') {
      if (des === 'NP') {
        return result('red', 'National park – no hunting', `${unit}: hunting is not permitted in national parks.`);
      }
      if (des === 'NLS') {
        return result('yellow', 'National lakeshore', `${unit}: hunting is allowed in parts of the lakeshore under state regulations, but developed areas and some zones are closed; check the park's hunting rules.`);
      }
      return result('yellow', 'National Park Service', `${unit}: National Park Service land; check the park's rules before hunting.`);
    }
    return result('yellow', 'Federal land', `${unit}: federal land managed by ${mang || 'a federal agency'}. Check that agency's rules before hunting.`);
  }
  if (mangType === 'STAT') {
    if (mang === 'SFW' || mang === 'SDNR') {
      return result('green', 'State land (DNR)', `${unit}: DNR-managed state land. Generally open to hunting; check unit rules.`, [REFS.landUseOrders]);
    }
    if (mang === 'SPR') {
      return result('yellow', 'State park', `${unit}: state park; hunting only in designated parts — check the park hunting layer.`, [REFS.landUseOrders]);
    }
    return result('yellow', 'State land (non-DNR)', `${unit}: state land not managed by the DNR.${mgr} Not open to hunting by default; contact the managing agency.`);
  }
  if (mangType === 'LOC' || mangType === 'DIST' || mangType === 'JNT') {
    // School-run land (district nature areas, athletic fields) is closed like any school property.
    if (/\bschools?\b|\bschool dist|\bI\.?S\.?D\b/i.test(`${localMgr} ${str(p.Loc_Own)}`)) {
      return result('red', SCHOOL_CATEGORY, `${unit}: ${SCHOOL_REASON}`);
    }
    const what = mang === 'CNTY' ? 'County' : mang === 'CITY' ? 'Municipal / township' : 'Regional / local';
    return result('yellow', `${what} land`, `${unit}: ${what.toLowerCase()} park or open space.${mgr} ${LOCAL_VERIFY}`);
  }
  if (mangType === 'NGO') {
    return result('yellow', 'Conservancy / land trust', `${unit}: owned or managed by a conservation organization.${mgr} Many preserves allow foot access but restrict or prohibit hunting; check the organization's rules.`, [REFS.trespass]);
  }
  if (mangType === 'PVT') {
    return result('red', 'Private', `${unit}: private protected land.${mgr} ${PRIVATE_VERIFY}`, [REFS.trespass]);
  }
  return result('yellow', 'Protected area (manager unknown)', `${unit}: manager not identified in PAD-US. Verify ownership before hunting.`);
}

function gradeNonLand(source: LayerSource): GradeResult {
  return result(
    'unknown',
    source.title,
    source.group === 'hunting-units'
      ? 'Management unit / zone boundary — it sets season and license rules, not land ownership. Check the land layers for whether you may hunt here.'
      : 'Reference boundary — not land ownership.',
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * True for national wildlife refuge system land: U.S. Fish & Wildlife Service units in the PAD-US
 * federal layer. Drawn in their own colour (REFUGE_COLOR); the grade is unaffected.
 */
export function isWildlifeRefuge(sourceId: string, properties: Record<string, unknown> | null | undefined): boolean {
  return sourceId === 'padus-federal-other' && str((properties ?? {}).Mang_Name).toUpperCase() === 'FWS';
}

export function gradeFeature(source: LayerSource, properties: Record<string, unknown>): GradeResult {
  const base = gradeByLayer(source, properties ?? {});
  // A researched rule for this specific unit (src/data/parkRules.ts) replaces the layer's grade.
  const rule = findParkRule(source.id, properties ?? {});
  return rule ? applyParkRule(rule, base, source.nameField ? str((properties ?? {})[source.nameField]) : '') : base;
}

function gradeByLayer(source: LayerSource, p: Record<string, unknown>): GradeResult {
  if (source.fixedGrade) return source.fixedGrade;
  const id = source.id;

  if (id === 'dnr-managed-lands') return gradeDnrManagedLands(p);
  if (source.role === 'boundary') return gradeBoundary(source, p);
  if (id === 'parcels-dnr-state-owned') return owned('dnr', gradeDnrDivision(str(p.DivisionDepartment), ''));
  if (id === 'dnr-hap') return gradeHap(p);
  if (id === 'dnr-park-hunting') return gradeParkHunting(p);
  if (id === 'commercial-forest') return gradeCfa(p);
  if (id === 'usfs-surface-ownership') return gradeUsfs(p);
  if (id.startsWith('padus-')) return gradePadus(p);

  if (source.group === 'parcels') {
    const field = source.parcel?.ownerField;
    if (!field) {
      return result('unknown', 'No owner field', 'This parcel layer has no owner name; check the county records.');
    }
    return gradeOwnerName(p[field]);
  }

  if (source.group === 'hunting-units' || source.group === 'reference') return gradeNonLand(source);

  return result('unknown', 'Unclassified', 'No grading rule for this layer; verify ownership before hunting.');
}
