// Tap/click → details sheet: one resolved verdict for the spot first (the parcel's reconciled
// grade, or the same precedence rules applied to the public layers at the point), then the
// county record, every overlapping layer with its own status, boundaries, units and reference.

import type { Map as MLMap, GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import { bbox as turfBbox } from '@turf/turf';
import type { Feature } from 'geojson';
import { GRADE_COLORS, type Grade, type LayerSource } from '../../contract';
import type { LayerManager } from '../layers/manager';
import { P, acresOf, gradeFromProps, isGrade, listRank, parseRefs } from '../layers/enrich';
import { parseNotes, parseOverlaps } from '../layers/reconcileLayers';
import { prepared, contains } from '../layers/coverage';
import { NO_PARCEL, cityOverride, reconcileParcel, tierOf, type Overlap } from '../../grading/reconcile';
import { CITY_OWNED_CATEGORY } from '../../grading/grade';
import { BOUNDARY_NOTE } from '../../grading/grade';
import { boundaryColor } from '../layers/manager';
import type { GradeResult } from '../../contract';
import { fill, copyText, h, icon, toast } from '../util/dom';
import { formatLatLon } from '../util/coords';
import { openLetterDialog, tidyOwnerName } from './letter';
import { formatMailing, formatSiteAddress } from './format';

export const GRADE_LABEL: Record<Grade, string> = {
  green: 'Likely open to public hunting',
  yellow: 'Uncertain — check local rules',
  red: 'Private or closed — permission required',
  unknown: 'Unknown — verify before entering',
};

export const GRADE_SHORT: Record<Grade, string> = { green: 'Public', yellow: 'Check', red: 'Private', unknown: 'Unknown' };

const gradeOrder = (g: Grade): number => ['green', 'yellow', 'red', 'unknown'].indexOf(g);

/** Badge text; a red park hunting zone, city-owned land or land closed by the city rule is closed rather than private. */
export function shortLabel(g: Grade, sourceId?: string, category?: string): string {
  if (g !== 'red') return GRADE_SHORT[g];
  return sourceId === 'dnr-park-hunting' || (category && (category === CITY_OWNED_CATEGORY || / city limits$/.test(category))) ? 'Closed' : GRADE_SHORT[g];
}

interface Hit {
  source: LayerSource;
  feature: Feature;
  grade: Grade;
}

interface Verdict {
  result: GradeResult;
  notes: string[];
  conflict: boolean;
  adoptedFrom?: string;
  /** The parcel the verdict belongs to, if any. */
  parcel?: Hit;
  /** Bare-point verdicts closed by the city rule: the verdict without it, and where it came from. */
  beforeCity?: { result: GradeResult; source?: LayerSource; name?: string };
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
  const site = p?.siteAddressFields?.length
    ? formatSiteAddress(p.siteAddressFields.map((f) => props[f]), p.siteCityField ? props[p.siteCityField] : undefined)
    : p?.siteAddressField
      ? formatSiteAddress([props[p.siteAddressField]], p.siteCityField ? props[p.siteCityField] : undefined)
      : '';
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
    const inside = (h: Hit): boolean => {
      const p = prepared(h.feature);
      return p ? contains(p, lon, lat) : false;
    };
    // The parcel under the point wins ties between neighbours touched by the tap box.
    const rank = (h: Hit): number => listRank(h.source) * 2 + (h.source.group === 'parcels' && !inside(h) ? 1 : 0);
    hits.sort((a, b) => rank(a) - rank(b) || (a.source.group === 'public-land' && b.source.group === 'public-land' ? gradeOrder(a.grade) - gradeOrder(b.grade) : 0));
    this.render(hits, this.verdict(hits, lon, lat), lon, lat);
    return true;
  }

  /**
   * Single verdict for the spot: the parcel's reconciled grade, else the public layers resolved at
   * the point. Both include the city-limits rule (the parcel's city, or the city at the point).
   */
  private verdict(hits: Hit[], lon: number, lat: number): Verdict | null {
    const graded: Overlap[] = hits
      .filter((h) => h.source.group === 'public-land' && tierOf(h.source) !== null)
      .map((h) => ({ source: h.source, grade: gradeFromProps((h.feature.properties ?? {}) as Record<string, unknown>, 'base'), fraction: 1, name: str(h.feature.properties?.[P.name]) || undefined }));
    const parcel = hits.find((h) => h.source.group === 'parcels');
    if (parcel) {
      const props = (parcel.feature.properties ?? {}) as Record<string, unknown>;
      const notes = parseNotes(props[P.notes]);
      const adopted = str(props[P.adopted]);
      // A parcel split between zones (e.g. open and closed park zones): the zone under the finger
      // decides this spot, by the same rules; the parcel-wide strictest grade stays in the notes.
      if (props[P.split] === true && graded.some((o) => o.source.id === adopted)) {
        const r = cityOverride(reconcileParcel(gradeFromProps(props, 'owner'), graded, str(props[P.owner])), str(props[P.city]) || undefined);
        if (r.adoptedFrom === adopted) return { result: r.result, notes: [...notes.filter((n) => !r.notes.includes(n)), ...r.notes.filter((n) => !notes.includes(n)), `At this spot: ${r.result.category}. Parcel-wide (strictest zone): ${str(props[P.category])}.`], conflict: r.conflict, adoptedFrom: adopted, parcel };
      }
      return { result: gradeFromProps(props), notes, conflict: props[P.conflict] === true, adoptedFrom: adopted || undefined, parcel };
    }
    if (!graded.length) return null;
    const r = cityOverride(reconcileParcel(NO_PARCEL, graded), this.deps.layers.cities?.at(lon, lat));
    const from = r.adoptedFrom ? graded.find((o) => o.source.id === r.adoptedFrom) : undefined;
    return {
      result: r.result,
      notes: r.notes.filter((n) => !n.startsWith('No owner name')),
      conflict: r.conflict,
      adoptedFrom: r.adoptedFrom,
      beforeCity: r.beforeCity ? { result: r.beforeCity, source: from?.source, name: from?.name } : undefined,
    };
  }

  private verdictBlock(v: Verdict): HTMLElement {
    const g = v.result.grade;
    const refs = v.result.references ?? [];
    const parts: (HTMLElement | null)[] = [];
    if (v.beforeCity) {
      // Away from parcels: the public-land record the city rule closed, listed like a parcel record.
      const b = v.beforeCity;
      parts.push(
        h(
          'p.record-line',
          {},
          h('span.muted', {}, `${b.source?.title ?? 'Land'} record: `),
          h('strong', {}, b.name || b.result.category),
          ' → ',
          h('span.badge.sm', { style: `--c:${GRADE_COLORS[b.result.grade]}`, 'data-grade': b.result.grade }, GRADE_SHORT[b.result.grade]),
          ' ',
          b.result.category,
        ),
      );
    }
    if (v.parcel) {
      const { source, feature } = v.parcel;
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      const owner = gradeFromProps(props, 'owner');
      const ownerName = ownerBlock(source, props).owner;
      parts.push(
        h(
          'p.record-line',
          {},
          h('span.muted', {}, source.parcel?.ownerField ? 'County parcel record: ' : 'Parcel record: '),
          h('strong', {}, ownerName ? tidyOwnerName(ownerName) : source.parcel?.ownerField ? '(no owner name)' : source.title),
          ' → ',
          h('span.badge.sm', { style: `--c:${GRADE_COLORS[owner.grade]}`, 'data-grade': owner.grade }, shortLabel(owner.grade, undefined, owner.category)),
          ' ',
          owner.category,
        ),
      );
      const overlaps = parseOverlaps(props[P.overlaps]);
      if (overlaps.length) {
        parts.push(
          h(
            'ul.overlap-list',
            {},
            overlaps.map((o) => {
              const src = this.deps.layers.sourceById(o.src);
              const grade: Grade = isGrade(o.grade) ? o.grade : 'unknown';
              const hidden = src && !this.deps.layers.getStatus(src.id).active ? ' (layer hidden on map)' : '';
              return h(
                'li',
                {},
                h('span.badge.sm', { style: `--c:${GRADE_COLORS[grade]}`, 'data-grade': grade }, shortLabel(grade, o.src)),
                h('span', {}, h('strong', {}, src?.title ?? o.src), ` — ${o.name ? `${o.name}: ` : ''}${o.category} · about ${o.pct}% of the parcel${hidden}`),
              );
            }),
          ),
        );
      }
    }
    return h(
      'section.verdict',
      { 'data-grade': g, 'data-conflict': v.conflict ? 'true' : null, style: `--c:${GRADE_COLORS[g]}` },
      h('div.verdict-head', {}, h('span.badge', { style: `--c:${GRADE_COLORS[g]}`, 'data-grade': g }, v.conflict ? 'Verify' : shortLabel(g, v.adoptedFrom, v.result.category)), h('span', {}, h('strong', {}, v.result.category), h('span.small', {}, GRADE_LABEL[g]))),
      v.result.reason ? h('p.reason', {}, v.result.reason) : null,
      v.notes.length ? h('ul.verdict-notes', {}, v.notes.map((n) => h('li', {}, n))) : null,
      refs.length ? h('ul.refs', {}, refs.map((r) => h('li', {}, r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.label) : r.label))) : null,
      ...parts,
    );
  }

  private render(hits: Hit[], verdict: Verdict | null, lon: number, lat: number): void {
    const cards = hits.map((hit, i) => this.card(hit, lon, lat, i === 0 && !verdict?.parcel, hit === verdict?.parcel));
    fill(this.body, 
      h(
        'div.details-head',
        {},
        h('div', {}, h('h2', {}, verdict ? 'This spot' : hits.length > 1 ? `${hits.length} layers here` : 'Details'), h('span.muted.small.mono', {}, formatLatLon(lat, lon))),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Close details', onclick: () => this.close() }, icon('close')),
      ),
      verdict ? this.verdictBlock(verdict) : null,
      hits.length > 1 || verdict ? h('h3.layers-here', {}, `Layers here (${hits.length})`) : null,
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

  private card(hit: Hit, lon: number, lat: number, expanded: boolean, primary = false): HTMLElement {
    const { source, feature } = hit;
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const isBoundary = source.role === 'boundary';
    const category = str(props[P.category]) || source.title;
    const reason = str(props[P.reason]);
    const refs = parseRefs(props[P.refs]);
    const isParcel = source.group === 'parcels';
    const isUnit = source.group === 'hunting-units';
    const ob = ownerBlock(source, props);
    const name = str(props[P.name]);
    const title = isParcel ? tidyOwnerName(ob.owner) || 'Parcel' : isBoundary ? `Inside the boundary of ${name || category}` : name || category;
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
      : isBoundary
        ? h('span.badge.unit', { style: `--c:${boundaryColor(source.id)}` }, 'Boundary')
        : h('span.badge', { style: `--c:${GRADE_COLORS[hit.grade]}`, 'data-grade': hit.grade }, props[P.conflict] === true ? 'Verify' : shortLabel(hit.grade, str(props[P.adopted]) || source.id, category));
    const showGrade = !isUnit && !isBoundary && !primary;

    const el = h(
      'details.feature-card',
      { open: expanded, 'data-grade': isBoundary ? 'boundary' : hit.grade },
      h('summary', {}, badge, h('span.fc-title', {}, h('strong', {}, title), h('span.muted.small', {}, source.title)), icon('chevron', 'ic chev')),
      h(
        'div.fc-body',
        {},
        showGrade ? h('div.grade-line', { style: `--c:${GRADE_COLORS[hit.grade]}` }, h('strong', {}, category), h('span', {}, GRADE_LABEL[hit.grade])) : null,
        isBoundary ? h('p.reason', {}, `Inside the boundary of ${name || category} (${category}) — ${BOUNDARY_NOTE}. It is not an access verdict: the parcel and land-ownership records decide whether you may hunt here.`) : null,
        primary ? h('p.muted.small', {}, 'The verdict above is this parcel’s resolved grade.') : null,
        reason && !primary && !isBoundary ? h('p.reason', {}, reason) : null,
        refs.length && !primary ? h('ul.refs', {}, refs.map((r) => h('li', {}, r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.label) : r.label))) : null,
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
