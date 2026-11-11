// Wires the map, data layers, panels, markups, tracker and compass together.

import 'maplibre-gl/dist/maplibre-gl.css';
import { Marker, type MapGeoJSONFeature, type MapMouseEvent } from 'maplibre-gl';
import { LAYER_SOURCES } from '../data/sources';
import { createMap, fitMichigan, setBasemap, currentBasemap } from './map/map';
import { LayerManager } from './layers/manager';
import { OVERVIEW_FILL, Overview } from './layers/overview';
import { OVERVIEW_HANDOFF_ZOOM } from '../data/sources';
import { Searcher, type SearchResult } from './ui/search';
import { GRADE_COLORS, type Grade } from '../contract';
import { GRADE_LABEL, GRADE_SHORT } from './details/details';
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
import { fill, $, h, icon, showDialog, toast } from './util/dom';

type Tab = 'layers' | 'markups' | 'track' | 'more';

let drawAllows: (tab: Tab) => boolean = () => true;
let leaveDrawing: (tab: Tab) => Promise<boolean> = async () => true;

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
    if (reveal && !drawAllows(tab)) return;
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    for (const p of panes) p.hidden = p.dataset.pane !== tab;
    panelEl.dataset.tab = tab;
    if (reveal) {
      panel.reveal();
      if (!desktopQuery.matches) detailsSheet.set('closed');
    }
  };
  for (const t of tabs)
    t.addEventListener('click', async () => {
      const tab = t.dataset.tab as Tab;
      if (t.getAttribute('aria-selected') === 'true' && panel.state !== 'peek' && !desktopQuery.matches) return panel.set('peek');
      if (!drawAllows(tab) && !(await leaveDrawing(tab))) return;
      selectTab(tab);
    });
  const pane = (name: Tab): HTMLElement => $(`[data-pane="${name}"]`, panelEl);

  // Keep map controls clear of the sheet on phones.
  const syncInsets = (): void => {
    const root = document.documentElement;
    if (desktopQuery.matches) {
      root.style.setProperty('--sheet-h', '0px');
      return;
    }
    // On phones the details sheet sits on top of the panel's tab bar (which stays visible).
    const hgt = Math.min(detailsSheet.state !== 'closed' ? $('#details').getBoundingClientRect().height + panelEl.getBoundingClientRect().height : panelEl.getBoundingClientRect().height, window.innerHeight * 0.5);
    root.style.setProperty('--sheet-h', `${Math.round(hgt)}px`);
  };
  const syncSoon = (): void => {
    // Phones: with a sheet raised, the map strip is short; the legal pill steps aside (the
    // panes and details carry the same notice) so it never lands on the top-left stack.
    document.documentElement.classList.toggle('sheet-up', !desktopQuery.matches && (panel.state !== 'peek' || detailsSheet.state !== 'closed'));
    requestAnimationFrame(syncInsets);
    window.setTimeout(syncInsets, 300); // after the height transition
  };
  panel.onState((s) => {
    // Phones: opening the tools panel replaces the details sheet (its tab bar is the way back).
    if (s !== 'peek' && !desktopQuery.matches && detailsSheet.state !== 'closed') detailsSheet.set('closed');
    syncSoon();
  });
  detailsSheet.onState((s) => {
    document.documentElement.classList.toggle('details-open', s !== 'closed');
    if (s === 'closed') details.clearSelection();
    else if (!desktopQuery.matches) panel.set('peek');
    syncSoon();
  });
  window.addEventListener('resize', syncInsets);
  desktopQuery.addEventListener('change', syncInsets);

  await new Promise<void>((resolve) => (map.loaded() ? resolve() : map.once('load', () => resolve())));
  document.documentElement.dataset.basemap = currentBasemap().dark ? 'dark' : 'light';

  // ----- data layers -----
  const layers = new LayerManager(map, LAYER_SOURCES);
  const overview = new Overview(map, layers);
  new LayerPanel(pane('layers'), map, layers, overview);

  // ----- markups -----
  const store = new MarkupStore();
  installMarkupLayers(map);
  const draw = new DrawController(map);
  store.onChange(() => renderMarkups(map, store.all()));

  // ----- drawing vs. the rest of the UI -----
  // Drawing keeps going only while the map stays in view: on desktop the sidebar sits beside the
  // map, so Layers / Markups / More are fine, but Track (recording is its own mode) and every tab
  // on a phone (the panel would cover the map and the draw bar) ask to finish or discard first.
  drawAllows = (tab: Tab): boolean => !draw.active || (desktopQuery.matches && tab !== 'track');
  leaveDrawing = async (tab: Tab): Promise<boolean> => {
    if (!draw.active) return true;
    if (draw.pointCount === 0 || draw.active === 'waypoint') {
      draw.cancel();
      return true;
    }
    const what = draw.active === 'line' ? 'line' : 'shape';
    const editing = draw.currentTitle.startsWith('Editing');
    const choice = await showDialog(
      h(
        'dialog.modal',
        { 'aria-label': `Finish the ${what}?` },
        h(
          'form',
          { method: 'dialog' },
          h('header.modal-head', {}, icon('pencil'), h('h2', { tabindex: -1, autofocus: true }, editing ? 'Finish editing first?' : `Finish this ${what} first?`)),
          h('p', {}, `You are still drawing (${draw.pointCount} point${draw.pointCount === 1 ? '' : 's'}). ${tab === 'track' ? 'Recording a track' : 'Opening that tab'} will end drawing.`),
          h(
            'footer.modal-foot',
            {},
            h('button.btn.ghost', { value: 'keep' }, 'Keep drawing'),
            h('button.btn.danger', { value: 'discard' }, icon('trash'), editing ? 'Discard changes' : 'Discard'),
            h('button.btn.primary', { value: 'save', disabled: !draw.canFinish }, icon('check'), editing ? 'Save points' : 'Save'),
          ),
        ),
      ),
    );
    if (choice === 'save' && draw.canFinish) draw.finish();
    else if (choice === 'discard') draw.cancel();
    return !draw.active;
  };
  // Phones: while drawing, the panel stays at peek so the draw bar is never covered.
  panel.canChange = (next) => !(draw.active && !desktopQuery.matches && next !== 'peek');

  // ----- location / compass / tracker -----
  const loc = new LocationService(map);
  const compass = new Compass(map, loc, $('#compass-hud'), $('#north'));
  const tracker = new Tracker(map, loc, store, pane('track'), $('#record-pill'), () => {
    void (async () => {
      if (!drawAllows('track') && !(await leaveDrawing('track'))) return;
      selectTab('track');
    })();
  });

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

  const overviewCard = (g: Grade, lon: number, lat: number): void => {
    const grade: Grade = g in GRADE_COLORS ? g : 'unknown';
    fill(
      $('#details-body'),
      h('div.details-head', {}, h('div', {}, h('h2', {}, 'Public land (overview)'), h('span.muted.small.mono', {}, `${lat.toFixed(4)}, ${lon.toFixed(4)}`)), h('button.icon-btn', { type: 'button', 'aria-label': 'Close details', onclick: () => detailsSheet.set('closed') }, icon('close'))),
      h(
        'section.verdict',
        { 'data-grade': grade, style: `--c:${GRADE_COLORS[grade]}` },
        h('div.verdict-head', {}, h('span.badge', { style: `--c:${GRADE_COLORS[grade]}`, 'data-grade': grade }, GRADE_SHORT[grade]), h('span', {}, h('strong', {}, 'Statewide overview'), h('span.small', {}, GRADE_LABEL[grade]))),
        h('p.reason', {}, `This is a generalised statewide picture (built ${overview.builtLabel() || 'from DNR, USFS and PAD-US data'}) of DNR land, state park hunting zones, national forest and other federal land. Edges are approximate to a few hundred feet and small parcels are left out. Zoom in for the live, parcel-level layers before relying on it.`),
      ),
      h('div.row.wrap.detail-actions', {}, h('button.btn.sm.primary', { type: 'button', onclick: () => map.flyTo({ center: [lon, lat], zoom: Math.max(OVERVIEW_HANDOFF_ZOOM + 2, map.getZoom()) }) }, icon('zoomto'), 'Zoom in here')),
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
      // Zoomed out: the statewide overview explains itself and offers to zoom in.
      const ov = overview.isShown ? map.queryRenderedFeatures(box, { layers: [OVERVIEW_FILL] }) : [];
      if (ov.length) return overviewCard(String(ov[0].properties?.g) as Grade, e.lngLat.lng, e.lngLat.lat);
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
  /** Coordinates search: pin the spot, and once the map has arrived and loaded, show what is there. */
  const goToCoord = (lon: number, lat: number): void => {
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
  };
  const searcher = new Searcher({ sources: LAYER_SOURCES, markups: () => store.all(), countyBBox: (n) => layers.counties.bboxOf(n) });
  const flyToBBox = (b: [number, number, number, number]): void => {
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: desktopQuery.matches ? 80 : { top: 110, bottom: 140, left: 30, right: 70 }, maxZoom: 14, duration: 900 });
  };
  setupSearch($('#search') as HTMLFormElement, $('#search-input') as HTMLInputElement, $('#search-results') as HTMLUListElement, {
    local: (q) => searcher.local(q),
    remote: (q, signal) => searcher.remote(q, signal),
    onPick: (r: SearchResult) => {
      if (r.kind === 'markup' && r.markupId) {
        const m = store.get(r.markupId);
        if (!m) return;
        zoomToMarkups(map, [m]);
        if (!draw.active) markupCard(m);
        return;
      }
      if (r.point) {
        map.flyTo({ center: r.point, zoom: Math.max(map.getZoom(), 15) });
        if (!draw.active) goToCoord(r.point[0], r.point[1]);
        return;
      }
      if (r.bbox) {
        flyToBBox(r.bbox);
        toast(`${r.label} · ${r.sub}`);
        return;
      }
      if (r.kind === 'county') toast('County outlines are still loading — try again in a moment');
    },
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
  Object.assign(window, { __mila: { map, layers, overview, store, tracker, compass, loc, draw, setBasemap, applyTheme } });
}
