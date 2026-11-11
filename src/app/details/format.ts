// Address tidying for parcel records (assessor exports are inconsistent). Pure, unit-tested.

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** "0   JACKSON ST" → "JACKSON ST"; collapses whitespace. */
export function tidyStreet(s: string): string {
  return clean(s).replace(/^0+\s+/, '');
}

/**
 * Joins a site address split over several fields ("921", " ", "GREEN", " ") and an optional
 * city ("LANSING" or "MARQUETTE, MI 49855") into "921 GREEN, LANSING". Blank parts and a 0 house
 * number are skipped; a city that is blank or only a state code is left off.
 */
export function formatSiteAddress(parts: readonly unknown[], city?: unknown): string {
  const street = tidyStreet(
    parts
      .map((p) => (p === null || p === undefined ? '' : clean(String(p))))
      .filter((p) => p && !/^0+$/.test(p))
      .join(' '),
  );
  const c = clean(city === null || city === undefined ? '' : String(city))
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
  const cityOk = c && !/^[A-Z]{2}$/i.test(c) && !/^0+$/.test(c);
  if (!street) return '';
  return cityOk ? `${street}, ${c}` : street;
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
