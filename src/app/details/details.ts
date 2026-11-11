// Tap/click → details sheet listing every feature under the finger, most permissive land first.

import type { Map as MLMap, GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import { bbox as turfBbox } from '@turf/turf';
import type { Feature } from 'geojson';
import { GRADE_COLORS, type Grade, type LayerSource } from '../../contract';
import type { LayerManager } from '../layers/manager';
import { P, acresOf, isGrade, parseRefs, permissivenessRank } from '../layers/enrich';
import { fill, copyText, h, icon, toast } from '../util/dom';
import { formatLatLon } from '../util/coords';
import { openLetterDialog, tidyOwnerName } from './letter';
import { formatMailing, tidyStreet } from './format';

export const GRADE_LABEL: Record<Grade, string> = {
  green: 'Likely open to public hunting',
  yellow: 'Uncertain — check local rules',
  red: 'Private or closed — permission required',
  unknown: 'Unknown — verify before entering',
};

export const GRADE_SHORT: Record<Grade, string> = { green: 'Public', yellow: 'Check', red: 'Private', unknown: 'Unknown' };

interface Hit {
  source: LayerSource;
  feature: Feature;
  grade: Grade;
}

export interface DetailsDeps {
  map: MLMap;
  layers: LayerManager;
  saveWaypoint: (name: string, note: string, lon: number, lat: number) => void;
  open: () => void;
  close: () => void;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function fmtValue(v: unknown): string {
  if (typeof v === 'number') {
    // ArcGIS dates come as epoch ms.
    if (v > 6e11 && v < 4.2e12) return new Date(v).toLocaleDateString();
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  return str(v);
}

export function ownerBlock(source: LayerSource, props: Record<string, unknown>): { owner: string; mailing: string[]; site: string; parcelId: string } {
  const p = source.parcel;
  const owner = p?.ownerField ? str(props[p.ownerField]) : '';
  const mailing = formatMailing((p?.ownerAddressFields ?? []).map((f) => str(props[f])));
  const site = p?.siteAddressField ? tidyStreet(str(props[p.siteAddressField])) : '';
  const parcelId = p?.parcelIdField ? str(props[p.parcelIdField]) : '';
  return { owner, mailing, site, parcelId };
}

export class Details {
  private readonly body: HTMLElement;

  private readonly deps: DetailsDeps;

  constructor(deps: DetailsDeps) {
    this.deps = deps;
    this.body = document.getElementById('details-body') as HTMLElement;
    const { map } = deps;
    map.addSource('selection', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'selection-casing', type: 'line', source: 'selection', paint: { 'line-color': '#000', 'line-width': 7, 'line-opacity': 0.5 } }, 'anchor-markups');
    map.addLayer({ id: 'selection-line', type: 'line', source: 'selection', paint: { 'line-color': '#ff6a13', 'line-width': 3.5 } }, 'anchor-markups');
    map.addLayer(
      { id: 'selection-point', type: 'circle', source: 'selection', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#ff6a13', 'circle-stroke-width': 3 } },
      'anchor-markups',
    );
  }

  clearSelection(): void {
    this.deps.map.getSource<GeoJSONSource>('selection')?.setData({ type: 'FeatureCollection', features: [] });
  }

  private select(f: Feature): void {
    this.deps.map.getSource<GeoJSONSource>('selection')?.setData(f);
  }

  /** Shows the details for rendered features at a point. Returns false when nothing was hit. */
  showAt(rendered: MapGeoJSONFeature[], lon: number, lat: number): boolean {
    const seen = new Set<string>();
    const hits: Hit[] = [];
    for (const rf of rendered) {
      const fid = str(rf.properties?.[P.fid]);
      if (!fid || seen.has(fid)) continue;
      seen.add(fid);
      const full = this.deps.layers.getFeature(fid);
      const source = full?.source ?? this.deps.layers.sourceById(str(rf.properties?.[P.src]));
      if (!source) continue;
      const feature: Feature = full?.feature ?? { type: 'Feature', geometry: rf.geometry, properties: rf.properties };
      const g = feature.properties?.[P.grade];
      hits.push({ source, feature, grade: isGrade(g) ? g : 'unknown' });
    }
    if (!hits.length) return false;
    hits.sort((a, b) => permissivenessRank(a.source, a.grade) - permissivenessRank(b.source, b.grade));
    this.render(hits, lon, lat);
    return true;
  }

  private render(hits: Hit[], lon: number, lat: number): void {
    const cards = hits.map((hit, i) => this.card(hit, lon, lat, i === 0));
    fill(this.body, 
      h(
        'div.details-head',
        {},
        h('div', {}, h('h2', {}, hits.length > 1 ? `${hits.length} layers here` : 'Details'), h('span.muted.small.mono', {}, formatLatLon(lat, lon))),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Close details', onclick: () => this.close() }, icon('close')),
      ),
      ...cards,
      h('p.fineprint', {}, icon('info'), 'Colours and owner data are informational only, can be outdated or wrong, and are not legal advice. Verify boundaries, ownership and local rules, and get permission before entering private land.'),
    );
    this.select(hits[0].feature);
    this.deps.open();
    this.body.scrollTop = 0;
  }

  close(): void {
    this.clearSelection();
    this.deps.close();
  }

  private card(hit: Hit, lon: number, lat: number, expanded: boolean): HTMLElement {
    const { source, feature } = hit;
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const category = str(props[P.category]) || source.title;
    const reason = str(props[P.reason]);
    const refs = parseRefs(props[P.refs]);
    const isParcel = source.group === 'parcels';
    const isUnit = source.group === 'hunting-units';
    const ob = ownerBlock(source, props);
    const name = str(props[P.name]);
    const title = isParcel ? tidyOwnerName(ob.owner) || 'Parcel' : name || category;
    const acres = acresOf(source, feature);
    const acresText = acres !== null ? `${acres.toLocaleString('en-US', { maximumFractionDigits: acres < 10 ? 2 : acres < 1000 ? 1 : 0 })} acres` : '';

    const rows: [string, string | HTMLElement][] = [];
    if (isParcel) {
      rows.push(['Owner', ob.owner || '—']);
      if (ob.mailing.length) rows.push(['Mailing address', h('span', {}, ...ob.mailing.flatMap((l, i) => (i ? [h('br'), l] : [l])))]);
      if (ob.site) rows.push(['Site address', ob.site]);
      if (ob.parcelId) rows.push(['Parcel ID', h('span.mono', {}, ob.parcelId)]);
      if (source.parcel?.county) rows.push(['County', source.parcel.county]);
    }
    if (acresText && source.geometry === 'polygon') rows.push([source.parcel?.acresField && props[source.parcel.acresField] ? 'Acreage' : 'Area (computed)', acresText]);
    if (isUnit) {
      if (name) rows.push(['Unit', name]);
      if (source.species?.length) rows.push(['Species', source.species.join(', ')]);
    }

    const attrs = source.fields
      .filter((f) => props[f] !== undefined && props[f] !== null && str(props[f]) !== '')
      .map((f) => h('tr', {}, h('th', {}, f), h('td', {}, fmtValue(props[f]))));

    const ownerText = [
      tidyOwnerName(ob.owner),
      ...ob.mailing,
      ob.site ? `Site: ${ob.site}` : '',
      ob.parcelId ? `Parcel ID: ${ob.parcelId}` : '',
      source.parcel?.county ? `${source.parcel.county} County, MI` : '',
      acresText,
    ]
      .filter(Boolean)
      .join('\n');

    const actions = h(
      'div.row.wrap.detail-actions',
      {},
      isParcel && ob.owner
        ? h(
            'button.btn.sm',
            { type: 'button', onclick: async () => toast((await copyText(ownerText)) ? 'Owner info copied' : 'Copy failed') },
            icon('copy'),
            'Copy owner info',
          )
        : null,
      h(
        'button.btn.sm',
        {
          type: 'button',
          onclick: () => {
            const note = [GRADE_SHORT[hit.grade] + ' · ' + category, isParcel ? ownerText : '', reason].filter(Boolean).join('\n');
            this.deps.saveWaypoint(title, note, lon, lat);
          },
        },
        icon('waypoint'),
        'Save as waypoint',
      ),
      isParcel
        ? h(
            'button.btn.sm.primary',
            {
              type: 'button',
              onclick: () =>
                void openLetterDialog({
                  ownerName: ob.owner,
                  ownerAddress: ob.mailing,
                  parcelId: ob.parcelId,
                  siteAddress: ob.site,
                  county: source.parcel?.county,
                  acres: acresText,
                }),
            },
            icon('mail'),
            'Draft permission letter',
          )
        : null,
      h(
        'button.btn.sm.ghost',
        {
          type: 'button',
          onclick: () => {
            this.select(feature);
            if (feature.geometry.type === 'Point') this.deps.map.flyTo({ center: feature.geometry.coordinates as [number, number], zoom: Math.max(this.deps.map.getZoom(), 15) });
            else {
              const b = turfBbox(feature);
              this.deps.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 17 });
            }
          },
        },
        icon('zoomto'),
        'Zoom to',
      ),
    );

    const badge = isUnit
      ? h('span.badge.unit', { style: `--c:${this.deps.layers.colorForUnitLayer(source.id)}` }, 'Unit')
      : h('span.badge', { style: `--c:${GRADE_COLORS[hit.grade]}`, 'data-grade': hit.grade }, GRADE_SHORT[hit.grade]);

    const el = h(
      'details.feature-card',
      { open: expanded, 'data-grade': hit.grade },
      h('summary', {}, badge, h('span.fc-title', {}, h('strong', {}, title), h('span.muted.small', {}, source.title)), icon('chevron', 'ic chev')),
      h(
        'div.fc-body',
        {},
        !isUnit ? h('div.grade-line', { style: `--c:${GRADE_COLORS[hit.grade]}` }, h('strong', {}, category), h('span', {}, GRADE_LABEL[hit.grade])) : null,
        reason ? h('p.reason', {}, reason) : null,
        refs.length ? h('ul.refs', {}, refs.map((r) => h('li', {}, r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.label) : r.label))) : null,
        rows.length ? h('dl.kv', {}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null,
        actions,
        attrs.length ? h('details.attrs', {}, h('summary', {}, 'All attributes'), h('table', {}, h('tbody', {}, attrs))) : null,
        h('p.muted.small.src-attr', {}, `Source: ${source.attribution}`),
      ),
    );
    el.addEventListener('toggle', () => {
      if ((el as HTMLDetailsElement).open) this.select(feature);
    });
    return el;
  }
}
