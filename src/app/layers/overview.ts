// Zoomed-out public-land overview: a prebuilt, heavily generalised statewide picture
// (public/overview/public-land.json, built by scripts/build-overview.mjs) drawn below the zoom
// where the live ArcGIS layers it summarises take over. Near the hand-off it stays up until the
// live layers have drawn something, then fades out, so there is neither a gap nor double drawing.

import type { Map as MLMap, GeoJSONSource, ExpressionSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { GRADE_COLORS } from '../../contract';
import { OVERVIEW_HANDOFF_ZOOM, OVERVIEW_LAYER_IDS } from '../../data/sources';
import type { LayerManager } from './manager';
import { prefGet, prefSet } from '../util/store';

export const OVERVIEW_FILL = 'overview-fill';
const OVERVIEW_LINE = 'overview-line';
const SRC = 'overview';

const color: ExpressionSpecification = ['match', ['get', 'g'], 'green', GRADE_COLORS.green, 'yellow', GRADE_COLORS.yellow, 'red', GRADE_COLORS.red, GRADE_COLORS.unknown];
// Matches the live public-land fills around the hand-off zoom (manager.ts), so the swap is smooth.
const FILL_OPACITY: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 0.55, 8, 0.48, 9, 0.47];
const LINE_OPACITY: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0.8];

interface OverviewFile extends FeatureCollection {
  built?: string;
  layers?: Record<string, number>;
}

/** Whether the overview should be drawn: below the hand-off, or above it until live data arrives. Pure. */
export function overviewWanted(zoom: number, live: readonly { active: boolean; loading: boolean; count: number }[], handoff = OVERVIEW_HANDOFF_ZOOM): boolean {
  if (zoom < handoff) return true;
  const active = live.filter((l) => l.active);
  if (!active.length) return false;
  // Keep it while every active live layer is still loading and nothing has been drawn yet.
  return active.some((l) => l.loading) && active.every((l) => l.count === 0);
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

  private update(force = false): void {
    const live = OVERVIEW_LAYER_IDS.map((id) => this.layers.getStatus(id));
    const want = this.enabled && this.status === 'ready' && overviewWanted(this.map.getZoom(), live);
    if (want === this.shown && !force) return;
    this.shown = want;
    this.map.setPaintProperty(OVERVIEW_FILL, 'fill-opacity', want ? FILL_OPACITY : 0);
    this.map.setPaintProperty(OVERVIEW_LINE, 'line-opacity', want ? LINE_OPACITY : 0);
    this.emit();
  }

  /** "Nov 11, 2026" for the layer panel. */
  builtLabel(): string {
    if (!this.built) return '';
    const d = new Date(`${this.built}T12:00:00`);
    return Number.isNaN(d.getTime()) ? this.built : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
