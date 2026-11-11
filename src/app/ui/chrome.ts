// Small UI pieces: theme, disclaimer, basemap picker, search + coordinate readout, "More" pane.

import type { Map as MLMap } from 'maplibre-gl';
import { APP_NAME, BASEMAPS } from '../config';
import type { LayerSource } from '../../contract';
import { currentBasemap, setBasemap } from '../map/map';
import { lonToTileX, latToTileY } from '../layers/arcgis';
import { fill, copyText, h, icon, showDialog, toast } from '../util/dom';
import { formatLatLon, parseLatLon, toDMS } from '../util/coords';
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
      h('header.modal-head', {}, icon('legal'), h('h2', {}, first ? 'Before you head out' : 'Not legal advice'), first ? null : h('button.icon-btn', { value: 'close', 'aria-label': 'Close' }, icon('close'))),
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
      first ? h('label.check', {}, agree, h('span', {}, 'I understand the map is informational and I will verify before I hunt.')) : null,
      h('footer.modal-foot', {}, h('button.btn.primary', { value: 'ok' }, first ? 'Continue to map' : 'OK')),
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
      { role: 'menu', 'aria-label': 'Basemap' },
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

// ---------- search + readout ----------

export function setupSearch(map: MLMap, form: HTMLFormElement, input: HTMLInputElement, onFound: (lon: number, lat: number) => void): void {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = parseLatLon(input.value);
    if (!p) {
      toast('Enter coordinates like 44.66, -84.71 or 44°39′N 84°43′W');
      input.select();
      return;
    }
    input.blur();
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 15) });
    onFound(p.lon, p.lat);
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
