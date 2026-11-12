// 3D view: terrain (AWS Terrain Tiles), shaded relief, sky / haze and extruded buildings
// (OpenFreeMap). Everything is added to the style lazily, the first time it is needed, so the
// flat map loads and renders exactly as before until 3D or relief is switched on.

import type { Map as MLMap, FillExtrusionLayerSpecification, ExpressionSpecification } from 'maplibre-gl';
import { RELIEF_ANCHOR } from './map';
import { fill, h, icon } from '../util/dom';
import { prefGet, prefSet } from '../util/store';
import {
  BUILDINGS_ATTRIBUTION,
  BUILDINGS_MINZOOM,
  BUILDINGS_SOURCE_LAYER,
  BUILDINGS_TILEJSON,
  DEFAULT_BUILDING_HEIGHT,
  DEM_MAXZOOM,
  DEM_TILE_SIZE,
  DEM_TILE_TEMPLATE,
  EXAGGERATION_STEPS,
  TERRAIN_ATTRIBUTION,
  TERRAIN_TILE_SIZE,
  buildingColor,
  cameraFor,
  demTileUrl,
  formatElevationFt,
  hillshadePaint,
  normalizePrefs,
  planFor,
  reduce,
  skyColors,
  terrariumElevation,
  tilePixel,
  trueElevation,
  type HillshadeMode,
  type View3DAction,
  type View3DPlan,
  type View3DPrefs,
} from './view3dModel';

const PREF_KEY = 'view3d';
const DEM_TERRAIN = 'dem-terrain';
const DEM_HILLSHADE = 'dem-hillshade';
const HILLSHADE_LAYER = 'relief-hillshade';
const BUILDINGS_SOURCE = 'ofm-buildings';
const BUILDINGS_LAYER = 'buildings-3d';
/** Elevation tiles are only requested inside this box (Michigan plus everything a tilted camera can see). */
const DEM_BOUNDS: [number, number, number, number] = [-97, 38, -76, 51];
/** Hard cap on elevation tiles kept in memory per DEM source (MapLibre otherwise sizes it to ~5 screens). */
const DEM_TILE_CACHE = 160;
const EASE_MS = 800;

let current: View3D | null = null;

/** Settings block for the More pane (null until the map has started). */
export function view3dSettings(): HTMLElement | null {
  return current?.settingsElement() ?? null;
}

export class View3D {
  private prefs: View3DPrefs;
  private plan: View3DPlan = { terrain: false, hillshade: false, buildings: false, dem: false, maxPitch: 0 };
  private readonly map: MLMap;
  private readonly button: HTMLButtonElement;
  private settings: HTMLElement | null = null;
  private listeners: (() => void)[] = [];
  private leaving = 0;
  private readonly sampler = new DemSampler(() => this.emit());

  constructor(map: MLMap, fabs: HTMLElement) {
    this.map = map;
    current = this;
    this.prefs = normalizePrefs(prefGet<unknown>(PREF_KEY, null));
    this.button = h(
      'button.fab.fab-labelled',
      { id: 'btn-3d', type: 'button', 'aria-pressed': 'false', 'aria-label': '3D view', title: '3D terrain view' },
      icon('terrain'),
      h('span', {}, '3D'),
    );
    this.button.addEventListener('click', () => this.dispatch({ type: 'toggle' }));
    const after = fabs.querySelector('#btn-sat');
    if (after) after.after(this.button);
    else fabs.prepend(this.button);

    // Remember the tilt / turn the user picks while in 3D.
    map.on('moveend', () => {
      if (!this.prefs.on || this.leaving) return;
      this.commit(reduce(this.prefs, { type: 'camera', pitch: map.getPitch(), bearing: map.getBearing() }), false);
    });
    // Terrain tiles arriving change the elevation under the readout without any camera move.
    map.on('idle', () => {
      if (this.plan.dem) this.emit();
    });
    // Restyle relief, sky and buildings when the basemap or theme changes.
    new MutationObserver(() => this.restyle()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-basemap'] });

    this.apply(false);
  }

  get on(): boolean {
    return this.prefs.on;
  }

  get exaggeration(): number {
    return this.prefs.exaggeration;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  dispatch(a: View3DAction): void {
    this.commit(reduce(this.prefs, a), true);
  }

  private commit(next: View3DPrefs, apply: boolean): void {
    if (next === this.prefs) return;
    this.prefs = next;
    prefSet(PREF_KEY, next);
    if (apply) this.apply(true);
  }

  // ---------- applying the plan ----------

  private headingUp(): boolean {
    return document.documentElement.classList.contains('heading-up');
  }

  private apply(animate: boolean): void {
    const map = this.map;
    const was = this.plan;
    const plan = planFor(this.prefs);
    this.plan = plan;

    if (plan.dem) this.ensureRelief();
    if (map.getLayer(HILLSHADE_LAYER)) map.setLayoutProperty(HILLSHADE_LAYER, 'visibility', plan.hillshade ? 'visible' : 'none');

    if (plan.terrain) {
      window.clearTimeout(this.leaving);
      this.leaving = 0;
      map.setMaxPitch(plan.maxPitch);
      this.setMousePitch(true);
      const t = map.getTerrain();
      if (!t || t.exaggeration !== this.prefs.exaggeration) map.setTerrain({ source: DEM_TERRAIN, exaggeration: this.prefs.exaggeration });
      if (!was.terrain) {
        const cam = cameraFor(true, this.prefs, this.headingUp());
        this.tilt(cam, animate);
      }
    } else if (was.terrain) {
      this.leave(animate);
    }

    if (plan.buildings) this.ensureBuildings();
    if (map.getLayer(BUILDINGS_LAYER)) map.setLayoutProperty(BUILDINGS_LAYER, 'visibility', plan.buildings ? 'visible' : 'none');

    document.documentElement.classList.toggle('view-3d', plan.terrain);
    this.button.setAttribute('aria-pressed', String(plan.terrain));
    this.button.classList.toggle('active', plan.terrain);
    this.button.title = plan.terrain ? 'Back to the flat map' : '3D terrain view';
    this.renderSettings();
    this.emit();
  }

  /** Tilt (and turn) the camera; heading-up owns the bearing and sets it every frame, so ease only the tilt then. */
  private tilt(cam: { pitch: number; bearing?: number }, animate: boolean): void {
    const map = this.map;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduced) {
      map.jumpTo(cam);
      return;
    }
    if (cam.bearing !== undefined) {
      map.easeTo({ ...cam, duration: EASE_MS });
      return;
    }
    // A per-frame setBearing from the compass would cancel an easeTo; animate the tilt by hand.
    const from = map.getPitch();
    const t0 = performance.now();
    const step = (now: number): void => {
      // Heading-up switched off (e.g. north tapped): stop, so its own bearing ease is not cancelled.
      if (!this.headingUp()) return;
      const k = Math.min(1, (now - t0) / EASE_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      map.setPitch(from + (cam.pitch - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Back to the flat map: level the camera first, then drop the terrain (no visible jump). */
  private leave(animate: boolean): void {
    const map = this.map;
    const cam = cameraFor(false, this.prefs, this.headingUp());
    const finish = (): void => {
      this.leaving = 0;
      if (this.prefs.on) return; // switched back on meanwhile
      if (map.getPitch() !== 0) {
        // Interrupted (a gesture or the north button's ease): level out once it has finished.
        if (map.isMoving()) {
          map.once('moveend', () => window.setTimeout(finish, 0));
          return;
        }
        map.jumpTo({ pitch: 0 });
      }
      map.setTerrain(null);
      map.setMaxPitch(0);
      this.setMousePitch(false);
    };
    this.tilt(cam, animate);
    window.clearTimeout(this.leaving);
    this.leaving = window.setTimeout(finish, animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? EASE_MS + 60 : 0);
  }

  /** Right-drag / Ctrl-drag tilts only in 3D (the flat map keeps rotate-only, as before). */
  private setMousePitch(on: boolean): void {
    const dr = this.map.dragRotate;
    if (dr._pitchWithRotate === on) return;
    dr._pitchWithRotate = on;
    if (dr.isEnabled()) {
      dr.disable();
      dr.enable();
    }
  }

  private capCache(sourceId: string): void {
    // Internal but typed: the per-source tile manager's out-of-view cache limit.
    const tm = this.map.style?.tileManagers?.[sourceId];
    if (tm) tm._maxTileCacheSize = DEM_TILE_CACHE;
  }

  private ensureRelief(): void {
    const map = this.map;
    // MapLibre wants separate DEM sources for the terrain mesh and the hillshade layer.
    for (const id of [DEM_TERRAIN, DEM_HILLSHADE]) {
      if (map.getSource(id)) continue;
      map.addSource(id, {
        type: 'raster-dem',
        tiles: [DEM_TILE_TEMPLATE],
        tileSize: id === DEM_TERRAIN ? TERRAIN_TILE_SIZE : DEM_TILE_SIZE,
        maxzoom: DEM_MAXZOOM,
        encoding: 'terrarium',
        bounds: DEM_BOUNDS,
        attribution: TERRAIN_ATTRIBUTION,
      });
      this.capCache(id);
    }
    if (!map.getLayer(HILLSHADE_LAYER)) {
      const before = map.getLayer(RELIEF_ANCHOR) ? map.getStyle().layers[map.getStyle().layers.findIndex((l) => l.id === RELIEF_ANCHOR) + 1]?.id : undefined;
      map.addLayer({ id: HILLSHADE_LAYER, type: 'hillshade', source: DEM_HILLSHADE, layout: { visibility: 'none' }, paint: { ...this.hillshadeStyle(), 'hillshade-illumination-anchor': 'map' } }, before);
      map.setSky(this.skyStyle());
    }
  }

  private ensureBuildings(): void {
    const map = this.map;
    if (!map.getSource(BUILDINGS_SOURCE)) map.addSource(BUILDINGS_SOURCE, { type: 'vector', url: BUILDINGS_TILEJSON, attribution: BUILDINGS_ATTRIBUTION });
    if (map.getLayer(BUILDINGS_LAYER)) return;
    const height: ExpressionSpecification = ['max', 3, ['coalesce', ['get', 'render_height'], DEFAULT_BUILDING_HEIGHT]];
    const base: ExpressionSpecification = ['coalesce', ['get', 'render_min_height'], 0];
    const layer: FillExtrusionLayerSpecification = {
      id: BUILDINGS_LAYER,
      type: 'fill-extrusion',
      source: BUILDINGS_SOURCE,
      'source-layer': BUILDINGS_SOURCE_LAYER,
      minzoom: BUILDINGS_MINZOOM,
      // Building parts are drawn by their own features; outlines marked hide_3d would double them.
      filter: ['!=', ['get', 'hide_3d'], true],
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': this.buildingStyle(),
        // Grow out of the ground as they appear instead of popping in.
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], BUILDINGS_MINZOOM, 0, BUILDINGS_MINZOOM + 0.6, height],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], BUILDINGS_MINZOOM, 0, BUILDINGS_MINZOOM + 0.6, base],
        'fill-extrusion-opacity': 0.78,
        'fill-extrusion-vertical-gradient': true,
      },
    };
    // Below the point symbols and labels, so owner names and waypoints stay on top.
    map.addLayer(layer, 'anchor-points');
  }

  private dark(): { basemap: boolean; theme: boolean } {
    const d = document.documentElement.dataset;
    return { basemap: d.basemap === 'dark', theme: d.theme === 'dark' };
  }

  private hillshadeStyle(): ReturnType<typeof hillshadePaint> {
    const d = this.dark();
    return hillshadePaint(d.basemap, d.theme);
  }

  private buildingStyle(): string {
    const d = this.dark();
    return buildingColor(d.basemap, d.theme);
  }

  private skyStyle(): Parameters<MLMap['setSky']>[0] {
    const d = this.dark();
    return { ...skyColors(d.basemap, d.theme), 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85, 'atmosphere-blend': 0 };
  }

  private restyle(): void {
    const map = this.map;
    if (map.getLayer(HILLSHADE_LAYER)) {
      for (const [k, v] of Object.entries(this.hillshadeStyle())) map.setPaintProperty(HILLSHADE_LAYER, k as keyof ReturnType<typeof hillshadePaint>, v);
      map.setSky(this.skyStyle());
    }
    if (map.getLayer(BUILDINGS_LAYER)) map.setPaintProperty(BUILDINGS_LAYER, 'fill-extrusion-color', this.buildingStyle());
  }

  // ---------- elevation ----------

  /** Ground elevation in metres, or null when relief is off or no data has loaded. */
  elevationAt(lon: number, lat: number): number | null {
    if (!this.plan.dem) return null;
    if (this.plan.terrain && this.map.getTerrain()) {
      const m = trueElevation(this.map.queryTerrainElevation([lon, lat]), this.prefs.exaggeration);
      // 0 means "no tile yet" (nowhere in Michigan is at sea level).
      if (m !== null && m > 0) return m;
    }
    return this.sampler.sample(lon, lat, Math.max(8, Math.min(DEM_MAXZOOM - 1, Math.floor(this.map.getZoom()))));
  }

  /** "≈ 1,230 ft" for the coordinate readout, or '' when relief is off. */
  elevationLabel(lon: number, lat: number): string {
    return formatElevationFt(this.elevationAt(lon, lat));
  }

  // ---------- More pane ----------

  settingsElement(): HTMLElement {
    if (!this.settings) this.settings = h('div.v3d-settings');
    this.renderSettings();
    return this.settings;
  }

  private renderSettings(): void {
    const root = this.settings;
    if (!root) return;
    const p = this.prefs;
    const radio = <T>(label: string, items: { value: T; text: string }[], cur: T, pick: (v: T) => void): HTMLElement =>
      h(
        'div.segmented',
        { role: 'radiogroup', 'aria-label': label },
        items.map((it) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(it.value === cur), onclick: () => pick(it.value) }, it.text)),
      );
    const bld = h('input', { type: 'checkbox', role: 'switch', 'aria-label': '3D buildings' });
    bld.checked = p.buildings;
    bld.addEventListener('change', () => this.dispatch({ type: 'buildings', on: bld.checked }));
    fill(
      root,
      h('h2.pane-title', {}, '3D view'),
      h(
        'div.v3d-toggle',
        {},
        h('button.btn.sm', { type: 'button', 'aria-pressed': String(p.on), onclick: () => this.dispatch({ type: 'toggle' }) }, icon('terrain'), p.on ? '3D is on — back to flat' : 'Turn on 3D'),
      ),
      h('p.muted.small', {}, 'Tilt the map over terrain with buildings. In 3D, drag with two fingers to tilt and turn (on a computer: right-drag or Ctrl-drag).'),
      h('p.v3d-label', {}, 'Terrain height'),
      radio('Terrain height', EXAGGERATION_STEPS.map((v) => ({ value: v as number, text: `${v}×` })), p.exaggeration, (v) => this.dispatch({ type: 'exaggeration', value: v })),
      h('label.layer-label.v3d-switch', {}, bld, h('span.switch', { 'aria-hidden': 'true' }), h('span.layer-text', {}, h('span.layer-title', {}, '3D buildings'), h('span.muted.small', {}, `In 3D from zoom ${BUILDINGS_MINZOOM}; OpenStreetMap coverage`))),
      h('p.v3d-label', {}, 'Shaded relief'),
      radio<HillshadeMode>(
        'Shaded relief',
        [
          { value: 'off', text: 'Off' },
          { value: '3d', text: 'In 3D' },
          { value: 'always', text: 'Always' },
        ],
        p.hillshade,
        (v) => this.dispatch({ type: 'hillshade', mode: v }),
      ),
      h('p.muted.small', {}, 'Elevation and building tiles download only while 3D or relief is on (a few MB for a session of panning) and are kept for offline use. Elevation is approximate (10–30 m data). If 3D is slow on an older phone, use 1× height, turn off buildings or relief, or go back to the flat map.'),
    );
  }
}

/**
 * Reads ground elevation straight from the terrarium PNGs when no terrain mesh is drawn (relief on
 * the flat map). Keeps a handful of decoded tiles; the browser / service worker cache the files.
 */
class DemSampler {
  private readonly tiles = new Map<string, ImageData | null>();
  private readonly pending = new Set<string>();
  private readonly onReady: () => void;

  constructor(onReady: () => void) {
    this.onReady = onReady;
  }

  sample(lon: number, lat: number, z: number): number | null {
    const t = tilePixel(lon, lat, z);
    const key = `${z}/${t.x}/${t.y}`;
    const img = this.tiles.get(key);
    if (img) {
      const o = (t.py * img.width + t.px) * 4;
      return terrariumElevation(img.data[o], img.data[o + 1], img.data[o + 2]);
    }
    if (img === undefined && !this.pending.has(key)) void this.load(key, z, t.x, t.y);
    return null;
  }

  private async load(key: string, z: number, x: number, y: number): Promise<void> {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return;
    this.pending.add(key);
    try {
      const res = await fetch(demTileUrl(z, x, y));
      if (!res.ok) throw new Error(String(res.status));
      const bmp = await createImageBitmap(await res.blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bmp, 0, 0);
      this.tiles.set(key, ctx.getImageData(0, 0, bmp.width, bmp.height));
      while (this.tiles.size > 8) this.tiles.delete(this.tiles.keys().next().value as string);
      this.onReady();
    } catch {
      this.tiles.set(key, null); // offline or missing: no elevation here, do not retry every frame
      window.setTimeout(() => this.tiles.delete(key), 30_000);
    } finally {
      this.pending.delete(key);
    }
  }
}
