// Small UI pieces: theme, disclaimer, basemap picker, search + coordinate readout, "More" pane.

import type { Map as MLMap } from 'maplibre-gl';
import { APP_NAME, BASEMAPS, type Basemap } from '../config';
import type { LayerSource } from '../../contract';
import { currentBasemap, setBasemap } from '../map/map';
import { lonToTileX, latToTileY } from '../layers/arcgis';
import { fill, copyText, debounce, h, icon, showDialog, toast } from '../util/dom';
import type { SearchResult } from './search';
import { formatLatLon, toDMS } from '../util/coords';
import { prefGet, prefSet } from '../util/store';

// ---------- theme ----------

export type ThemePref = 'auto' | 'light' | 'dark';

export function applyTheme(pref: ThemePref = prefGet<ThemePref>('theme', 'auto')): void {
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]:not([media])')?.remove();
  const meta = h('meta', { name: 'theme-color', content: dark ? '#14201a' : '#f3f1ea' });
  document.head.append(meta);
}

export function watchTheme(): void {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
}

// ---------- disclaimer ----------

const DISCLAIMER_VERSION = 1;

export function disclaimerDialog(first: boolean): HTMLDialogElement {
  const agree = h('input', { type: 'checkbox', required: true });
  return h(
    'dialog.modal.disclaimer',
    { 'aria-label': 'Before you use this map' },
    h(
      'form',
      { method: 'dialog' },
      // The heading takes initial focus (not the checkbox at the bottom), so a short phone screen
      // opens at the top of the notice; the acknowledgement sits in a footer that is always visible.
      h('header.modal-head', {}, icon('legal'), h('h2', { tabindex: -1, autofocus: true }, first ? 'Before you head out' : 'Not legal advice'), first ? null : h('button.icon-btn', { value: 'close', 'aria-label': 'Close' }, icon('close'))),
      h(
        'div.disclaimer-body',
        {},
        h('p', {}, h('strong', {}, `${APP_NAME} is an informational tool, not legal advice.`), ' The green / yellow / red / grey colours are an automated best guess from public GIS records and owner names.'),
        h(
          'ul',
          {},
          h('li', {}, 'Ownership, boundaries and parcel lines can be outdated, misaligned or simply wrong.'),
          h('li', {}, 'Public land can still be closed (safety zones, refuges, leases, local ordinances, seasonal closures).'),
          h('li', {}, 'You are responsible for knowing where you are, following the Michigan hunting digest and local rules, and getting the landowner’s permission before entering private land.'),
          h('li', {}, 'Always verify on the ground and with the managing agency or landowner.'),
        ),
        h('p.muted.small', {}, 'Your markups and tracks are stored only on this device unless you share or export them. Map tiles come from USGS and OpenStreetMap; land data comes from the public GIS services credited on the map.'),
      ),
      h(
        'div.disclaimer-foot',
        {},
        first ? h('label.check', {}, agree, h('span', {}, 'I understand the map is informational and I will verify before I hunt.')) : null,
        h('footer.modal-foot', {}, h('button.btn.primary', { value: 'ok' }, first ? 'Continue to map' : 'OK')),
      ),
    ),
  );
}

export async function maybeShowDisclaimer(): Promise<void> {
  if (prefGet('disclaimer', 0) >= DISCLAIMER_VERSION) return;
  const dlg = disclaimerDialog(true);
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // must acknowledge
  await showDialog(dlg);
  prefSet('disclaimer', DISCLAIMER_VERSION);
}

export async function showLegal(): Promise<void> {
  await showDialog(disclaimerDialog(false));
}

// ---------- basemap picker ----------

export function setupBasemapPicker(map: MLMap, button: HTMLElement): void {
  const z = 11;
  const x = lonToTileX(-84.72, z);
  const y = latToTileY(44.66, z);
  let pop: HTMLElement | null = null;
  const close = (): void => {
    pop?.remove();
    pop = null;
    button.setAttribute('aria-expanded', 'false');
  };
  button.setAttribute('aria-haspopup', 'true');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop) return close();
    const cur = currentBasemap().id;
    pop = h(
      'div.popover.basemaps',
      { role: 'menu', 'aria-label': 'Map style' },
      h('p.popover-title', {}, 'Map style'),
      BASEMAPS.map((b) =>
        h(
          'button.bm',
          {
            type: 'button',
            role: 'menuitemradio',
            'aria-checked': String(b.id === cur),
            onclick: () => {
              setBasemap(map, b);
              close();
            },
          },
          h('img', { src: b.tiles[0].replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), alt: '', loading: 'lazy', width: 64, height: 64 }),
          h('span', {}, b.title),
        ),
      ),
    );
    document.getElementById('app')?.append(pop);
    button.setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('click', (e) => {
    if (pop && !pop.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

/** Tile thumbnail URL of a basemap over central Michigan (same spot as the picker). */
function thumb(b: Basemap): string {
  const z = 11;
  return b.tiles[0].replace('{z}', String(z)).replace('{x}', String(lonToTileX(-84.72, z))).replace('{y}', String(latToTileY(44.66, z)));
}

/**
 * One-tap topo ⇄ satellite: a thumbnail of the other style, like a phone maps app. It remembers
 * which satellite variant (with or without labels) and which map variant you used last.
 */
export function setupSatelliteToggle(map: MLMap, button: HTMLButtonElement): void {
  const isSat = (b: Basemap): boolean => b.id.startsWith('usgs-imagery');
  const img = button.querySelector('img') as HTMLImageElement;
  const label = button.querySelector('span') as HTMLElement;
  const target = (): Basemap => {
    const cur = currentBasemap();
    const want = isSat(cur) ? prefGet('lastMapBasemap', 'usgs-topo') : prefGet('lastSatBasemap', 'usgs-imagery-topo');
    return BASEMAPS.find((b) => b.id === want && isSat(b) !== isSat(cur)) ?? BASEMAPS.find((b) => isSat(b) !== isSat(cur)) ?? BASEMAPS[0];
  };
  const render = (): void => {
    const cur = currentBasemap();
    prefSet(isSat(cur) ? 'lastSatBasemap' : 'lastMapBasemap', cur.id);
    const t = target();
    img.src = thumb(t);
    const name = isSat(t) ? 'Satellite' : 'Topo';
    label.textContent = name;
    button.setAttribute('aria-label', `Switch to ${isSat(t) ? 'satellite' : 'the topo map'}`);
    button.title = `Switch to ${t.title}`;
  };
  button.addEventListener('click', () => setBasemap(map, target()));
  window.addEventListener('basemapchange', render);
  render();
}

// ---------- search + readout ----------

export interface SearchUi {
  /** Instant local matches (coordinates, counties, markups). */
  local: (q: string) => SearchResult[];
  /** Park / game-area names from the DNR layers. */
  remote: (q: string, signal: AbortSignal) => Promise<SearchResult[]>;
  onPick: (r: SearchResult) => void;
}

const PLACEHOLDER_WIDE = 'Parks, game areas, counties, markups, lat,lon';
const PLACEHOLDER_NARROW = 'Park, county, lat,lon';

export function setupSearch(form: HTMLFormElement, input: HTMLInputElement, list: HTMLUListElement, ui: SearchUi): void {
  const narrow = window.matchMedia('(max-width: 520px)');
  const setPlaceholder = (): void => {
    input.placeholder = narrow.matches ? PLACEHOLDER_NARROW : PLACEHOLDER_WIDE;
  };
  setPlaceholder();
  narrow.addEventListener('change', setPlaceholder);

  let results: SearchResult[] = [];
  let active = -1;
  let ctrl: AbortController | null = null;
  let remoteState: 'idle' | 'loading' | 'error' = 'idle';
  let seq = 0;

  const close = (): void => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const pick = (r: SearchResult | undefined): void => {
    if (!r) return;
    close();
    input.blur();
    ui.onPick(r);
  };
  const render = (): void => {
    const q = input.value.trim();
    if (!q) return close();
    const rows: HTMLElement[] = results.map((r, i) =>
      h(
        'li.sr-item',
        { id: `sr-${i}`, role: 'option', 'aria-selected': String(i === active), onpointerdown: (e: Event) => e.preventDefault(), onclick: () => pick(r) },
        h('span.sr-kind', { 'data-kind': r.kind }, icon(r.kind === 'markup' ? 'waypoint' : r.kind === 'coord' ? 'crosshair' : r.kind === 'county' ? 'map' : 'polygon')),
        h('span.sr-text', {}, h('strong', {}, r.label), h('span.muted.small', {}, r.sub)),
      ),
    );
    if (remoteState === 'loading') rows.push(h('li.sr-note.muted.small', { role: 'presentation' }, h('span.spinner', { 'aria-hidden': 'true' }), 'Searching DNR parks & game areas…'));
    else if (remoteState === 'error') rows.push(h('li.sr-note.muted.small', { role: 'presentation' }, 'Park & game-area names need a connection — counties, markups and coordinates still work.'));
    else if (!results.length) rows.push(h('li.sr-note.muted.small', { role: 'presentation' }, 'No matches. Try a park, game area or county name, one of your markups, or coordinates like 44.66, -84.71.'));
    fill(list, ...rows);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `sr-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const run = debounce(async (q: string, id: number) => {
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      const more = await ui.remote(q, ctrl.signal);
      if (id !== seq) return;
      const seen = new Set(results.map((r) => `${r.kind}:${r.label}`));
      results = [...results, ...more.filter((r) => !seen.has(`${r.kind}:${r.label}`))];
      remoteState = 'idle';
    } catch (err) {
      if (id !== seq || (err instanceof DOMException && err.name === 'AbortError')) return;
      remoteState = 'error';
    }
    render();
  }, 280);

  input.addEventListener('input', () => {
    const q = input.value.trim();
    seq++;
    ctrl?.abort();
    active = -1;
    results = q ? ui.local(q) : [];
    remoteState = q.length >= 3 && !results.some((r) => r.kind === 'coord') ? 'loading' : 'idle';
    render();
    if (remoteState === 'loading') void run(q, seq);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      render();
      list.querySelector(`#sr-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('focus', () => {
    if (input.value.trim() && results.length) render();
  });
  input.addEventListener('blur', () => window.setTimeout(close, 150));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    if (active < 0) results = results.length ? results : ui.local(q);
    const r = results[active >= 0 ? active : 0];
    if (r) return pick(r);
    if (remoteState === 'loading') return; // the list updates when names arrive
    toast('Nothing found — try a park, game area or county name, a markup, or coordinates like 44.66, -84.71', 4000);
    input.select();
  });
}

export function setupReadout(map: MLMap, el: HTMLElement): void {
  let dms = prefGet('dms', false);
  let pointer: [number, number] | null = null;
  const render = (): void => {
    const [lon, lat] = pointer ?? map.getCenter().toArray();
    el.textContent = dms ? `${toDMS(lat, true)} ${toDMS(lon, false)}` : formatLatLon(lat, lon);
    el.dataset.mode = pointer ? 'pointer' : 'center';
  };
  map.on('move', () => {
    if (!pointer) render();
  });
  const fine = window.matchMedia('(pointer: fine)');
  map.on('mousemove', (e) => {
    if (!fine.matches) return;
    pointer = [e.lngLat.lng, e.lngLat.lat];
    render();
  });
  map.getCanvas().addEventListener('mouseleave', () => {
    pointer = null;
    render();
  });
  const act = async (): Promise<void> => {
    const [lon, lat] = map.getCenter().toArray();
    const text = dms ? `${toDMS(lat, true)} ${toDMS(lon, false)}` : formatLatLon(lat, lon);
    if (await copyText(text)) toast(`Copied map centre ${text}`);
  };
  window.addEventListener('coordfmt', () => {
    dms = prefGet('dms', false);
    render();
  });
  el.addEventListener('click', () => void act());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') void act();
  });
  render();
}

// ---------- More pane ----------

export function renderMorePane(root: HTMLElement, sources: LayerSource[], onInstall: (() => void) | null): void {
  const theme = prefGet<ThemePref>('theme', 'auto');
  const seg = h(
    'div.segmented',
    { role: 'radiogroup', 'aria-label': 'Theme' },
    (['auto', 'light', 'dark'] as ThemePref[]).map((t) =>
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(t === theme),
          onclick: () => {
            prefSet('theme', t);
            applyTheme(t);
            renderMorePane(root, sources, onInstall);
          },
        },
        icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'gps'),
        t === 'auto' ? 'Auto' : t === 'light' ? 'Day' : 'Night',
      ),
    ),
  );
  const attributions = [...new Set(sources.map((s) => s.attribution))];
  fill(root, 
    h('h2.pane-title', {}, 'Display'),
    seg,
    h('h2.pane-title', {}, 'Coordinates'),
    h(
      'div.segmented',
      { role: 'radiogroup', 'aria-label': 'Coordinate format' },
      [false, true].map((d) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(prefGet('dms', false) === d),
            onclick: () => {
              prefSet('dms', d);
              window.dispatchEvent(new Event('coordfmt'));
              renderMorePane(root, sources, onInstall);
            },
          },
          d ? 'Deg° min′ sec″' : 'Decimal degrees',
        ),
      ),
    ),
    onInstall ? h('button.btn.primary', { type: 'button', onclick: onInstall }, icon('download'), 'Install app') : null,
    h('h2.pane-title', {}, 'Offline'),
    h('p.muted.small', {}, 'The app works offline once loaded. Map tiles and land data you have viewed recently are kept (up to ~2,500 tiles). To prepare for no signal, pan and zoom over your hunting area at home before you go.'),
    h(
      'button.btn.ghost.sm',
      {
        type: 'button',
        onclick: async () => {
          if (!('caches' in window)) return toast('No cache in this browser');
          await caches.delete('basemap-tiles');
          await caches.delete('land-data');
          toast('Cached tiles and land data cleared');
        },
      },
      icon('trash'),
      'Clear cached map data',
    ),
    h('h2.pane-title', {}, 'About'),
    h('p.small', {}, `${APP_NAME} is an independent Michigan land-access map for hunters. It is not affiliated with the Michigan DNR or any county.`),
    h('button.btn.ghost.sm', { type: 'button', onclick: () => void showDialog(disclaimerDialog(false)) }, icon('legal'), 'Not legal advice — read'),
    h('details.attrs', {}, h('summary', {}, 'Data sources'), h('ul.small', {}, h('li', {}, 'Basemaps: USGS The National Map; © OpenStreetMap contributors'), attributions.map((a) => h('li', {}, a)))),
  );
}
