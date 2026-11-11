import type { Map as MLMap } from 'maplibre-gl';
import { GRADE_COLORS, type Grade, type LayerGroup, type LayerSource } from '../../contract';
import type { LayerManager } from '../layers/manager';
import { countyHasParcels, parcelCounties } from '../layers/counties';
import { GRADE_LABEL } from '../details/details';
import { fill, h, icon } from '../util/dom';
import { prefGet, prefSet } from '../util/store';

const GROUPS: { id: LayerGroup; title: string }[] = [
  { id: 'public-land', title: 'Public land' },
  { id: 'parcels', title: 'Parcels' },
  { id: 'hunting-units', title: 'Hunting units' },
  { id: 'reference', title: 'Reference' },
];

const LEGEND: { grade: Grade; title: string }[] = [
  { grade: 'green', title: 'Public' },
  { grade: 'yellow', title: 'Check first' },
  { grade: 'red', title: 'Private / closed' },
  { grade: 'unknown', title: 'Unknown' },
];

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export class LayerPanel {
  private rows = new Map<string, { status: HTMLElement; input: HTMLInputElement; row: HTMLElement }>();
  private hint: HTMLElement = h('div.hint-slot');

  private readonly root: HTMLElement;
  private readonly map: MLMap;
  private readonly layers: LayerManager;

  constructor(root: HTMLElement, map: MLMap, layers: LayerManager) {
    this.root = root;
    this.map = map;
    this.layers = layers;
    this.build();
    layers.onChange(() => this.update());
    this.update();
  }

  private build(): void {
    const legend = h(
      'details.legend',
      { open: prefGet('legendOpen', true), ontoggle: (e: Event) => prefSet('legendOpen', (e.currentTarget as HTMLDetailsElement).open) },
      h('summary', {}, 'What the colours mean'),
      h(
        'ul',
        {},
        LEGEND.map((l) => h('li', {}, h('span.legend-chip', { style: `--c:${GRADE_COLORS[l.grade]}` }), h('span', {}, h('strong', {}, l.title), h('span.muted.small', {}, GRADE_LABEL[l.grade])))),
      ),
      h('p.muted.small', {}, 'Grades are an automated guess from ownership records — not legal advice. Always verify boundaries and rules, and get permission for private land.'),
    );
    const groups = GROUPS.map((g) => {
      const srcs = this.layers.sources.filter((s) => s.group === g.id);
      if (!srcs.length) return null;
      const extra = g.id === 'hunting-units' ? this.speciesSelect() : null;
      if (g.id === 'parcels') return this.parcelGroup(g.title, srcs);
      return h('section.layer-group', {}, h('h3.group-title', {}, g.title), extra, h('ul.layer-list', {}, srcs.map((s) => this.row(s))));
    });
    fill(this.root, legend, this.hint, ...groups.filter((x): x is HTMLElement => x !== null));
    if (!this.layers.sources.length) this.root.append(h('p.muted', {}, 'No data layers are configured.'));
  }

  private countyMaster: HTMLInputElement | null = null;
  private countySummary: HTMLElement | null = null;

  /** County parcel layers are many: one master switch plus a collapsible per-county list. */
  private parcelGroup(title: string, srcs: LayerSource[]): HTMLElement {
    const isCounty = (s: LayerSource): boolean => Boolean(s.parcel && this.layers.counties.info(s.parcel.county));
    const county = srcs.filter(isCounty).sort((a, b) => a.title.localeCompare(b.title));
    const other = srcs.filter((s) => !isCounty(s));
    const master = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'County parcels with owner names' });
    master.addEventListener('change', () => {
      for (const s of county) this.layers.setVisible(s.id, master.checked);
    });
    this.countyMaster = master;
    this.countySummary = h('span.layer-status');
    return h(
      'section.layer-group',
      {},
      h('h3.group-title', {}, title),
      h(
        'ul.layer-list',
        {},
        county.length
          ? h(
              'li.layer-row',
              {},
              h('label.layer-label', {}, master, h('span.switch', { 'aria-hidden': 'true' }), h('span.layer-sw.parcel'), h('span.layer-text', {}, h('span.layer-title', {}, 'County parcels (owner names)'), this.countySummary)),
            )
          : null,
        other.map((s) => this.row(s)),
      ),
      county.length ? h('details.county-list', {}, h('summary', {}, `Counties with parcel data (${county.length})`), h('ul.layer-list', {}, county.map((s) => this.row(s)))) : null,
    );
  }

  private speciesSelect(): HTMLElement | null {
    const species = this.layers.allSpecies();
    if (!species.length) return null;
    const sel = h('select', { 'aria-label': 'Target species' }, h('option', { value: 'all' }, 'All species'), species.map((s) => h('option', { value: s }, cap(s))));
    sel.value = species.includes(this.layers.getSpecies()) ? this.layers.getSpecies() : 'all';
    sel.addEventListener('change', () => {
      const sp = sel.value;
      // Picking a species with none of its unit layers on turns the first one on.
      const matching = this.layers.sources.filter((s) => s.group === 'hunting-units' && s.species?.some((x) => x.toLowerCase() === sp));
      if (sp !== 'all' && matching.length && !matching.some((s) => this.layers.getStatus(s.id).visible)) this.layers.setVisible(matching[0].id, true);
      this.layers.setSpecies(sp);
    });
    return h('label.species', {}, h('span', {}, 'Target species'), sel);
  }

  private row(s: LayerSource): HTMLElement {
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': s.title });
    input.addEventListener('change', () => this.layers.setVisible(s.id, input.checked));
    const status = h('span.layer-status');
    const swatchColor = s.group === 'hunting-units' ? this.layers.colorForUnitLayer(s.id) : s.fixedGrade ? GRADE_COLORS[s.fixedGrade.grade] : '';
    const sw = s.group === 'hunting-units' ? h('span.layer-sw.unit', { style: `--c:${swatchColor}` }) : s.fixedGrade ? h('span.layer-sw', { style: `--c:${swatchColor}` }) : h('span.layer-sw.multi');
    const row = h('li.layer-row', {}, h('label.layer-label', {}, input, h('span.switch', { 'aria-hidden': 'true' }), sw, h('span.layer-text', {}, h('span.layer-title', {}, s.title), status)));
    this.rows.set(s.id, { status, input, row });
    return row;
  }

  update(): void {
    const zoom = this.map.getZoom();
    for (const s of this.layers.sources) {
      const r = this.rows.get(s.id);
      if (!r) continue;
      const st = this.layers.getStatus(s.id);
      r.input.checked = st.visible;
      r.row.classList.toggle('dim', st.visible && !st.active);
      // With a target species chosen, other species' unit layers are filtered out of the list.
      r.row.hidden = st.hiddenReason === 'species';
      let text: (string | HTMLElement)[] = [];
      if (!st.visible) text = [];
      else if (st.hiddenReason === 'species') text = [`Hidden: not a ${cap(this.layers.getSpecies())} unit`];
      else if (st.hiddenReason === 'county') text = ['Not in view'];
      else if (st.hiddenReason === 'zoom')
        text = [
          `Zoom in to see (now ${zoom.toFixed(0)}, needs ${s.minZoom})`,
          h('button.link-btn', { type: 'button', onclick: () => this.map.easeTo({ zoom: s.minZoom + 0.2 }) }, 'Zoom in'),
        ];
      else if (st.loading) text = [h('span.spinner', { 'aria-hidden': 'true' }), `Loading… ${st.count ? `${st.count} so far` : ''}`];
      else if (st.error) text = [h('span.err', {}, st.error)];
      else text = [`${st.count.toLocaleString()} in view${st.truncated ? ' (limit reached — zoom in for all)' : ''}`];
      fill(r.status, ...text);
    }
    this.updateCountyMaster(zoom);
    this.updateHint(zoom);
  }

  private updateCountyMaster(zoom: number): void {
    if (!this.countyMaster || !this.countySummary) return;
    const county = this.layers.sources.filter((s) => s.parcel && this.layers.counties.info(s.parcel.county));
    const st = county.map((s) => ({ s, st: this.layers.getStatus(s.id) }));
    const on = st.filter((x) => x.st.visible).length;
    this.countyMaster.checked = on > 0;
    this.countyMaster.indeterminate = on > 0 && on < st.length;
    const minZ = Math.min(...county.map((s) => s.minZoom));
    const active = st.filter((x) => x.st.active);
    const loading = active.some((x) => x.st.loading);
    const count = active.reduce((n, x) => n + x.st.count, 0);
    let msg: (string | HTMLElement)[];
    if (!on) msg = [];
    else if (zoom < minZ) msg = [`Zoom in to see (now ${zoom.toFixed(0)}, needs ${minZ})`, h('button.link-btn', { type: 'button', onclick: () => this.map.easeTo({ zoom: minZ + 0.2 }) }, 'Zoom in')];
    else if (!active.length) msg = ['No county parcel data in view'];
    else if (loading) msg = [h('span.spinner', { 'aria-hidden': 'true' }), `Loading ${active.map((x) => x.s.parcel?.county).join(', ')}…`];
    else {
      const err = active.find((x) => x.st.error);
      msg = err ? [h('span.err', {}, `${err.s.parcel?.county}: ${err.st.error}`)] : [`${count.toLocaleString()} parcels in view · ${active.map((x) => x.s.parcel?.county).join(', ')}`];
    }
    fill(this.countySummary, ...msg);
  }

  /** County-level parcel coverage hint. */
  private updateHint(zoom: number): void {
    const parcelSources = this.layers.sources.filter((s) => s.group === 'parcels');
    const anyOn = parcelSources.some((s) => this.layers.getStatus(s.id).visible);
    if (!parcelSources.length || !anyOn || zoom < 9) {
      fill(this.hint);
      return;
    }
    const c = this.map.getCenter();
    const covered = parcelCounties(this.layers.sources);
    let msg: string | null = null;
    const here = this.layers.counties.countyAt(c.lng, c.lat);
    if (here && !countyHasParcels(here.name, here.info, this.layers.sources)) {
      msg = `No owner/parcel data for ${here.name} County yet — public land is still shown.${here.info?.parcelNote ? ` ${here.info.parcelNote}` : ''}`;
    } else if (here?.info?.parcelNote) {
      msg = `${here.name} County: ${here.info.parcelNote}`;
    } else if (!this.layers.counties.loaded && zoom >= Math.min(...parcelSources.map((s) => s.minZoom))) {
      // Without county outlines: infer "no coverage" from active parcel layers that loaded nothing.
      const st = parcelSources.map((s) => this.layers.getStatus(s.id)).filter((x) => x.active);
      if (st.length && st.every((x) => !x.loading && !x.error && x.count === 0)) msg = 'No parcel data loaded here — this county may not be covered.';
    }
    const list = covered.length ? h('details.covered', {}, h('summary', {}, `Counties with owner data (${covered.length})`), h('p.small', {}, covered.join(', '))) : null;
    fill(this.hint, ...(msg ? [h('div.hint', {}, icon('info'), h('div', {}, h('span', {}, msg), list))] : []));
  }
}
