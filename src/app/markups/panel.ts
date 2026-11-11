// "My markups": list, create, edit, delete, import/export (GeoJSON, GPX), share links.

import type { Map as MLMap, LngLatBoundsLike } from 'maplibre-gl';
import { area as turfArea } from '@turf/turf';
import { fill, copyText, downloadText, h, icon, showDialog, toast } from '../util/dom';
import { formatAcres, formatDistance, formatDuration, pathLength, type LngLat } from '../util/geo';
import { formatLatLon } from '../util/coords';
import type { DrawController, DrawKind } from './draw';
import { geoJSONToMarkups, markupsToGeoJSON } from './geojson';
import { gpxToMarkups, markupsToGPX } from './gpx';
import {
  ICON_LABELS,
  MARKUP_COLORS,
  WAYPOINT_ICONS,
  type Markup,
  defaultColor,
  kindLabel,
  markupCoords,
  newId,
} from './model';
import { buildShareUrl } from './share';
import type { MarkupStore } from './store';

export interface MarkupPanelDeps {
  map: MLMap;
  store: MarkupStore;
  draw: DrawController;
  /** Called to show the panel (e.g. after import). */
  reveal: () => void;
  /** Point the compass/navigation at a waypoint. */
  navigateTo: (m: Markup) => void;
}

export function describeMarkup(m: Markup): string {
  switch (m.kind) {
    case 'waypoint':
      return formatLatLon(m.coord[1], m.coord[0]);
    case 'line':
      return formatDistance(pathLength(m.coords));
    case 'track': {
      const d = formatDistance(pathLength(m.coords));
      return m.duration ? `${d} · ${formatDuration(m.duration)}` : d;
    }
    case 'shape': {
      const ring = [...m.coords, m.coords[0]].map((c) => [c[0], c[1]]);
      const a = turfArea({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } });
      return `${formatAcres(a)} · ${formatDistance(pathLength(ring as LngLat[]))} around`;
    }
  }
}

function boundsOf(ms: readonly Markup[]): LngLatBoundsLike | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const m of ms)
    for (const c of markupCoords(m)) {
      w = Math.min(w, c[0]);
      e = Math.max(e, c[0]);
      s = Math.min(s, c[1]);
      n = Math.max(n, c[1]);
    }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}

export function zoomToMarkups(map: MLMap, ms: readonly Markup[]): void {
  const b = boundsOf(ms);
  if (!b) return;
  const [[w, s], [e, n]] = b as [[number, number], [number, number]];
  if (w === e && s === n) map.flyTo({ center: [w, s], zoom: Math.max(map.getZoom(), 15) });
  else map.fitBounds(b, { padding: { top: 90, bottom: 120, left: 40, right: 40 }, maxZoom: 17 });
}

function swatch(m: Markup): HTMLElement {
  const el = h('span.mk-swatch', { style: `--c:${m.color}` });
  el.append(icon(m.kind === 'waypoint' ? `wp-${m.icon}` : m.kind === 'shape' ? 'polygon' : m.kind === 'track' ? 'route' : 'line'));
  return el;
}

export class MarkupPanel {
  private selecting = false;
  private selected = new Set<string>();
  private filter = '';

  private readonly root: HTMLElement;
  private readonly deps: MarkupPanelDeps;

  constructor(root: HTMLElement, deps: MarkupPanelDeps) {
    this.root = root;
    this.deps = deps;
    deps.store.onChange(() => this.render());
    this.render();
  }

  async create(kind: DrawKind, initial: LngLat[] = [], preset: Partial<Markup> = {}): Promise<Markup | null> {
    const res = await this.deps.draw.start(kind, initial);
    if (!res) return null;
    const now = Date.now();
    const base = { id: newId(), name: preset.name ?? '', note: preset.note ?? '', color: preset.color ?? defaultColor(kind), created: now, updated: now };
    const m: Markup =
      res.kind === 'waypoint'
        ? { ...base, kind: 'waypoint', coord: res.coords[0], icon: (preset.kind === 'waypoint' ? preset.icon : undefined) ?? 'pin' }
        : res.kind === 'line'
          ? { ...base, kind: 'line', coords: res.coords }
          : { ...base, kind: 'shape', coords: res.coords };
    this.deps.store.add(m);
    await this.edit(m.id, true);
    return m;
  }

  async edit(id: string, isNew = false): Promise<void> {
    const m = this.deps.store.get(id);
    if (!m) return;
    let color = m.color;
    let wpIcon = m.kind === 'waypoint' ? m.icon : 'pin';
    const name = h('input', { type: 'text', value: m.name, placeholder: `${kindLabel(m.kind)} name`, maxlength: 80, 'aria-label': 'Name' });
    const note = h('textarea', { rows: 3, placeholder: 'Notes (wind, access, sign…)', 'aria-label': 'Notes' });
    note.value = m.note;
    const colors = h(
      'div.swatches',
      { role: 'radiogroup', 'aria-label': 'Colour' },
      // An older markup may use a colour no longer offered (e.g. the old grade-like yellow): keep it selectable.
      [...MARKUP_COLORS, ...((MARKUP_COLORS as readonly string[]).includes(m.color) ? [] : [m.color])].map((c) => {
        const b = h('button.swatch', { type: 'button', role: 'radio', style: `--c:${c}`, 'aria-label': c, 'aria-checked': String(c === color) });
        b.addEventListener('click', () => {
          color = c;
          colors.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        });
        return b;
      }),
    );
    const icons =
      m.kind === 'waypoint'
        ? h(
            'div.icon-grid',
            { role: 'radiogroup', 'aria-label': 'Icon' },
            WAYPOINT_ICONS.map((ic) => {
              const b = h('button.icon-choice', { type: 'button', role: 'radio', 'aria-checked': String(ic === wpIcon), title: ICON_LABELS[ic] }, icon(`wp-${ic}`), h('span', {}, ICON_LABELS[ic]));
              b.addEventListener('click', () => {
                wpIcon = ic;
                icons?.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
              });
              return b;
            }),
          )
        : null;

    const dlg = h(
      'dialog.modal',
      { 'aria-label': `Edit ${kindLabel(m.kind).toLowerCase()}` },
      h(
        'form',
        { method: 'dialog' },
        h('header.modal-head', {}, swatch(m), h('h2', {}, isNew ? `New ${kindLabel(m.kind).toLowerCase()}` : `Edit ${kindLabel(m.kind).toLowerCase()}`), h('button.icon-btn', { value: 'cancel', 'aria-label': 'Close', formnovalidate: true }, icon('close'))),
        h('p.muted', {}, describeMarkup(m)),
        h('label.field', {}, h('span', {}, 'Name'), name),
        h('label.field', {}, h('span', {}, 'Notes'), note),
        h('div.field', {}, h('span', {}, 'Colour'), colors),
        icons ? h('div.field', {}, h('span', {}, 'Icon'), icons) : null,
        h(
          'div.row.wrap',
          {},
          h('button.btn.ghost', { value: 'geometry', type: 'submit' }, icon(m.kind === 'waypoint' ? 'crosshair' : 'pencil'), m.kind === 'waypoint' ? 'Move' : 'Edit points'),
          m.kind === 'waypoint' ? h('button.btn.ghost', { value: 'navigate', type: 'submit' }, icon('compass'), 'Navigate') : null,
          h('button.btn.ghost', { value: 'share', type: 'submit' }, icon('link'), 'Share'),
          h('button.btn.danger', { value: 'delete', type: 'submit' }, icon('trash'), 'Delete'),
        ),
        h('footer.modal-foot', {}, h('button.btn.ghost', { value: 'cancel', formnovalidate: true }, isNew ? 'Skip' : 'Cancel'), h('button.btn.primary', { value: 'save' }, icon('check'), 'Save')),
      ),
    );
    const result = await showDialog(dlg);
    const latest = this.deps.store.get(id);
    if (!latest) return;
    const patched: Markup = { ...latest, name: name.value.trim(), note: note.value.trim(), color };
    if (patched.kind === 'waypoint') patched.icon = wpIcon;
    if (result === 'save' || result === 'geometry' || result === 'navigate' || result === 'share') this.deps.store.update(patched);
    if (result === 'delete') {
      if (confirm(`Delete “${latest.name || kindLabel(latest.kind)}”?`)) this.deps.store.remove(id);
    } else if (result === 'geometry') await this.editGeometry(id);
    else if (result === 'navigate') this.deps.navigateTo(patched);
    else if (result === 'share') await this.share([patched]);
  }

  async editGeometry(id: string): Promise<void> {
    const m = this.deps.store.get(id);
    if (!m) return;
    const kind: DrawKind = m.kind === 'waypoint' ? 'waypoint' : m.kind === 'shape' ? 'shape' : 'line';
    const initial = markupCoords(m).map((c) => [c[0], c[1]] as LngLat);
    const res = await this.deps.draw.start(kind, initial, `Editing ${m.name || kindLabel(m.kind).toLowerCase()}`);
    if (!res) return;
    const latest = this.deps.store.get(id);
    if (!latest) return;
    if (latest.kind === 'waypoint') this.deps.store.update({ ...latest, coord: res.coords[0] });
    else if (latest.kind === 'track') this.deps.store.update({ ...latest, coords: res.coords, times: undefined });
    else this.deps.store.update({ ...latest, coords: res.coords });
    toast('Updated');
  }

  private targets(): Markup[] {
    const all = this.deps.store.all();
    return this.selecting && this.selected.size ? all.filter((m) => this.selected.has(m.id)) : [...all];
  }

  async share(ms: Markup[]): Promise<void> {
    if (!ms.length) return toast('Nothing to share');
    const url = await buildShareUrl(location.href.split('#')[0], ms);
    const title = ms.length === 1 ? ms[0].name || kindLabel(ms[0].kind) : `${ms.length} markups`;
    if (url.length > 8000) toast('Link is long — GPX export may be more reliable for big tracks', 4000);
    if (navigator.share) {
      try {
        await navigator.share({ title: `SketchX: ${title}`, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    if (await copyText(url)) toast('Share link copied');
    else prompt('Copy this link', url);
  }

  private async shareFile(ms: Markup[]): Promise<void> {
    const gpx = markupsToGPX(ms);
    const file = new File([gpx], 'markups.gpx', { type: 'application/gpx+xml' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'SketchX markups' });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    downloadText('markups.gpx', gpx, 'application/gpx+xml');
  }

  private exportAs(fmt: 'gpx' | 'geojson'): void {
    const ms = this.targets();
    if (!ms.length) return toast('No markups to export');
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'gpx') downloadText(`sketchx-${stamp}.gpx`, markupsToGPX(ms), 'application/gpx+xml');
    else downloadText(`sketchx-${stamp}.geojson`, JSON.stringify(markupsToGeoJSON(ms), null, 1), 'application/geo+json');
  }

  importText(text: string, filename = ''): number {
    const trimmed = text.trim();
    const ms = trimmed.startsWith('<') || /\.gpx$/i.test(filename) ? gpxToMarkups(trimmed) : geoJSONToMarkups(JSON.parse(trimmed));
    // Always new ids for imports so re-importing doesn't clobber.
    for (const m of ms) m.id = newId();
    this.deps.store.add(...ms);
    if (ms.length) zoomToMarkups(this.deps.map, ms);
    return ms.length;
  }

  private pickFile(): void {
    const input = h('input', { type: 'file', accept: '.gpx,.geojson,.json,application/gpx+xml,application/geo+json,application/json', multiple: true });
    input.hidden = true;
    document.body.append(input); // iOS Safari and some browsers need the input in the DOM
    window.addEventListener('focus', () => setTimeout(() => input.remove(), 60_000), { once: true });
    input.addEventListener('change', async () => {
      input.remove();
      let total = 0;
      for (const f of Array.from(input.files ?? [])) {
        try {
          total += this.importText(await f.text(), f.name);
        } catch (err) {
          toast(`Couldn't read ${f.name}: ${err instanceof Error ? err.message : 'invalid file'}`, 4000);
        }
      }
      if (total) toast(`Imported ${total} markup${total === 1 ? '' : 's'}`);
    });
    input.click();
  }

  render(): void {
    const { store, map } = this.deps;
    const all = [...store.all()].sort((a, b) => b.updated - a.updated);
    const q = this.filter.toLowerCase();
    const shown = q ? all.filter((m) => `${m.name} ${m.note} ${m.kind}`.toLowerCase().includes(q)) : all;
    for (const id of this.selected) if (!store.get(id)) this.selected.delete(id);

    const createRow = h(
      'div.create-row',
      {},
      h('button.btn.tile', { type: 'button', onclick: () => void this.create('waypoint') }, icon('waypoint'), 'Waypoint'),
      h('button.btn.tile', { type: 'button', onclick: () => void this.create('line') }, icon('line'), 'Line'),
      h('button.btn.tile', { type: 'button', onclick: () => void this.create('shape') }, icon('polygon'), 'Shape'),
    );

    const list = h('ul.mk-list', { 'aria-label': 'My markups' });
    for (const m of shown) {
      const check = this.selecting ? h('input', { type: 'checkbox', 'aria-label': `Select ${m.name || kindLabel(m.kind)}` }) : null;
      if (check) {
        check.checked = this.selected.has(m.id);
        check.addEventListener('change', () => {
          if (check.checked) this.selected.add(m.id);
          else this.selected.delete(m.id);
          this.render();
        });
      }
      list.append(
        h(
          'li.mk-item',
          {},
          check,
          h(
            'button.mk-main',
            { type: 'button', onclick: () => zoomToMarkups(map, [m]), title: 'Zoom to' },
            swatch(m),
            h('span.mk-text', {}, h('span.mk-name', {}, m.name || `Untitled ${kindLabel(m.kind).toLowerCase()}`), h('span.mk-sub', {}, `${kindLabel(m.kind)} · ${describeMarkup(m)}`)),
          ),
          h('button.icon-btn', { type: 'button', onclick: () => void this.edit(m.id), 'aria-label': `Edit ${m.name || kindLabel(m.kind)}` }, icon('pencil')),
        ),
      );
    }

    const n = this.selected.size;
    const toolbar = h(
      'div.row.wrap.mk-tools',
      {},
      h('button.btn.ghost.sm', { type: 'button', onclick: () => this.pickFile() }, icon('upload'), 'Import'),
      h('button.btn.ghost.sm', { type: 'button', onclick: () => this.exportAs('gpx'), disabled: !all.length }, icon('download'), 'GPX'),
      h('button.btn.ghost.sm', { type: 'button', onclick: () => this.exportAs('geojson'), disabled: !all.length }, icon('download'), 'GeoJSON'),
      h('button.btn.ghost.sm', { type: 'button', onclick: () => void this.share(this.targets()), disabled: !all.length }, icon('link'), 'Link'),
      'share' in navigator ? h('button.btn.ghost.sm', { type: 'button', onclick: () => void this.shareFile(this.targets()), disabled: !all.length }, icon('share'), 'Send') : null,
      h(
        'button.btn.ghost.sm',
        {
          type: 'button',
          'aria-pressed': String(this.selecting),
          disabled: !all.length,
          onclick: () => {
            this.selecting = !this.selecting;
            this.selected.clear();
            this.render();
          },
        },
        icon('check'),
        this.selecting ? 'Done selecting' : 'Select',
      ),
    );

    const search =
      all.length > 6
        ? h('input.mk-filter', {
            type: 'search',
            placeholder: 'Filter markups',
            value: this.filter,
            'aria-label': 'Filter markups',
            oninput: (e: Event) => {
              this.filter = (e.target as HTMLInputElement).value;
              this.render();
              const el = this.root.querySelector<HTMLInputElement>('.mk-filter');
              el?.focus();
              el?.setSelectionRange(el.value.length, el.value.length);
            },
          })
        : null;

    fill(this.root, 
      h('h2.pane-title', {}, 'Add to map'),
      createRow,
      h('div.pane-title-row', {}, h('h2.pane-title', {}, `My markups ${all.length ? `(${all.length})` : ''}`), all.length ? h('button.link-btn', { type: 'button', onclick: () => zoomToMarkups(map, all) }, 'Show all') : null),
      toolbar,
      this.selecting ? h('p.muted.small', {}, n ? `${n} selected — export/link/send use the selection.` : 'Tick markups to export or share just those.') : null,
      search,
      all.length ? list : h('div.empty', {}, h('p', {}, 'No markups yet.'), h('p.muted', {}, 'Drop waypoints for stands, cameras and parking; draw lines for drag routes and shapes for bedding areas. Everything stays on this device unless you share it.')),
    );
  }
}
