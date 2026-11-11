// Touch-friendly drawing: tap to add vertices (or "Add at crosshair" for precision), drag
// vertex handles to adjust, live length / area readout.

import { Marker, type Map as MLMap, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
import { area as turfArea } from '@turf/turf';
import type { Feature, FeatureCollection } from 'geojson';
import { formatAcres, formatDistance, pathLength, type LngLat } from '../util/geo';
import { fill, h, icon } from '../util/dom';

export type DrawKind = 'waypoint' | 'line' | 'shape';

export interface DrawResult {
  kind: DrawKind;
  coords: LngLat[];
}

const SRC = 'draw';

export function measure(kind: DrawKind, coords: readonly LngLat[]): string {
  if (kind === 'waypoint') return '';
  const len = pathLength(coords);
  if (kind === 'line') return coords.length < 2 ? 'Tap the map to add points' : `Length ${formatDistance(len)}`;
  if (coords.length < 3) return coords.length < 1 ? 'Tap the map to outline the area' : `${3 - coords.length} more point${coords.length === 2 ? '' : 's'}`;
  const ring = [...coords, coords[0]];
  const a = turfArea({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } });
  return `${formatAcres(a)} · perimeter ${formatDistance(pathLength(ring))}`;
}

export class DrawController {
  active: DrawKind | null = null;
  private coords: LngLat[] = [];
  private markers: Marker[] = [];
  private resolve: ((r: DrawResult | null) => void) | null = null;
  private readonly hud: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly onClick = (e: MapMouseEvent): void => this.handleClick(e);
  private title = '';

  private readonly map: MLMap;

  constructor(map: MLMap) {
    this.map = map;
    this.hud = document.getElementById('draw-hud') as HTMLElement;
    this.crosshair = document.getElementById('crosshair') as HTMLElement;
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'draw-fill', type: 'fill', source: SRC, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#ff6a13', 'fill-opacity': 0.2 } }, 'anchor-top');
    map.addLayer({ id: 'draw-casing', type: 'line', source: SRC, paint: { 'line-color': '#000', 'line-width': 6, 'line-opacity': 0.5 } }, 'anchor-top');
    map.addLayer({ id: 'draw-line', type: 'line', source: SRC, paint: { 'line-color': '#ff6a13', 'line-width': 3 } }, 'anchor-top');
  }

  /** Points placed so far. */
  get pointCount(): number {
    return this.coords.length;
  }

  /** Whether Done would succeed now. */
  get canFinish(): boolean {
    const kind = this.active;
    return Boolean(kind) && this.coords.length >= (kind === 'waypoint' ? 1 : kind === 'line' ? 2 : 3);
  }

  get currentTitle(): string {
    return this.title;
  }

  /** Starts drawing; resolves with the geometry, or null if cancelled. */
  start(kind: DrawKind, initial: LngLat[] = [], title?: string): Promise<DrawResult | null> {
    this.cancel();
    this.active = kind;
    this.coords = [...initial];
    this.title = title ?? (kind === 'waypoint' ? 'New waypoint' : kind === 'line' ? 'New line' : 'New shape');
    document.documentElement.classList.add('drawing');
    this.crosshair.hidden = false;
    this.map.on('click', this.onClick);
    if (kind === 'waypoint' && initial[0]) this.map.easeTo({ center: initial[0], duration: 300 });
    this.update();
    return new Promise((res) => {
      this.resolve = res;
    });
  }

  private handleClick(e: MapMouseEvent): void {
    if (!this.active) return;
    const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
    if (this.active === 'waypoint') {
      this.coords = [p];
      this.finish();
      return;
    }
    this.coords.push(p);
    this.update();
  }

  private addAtCenter(): void {
    const c = this.map.getCenter();
    const p: LngLat = [c.lng, c.lat];
    if (this.active === 'waypoint') {
      this.coords = [p];
      this.finish();
      return;
    }
    this.coords.push(p);
    this.update();
  }

  private undo(): void {
    this.coords.pop();
    this.update();
  }

  finish(): void {
    if (!this.active) return;
    const kind = this.active;
    const min = kind === 'waypoint' ? 1 : kind === 'line' ? 2 : 3;
    if (this.coords.length < min) return;
    const coords = this.coords;
    const res = this.resolve;
    this.teardown();
    res?.({ kind, coords });
  }

  cancel(): void {
    if (!this.active) return;
    const res = this.resolve;
    this.teardown();
    res?.(null);
  }

  private teardown(): void {
    this.map.off('click', this.onClick);
    this.active = null;
    this.resolve = null;
    this.coords = [];
    for (const m of this.markers) m.remove();
    this.markers = [];
    this.hud.hidden = true;
    fill(this.hud);
    this.crosshair.hidden = true;
    document.documentElement.classList.remove('drawing');
    this.map.getSource<GeoJSONSource>(SRC)?.setData({ type: 'FeatureCollection', features: [] });
  }

  private update(): void {
    if (!this.active) return;
    const kind = this.active;
    // Preview geometry.
    const features: Feature[] = [];
    if (kind === 'shape' && this.coords.length >= 3) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...this.coords, this.coords[0]]] } });
    } else if (this.coords.length >= 2) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: this.coords } });
    }
    const fc: FeatureCollection = { type: 'FeatureCollection', features };
    this.map.getSource<GeoJSONSource>(SRC)?.setData(fc);

    // Vertex handles (draggable, large touch targets).
    for (const m of this.markers) m.remove();
    this.markers = [];
    if (kind !== 'waypoint') {
      this.coords.forEach((c, i) => {
        const el = h('div.vertex', { 'aria-label': `Point ${i + 1}` });
        if (i === 0 && kind === 'shape') el.classList.add('first');
        const mk = new Marker({ element: el, draggable: true }).setLngLat(c).addTo(this.map);
        mk.on('drag', () => {
          const ll = mk.getLngLat();
          this.coords[i] = [ll.lng, ll.lat];
          this.updateGeometryOnly();
        });
        mk.on('dragend', () => this.update());
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          // Tapping the first vertex of a shape closes it.
          if (kind === 'shape' && i === 0 && this.coords.length >= 3) this.finish();
        });
        this.markers.push(mk);
      });
    }
    this.renderHud();
  }

  private updateGeometryOnly(): void {
    const kind = this.active;
    if (!kind) return;
    const geom: Feature[] =
      kind === 'shape' && this.coords.length >= 3
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...this.coords, this.coords[0]]] } }]
        : this.coords.length >= 2
          ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: this.coords } }]
          : [];
    this.map.getSource<GeoJSONSource>(SRC)?.setData({ type: 'FeatureCollection', features: geom });
    const m = this.hud.querySelector('.draw-measure');
    if (m) m.textContent = measure(kind, this.coords);
  }

  private renderHud(): void {
    const kind = this.active;
    if (!kind) return;
    this.hud.hidden = false;
    const min = kind === 'waypoint' ? 1 : kind === 'line' ? 2 : 3;
    const hint = kind === 'waypoint' ? 'Tap the map, or pan it under the crosshair' : measure(kind, this.coords);
    fill(this.hud, 
      h('div.draw-head', {}, h('strong', {}, this.title), h('span.draw-measure', {}, hint)),
      h(
        'div.draw-actions',
        {},
        kind !== 'waypoint'
          ? h('button.btn.ghost', { type: 'button', onclick: () => this.undo(), disabled: this.coords.length === 0, 'aria-label': 'Undo last point' }, icon('undo'), 'Undo')
          : null,
        h('button.btn.ghost', { type: 'button', onclick: () => this.addAtCenter() }, icon('crosshair'), kind === 'waypoint' ? 'Place here' : 'Add point'),
        kind !== 'waypoint' ? h('button.btn.primary', { type: 'button', onclick: () => this.finish(), disabled: this.coords.length < min }, icon('check'), 'Done') : null,
        h('button.btn.icon-only', { type: 'button', onclick: () => this.cancel(), 'aria-label': 'Cancel drawing' }, icon('close')),
      ),
    );
  }
}
