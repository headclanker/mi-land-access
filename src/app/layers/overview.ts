// Zoomed-out public-land overview: a prebuilt, heavily generalised statewide picture
// (public/overview/public-land.json, built by scripts/build-overview.mjs) drawn below the zoom
// where the live ArcGIS layers it summarises take over. Near the hand-off it stays up until the
// live layers have drawn something, then fades out, so there is neither a gap nor double drawing.

import type { Map as MLMap, GeoJSONSource, ExpressionSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { GRADE_COLORS, REFUGE_COLOR } from '../../contract';
import { OVERVIEW_HANDOFF_ZOOM, OVERVIEW_LAYER_IDS, PARCEL_MIN_ZOOM } from '../../data/sources';
import type { LayerManager } from './manager';
import { prefGet, prefSet } from '../util/store';

export const OVERVIEW_FILL = 'overview-fill';
const OVERVIEW_LINE = 'overview-line';
const OVERVIEW_YELLOW = 'overview-yellow';
const SRC = 'overview';

const color: ExpressionSpecification = ['match', ['get', 'g'], 'green', GRADE_COLORS.green, 'yellow', GRADE_COLORS.yellow, 'red', GRADE_COLORS.red, 'refuge', REFUGE_COLOR, GRADE_COLORS.unknown];
// Matches the live public-land fills around the hand-off zoom (manager.ts), so the swap is smooth.
const FILL_OPACITY: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 0.55, 8, 0.48, 9, 0.47];
const LINE_OPACITY: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0.8];

interface OverviewFile extends FeatureCollection {
  built?: string;
  layers?: Record<string, number>;
}

/** Zoom from which the overview never shows (county parcels draw and reconcile against live data). */
export const OVERVIEW_MAX_ZOOM = PARCEL_MIN_ZOOM;

export interface LiveState {
  visible: boolean;
  active: boolean;
  loading: boolean;
  count: number;
  truncated: boolean;
}

/**
 * Whether the overview should be drawn instead of the live layers it summarises. Pure.
 *  - below the hand-off zoom: always;
 *  - from the hand-off up to parcel zoom: while the live layers have not drawn anything yet
 *    (being switched on / loading), or while any of them hit its feature limit in this view
 *    (dense state forest at zoom 9–11) — a complete coarse picture beats a partial live one;
 *  - from parcel zoom up: never.
 */
export function overviewWanted(zoom: number, live: readonly LiveState[], handoff = OVERVIEW_HANDOFF_ZOOM, maxZoom = OVERVIEW_MAX_ZOOM): boolean {
  if (zoom < handoff) return true;
  if (zoom >= maxZoom) return false;
  const on = live.filter((l) => l.visible);
  if (!on.length) return false;
  if (on.some((l) => l.active && l.truncated)) return true;
  return on.every((l) => l.count === 0) && on.some((l) => !l.active || l.loading);
}

export class Overview {
  enabled: boolean = prefGet('overview', true);
  status: 'loading' | 'ready' | 'error' = 'loading';
  /** Build date (YYYY-MM-DD) from the file. */
  built = '';
  private shown = false;
  private listeners: (() => void)[] = [];

  private readonly map: MLMap;
  private readonly layers: LayerManager;

  constructor(map: MLMap, layers: LayerManager) {
    this.map = map;
    this.layers = layers;
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0.5 });
    map.addLayer({ id: OVERVIEW_FILL, type: 'fill', source: SRC, paint: { 'fill-color': color, 'fill-opacity': 0, 'fill-opacity-transition': { duration: 350, delay: 0 } } }, 'anchor-fills');
    map.addLayer({ id: OVERVIEW_LINE, type: 'line', source: SRC, paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 9, 1], 'line-opacity': 0, 'line-opacity-transition': { duration: 350, delay: 0 } } }, 'anchor-lines');
    // "Check first" land is mostly a few acres: a bold outline keeps each area visible as a dot.
    map.addLayer({ id: OVERVIEW_YELLOW, type: 'line', source: SRC, filter: ['==', ['get', 'g'], 'yellow'], paint: { 'line-color': '#ffd21f', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 7, 1.6, 9, 2.2], 'line-opacity': 0, 'line-opacity-transition': { duration: 350, delay: 0 } } }, 'anchor-lines');
    map.on('zoom', () => this.update());
    layers.onChange(() => this.update());
    void this.load();
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private async load(): Promise<void> {
    try {
      // Relative to the page so it works at a domain root and under a sub-path (GitHub Pages).
      const res = await fetch(new URL('overview/public-land.json', document.baseURI));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OverviewFile;
      this.built = typeof data.built === 'string' ? data.built : '';
      this.map.getSource<GeoJSONSource>(SRC)?.setData({ type: 'FeatureCollection', features: data.features ?? [] });
      this.status = 'ready';
    } catch (err) {
      console.warn('Public-land overview unavailable', err);
      this.status = 'error';
    }
    this.update(true);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    prefSet('overview', on);
    this.update(true);
  }

  /** True while the overview is actually drawn (taps on it are then meaningful). */
  get isShown(): boolean {
    return this.shown;
  }

  /** True when the overview is standing in for live layers above the hand-off zoom. */
  standingIn = false;

  private update(force = false): void {
    const live = OVERVIEW_LAYER_IDS.map((id) => this.layers.getStatus(id));
    const zoom = this.map.getZoom();
    const want = this.enabled && this.status === 'ready' && overviewWanted(zoom, live);
    // Above the hand-off the live layers it covers are hidden meanwhile: never both at once.
    const standIn = want && zoom >= OVERVIEW_HANDOFF_ZOOM;
    if (standIn !== this.standingIn) {
      this.standingIn = standIn;
      this.layers.suppress(OVERVIEW_LAYER_IDS, standIn);
    }
    if (want === this.shown && !force) return;
    this.shown = want;
    this.map.setPaintProperty(OVERVIEW_FILL, 'fill-opacity', want ? FILL_OPACITY : 0);
    this.map.setPaintProperty(OVERVIEW_LINE, 'line-opacity', want ? LINE_OPACITY : 0);
    this.map.setPaintProperty(OVERVIEW_YELLOW, 'line-opacity', want ? 1 : 0);
    this.emit();
  }

  /** "Nov 11, 2026" for the layer panel. */
  builtLabel(): string {
    if (!this.built) return '';
    const d = new Date(`${this.built}T12:00:00`);
    return Number.isNaN(d.getTime()) ? this.built : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
