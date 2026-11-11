// Device compass: iOS (webkitCompassHeading + permission prompt), Android (absolute orientation),
// heading-up map mode, bearing/distance to a target waypoint, desktop fallback.

import type { Map as MLMap } from 'maplibre-gl';
import { bearing, cardinal, formatDistance, haversine, normalizeDeg } from '../util/geo';
import { fill, h, icon } from '../util/dom';
import type { LocationService } from '../tracker/location';

interface IOSOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

interface OrientationCtor {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export interface CompassTarget {
  name: string;
  lon: number;
  lat: number;
}

/** Heading in degrees from a DeviceOrientation event, or null when not absolute. Pure. */
export function headingFromEvent(e: { alpha: number | null; absolute?: boolean; webkitCompassHeading?: number }, screenAngle = 0): number | null {
  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
    return normalizeDeg(e.webkitCompassHeading + screenAngle);
  }
  if (e.absolute && e.alpha !== null) return normalizeDeg(360 - e.alpha + screenAngle);
  return null;
}

/** Circular low-pass filter so the needle doesn't jitter or spin across 0°/360°. */
export function smoothHeading(prev: number | null, next: number, k = 0.25): number {
  if (prev === null) return next;
  let d = next - prev;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return normalizeDeg(prev + d * k);
}

export class Compass {
  heading: number | null = null;
  private listening = false;
  private gotSensor = false;
  private rotateMap = false;
  private target: CompassTarget | null = null;
  private raf = 0;
  private visible = false;
  private readonly onAbs = (e: Event): void => this.handle(e as IOSOrientationEvent, true);
  private readonly onRel = (e: Event): void => this.handle(e as IOSOrientationEvent, false);
  private fallbackTimer: number | undefined;

  private readonly map: MLMap;
  private readonly loc: LocationService;
  private readonly hud: HTMLElement;
  private readonly northEl: HTMLElement;

  constructor(map: MLMap, loc: LocationService, hud: HTMLElement, northEl: HTMLElement) {
    this.map = map;
    this.loc = loc;
    this.hud = hud;
    this.northEl = northEl;
    map.on('rotate', () => this.renderNorth());
    northEl.addEventListener('click', () => {
      this.setRotateMap(false);
      map.easeTo({ bearing: 0, duration: 300 });
    });
    loc.onFix(() => this.render());
    this.renderNorth();
  }

  private screenAngle(): number {
    const so = screen.orientation as ScreenOrientation | undefined;
    return so && typeof so.angle === 'number' ? so.angle : 0;
  }

  /** Must run from a user gesture (iOS permission prompt). */
  async enable(): Promise<void> {
    if (this.listening) return;
    const ctor = (window.DeviceOrientationEvent as unknown as OrientationCtor | undefined) ?? undefined;
    if (ctor?.requestPermission) {
      try {
        const res = await ctor.requestPermission();
        // Shown inside the compass itself (a toast would land on top of it).
        this.denied = res === 'denied';
      } catch {
        /* fall through to fallback */
      }
    }
    this.listening = true;
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', this.onAbs);
    window.addEventListener('deviceorientation', this.onRel);
    window.clearTimeout(this.fallbackTimer);
    this.fallbackTimer = window.setTimeout(() => {
      if (!this.gotSensor) this.render();
    }, 2500);
  }

  disable(): void {
    window.removeEventListener('deviceorientationabsolute', this.onAbs);
    window.removeEventListener('deviceorientation', this.onRel);
    this.listening = false;
    this.setRotateMap(false);
    this.loc.setHeading(null);
  }

  private handle(e: IOSOrientationEvent, absEvent: boolean): void {
    const hd = headingFromEvent({ alpha: e.alpha, absolute: absEvent || e.absolute, webkitCompassHeading: e.webkitCompassHeading }, this.screenAngle());
    if (hd === null) return;
    this.gotSensor = true;
    this.heading = smoothHeading(this.heading, hd);
    this.loc.setHeading(this.heading);
    if (!this.raf)
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        if (this.rotateMap && this.heading !== null) this.map.setBearing(this.heading);
        this.render();
      });
  }

  setRotateMap(on: boolean): void {
    this.rotateMap = on;
    document.documentElement.classList.toggle('heading-up', on);
    if (!on && this.map.getBearing() !== 0) this.map.easeTo({ bearing: 0, duration: 300 });
    this.render();
  }

  setTarget(t: CompassTarget | null): void {
    this.target = t;
    if (t) {
      this.show(true);
      this.setExpanded(true);
      if (!this.loc.running) this.loc.acquire('compass');
    } else this.loc.release('compass');
    this.render();
  }

  toggle(): void {
    this.show(!this.visible);
  }

  show(on: boolean): void {
    this.visible = on;
    this.hud.hidden = !on;
    document.getElementById('btn-compass')?.classList.toggle('active', on);
    if (on) void this.enable();
    else {
      this.disable();
      this.setTarget(null);
      this.setExpanded(false);
    }
    this.render();
  }

  private renderNorth(): void {
    const b = this.map.getBearing();
    this.northEl.style.setProperty('--bearing', `${-b}deg`);
    this.northEl.classList.toggle('rotated', Math.abs(b) > 0.5);
    this.northEl.setAttribute('aria-label', `Map bearing ${Math.round(normalizeDeg(b))}°, tap to reset north`);
  }

  private els: {
    chip: HTMLButtonElement;
    dial: HTMLElement;
    target: HTMLElement;
    deg: HTMLElement;
    card: HTMLElement;
    chipDist: HTMLElement;
    more: HTMLElement;
    src: HTMLElement;
    headingBtn: HTMLButtonElement;
    info: HTMLElement;
    infoName: HTMLElement;
    infoVal: HTMLElement;
  } | null = null;

  private expanded = false;
  private denied = false;

  /** Compact chip by default; tapping it expands the details (heading-up, bearing to a waypoint). */
  setExpanded(on: boolean): void {
    this.expanded = on;
    this.hud.classList.toggle('expanded', on);
    this.els?.chip.setAttribute('aria-expanded', String(on));
    if (this.els) this.els.more.hidden = !on;
    this.render();
  }

  /** Builds the HUD once; render() only updates text and transforms (safe at 60 fps). */
  private build(): NonNullable<Compass['els']> {
    if (this.els) return this.els;
    const target = h('div.dial-target', { hidden: true });
    const dial = h(
      'div.dial',
      { 'aria-hidden': 'true' },
      h('div.dial-rose', {}, ...['N', 'E', 'S', 'W'].map((c, i) => h(`span.rose-${c.toLowerCase()}`, { style: `--a:${i * 90}deg` }, c))),
      target,
      h('div.dial-needle'),
    );
    const deg = h('strong.deg');
    const card = h('span.card');
    const chipDist = h('span.chip-dist', { hidden: true });
    const chip = h(
      'button.compass-chip',
      { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'compass-more', title: 'Compass — tap for more', onclick: () => this.setExpanded(!this.expanded) },
      dial,
      h('span.chip-read', {}, h('span.deg-row', {}, deg, card), chipDist),
    );
    const src = h('span.src');
    const headingBtn = h(
      'button.btn.sm',
      { type: 'button', onclick: () => this.setRotateMap(!this.rotateMap), title: 'Rotate map to your heading' },
      icon('nav'),
      'Heading up',
    );
    const infoName = h('span.ct-name');
    const infoVal = h('strong');
    const info = h(
      'div.compass-target',
      { hidden: true },
      h('span.ct-text', {}, infoName, infoVal),
      h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Stop navigating', title: 'Stop navigating', onclick: () => this.setTarget(null) }, icon('close')),
    );
    const more = h(
      'div#compass-more.compass-more',
      { hidden: true },
      src,
      info,
      h('div.row', {}, headingBtn, h('button.btn.sm.ghost', { type: 'button', onclick: () => this.show(false) }, icon('close'), 'Close')),
    );
    fill(this.hud, chip, more);
    this.els = { chip, dial, target, deg, card, chipDist, more, src, headingBtn, info, infoName, infoVal };
    return this.els;
  }

  private render(): void {
    if (!this.visible) return;
    const e = this.build();
    const sensor = this.gotSensor && this.heading !== null;
    const hd = sensor ? (this.heading as number) : normalizeDeg(this.map.getBearing());
    e.dial.style.setProperty('--rot', `${-hd}deg`);
    e.deg.textContent = `${Math.round(hd) % 360}°`;
    e.card.textContent = cardinal(hd);
    e.src.textContent = sensor
      ? 'Compass heading'
      : this.denied
        ? 'Compass access denied · showing map bearing'
        : this.listening && !this.gotSensor
          ? 'No compass sensor · showing map bearing'
          : 'Map bearing';
    e.headingBtn.disabled = !sensor;
    e.headingBtn.setAttribute('aria-pressed', String(this.rotateMap));
    e.chip.setAttribute('aria-label', `Compass ${Math.round(hd) % 360}° ${cardinal(hd)}${sensor ? '' : ' (map bearing)'} — ${this.expanded ? 'hide' : 'show'} details`);
    const here = this.loc.last;
    e.info.hidden = !this.target;
    e.target.hidden = true;
    e.chipDist.hidden = !this.target;
    if (this.target) {
      e.infoName.textContent = `To ${this.target.name || 'waypoint'}`;
      if (here) {
        const brg = bearing([here.lon, here.lat], [this.target.lon, this.target.lat]);
        const dist = haversine([here.lon, here.lat], [this.target.lon, this.target.lat]);
        e.target.hidden = false;
        e.target.style.setProperty('--t', `${brg}deg`);
        e.infoVal.textContent = `${formatDistance(dist)} · ${Math.round(brg) % 360}° ${cardinal(brg)}`;
        e.chipDist.textContent = `${formatDistance(dist)} ${cardinal(brg)}`;
      } else {
        e.infoVal.textContent = 'Waiting for GPS…';
        e.chipDist.textContent = 'GPS…';
      }
    }
  }
}
