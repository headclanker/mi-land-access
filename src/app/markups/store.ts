import { kvGet, kvSet } from '../util/store';
import type { Markup } from './model';

const KEY = 'markups-v1';

/** In-memory list of markups persisted to IndexedDB (localStorage fallback). */
export class MarkupStore {
  private items: Markup[] = [];
  private listeners: (() => void)[] = [];
  private saveTimer: number | undefined;

  async load(): Promise<void> {
    const saved = await kvGet<Markup[]>(KEY);
    this.items = Array.isArray(saved) ? saved : [];
    this.emit();
  }

  all(): readonly Markup[] {
    return this.items;
  }

  get(id: string): Markup | undefined {
    return this.items.find((m) => m.id === id);
  }

  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  add(...ms: Markup[]): void {
    for (const m of ms) {
      while (this.items.some((x) => x.id === m.id)) m.id = `${m.id}x`;
      this.items.push(m);
    }
    this.changed();
  }

  update(m: Markup): void {
    const i = this.items.findIndex((x) => x.id === m.id);
    if (i < 0) return;
    this.items[i] = { ...m, updated: Date.now() };
    this.changed();
  }

  remove(id: string): Markup | undefined {
    const m = this.get(id);
    this.items = this.items.filter((x) => x.id !== id);
    this.changed();
    return m;
  }

  private changed(): void {
    this.emit();
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void kvSet(KEY, this.items), 150);
  }

  /** Flush now (e.g. on pagehide). */
  flush(): void {
    window.clearTimeout(this.saveTimer);
    void kvSet(KEY, this.items);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
