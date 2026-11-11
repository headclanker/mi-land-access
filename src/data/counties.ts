// All 83 Michigan counties, with whether the catalog has an owner-name parcel layer for them.
// County codes / peninsula come from the DNR Michigan_Counties layer (CO_NUMBER, PENIN).

import { PARCEL_COUNTIES } from './sources.ts';

export interface MichiganCounty {
  name: string;
  /** Michigan county number (alphabetical, '01'..'83') as used in parcel numbers. */
  code: string;
  peninsula: 'LP' | 'UP';
  /** True when LAYER_SOURCES contains a parcel layer (with owner names) for this county. */
  hasParcels: boolean;
  /** Caveat about coverage, if any. */
  parcelNote?: string;
}

const RAW: [name: string, code: string, peninsula: 'LP' | 'UP'][] = [
  ['Alcona', '01', 'LP'],
  ['Alger', '02', 'UP'],
  ['Allegan', '03', 'LP'],
  ['Alpena', '04', 'LP'],
  ['Antrim', '05', 'LP'],
  ['Arenac', '06', 'LP'],
  ['Baraga', '07', 'UP'],
  ['Barry', '08', 'LP'],
  ['Bay', '09', 'LP'],
  ['Benzie', '10', 'LP'],
  ['Berrien', '11', 'LP'],
  ['Branch', '12', 'LP'],
  ['Calhoun', '13', 'LP'],
  ['Cass', '14', 'LP'],
  ['Charlevoix', '15', 'LP'],
  ['Cheboygan', '16', 'LP'],
  ['Chippewa', '17', 'UP'],
  ['Clare', '18', 'LP'],
  ['Clinton', '19', 'LP'],
  ['Crawford', '20', 'LP'],
  ['Delta', '21', 'UP'],
  ['Dickinson', '22', 'UP'],
  ['Eaton', '23', 'LP'],
  ['Emmet', '24', 'LP'],
  ['Genesee', '25', 'LP'],
  ['Gladwin', '26', 'LP'],
  ['Gogebic', '27', 'UP'],
  ['Grand Traverse', '28', 'LP'],
  ['Gratiot', '29', 'LP'],
  ['Hillsdale', '30', 'LP'],
  ['Houghton', '31', 'UP'],
  ['Huron', '32', 'LP'],
  ['Ingham', '33', 'LP'],
  ['Ionia', '34', 'LP'],
  ['Iosco', '35', 'LP'],
  ['Iron', '36', 'UP'],
  ['Isabella', '37', 'LP'],
  ['Jackson', '38', 'LP'],
  ['Kalamazoo', '39', 'LP'],
  ['Kalkaska', '40', 'LP'],
  ['Kent', '41', 'LP'],
  ['Keweenaw', '42', 'UP'],
  ['Lake', '43', 'LP'],
  ['Lapeer', '44', 'LP'],
  ['Leelanau', '45', 'LP'],
  ['Lenawee', '46', 'LP'],
  ['Livingston', '47', 'LP'],
  ['Luce', '48', 'UP'],
  ['Mackinac', '49', 'UP'],
  ['Macomb', '50', 'LP'],
  ['Manistee', '51', 'LP'],
  ['Marquette', '52', 'UP'],
  ['Mason', '53', 'LP'],
  ['Mecosta', '54', 'LP'],
  ['Menominee', '55', 'UP'],
  ['Midland', '56', 'LP'],
  ['Missaukee', '57', 'LP'],
  ['Monroe', '58', 'LP'],
  ['Montcalm', '59', 'LP'],
  ['Montmorency', '60', 'LP'],
  ['Muskegon', '61', 'LP'],
  ['Newaygo', '62', 'LP'],
  ['Oakland', '63', 'LP'],
  ['Oceana', '64', 'LP'],
  ['Ogemaw', '65', 'LP'],
  ['Ontonagon', '66', 'UP'],
  ['Osceola', '67', 'LP'],
  ['Oscoda', '68', 'LP'],
  ['Otsego', '69', 'LP'],
  ['Ottawa', '70', 'LP'],
  ['Presque Isle', '71', 'LP'],
  ['Roscommon', '72', 'LP'],
  ['Saginaw', '73', 'LP'],
  ['St. Clair', '74', 'LP'],
  ['St. Joseph', '75', 'LP'],
  ['Sanilac', '76', 'LP'],
  ['Schoolcraft', '77', 'UP'],
  ['Shiawassee', '78', 'LP'],
  ['Tuscola', '79', 'LP'],
  ['Van Buren', '80', 'LP'],
  ['Washtenaw', '81', 'LP'],
  ['Wayne', '82', 'LP'],
  ['Wexford', '83', 'LP'],
];

const OWN_SERVER =
  'County publishes parcels on its own GIS server; not added because it could not be verified from the build environment.';
const UNVERIFIED_HOST =
  'A county parcel service is listed on ArcGIS Online (services8.arcgis.com) but could not be verified from the build environment.';

const NOTES: Record<string, string> = {
  Charlevoix:
    'Partial: the public layer covers only the mainland townships around Charlevoix/Bay Shore (~9k parcels); Beaver Island and the east side are missing.',
  Houghton: 'Parcel data is a Regrid copy published in a Michigan Tech web map; may lag the assessor roll.',
  Marquette: 'From a county landowner-classification study layer; may lag the assessor roll.',
  Kent: 'Third-party republication of county parcels; check the county equalization site for the current owner.',
  Ottawa: 'Third-party republication of county parcels; check the county site for the current owner.',
  Muskegon: 'Third-party republication of county parcels; check the county site for the current owner.',
  Wayne: 'Third-party republication; owner mailing address not included.',
  'Grand Traverse': OWN_SERVER,
  Emmet: OWN_SERVER,
  Oakland: OWN_SERVER,
  Jackson: OWN_SERVER,
  Iron: UNVERIFIED_HOST,
  Arenac: UNVERIFIED_HOST,
  Missaukee: 'County parcel service requires a login (not public).',
  Menominee: 'County parcel service requires a login (not public).',
  Mackinac: 'Public county layer has parcel boundaries but no owner names.',
  Delta: 'Public county layer has parcel numbers but no owner names.',
  Clinton: 'Public county layer has parcel numbers but no owner names.',
  Kalamazoo: 'Public county layer has no owner names.',
};

const HAS = new Set(PARCEL_COUNTIES);

export const MICHIGAN_COUNTIES: MichiganCounty[] = RAW.map(([name, code, peninsula]) => ({
  name,
  code,
  peninsula,
  hasParcels: HAS.has(name),
  ...(NOTES[name] ? { parcelNote: NOTES[name] } : {}),
}));

export function countiesWithoutParcels(): MichiganCounty[] {
  return MICHIGAN_COUNTIES.filter((c) => !c.hasParcels);
}
