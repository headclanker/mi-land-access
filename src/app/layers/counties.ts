// County awareness: which county is under the map centre, which counties are in view, and
// whether we have parcel/owner data there. Outlines come (generalised, once) from the county
// boundary reference layer in the catalogue; coverage flags from src/data/counties.ts.

import { booleanPointInPolygon, bbox as turfBbox } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { LayerSource } from '../../contract';
import { MICHIGAN_COUNTIES, type MichiganCounty } from '../../data/counties';
import { fetchFeatures, type BBox } from './arcgis';

export const normCounty = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\s+county$/, '')
    .replace(/^saint\s+/, 'st ')
    .replace(/[^a-z]/g, '');

interface Outline {
  key: string;
  name: string;
  bbox: BBox;
  feature: Feature<Polygon | MultiPolygon>;
}

const MI_BBOX: BBox = [-90.5, 41.6, -82.1, 48.4];

function findCountySource(sources: readonly LayerSource[]): LayerSource | undefined {
  return (
    sources.find((s) => s.id === 'ref-counties') ??
    sources.find((s) => s.group === 'reference' && s.geometry === 'polygon' && /count/i.test(`${s.id} ${s.title}`))
  );
}

export class CountyIndex {
  private outlines: Outline[] = [];
  private readonly byKey = new Map<string, MichiganCounty>();
  loaded = false;

  constructor() {
    for (const c of MICHIGAN_COUNTIES) this.byKey.set(normCounty(c.name), c);
  }

  /** Fetches generalised county outlines once (cached by the service worker afterwards). */
  async load(sources: readonly LayerSource[]): Promise<void> {
    const src = findCountySource(sources);
    if (!src) return;
    const nameField = src.fields.find((f) => /^name$/i.test(f)) ?? src.nameField ?? src.fields[0];
    try {
      const { features } = await fetchFeatures({ layerUrl: src.url, fields: [nameField], bbox: MI_BBOX, cap: 200, maxAllowableOffset: 0.004, where: src.where });
      this.outlines = features
        .filter((f): f is Feature<Polygon | MultiPolygon> => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')
        .map((f) => {
          const raw = String(f.properties?.[nameField] ?? '');
          const key = normCounty(raw);
          const b = turfBbox(f);
          return { key, name: this.byKey.get(key)?.name ?? raw, bbox: [b[0], b[1], b[2], b[3]] as BBox, feature: f };
        });
      this.loaded = this.outlines.length > 0;
    } catch (err) {
      console.warn('County outlines unavailable; parcel layers will load without county filtering', err);
    }
  }

  countyAt(lon: number, lat: number): { name: string; info?: MichiganCounty } | undefined {
    for (const o of this.outlines) {
      const [w, s, e, n] = o.bbox;
      if (lon < w || lon > e || lat < s || lat > n) continue;
      if (booleanPointInPolygon([lon, lat], o.feature)) return { name: o.name, info: this.byKey.get(o.key) };
    }
    return undefined;
  }

  /** Normalised keys of counties whose bounding box touches the view. */
  inView(view: BBox): Set<string> {
    const out = new Set<string>();
    for (const o of this.outlines) {
      const [w, s, e, n] = o.bbox;
      if (w <= view[2] && e >= view[0] && s <= view[3] && n >= view[1]) out.add(o.key);
    }
    return out;
  }

  info(name: string): MichiganCounty | undefined {
    return this.byKey.get(normCounty(name));
  }

  /** Whether a county parcel layer should be queried for this view (true when unknown). */
  layerCoversView(s: LayerSource, view: BBox): boolean {
    if (!s.parcel || !this.loaded) return true;
    const key = normCounty(s.parcel.county);
    if (!this.byKey.has(key)) return true; // "Statewide" and other non-county layers
    return this.inView(view).has(key);
  }
}

export function countyHasParcels(name: string, info: MichiganCounty | undefined, sources: readonly LayerSource[]): boolean {
  if (info?.hasParcels) return true;
  return sources.some((s) => s.parcel && normCounty(s.parcel.county) === normCounty(name));
}

export function parcelCounties(sources: readonly LayerSource[]): string[] {
  const all = sources.filter((s) => s.parcel).map((s) => s.parcel!.county);
  return [...new Set(all)].filter((c) => MICHIGAN_COUNTIES.some((m) => normCounty(m.name) === normCounty(c))).sort();
}
