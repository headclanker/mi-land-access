// Bottom sheet on phones (peek / half / full, draggable), static sidebar/card on desktop.

export type SheetState = 'closed' | 'peek' | 'half' | 'full';

export const desktopQuery = window.matchMedia('(min-width: 900px)');

export class Sheet {
  private startY = 0;
  private startH = 0;
  private dragging = false;
  private listeners: ((s: SheetState) => void)[] = [];

  private readonly states: SheetState[];
  readonly el: HTMLElement;

  constructor(el: HTMLElement, states: SheetState[]) {
    this.el = el;
    this.states = states;
    const grip = el.querySelector<HTMLElement>('.sheet-grip');
    if (grip) {
      grip.addEventListener('pointerdown', (e) => this.onDown(e));
      grip.addEventListener('pointermove', (e) => this.onMove(e));
      grip.addEventListener('pointerup', (e) => this.onUp(e));
      grip.addEventListener('pointercancel', (e) => this.onUp(e));
      grip.addEventListener('click', () => {
        if (Math.abs(this.moved) < 4) this.cycle();
      });
    }
  }

  private moved = 0;

  get state(): SheetState {
    return (this.el.dataset.state as SheetState) ?? 'closed';
  }

  /** Optional guard: return false to refuse a state change (e.g. while drawing on a phone). */
  canChange: ((next: SheetState) => boolean) | null = null;

  set(state: SheetState): void {
    if (this.state === state) return;
    if (this.canChange && !this.canChange(state)) return;
    this.el.dataset.state = state;
    this.el.style.removeProperty('--drag-h');
    for (const fn of this.listeners) fn(state);
  }

  onState(fn: (s: SheetState) => void): void {
    this.listeners.push(fn);
  }

  /** Make sure the content is readable (at least half height on phones). */
  reveal(): void {
    if (this.state === 'closed' || this.state === 'peek') this.set('half');
  }

  cycle(): void {
    const i = this.states.indexOf(this.state);
    const next = this.states[(i + 1) % this.states.length];
    this.set(next === 'closed' && this.states.includes('peek') ? 'peek' : next);
  }

  private onDown(e: PointerEvent): void {
    if (desktopQuery.matches) return;
    if (this.canChange && !this.canChange('full')) return;
    this.dragging = true;
    this.moved = 0;
    this.startY = e.clientY;
    this.startH = this.el.getBoundingClientRect().height;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.el.classList.add('dragging');
  }

  private onMove(e: PointerEvent): void {
    if (!this.dragging) return;
    this.moved = this.startY - e.clientY;
    const h = Math.max(40, Math.min(window.innerHeight * 0.94, this.startH + this.moved));
    this.el.style.setProperty('--drag-h', `${h}px`);
  }

  private onUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.el.classList.remove('dragging');
    const h = Math.max(40, this.startH + (this.startY - e.clientY));
    const vh = window.innerHeight;
    this.el.style.removeProperty('--drag-h');
    if (Math.abs(this.moved) < 4) return;
    // Snap to the nearest allowed state.
    const targets: [SheetState, number][] = this.states.map((s) => [s, s === 'closed' ? 0 : s === 'peek' ? 76 : s === 'half' ? vh * 0.5 : vh * 0.9]);
    targets.sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h));
    const snapped = targets[0][0];
    // Force listeners even if same state, to re-apply height.
    if (snapped === this.state) {
      this.el.dataset.state = '';
    }
    this.set(snapped);
  }
}
