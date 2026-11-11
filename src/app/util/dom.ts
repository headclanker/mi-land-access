// Tiny DOM helpers so the UI can be built without a framework.

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

/** Hyperscript: h('button.primary', { onclick }, 'Save'). Text children are escaped by the DOM. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const [nameAndId, ...classes] = tag.split('.');
  const [name, id] = nameAndId.split('#');
  const el = document.createElement(name as K);
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = [el.className, String(v)].filter(Boolean).join(' ');
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
}

/** Inline SVG icon from the sprite in index.html. */
export function icon(name: string, cls = 'ic'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

let toastTimer: number | undefined;

export function toast(message: string, ms = 2600): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div#toast', { role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove('show'), ms);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for http / older browsers.
    const ta = h('textarea', { style: 'position:fixed;opacity:0;top:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Opens a modal <dialog>; resolves with its returnValue when closed. */
export function showDialog(dialog: HTMLDialogElement): Promise<string> {
  if (!dialog.isConnected) document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        resolve(dialog.returnValue);
        dialog.remove();
      },
      { once: true },
    );
    dialog.showModal();
  });
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: number | undefined;
  return (...args: A) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

/** replaceChildren that tolerates null/false placeholders from conditional UI. */
export function fill(el: Element, ...kids: (Node | string | null | undefined | false)[]): void {
  el.replaceChildren(...kids.filter((k): k is Node | string => k !== null && k !== undefined && k !== false));
}
