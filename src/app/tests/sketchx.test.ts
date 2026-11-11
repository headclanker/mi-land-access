import { describe, expect, it } from 'vitest';
import { formatSiteAddress } from '../details/format';
import { cleanPhone, draftText, ownerKey, smsHref, smsPlatform, tidyPlace } from '../details/letter';
import { groupByName, likeWhere, matchCounties, matchMarkups, matchScore, normQuery } from '../ui/search';
import { overviewWanted, type LiveState } from '../layers/overview';
import { describeGpsError } from '../tracker/gpsError';
import { GRADE_LIKE_COLORS, MARKUP_COLORS, defaultColor, type Markup } from '../markups/model';
import { GRADE_COLORS } from '../../contract';
import { LAYER_SOURCES, OVERVIEW_HANDOFF_ZOOM, OVERVIEW_LAYER_IDS } from '../../data/sources';

describe('site address', () => {
  it('joins split fields and the city, skipping blanks and a 0 house number', () => {
    expect(formatSiteAddress([921, ' ', 'GREEN', ' '], 'LANSING')).toBe('921 GREEN, LANSING');
    expect(formatSiteAddress([0, ' ', 'GREEN', ' '], 'LANSING')).toBe('GREEN, LANSING');
    expect(formatSiteAddress([4114, 'N', 'PINE DELL', null], 'LANSING')).toBe('4114 N PINE DELL, LANSING');
  });
  it('handles a single combined field and junk cities', () => {
    expect(formatSiteAddress(['0   JACKSON ST'])).toBe('JACKSON ST');
    expect(formatSiteAddress(['113 CO RD AAT', 0, ' '], ', MI')).toBe('113 CO RD AAT');
    expect(formatSiteAddress(['1027 N FRONT ST', 0, ' '], 'MARQUETTE, MI 49855')).toBe('1027 N FRONT ST, MARQUETTE, MI 49855');
    expect(formatSiteAddress([' ', 0], 'LANSING')).toBe('');
  });
  it('every split-address parcel layer requests the fields it maps', () => {
    for (const s of LAYER_SOURCES.filter((x) => x.parcel?.siteAddressFields)) {
      for (const f of [...(s.parcel?.siteAddressFields ?? []), ...(s.parcel?.siteCityField ? [s.parcel.siteCityField] : [])]) expect(s.fields, `${s.id} ${f}`).toContain(f);
    }
    const ingham = LAYER_SOURCES.find((x) => x.id === 'parcels-ingham');
    expect(ingham?.parcel?.siteAddressFields).toEqual(['PROPADDRNU', 'PROPADDRDI', 'PROPSTREET', 'UNITORAPT']);
  });
});

describe('text message', () => {
  const base = { siteAddress: 'EDGAR RD, MASON', county: 'Ingham', parcelId: '33-09-09-01-100-011', sender: { name: 'Sam Hunter', phone: '517-555-0100', email: 'sam@example.com' }, activity: 'bow hunt deer', season: 'the 2026 archery season' };
  it('is short, polite and covers who, what, where and how to reach me', () => {
    const t = draftText(base);
    expect(t).toContain("I'm Sam Hunter");
    expect(t).toContain('May I bow hunt deer on your land at Edgar Rd, Mason (Ingham County) during the 2026 archery season?');
    expect(t).toContain('Reach me at 517-555-0100.');
    expect(t).not.toContain('sam@example.com'); // phone first; email only without a phone
    expect(t.length).toBeLessThanOrEqual(320); // two SMS segments
    expect(/[^\x00-\x7f]/.test(t)).toBe(false); // plain GSM-friendly text
  });
  it('falls back to parcel / county and email, with placeholders when empty', () => {
    const t = draftText({ ...base, siteAddress: '', sender: { name: '', phone: '', email: 'sam@example.com' }, activity: '', season: '' });
    expect(t).toContain('your land in Ingham County (parcel 33-09-09-01-100-011)');
    expect(t).toContain('Reach me at sam@example.com.');
    expect(t).toContain('[your name]');
    expect(t).toContain('May I hunt');
    expect(draftText({ ...base, siteAddress: '', parcelId: '', county: '' })).toContain('on your land during');
  });
  it('tidies all-caps places but keeps directions and route letters', () => {
    expect(tidyPlace('921 N GREEN RD, LANSING')).toBe('921 N Green Rd, Lansing');
    expect(tidyPlace('M 28 E')).toBe('M 28 E');
    expect(tidyPlace('Already Mixed')).toBe('Already Mixed');
  });
  it('builds iOS and Android sms: links', () => {
    expect(smsHref('(517) 555-0142', 'Hi & thanks?', 'ios')).toBe('sms:5175550142&body=Hi%20%26%20thanks%3F');
    expect(smsHref('(517) 555-0142', 'Hi & thanks?', 'other')).toBe('sms:5175550142?body=Hi%20%26%20thanks%3F');
    expect(smsHref('', 'Hi', 'ios')).toBe('sms:&body=Hi');
    expect(smsHref('', 'Hi', 'other')).toBe('sms:?body=Hi');
    expect(smsHref('+1 517 555 0142', 'x', 'other')).toBe('sms:+15175550142?body=x');
  });
  it('cleans phone numbers and detects iOS', () => {
    expect(cleanPhone('517.555.0142')).toBe('5175550142');
    expect(cleanPhone('555')).toBe('');
    expect(smsPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(smsPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios'); // iPadOS
    expect(smsPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('other');
    expect(smsPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('other');
  });
  it('remembers numbers per owner (or per parcel without an owner name)', () => {
    expect(ownerKey('Smith  John', 'Ingham', '1')).toBe(ownerKey('SMITH JOHN', 'Ingham', '2'));
    expect(ownerKey('', 'Ingham', '1')).not.toBe(ownerKey('', 'Ingham', '2'));
  });
});

describe('search', () => {
  it('builds safe LIKE clauses', () => {
    expect(likeWhere(['Park_Label', 'UNIT_NAME'], 'Waterloo rec')).toBe("UPPER(Park_Label) LIKE '%WATERLOO%REC%' OR UPPER(UNIT_NAME) LIKE '%WATERLOO%REC%'");
    expect(likeWhere(['A'], "o'neil%_ \\")).toBe("UPPER(A) LIKE '%O%NEIL%'");
    expect(likeWhere(['A'], "''")).toBe('1=0');
    expect(normQuery('  Allegan   SGA ')).toBe('allegan sga');
  });
  it('ranks exact and prefix matches first', () => {
    expect(matchScore('Allegan', 'allegan')).toBeGreaterThan(matchScore('Allegan State Game Area', 'allegan'));
    expect(matchScore('Allegan State Game Area', 'game')).toBeGreaterThan(0);
    expect(matchScore('Allegan', 'zz')).toBe(0);
  });
  it('matches counties, with or without "county" and "saint"', () => {
    expect(matchCounties('allegan')[0]).toBe('Allegan');
    expect(matchCounties('Allegan County')[0]).toBe('Allegan');
    expect(matchCounties('saint joseph')).toContain('St. Joseph');
    expect(matchCounties('st joseph')).toContain('St. Joseph');
    expect(matchCounties('a')).toEqual([]);
  });
  it('finds markups by name or note', () => {
    const ms: Markup[] = [
      { id: 'w', kind: 'waypoint', name: 'North stand', note: '', color: '#ff6a13', created: 1, updated: 5, coord: [-84.7, 44.6], icon: 'stand' },
      { id: 's', kind: 'shape', name: 'Swamp', note: 'bedding near north ridge', color: '#a855f7', created: 1, updated: 2, coords: [[-84.7, 44.6], [-84.71, 44.6], [-84.71, 44.61]] },
    ];
    const r = matchMarkups('north', ms);
    expect(r.map((x) => x.markupId)).toEqual(['w', 's']);
    expect(r[0].point).toEqual([-84.7, 44.6]);
    expect(r[1].bbox).toEqual([-84.71, 44.6, -84.7, 44.61]);
  });
  it('merges game-area pieces into one result per name', () => {
    const sq = (x: number) => ({ type: 'Polygon' as const, coordinates: [[[x, 42], [x + 1, 42], [x + 1, 43], [x, 43], [x, 42]]] });
    const g = groupByName({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { N: 'Allegan SGA' }, geometry: sq(-86) }, { type: 'Feature', properties: { N: 'Allegan SGA' }, geometry: sq(-85) }, { type: 'Feature', properties: { N: 'Other' }, geometry: sq(-84) }] }, 'N');
    expect(g).toEqual([{ name: 'Allegan SGA', bbox: [-86, 42, -84, 43] }, { name: 'Other', bbox: [-84, 42, -83, 43] }]);
  });
});

describe('public-land overview hand-off', () => {
  const st = (o: Partial<LiveState> = {}): LiveState => ({ visible: true, active: true, loading: false, count: 10, truncated: false, ...o });
  it('shows below the hand-off zoom, never at parcel zoom', () => {
    expect(overviewWanted(6, [st()])).toBe(true);
    expect(overviewWanted(13.2, [st({ truncated: true })])).toBe(false);
  });
  it('stays up until live layers have drawn, then steps aside', () => {
    expect(overviewWanted(9.1, [st({ active: false, count: 0 })])).toBe(true); // not switched on yet
    expect(overviewWanted(9.1, [st({ loading: true, count: 0 })])).toBe(true);
    expect(overviewWanted(9.1, [st({ loading: true, count: 5 })])).toBe(false);
    expect(overviewWanted(9.1, [st({ count: 0 })])).toBe(false); // loaded, nothing here
    expect(overviewWanted(9.1, [st({ visible: false, count: 0 })])).toBe(false);
  });
  it('stands in while a live layer hit its feature limit', () => {
    expect(overviewWanted(10.5, [st({ truncated: true }), st()])).toBe(true);
  });
  it('covers layers whose live minZoom is the hand-off zoom', () => {
    for (const id of OVERVIEW_LAYER_IDS) expect(LAYER_SOURCES.find((s) => s.id === id)?.minZoom).toBe(OVERVIEW_HANDOFF_ZOOM);
  });
});

describe('map defaults', () => {
  it('starts with deer management units off', () => {
    expect(LAYER_SOURCES.find((s) => s.id === 'unit-deer-dmu')?.defaultVisible).toBe(false);
  });
  it('never offers or defaults markups to a grade colour', () => {
    const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const dist = (a: string, b: string) => Math.hypot(...hex(a).map((v, i) => v - hex(b)[i]));
    for (const c of MARKUP_COLORS) {
      expect(GRADE_LIKE_COLORS as readonly string[]).not.toContain(c);
      for (const g of [GRADE_COLORS.green, GRADE_COLORS.yellow, GRADE_COLORS.red]) expect(dist(c, g), `${c} vs ${g}`).toBeGreaterThan(90);
    }
    for (const k of ['waypoint', 'line', 'shape', 'track'] as const) expect(MARKUP_COLORS as readonly string[]).toContain(defaultColor(k));
  });
});

describe('GPS errors', () => {
  it('ignores blips while fixes are flowing, reports when they stop', () => {
    expect(describeGpsError(2, 500)).toBeNull();
    expect(describeGpsError(3, 5_000)).toBeNull();
    expect(describeGpsError(2, Infinity)).toMatch(/unavailable/);
    expect(describeGpsError(3, 25_000)).toMatch(/waiting/);
    expect(describeGpsError(1, 0)).toMatch(/denied/);
  });
});
