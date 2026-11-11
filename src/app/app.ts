// Wires the map, data layers, panels, markups, tracker and compass together.

import 'maplibre-gl/dist/maplibre-gl.css';
import { Marker, type MapGeoJSONFeature, type MapMouseEvent } from 'maplibre-gl';
import { LAYER_SOURCES } from '../data/sources';
import { createMap, fitMichigan, setBasemap, currentBasemap } from './map/map';
import { LayerManager } from './layers/manager';
import { LayerPanel } from './ui/layerPanel';
import { Details } from './details/details';
import { Sheet, desktopQuery } from './ui/sheet';
import { injectSprite } from './ui/icons';
import { applyTheme, maybeShowDisclaimer, renderMorePane, setupBasemapPicker, setupReadout, setupSearch, showLegal, watchTheme } from './ui/chrome';
import { MarkupStore } from './markups/store';
import { MARKUP_LAYERS, installMarkupLayers, renderMarkups } from './markups/render';
import { DrawController } from './markups/draw';
import { MarkupPanel, describeMarkup, zoomToMarkups } from './markups/panel';
import { decodeShare, sharePayloadFromHash } from './markups/share';
import { defaultColor, kindLabel, newId, type Markup } from './markups/model';
import { LocationService } from './tracker/location';
import { Tracker } from './tracker/tracker';
import { Compass } from './compass/compass';
import { fill, $, h, icon, toast } from './util/dom';

type Tab = 'layers' | 'markups' | 'track' | 'more';

/** Wait for the debounced layer refresh to start before checking whether data has loaded. */
const LOADER_SETTLE_MS = 700;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export async function startApp(): Promise<void> {
  injectSprite();
  watchTheme();

  const map = createMap($('#map'));
  const panelEl = $('#panel');
  const panel = new Sheet(panelEl, ['peek', 'half', 'full']);
  const detailsSheet = new Sheet($('#details'), ['closed', 'half', 'full']);

  // ----- tabs -----
  const tabs = Array.from(panelEl.querySelectorAll<HTMLButtonElement>('[role=tab]'));
  const panes = Array.from(panelEl.querySelectorAll<HTMLElement>('[data-pane]'));
  const selectTab = (tab: Tab, reveal = true): void => {
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    for (const p of panes) p.hidden = p.dataset.pane !== tab;
    panelEl.dataset.tab = tab;
    if (reveal) {
      panel.reveal();
      if (!desktopQuery.matches) detailsSheet.set('closed');
    }
  };
  for (const t of tabs)
    t.addEventListener('click', () => {
      const tab = t.dataset.tab as Tab;
      if (t.getAttribute('aria-selected') === 'true' && panel.state !== 'peek' && !desktopQuery.matches) panel.set('peek');
      else selectTab(tab);
    });
  const pane = (name: Tab): HTMLElement => $(`[data-pane="${name}"]`, panelEl);

  // Keep map controls clear of the sheet on phones.
  const syncInsets = (): void => {
    const root = document.documentElement;
    if (desktopQuery.matches) {
      root.style.setProperty('--sheet-h', '0px');
      return;
    }
    const visible = detailsSheet.state !== 'closed' ? $('#details') : panelEl;
    const hgt = Math.min(visible.getBoundingClientRect().height, window.innerHeight * 0.5);
    root.style.setProperty('--sheet-h', `${Math.round(hgt)}px`);
  };
  const syncSoon = (): void => {
    requestAnimationFrame(syncInsets);
    window.setTimeout(syncInsets, 300); // after the height transition
  };
  panel.onState(syncSoon);
  detailsSheet.onState((s) => {
    document.documentElement.classList.toggle('details-open', s !== 'closed');
    if (s === 'closed') details.clearSelection();
    syncSoon();
  });
  window.addEventListener('resize', syncInsets);
  desktopQuery.addEventListener('change', syncInsets);

  await new Promise<void>((resolve) => (map.loaded() ? resolve() : map.once('load', () => resolve())));
  document.documentElement.dataset.basemap = currentBasemap().dark ? 'dark' : 'light';

  // ----- data layers -----
  const layers = new LayerManager(map, LAYER_SOURCES);
  new LayerPanel(pane('layers'), map, layers);

  // ----- markups -----
  const store = new MarkupStore();
  installMarkupLayers(map);
  const draw = new DrawController(map);
  store.onChange(() => renderMarkups(map, store.all()));

  // ----- location / compass / tracker -----
  const loc = new LocationService(map);
  const compass = new Compass(map, loc, $('#compass-hud'), $('#north'));
  const tracker = new Tracker(map, loc, store, pane('track'), $('#record-pill'), () => selectTab('track'));

  const markupPanel = new MarkupPanel(pane('markups'), {
    map,
    store,
    draw,
    reveal: () => selectTab('markups'),
    navigateTo: (m) => {
      if (m.kind !== 'waypoint') return;
      compass.setTarget({ name: m.name, lon: m.coord[0], lat: m.coord[1] });
    },
  });

  const details = new Details({
    map,
    layers,
    open: () => {
      detailsSheet.set(desktopQuery.matches ? 'full' : 'half');
    },
    close: () => detailsSheet.set('closed'),
    saveWaypoint: (name, note, lon, lat) => {
      const now = Date.now();
      const m: Markup = { id: newId(), kind: 'waypoint', name, note, color: defaultColor('waypoint'), created: now, updated: now, coord: [lon, lat], icon: 'pin' };
      store.add(m);
      toast('Saved to My markups');
      void markupPanel.edit(m.id, true);
    },
  });

  // Hide panel peek while drawing on phones so the map has room.
  const drawObserver = new MutationObserver(() => {
    if (document.documentElement.classList.contains('drawing')) {
      if (!desktopQuery.matches) panel.set('peek');
      detailsSheet.set('closed');
    }
  });
  drawObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // ----- map interaction -----
  /** On phones, nudge the map so a point isn't hidden under the half-height sheet. */
  const keepVisible = (lon: number, lat: number): void => {
    if (desktopQuery.matches) return;
    window.setTimeout(() => {
      const sheetTop = window.innerHeight * 0.48;
      const p = map.project([lon, lat]);
      if (p.y < sheetTop - 30 && p.y > 120) return;
      const targetY = Math.max(140, sheetTop / 2 + 40);
      map.panBy([0, p.y - targetY], { duration: 350 });
    }, 50);
  };

  const markupCard = (m: Markup): void => {
    const c = m.kind === 'waypoint' ? m.coord : m.coords[0];
    keepVisible(c[0], c[1]);
    const body = $('#details-body');
    fill(body, 
      h('div.details-head', {}, h('div', {}, h('h2', {}, m.name || `Untitled ${kindLabel(m.kind).toLowerCase()}`), h('span.muted.small', {}, `${kindLabel(m.kind)} · ${describeMarkup(m)}`)), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => detailsSheet.set('closed') }, icon('close'))),
      m.note ? h('p.reason.pre', {}, m.note) : null,
      h(
        'div.row.wrap.detail-actions',
        {},
        h('button.btn.sm.primary', { type: 'button', onclick: () => void markupPanel.edit(m.id) }, icon('pencil'), 'Edit'),
        m.kind === 'waypoint' ? h('button.btn.sm', { type: 'button', onclick: () => compass.setTarget({ name: m.name, lon: m.coord[0], lat: m.coord[1] }) }, icon('compass'), 'Navigate') : null,
        h('button.btn.sm', { type: 'button', onclick: () => void markupPanel.share([m]) }, icon('link'), 'Share'),
        h('button.btn.sm.ghost', { type: 'button', onclick: () => zoomToMarkups(map, [m]) }, icon('zoomto'), 'Zoom to'),
      ),
    );
    details.clearSelection();
    detailsSheet.set(desktopQuery.matches ? 'full' : 'half');
  };

  /** Opens the details sheet for whatever land/unit features are drawn at a screen point. */
  const inspect = (x: number, y: number, lon: number, lat: number): boolean => {
    const visibleLayers = layers.clickableLayers.filter((l) => map.getLayoutProperty(l, 'visibility') !== 'none');
    const hits: MapGeoJSONFeature[] = visibleLayers.length ? map.queryRenderedFeatures([[x - 2, y - 2], [x + 2, y + 2]], { layers: visibleLayers }) : [];
    const ok = details.showAt(hits, lon, lat);
    if (ok) keepVisible(lon, lat);
    return ok;
  };

  map.on('click', (e: MapMouseEvent) => {
    if (draw.active) return;
    const pad = 8;
    const box: [[number, number], [number, number]] = [
      [e.point.x - pad, e.point.y - pad],
      [e.point.x + pad, e.point.y + pad],
    ];
    const mk = map.queryRenderedFeatures(box, { layers: MARKUP_LAYERS.filter((l) => map.getLayer(l)) });
    if (mk.length) {
      const m = store.get(String(mk[0].properties?.id));
      if (m) return markupCard(m);
    }
    if (!inspect(e.point.x, e.point.y, e.lngLat.lng, e.lngLat.lat)) {
      if (detailsSheet.state !== 'closed') detailsSheet.set('closed');
      else if (!desktopQuery.matches && panel.state !== 'peek') panel.set('peek');
    }
  });
  const pointerLayers = (): string[] => [...layers.clickableLayers, ...MARKUP_LAYERS].filter((l) => map.getLayer(l));
  map.on('mousemove', (e) => {
    if (draw.active) return;
    const f = map.queryRenderedFeatures(e.point, { layers: pointerLayers() });
    map.getCanvas().style.cursor = f.length ? 'pointer' : '';
  });

  // ----- chrome -----
  $('#btn-home').addEventListener('click', () => fitMichigan(map));
  $('#btn-locate').addEventListener('click', () => loc.locateClick());
  $('#btn-compass').addEventListener('click', () => compass.toggle());
  $('#legal-link').addEventListener('click', () => void showLegal());
  setupBasemapPicker(map, $('#btn-basemap'));
  setupReadout(map, $('#coord-readout'));
  let searchPin: Marker | null = null;
  setupSearch(map, $('#search') as HTMLFormElement, $('#search-input') as HTMLInputElement, (lon, lat) => {
    searchPin?.remove();
    searchPin = new Marker({ element: h('div.search-pin', { 'aria-label': 'Search result' }) }).setLngLat([lon, lat]).addTo(map);
    // Once the map has arrived and the land layers have loaded, show what is there.
    map.once('moveend', () => {
      const show = (): void => {
        const p = map.project([lon, lat]);
        const body = $('#details-body');
        if (!inspect(p.x, p.y, lon, lat)) {
          fill(
            body,
            h('div.details-head', {}, h('div', {}, h('h2', {}, 'Search result'), h('span.muted.small.mono', {}, `${lat.toFixed(5)}, ${lon.toFixed(5)}`)), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => detailsSheet.set('closed') }, icon('close'))),
            h('p.muted', {}, 'No land layers are drawn at this spot right now. Zoom in or turn on more layers, then tap the map to check ownership.'),
          );
          detailsSheet.set(desktopQuery.matches ? 'full' : 'half');
        }
        body.insertBefore(
          h(
            'div.row.wrap.search-actions',
            {},
            h(
              'button.btn.sm.primary',
              {
                type: 'button',
                onclick: () => {
                  const now = Date.now();
                  const m: Markup = { id: newId(), kind: 'waypoint', name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, note: '', color: defaultColor('waypoint'), created: now, updated: now, coord: [lon, lat], icon: 'flag' };
                  store.add(m);
                  searchPin?.remove();
                  void markupPanel.edit(m.id, true);
                },
              },
              icon('waypoint'),
              'Save this spot',
            ),
          ),
          body.children[1] ?? null,
        );
      };
      const settle = (): void => {
        if (layers.sources.some((s) => layers.getStatus(s.id).loading)) window.setTimeout(settle, 400);
        else show();
      };
      window.setTimeout(settle, LOADER_SETTLE_MS);
    });
  });
  map.on('click', () => {
    searchPin?.remove();
    searchPin = null;
  });

  let installPrompt: BeforeInstallPromptEvent | null = null;
  const renderMore = (): void =>
    renderMorePane(
      pane('more'),
      LAYER_SOURCES,
      installPrompt
        ? () => {
            void installPrompt?.prompt();
            installPrompt = null;
            renderMore();
          }
        : null,
    );
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as BeforeInstallPromptEvent;
    renderMore();
  });
  renderMore();

  selectTab('layers', false);
  if (desktopQuery.matches) panel.set('full');
  syncInsets();

  // ----- persisted state -----
  await store.load();
  await tracker.restore();

  // ----- share link on open -----
  const importFromHash = async (): Promise<void> => {
    const payload = sharePayloadFromHash(location.hash);
    if (!payload) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const ms = await decodeShare(payload);
      if (!ms.length) return;
      store.add(...ms);
      zoomToMarkups(map, ms);
      selectTab('markups');
      toast(`Added ${ms.length} shared markup${ms.length === 1 ? '' : 's'}`, 3500);
    } catch {
      toast('That share link is damaged or incomplete', 4000);
    }
  };
  window.addEventListener('hashchange', () => void importFromHash());

  window.addEventListener('pagehide', () => {
    store.flush();
    tracker.flush();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      store.flush();
      tracker.flush();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && draw.active) draw.cancel();
  });

  await maybeShowDisclaimer();
  await importFromHash();

  // Exposed for debugging / automated checks only.
  Object.assign(window, { __mila: { map, layers, store, tracker, compass, loc, setBasemap, applyTheme } });
}
