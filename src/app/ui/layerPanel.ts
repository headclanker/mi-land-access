import type { Map as MLMap } from 'maplibre-gl';
import { GRADE_COLORS, REFUGE_COLOR, type Grade, type LayerGroup, type LayerSource } from '../../contract';
import type { LayerManager } from '../layers/manager';
import type { Overview } from '../layers/overview';
import type { CityLimitsLayer } from '../layers/cities';
import { OVERVIEW_HANDOFF_ZOOM } from '../../data/sources';
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
  private readonly overview: Overview | null;
  private overviewRow: { input: HTMLInputElement; status: HTMLElement; row: HTMLElement } | null = null;
  private readonly cities: CityLimitsLayer | null;
  private cityRow: { input: HTMLInputElement; status: HTMLElement } | null = null;

  constructor(root: HTMLElement, map: MLMap, layers: LayerManager, overview: Overview | null = null, cities: CityLimitsLayer | null = null) {
    this.root = root;
    this.map = map;
    this.layers = layers;
    this.overview = overview;
    this.cities = cities;
    this.build();
    layers.onChange(() => this.update());
    overview?.onChange(() => this.update());
    cities?.onChange(() => this.update());
    map.on('zoomend', () => this.update());
    this.update();
  }

  /** The zoomed-out overview stands in for several live layers; it gets its own row and note. */
  private overviewItem(): HTMLElement | null {
    const ov = this.overview;
    if (!ov) return null;
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Statewide public-land overview' });
    input.addEventListener('change', () => ov.setEnabled(input.checked));
    const status = h('span.layer-status');
    const row = h(
      'li.layer-row',
      {},
      h('label.layer-label', {}, input, h('span.switch', { 'aria-hidden': 'true' }), h('span.layer-sw.multi'), h('span.layer-text', {}, h('span.layer-title', {}, 'Statewide overview (zoomed out)'), status)),
    );
    this.overviewRow = { input, status, row };
    return row;
  }

  /** "City limits": a reference outline drawn from the bundled city-limits file (not an ArcGIS layer). */
  private cityItem(): HTMLElement | null {
    const c = this.cities;
    if (!c) return null;
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'City limits' });
    input.addEventListener('change', () => c.setVisible(input.checked));
    const status = h('span.layer-status');
    this.cityRow = { input, status };
    return h('li.layer-row', {}, h('label.layer-label', {}, input, h('span.switch', { 'aria-hidden': 'true' }), h('span.layer-sw.city', { title: 'Outline only' }), h('span.layer-text', {}, h('span.layer-title', {}, 'City limits'), status)));
  }

  private updateCities(): void {
    const c = this.cities;
    const r = this.cityRow;
    if (!c || !r) return;
    r.input.checked = c.visible;
    const built = c.builtLabel();
    const msg =
      c.status === 'loading'
        ? 'Loading…'
        : c.status === 'error'
          ? 'Couldn’t load city limits — the city rule is off.'
          : `${c.index?.size ?? 0} Michigan cities${built ? `, built ${built}` : ''}. Land inside is treated as closed unless a state or federal program opens it.`;
    fill(r.status, c.status === 'error' ? h('span.err', {}, msg) : msg);
  }

  private updateOverview(zoom: number): void {
    const ov = this.overview;
    const r = this.overviewRow;
    if (!ov || !r) return;
    r.input.checked = ov.enabled;
    r.row.classList.toggle('dim', ov.enabled && !ov.isShown);
    const built = ov.builtLabel();
    const what = `Generalised overview of DNR land, state park hunting zones, national forest and other federal land${built ? `, built ${built}` : ''}.`;
    let state: string;
    if (ov.status === 'loading') state = 'Loading…';
    else if (ov.status === 'error') state = 'Couldn’t load the overview.';
    else if (!ov.enabled) state = '';
    else if (zoom < OVERVIEW_HANDOFF_ZOOM) state = `Shown now; the live layers take over from zoom ${OVERVIEW_HANDOFF_ZOOM}.`;
    else if (ov.isShown) state = 'Shown here: the live layers are too dense to draw in full at this zoom — zoom in for them.';
    else state = 'Live layers shown at this zoom.';
    fill(r.status, h('span', {}, `${state} ${what}`.trim()));
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
        h('li', {}, h('span.legend-chip', { style: `--c:${REFUGE_COLOR}` }), h('span', {}, h('strong', {}, 'National wildlife refuge'), h('span.muted.small', {}, 'Hunting only where the refuge’s own rules open it — tap for this refuge’s status'))),
        h('li', {}, h('span.legend-chip.hatch', { style: `--c:${GRADE_COLORS.yellow}` }), h('span', {}, h('strong', {}, 'Hatched: records disagree'), h('span.muted.small', {}, 'County owner and state/federal land records conflict — verify before entering'))),
        h('li', {}, h('span.legend-chip.boundary'), h('span', {}, h('strong', {}, 'Dashed outline: area boundary'), h('span.muted.small', {}, 'Game-area or park boundary — can include private land; not a grade'))),
        h('li', {}, h('span.legend-chip', { style: `--c:${GRADE_COLORS.red}` }), h('span', {}, h('strong', {}, 'Inside city limits'), h('span.muted.small', {}, 'Treated as closed unless a state or federal program (state land, open park zone, HAP, Commercial Forest) opens it — city ordinances generally ban hunting and firearm discharge'))),
      ),
      h(
        'p.muted.small',
        {},
        'Where county parcels are shown, each parcel gets one colour: park hunting zones, HAP and Commercial Forest come first, then DNR and national-forest ownership, then the county owner name. Grades are an automated guess from these records — not legal advice. Always verify boundaries and rules, and get permission for private land.',
      ),
    );
    const groups = GROUPS.map((g) => {
      const srcs = this.layers.sources.filter((s) => s.group === g.id);
      if (!srcs.length) return null;
      const extra = g.id === 'hunting-units' ? this.speciesSelect() : null;
      if (g.id === 'parcels') return this.parcelGroup(g.title, srcs);
      const lead = g.id === 'public-land' ? this.overviewItem() : g.id === 'reference' ? this.cityItem() : null;
      return h('section.layer-group', {}, h('h3.group-title', {}, g.title), extra, h('ul.layer-list', {}, lead, srcs.map((s) => this.row(s))));
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
    const sw =
      s.group === 'hunting-units'
        ? h('span.layer-sw.unit', { style: `--c:${swatchColor}` })
        : s.role === 'boundary'
          ? h('span.layer-sw.boundary', { title: 'Outline only — not a grade' })
          : s.fixedGrade
            ? h('span.layer-sw', { style: `--c:${swatchColor}` })
            : h('span.layer-sw.multi');
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
      else if (st.hiddenReason === 'zoom' && this.overview?.isShown && s.minZoom === OVERVIEW_HANDOFF_ZOOM)
        text = [`In the overview below zoom ${s.minZoom}; live from ${s.minZoom}`, h('button.link-btn', { type: 'button', onclick: () => this.map.easeTo({ zoom: s.minZoom + 0.2 }) }, 'Zoom in')];
      else if (st.hiddenReason === 'zoom')
        text = [
          `Zoom in to see (now ${zoom.toFixed(0)}, needs ${s.minZoom})`,
          h('button.link-btn', { type: 'button', onclick: () => this.map.easeTo({ zoom: s.minZoom + 0.2 }) }, 'Zoom in'),
        ];
      else if (this.layers.isSuppressed(s.id)) text = [st.truncated ? 'Too dense to draw in full here — overview shown; zoom in for live detail' : 'Loading — overview shown meanwhile'];
      else if (st.loading) text = [h('span.spinner', { 'aria-hidden': 'true' }), `Loading… ${st.count ? `${st.count} so far` : ''}`];
      else if (st.error) text = [h('span.err', {}, st.error)];
      else text = [`${st.count.toLocaleString()} in view${st.truncated ? ' (limit reached — zoom in for all)' : ''}`];
      fill(r.status, ...text);
    }
    this.updateCountyMaster(zoom);
    this.updateHint(zoom);
    this.updateOverview(zoom);
    this.updateCities();
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
