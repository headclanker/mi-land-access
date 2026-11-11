// Original icon set (24×24). UI icons are stroked; waypoint glyphs are filled and also drawn
// onto canvases for the map's waypoint symbols, so both share one source of truth.

import type { WaypointIcon } from '../markups/model';

export const UI_ICONS: Record<string, string> = {
  layers: 'M12 3 2 8l10 5 10-5-10-5z M2 12.5l10 5 10-5 M2 17l10 5 10-5',
  pencil: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
  route: 'M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M15.5 8.5l-2 5-5 2 2-5z',
  locate: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z M21 21l-5.2-5.2',
  close: 'M6 6l12 12 M18 6 6 18',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  share: 'M12 3v12 M7.5 7.5 12 3l4.5 4.5 M5 12v8h14v-8',
  copy: 'M9 9h11v11H9z M15 9V4H4v11h5',
  download: 'M12 3v12 M7 10l5 5 5-5 M5 21h14',
  upload: 'M12 20V8 M7 13l5-5 5 5 M5 3h14',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5v.5',
  warn: 'M12 3 2 20.5h20z M12 10v5 M12 17.5v.5',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M7.5 5v14 M16.5 5v14',
  stop: 'M6 6h12v12H6z',
  line: 'M4 19l5-9 5 4 6-9 M4 19h.01 M20 5h.01',
  polygon: 'M5 19 3.5 8.5 12 3l8.5 6-3 10z',
  check: 'M5 12.5l4.5 4.5L19 7',
  undo: 'M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  crosshair: 'M12 3v6 M12 15v6 M3 12h6 M15 12h6',
  map: 'M9 4 3 6.5v14L9 18l6 2.5 6-2.5V4l-6 2.5L9 4z M9 4v14 M15 6.5v14',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  chevron: 'M6 9l6 6 6-6',
  nav: 'M12 2.5l7 18.5-7-4-7 4z',
  waypoint: 'M12 21.5s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  mail: 'M3 5h18v14H3z M3 6.5l9 6.5 9-6.5',
  zoomto: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5 M12 12h.01',
  scale: 'M3 17h18 M3 13v4 M12 15v2 M21 13v4',
  gps: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3',
  legal: 'M12 3v18 M5 21h14 M4 7h16 M7 7l-3 7a3 3 0 0 0 6 0z M17 7l-3 7a3 3 0 0 0 6 0z',
  file: 'M6 3h8l5 5v13H6z M14 3v5h5',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1 M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1',
};

export const WAYPOINT_GLYPHS: Record<WaypointIcon, string> = {
  pin: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z',
  stand: 'M6.5 4h11v3h-11z M8 7h2.2v13H8z M13.8 7H16v13h-2.2z M10.2 10.5h3.6v1.8h-3.6z M10.2 15h3.6v1.8h-3.6z',
  blind: 'M12 4 2.5 20h19L12 4zm0 8 3.2 6H8.8L12 12z',
  camera: 'M3.5 8h3.5l2-2.5h6L17 8h3.5v11h-17V8zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  parking: 'M7 4h6.5a5 5 0 0 1 0 10H10v6H7V4zm3 3v4h3.3a2 2 0 0 0 0-4H10z',
  camp: 'M12 3.5 2.5 20.5h7L12 15l2.5 5.5h7L12 3.5z',
  deer: 'M8.5 4C6 7 5 11 6 15c.8 3 4 3 4.3 0L10.5 6zM15.5 4C18 7 19 11 18 15c-.8 3-4 3-4.3 0L13.5 6z',
  drop: 'M12 3c-3 5-6.5 8-6.5 12a6.5 6.5 0 0 0 13 0C18.5 11 15 8 12 3z',
  gate: 'M3 5h2.2v15H3z M18.8 5H21v15h-2.2z M5 7h14v2.2H5z M5 15h14v2.2H5z M5.4 15.4 17 7.4l1.2 1.7-11.6 8z',
  flag: 'M5 3h2.2v18H5z M7.2 4H19l-3 4.2L19 12.4H7.2z',
};

/** Injects the SVG sprite once; icons are then referenced with <use href="#i-name">. */
export function injectSprite(): void {
  if (document.getElementById('icon-sprite')) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.id = 'icon-sprite';
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'none';
  const add = (name: string, d: string, filled: boolean): void => {
    const sym = document.createElementNS(ns, 'symbol');
    sym.id = `i-${name}`;
    sym.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    if (filled) {
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('stroke', 'none');
      path.setAttribute('fill-rule', 'evenodd');
    }
    sym.append(path);
    svg.append(sym);
  };
  for (const [k, d] of Object.entries(UI_ICONS)) add(k, d, false);
  for (const [k, d] of Object.entries(WAYPOINT_GLYPHS)) add(`wp-${k}`, d, true);
  document.body.prepend(svg);
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

/** Draws a round waypoint badge (coloured disc, white ring, glyph) for map.addImage. */
export function drawWaypointImage(icon: WaypointIcon, color: string, pixelRatio: number): ImageData {
  const css = 34;
  const size = Math.round(css * pixelRatio);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.scale(pixelRatio, pixelRatio);
  // Shadow + ring + disc
  ctx.beginPath();
  ctx.arc(css / 2, css / 2, 15, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(css / 2, css / 2 - 0.5, 14, 0, Math.PI * 2);
  ctx.fillStyle = isLight(color) ? '#1b1f1c' : '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(css / 2, css / 2 - 0.5, 11.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.translate(css / 2 - 8, css / 2 - 8.5);
  ctx.scale(16 / 24, 16 / 24);
  ctx.fillStyle = isLight(color) ? '#111111' : '#ffffff';
  ctx.fill(new Path2D(WAYPOINT_GLYPHS[icon]), 'evenodd');
  ctx.restore();
  return ctx.getImageData(0, 0, size, size);
}
