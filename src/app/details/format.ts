// Address tidying for parcel records (assessor exports are inconsistent). Pure, unit-tested.

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** "0   JACKSON ST" → "JACKSON ST"; collapses whitespace. */
export function tidyStreet(s: string): string {
  return clean(s).replace(/^0+\s+/, '');
}

/** Normalises a ZIP: drops a "-0000" suffix. */
export function tidyZip(s: string): string {
  return clean(s).replace(/^(\d{5})-?0000$/, '$1').replace(/^(\d{5})(\d{4})$/, '$1-$2');
}

/**
 * Turns separate owner-address fields (street, city, state, zip — or already-combined
 * "CITY ST ZIP") into envelope lines: ["810 DIETZ RD N", "WEBBERVILLE, MI 48892"].
 */
export function formatMailing(fields: readonly string[]): string[] {
  const parts = fields.map(clean).filter(Boolean);
  if (parts.length <= 1) return parts.map(tidyStreet);
  const [street, ...rest] = parts;
  const zipIdx = rest.findIndex((p) => /^\d{5}(-?\d{4})?$/.test(p));
  if (zipIdx >= 0) rest[zipIdx] = tidyZip(rest[zipIdx]);
  let last: string;
  if (rest.length >= 2 && /^[A-Z]{2}$/i.test(rest[1])) last = `${rest[0]}, ${rest.slice(1).join(' ')}`;
  else last = rest.join(' ');
  return [tidyStreet(street), last.replace(/\s+,/g, ',')].filter(Boolean);
}
