// Shared GPS watcher + "my location" rendering (dot, heading cone, accuracy circle).

import { Marker, type Map as MLMap, type GeoJSONSource } from 'maplibre-gl';
import { circle } from '@turf/turf';
import { h, toast } from '../util/dom';
import { describeGpsError } from './gpsError';

export interface Fix {
  lon: number;
  lat: number;
  acc: number;
  alt?: number;
  speed?: number;
  /** GPS course over ground, degrees, when moving. */
  course?: number;
  t: number;
}

type Listener = (f: Fix) => void;

export class LocationService {
  last: Fix | null = null;
  private watchId: number | null = null;
  private listeners = new Set<Listener>();
  private holders = new Set<string>();
  private marker: Marker | null = null;
  private readonly dot: HTMLElement;
  follow = false;
  /** Current problem with the GPS (null while fixes are flowing). */
  error: string | null = null;
  /** Date.now() when the last fix arrived (device timestamps can be in another clock). */
  lastFixAt = 0;
  private statusListeners: (() => void)[] = [];

  private readonly map: MLMap;

  constructor(map: MLMap) {
    this.map = map;
    this.dot = h('div.me-dot', { 'aria-label': 'Your location' }, h('div.me-cone'), h('div.me-core'));
    map.addSource('me-acc', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'me-acc-fill', type: 'fill', source: 'me-acc', paint: { 'fill-color': '#2f8cff', 'fill-opacity': 0.13 } }, 'anchor-top');
    map.addLayer({ id: 'me-acc-line', type: 'line', source: 'me-acc', paint: { 'line-color': '#2f8cff', 'line-opacity': 0.6, 'line-width': 1.2 } }, 'anchor-top');
    // Stop following when the user pans by hand.
    map.on('dragstart', () => {
      if (this.follow) {
        this.follow = false;
        document.getElementById('btn-locate')?.classList.remove('following');
      }
    });
  }

  get available(): boolean {
    return 'geolocation' in navigator;
  }

  get running(): boolean {
    return this.watchId !== null;
  }

  onFix(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called whenever `error` changes (set by a real failure, cleared as soon as a fix arrives). */
  onStatus(fn: () => void): void {
    this.statusListeners.push(fn);
  }

  private setError(msg: string | null): void {
    if (msg === this.error) return;
    this.error = msg;
    for (const fn of this.statusListeners) fn();
  }

  /** Reference-counted start: the locate button and the tracker each hold the watcher. */
  acquire(holder: string): void {
    this.holders.add(holder);
    if (this.watchId !== null || !this.available) {
      if (!this.available) toast('Location is not available in this browser');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.handle(p),
      (err) => {
        const msg = describeGpsError(err.code, this.lastFixAt ? Date.now() - this.lastFixAt : Infinity);
        if (err.code === err.PERMISSION_DENIED && msg) {
          toast(msg, 4000);
          this.holders.clear();
          this.stopWatch();
        }
        if (msg) this.setError(msg);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
    );
  }

  release(holder: string): void {
    this.holders.delete(holder);
    if (this.holders.size === 0) this.stopWatch();
  }

  holds(holder: string): boolean {
    return this.holders.has(holder);
  }

  private stopWatch(): void {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.setError(null);
    this.marker?.remove();
    this.marker = null;
    this.map.getSource<GeoJSONSource>('me-acc')?.setData({ type: 'FeatureCollection', features: [] });
    this.follow = false;
  }

  private handle(p: GeolocationPosition): void {
    const c = p.coords;
    const fix: Fix = {
      lon: c.longitude,
      lat: c.latitude,
      acc: c.accuracy,
      alt: c.altitude ?? undefined,
      speed: c.speed ?? undefined,
      course: c.heading !== null && Number.isFinite(c.heading) ? c.heading : undefined,
      t: p.timestamp || Date.now(),
    };
    const first = !this.last;
    this.last = fix;
    this.lastFixAt = Date.now();
    this.setError(null);
    this.draw(fix);
    if (this.follow || first) {
      if (first && this.follow) this.map.flyTo({ center: [fix.lon, fix.lat], zoom: Math.max(this.map.getZoom(), 15) });
      else if (this.follow) this.map.easeTo({ center: [fix.lon, fix.lat], duration: 500 });
    }
    for (const fn of this.listeners) fn(fix);
  }

  private draw(f: Fix): void {
    if (!this.marker) this.marker = new Marker({ element: this.dot, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([f.lon, f.lat]).addTo(this.map);
    else this.marker.setLngLat([f.lon, f.lat]);
    const acc = Math.min(Math.max(f.acc, 1), 5000);
    this.map.getSource<GeoJSONSource>('me-acc')?.setData(circle([f.lon, f.lat], acc / 1000, { steps: 48, units: 'kilometers' }));
  }

  /** Rotates the heading cone (device compass heading, degrees from true north). */
  setHeading(deg: number | null): void {
    this.dot.classList.toggle('has-heading', deg !== null);
    if (deg !== null) this.dot.style.setProperty('--heading', `${deg}deg`);
  }

  /** Locate-me: centre once, then toggle follow, then turn off. */
  locateClick(): void {
    const btn = document.getElementById('btn-locate');
    if (!this.holds('locate')) {
      this.follow = true;
      this.acquire('locate');
      btn?.classList.add('active', 'following');
      if (this.last) this.map.flyTo({ center: [this.last.lon, this.last.lat], zoom: Math.max(this.map.getZoom(), 15) });
      else toast('Finding your location…');
      return;
    }
    if (!this.follow && this.last) {
      this.follow = true;
      btn?.classList.add('following');
      this.map.flyTo({ center: [this.last.lon, this.last.lat], zoom: Math.max(this.map.getZoom(), 14) });
      return;
    }
    this.follow = false;
    btn?.classList.remove('active', 'following');
    this.release('locate');
    if (this.running) toast('Location stays on while recording a track');
  }
}
