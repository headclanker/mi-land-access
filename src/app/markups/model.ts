// Markup data model shared by storage, drawing, import/export and sharing.

export type MarkupKind = 'waypoint' | 'line' | 'shape' | 'track';

export const WAYPOINT_ICONS = ['pin', 'stand', 'blind', 'camera', 'parking', 'camp', 'deer', 'drop', 'gate', 'flag'] as const;
export type WaypointIcon = (typeof WAYPOINT_ICONS)[number];

export const ICON_LABELS: Record<WaypointIcon, string> = {
  pin: 'Pin',
  stand: 'Tree stand',
  blind: 'Ground blind',
  camera: 'Trail camera',
  parking: 'Parking',
  camp: 'Camp',
  deer: 'Sign / sighting',
  drop: 'Blood trail',
  gate: 'Gate / access',
  flag: 'Flag',
};

/**
 * Markup palette. It deliberately leaves out the land-grade hues (green / yellow / red, see
 * GRADE_COLORS) so a drawn shape never reads as "public" or "check first" land; markups are also
 * drawn with a white casing (render.ts) that grade layers never use. Older markups saved in a
 * colour that is no longer offered keep it.
 */
export const MARKUP_COLORS = ['#ff6a13', '#ff2fb3', '#a855f7', '#3a86ff', '#00c2d1', '#8d5a3b', '#ffffff', '#111111'] as const;

/** Hues markups must not default to: the three grade colours and their old near-matches. */
export const GRADE_LIKE_COLORS = ['#2e9e4f', '#e0b000', '#c8372d', '#ffd23f', '#e63946', '#06d6a0'] as const;

/** [lon, lat] or [lon, lat, ele]. */
export type Coord = [number, number] | [number, number, number];

interface Base {
  id: string;
  name: string;
  note: string;
  color: string;
  created: number;
  updated: number;
}

export interface WaypointMarkup extends Base {
  kind: 'waypoint';
  coord: Coord;
  icon: WaypointIcon;
}

export interface LineMarkup extends Base {
  kind: 'line';
  coords: Coord[];
}

export interface ShapeMarkup extends Base {
  kind: 'shape';
  /** Open ring (first point not repeated). */
  coords: Coord[];
}

export interface TrackMarkup extends Base {
  kind: 'track';
  coords: Coord[];
  /** Epoch ms per coordinate, same length as coords when present. */
  times?: number[];
  /** Active recording time, ms. */
  duration?: number;
}

export type Markup = WaypointMarkup | LineMarkup | ShapeMarkup | TrackMarkup;

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

export function isWaypointIcon(v: unknown): v is WaypointIcon {
  return typeof v === 'string' && (WAYPOINT_ICONS as readonly string[]).includes(v);
}

export function isColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

export function defaultColor(kind: MarkupKind): string {
  return kind === 'track' ? '#ff2fb3' : kind === 'shape' ? '#a855f7' : kind === 'line' ? '#3a86ff' : '#ff6a13';
}

export function kindLabel(kind: MarkupKind): string {
  return { waypoint: 'Waypoint', line: 'Line', shape: 'Shape', track: 'Track' }[kind];
}

/** All coordinates of a markup (for bounds / zoom-to). */
export function markupCoords(m: Markup): Coord[] {
  return m.kind === 'waypoint' ? [m.coord] : m.coords;
}
