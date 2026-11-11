import { describe, expect, it } from 'vitest';
import { formatMailing, tidyStreet, tidyZip } from '../details/format';
import { draftLetter, salutation, tidyOwnerName } from '../details/letter';
import { headingFromEvent, smoothHeading } from '../compass/compass';

describe('address formatting', () => {
  it('joins separate city/state/zip fields', () => {
    expect(formatMailing(['810 DIETZ RD N', 'WEBBERVILLE', 'MI', '48892-0000'])).toEqual(['810 DIETZ RD N', 'WEBBERVILLE, MI 48892']);
  });
  it('keeps combined city lines', () => {
    expect(formatMailing(['PO BOX 12', 'GRAYLING MI 49738'])).toEqual(['PO BOX 12', 'GRAYLING MI 49738']);
  });
  it('drops empties and tidies streets', () => {
    expect(formatMailing(['', '  '])).toEqual([]);
    expect(tidyStreet('0   JACKSON ST')).toBe('JACKSON ST');
    expect(tidyZip('488921234')).toBe('48892-1234');
  });
});

describe('permission letter', () => {
  it('tidies all-caps owner names but keeps entity suffixes', () => {
    expect(tidyOwnerName('HAMLIN FARMS LLC')).toBe('Hamlin Farms LLC');
    expect(tidyOwnerName('Already Mixed')).toBe('Already Mixed');
  });
  it('uses a generic salutation for organisations', () => {
    expect(salutation('Hamlin Farms LLC')).toBe('Dear Property Owner,');
    expect(salutation('John Smith')).toBe('Dear John Smith,');
  });
  it('includes parcel, county, sender and contact', () => {
    const t = draftLetter({
      ownerName: 'SMITH JOHN',
      ownerAddress: ['1 MAIN ST', 'LANSING, MI 48933'],
      parcelId: '33-01-01',
      county: 'Ingham',
      siteAddress: '100 FIELD RD',
      sender: { name: 'Sam Hunter', phone: '555-0100', email: '', address: '' },
      activity: 'bow hunt deer',
      season: 'the 2026 archery season',
      date: new Date(2026, 8, 1),
    });
    expect(t).toContain('Dear Smith John,');
    expect(t).toContain('permission to bow hunt deer on your property at 100 FIELD RD (parcel 33-01-01, Ingham County) during the 2026 archery season');
    expect(t).toContain('phone 555-0100');
    expect(t).toContain('September 1, 2026');
  });
});

describe('compass maths', () => {
  it('prefers iOS webkitCompassHeading', () => {
    expect(headingFromEvent({ alpha: 10, webkitCompassHeading: 270 })).toBe(270);
  });
  it('uses 360 - alpha for absolute orientation and adds screen angle', () => {
    expect(headingFromEvent({ alpha: 90, absolute: true })).toBe(270);
    expect(headingFromEvent({ alpha: 90, absolute: true }, 90)).toBe(0);
    expect(headingFromEvent({ alpha: 90, absolute: false })).toBeNull();
  });
  it('smooths across north without spinning', () => {
    const s = smoothHeading(350, 10, 0.5);
    expect(s).toBeCloseTo(0, 6);
  });
});
