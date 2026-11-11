// GPS track recorder: start/pause/resume/stop, live line, stats, Wake Lock, survives reloads.

import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import { kvGet, kvSet } from '../util/store';
import { fill, h, icon, toast } from '../util/dom';
import {
  activeDuration,
  formatDistance,
  formatDuration,
  formatFeet,
  formatPace,
  shouldAcceptPoint,
  trackStats,
  type TrackPoint,
} from '../util/geo';
import type { LocationService, Fix } from './location';
import type { MarkupStore } from '../markups/store';
import { defaultColor, newId, type TrackMarkup } from '../markups/model';

type Status = 'idle' | 'recording' | 'paused';

interface Persisted {
  status: Status;
  points: TrackPoint[];
  /** Active time windows. */
  segments: { start: number; end?: number }[];
  startedAt: number;
}

const KEY = 'tracker-v1';
const HOLDER = 'tracker';

export class Tracker {
  private s: Persisted = { status: 'idle', points: [], segments: [], startedAt: 0 };
  private unsub: (() => void) | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private tick: number | undefined;
  private saveTimer: number | undefined;
  private lastFix: Fix | null = null;

  private readonly map: MLMap;
  private readonly loc: LocationService;
  private readonly store: MarkupStore;
  private readonly root: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly openPanel: () => void;

  constructor(map: MLMap, loc: LocationService, store: MarkupStore, root: HTMLElement, pill: HTMLElement, openPanel: () => void) {
    this.map = map;
    this.loc = loc;
    this.store = store;
    this.root = root;
    this.pill = pill;
    this.openPanel = openPanel;
    map.addSource('track-live', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'track-live-casing', type: 'line', source: 'track-live', paint: { 'line-color': '#000', 'line-width': 7, 'line-opacity': 0.45 }, layout: { 'line-cap': 'round', 'line-join': 'round' } }, 'anchor-top');
    map.addLayer({ id: 'track-live', type: 'line', source: 'track-live', paint: { 'line-color': '#ff2fb3', 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } }, 'anchor-top');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.s.status === 'recording') void this.requestWakeLock();
    });
    // GPS problems show as a banner while recording; LocationService clears its error the
    // moment a fix arrives, so the banner never sits over a working recording.
    loc.onStatus(() => {
      if (this.s.status !== 'idle') this.render();
    });
    pill.addEventListener('click', () => this.openPanel());
    this.render();
  }

  get status(): Status {
    return this.s.status;
  }

  /** Restores an in-progress recording after a reload or crash. */
  async restore(): Promise<void> {
    const saved = await kvGet<Persisted>(KEY);
    if (!saved || saved.status === 'idle' || !Array.isArray(saved.points)) return;
    this.s = saved;
    this.drawLine();
    if (saved.status === 'recording') {
      // The gap while the page was closed doesn't count as moving time.
      const open = this.s.segments[this.s.segments.length - 1];
      if (open && open.end === undefined) open.end = saved.points[saved.points.length - 1]?.t ?? open.start;
      this.s.segments.push({ start: Date.now() });
      this.listen();
      toast('Resumed track recording');
    }
    this.render();
  }

  start(): void {
    if (!this.loc.available) return toast('GPS is not available in this browser');
    this.s = { status: 'recording', points: [], segments: [{ start: Date.now() }], startedAt: Date.now() };
    this.listen();
    this.persist(true);
    this.render();
  }

  pause(): void {
    if (this.s.status !== 'recording') return;
    this.s.status = 'paused';
    const seg = this.s.segments[this.s.segments.length - 1];
    if (seg) seg.end = Date.now();
    this.unlisten();
    this.persist(true);
    this.render();
  }

  resume(): void {
    if (this.s.status !== 'paused') return;
    this.s.status = 'recording';
    this.s.segments.push({ start: Date.now() });
    this.listen();
    this.persist(true);
    this.render();
  }

  stop(save: boolean): void {
    if (this.s.status === 'recording') {
      const seg = this.s.segments[this.s.segments.length - 1];
      if (seg && seg.end === undefined) seg.end = Date.now();
    }
    this.unlisten();
    if (save) {
      if (this.s.points.length >= 2) {
        const pts = this.s.points;
        const d = new Date(this.s.startedAt);
        const m: TrackMarkup = {
          id: newId(),
          kind: 'track',
          name: `Track ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
          note: '',
          color: defaultColor('track'),
          created: Date.now(),
          updated: Date.now(),
          coords: pts.map((p) => (p.ele !== undefined ? [p.lon, p.lat, Math.round(p.ele * 10) / 10] : [p.lon, p.lat])),
          times: pts.map((p) => p.t),
          duration: activeDuration(this.s.segments, Date.now()),
        };
        this.store.add(m);
        toast('Track saved to My markups');
      } else toast('Track too short to save');
    }
    this.s = { status: 'idle', points: [], segments: [], startedAt: 0 };
    this.drawLine();
    this.persist(true);
    this.render();
  }

  private listen(): void {
    this.loc.acquire(HOLDER);
    this.unsub?.();
    this.unsub = this.loc.onFix((f) => this.onFix(f));
    if (this.loc.last && Date.now() - this.loc.last.t < 10_000) this.onFix(this.loc.last);
    void this.requestWakeLock();
    window.clearInterval(this.tick);
    this.tick = window.setInterval(() => this.renderStats(), 1000);
  }

  private unlisten(): void {
    this.unsub?.();
    this.unsub = null;
    this.loc.release(HOLDER);
    window.clearInterval(this.tick);
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  private async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      /* not allowed (battery saver / not visible) */
    }
  }

  private onFix(f: Fix): void {
    this.lastFix = f;
    if (this.s.status !== 'recording') return;
    const pt: TrackPoint = { lon: f.lon, lat: f.lat, ele: f.alt, t: f.t, acc: f.acc };
    if (shouldAcceptPoint(this.s.points[this.s.points.length - 1], pt)) {
      this.s.points.push(pt);
      this.drawLine();
      this.persist(false);
    }
    this.renderStats();
  }

  private lastSave = 0;

  /** Throttled save (at most every 3 s while moving) so a crash/reload loses little. */
  private persist(now: boolean): void {
    const save = (): void => {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.lastSave = Date.now();
      void kvSet(KEY, this.s);
    };
    if (now || Date.now() - this.lastSave > 3000) save();
    else if (this.saveTimer === undefined) this.saveTimer = window.setTimeout(save, 3000 - (Date.now() - this.lastSave));
  }

  /** Called on pagehide / backgrounding. */
  flush(): void {
    if (this.s.status !== 'idle') this.persist(true);
  }

  private drawLine(): void {
    const coords = this.s.points.map((p) => [p.lon, p.lat]);
    this.map.getSource<GeoJSONSource>('track-live')?.setData(
      coords.length >= 2 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } : { type: 'FeatureCollection', features: [] },
    );
  }

  private stats(): { dist: string; time: string; pace: string; ele: string; gain: string; n: number } {
    const st = trackStats(this.s.points);
    const ms = activeDuration(this.s.segments, Date.now());
    const alt = this.lastFix?.alt;
    return {
      dist: formatDistance(st.distance),
      time: formatDuration(ms),
      pace: formatPace(ms, st.distance),
      ele: alt !== undefined ? formatFeet(alt) : '–',
      gain: st.maxEle !== undefined ? `+${formatFeet(st.gain)}` : '–',
      n: this.s.points.length,
    };
  }

  private renderStats(): void {
    const s = this.stats();
    for (const [k, v] of Object.entries(s)) {
      const el = this.root.querySelector(`[data-stat="${k}"]`);
      if (el) el.textContent = String(v);
    }
    this.pill.hidden = this.s.status === 'idle';
    document.documentElement.classList.toggle('recording', this.s.status !== 'idle');
    this.pill.classList.toggle('paused', this.s.status === 'paused');
    fill(this.pill, h('span.rec-dot'), h('strong', {}, s.time), h('span', {}, s.dist));
  }

  render(): void {
    const st = this.s.status;
    const stat = (k: string, label: string): HTMLElement => h('div.stat', {}, h('span.stat-v', { 'data-stat': k }, '–'), h('span.stat-l', {}, label));
    const controls =
      st === 'idle'
        ? [h('button.btn.primary.big', { type: 'button', onclick: () => this.start() }, icon('play'), 'Start recording')]
        : [
            st === 'recording'
              ? h('button.btn.big', { type: 'button', onclick: () => this.pause() }, icon('pause'), 'Pause')
              : h('button.btn.primary.big', { type: 'button', onclick: () => this.resume() }, icon('play'), 'Resume'),
            h('button.btn.primary.big', { type: 'button', onclick: () => this.stop(true) }, icon('stop'), 'Stop & save'),
            h(
              'button.btn.danger.sm',
              {
                type: 'button',
                onclick: () => {
                  if (confirm('Discard this track?')) this.stop(false);
                },
              },
              icon('trash'),
              'Discard',
            ),
          ];
    fill(this.root, 
      h('h2.pane-title', {}, st === 'idle' ? 'Record a track' : st === 'recording' ? 'Recording…' : 'Paused'),
      h('div.stats', {}, stat('dist', 'Distance'), stat('time', 'Moving time'), stat('pace', 'Pace'), stat('ele', 'Elevation'), stat('gain', 'Climb'), stat('n', 'Points')),
      this.loc.error && st === 'recording' ? h('p.hint.warn', { role: 'status' }, icon('warn'), this.loc.error) : null,
      h('div.row.wrap.track-controls', {}, ...controls),
      h(
        'p.muted.small',
        {},
        st === 'idle'
          ? 'Keeps the screen awake while recording where supported. Recording survives a page reload; most phones stop GPS when the browser is fully in the background, so keep the app open.'
          : 'Keep this app open. Saved tracks appear in My markups.',
      ),
    );
    this.renderStats();
  }
}
