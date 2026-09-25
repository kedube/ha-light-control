import { clamp, type RGB } from './color.ts';
import { UNASSIGNED } from './discovery.ts';

export interface HouseRoom {
  id: string;
  name: string;
  floorId: string | null;
  outdoor: boolean;
  onCount: number;
  total: number;
  /** Brightness-weighted color of the room's lit lights; null when the room is dark. */
  rgb: RGB | null;
  /** Average brightness of the lit lights, 0–1. */
  level: number;
  caption: string;
}

export interface HouseFloor {
  id: string;
  level: number | null;
}

export interface SunInfo {
  elevation?: number;
  azimuth?: number;
  aboveHorizon?: boolean;
}

export type SkyMode = 'day' | 'dusk' | 'night';

export interface Slot {
  room: HouseRoom;
  x: number;
  y: number;
  w: number;
  h: number;
  basement: boolean;
}

export interface Lamp {
  room: HouseRoom;
  x: number;
}

export interface HouseLayout {
  bodyW: number;
  topY: number;
  roofH: number;
  basementH: number;
  windows: Slot[];
  lamps: Lamp[];
  door?: { x: number };
  bands: number[];
  bounds: { left: number; right: number; top: number; bottom: number };
}

const WIN_W = 30;
const WIN_H = 34;
const GAP = 16;
const PAD = 20;
const ROW_H = 60;
const BASE_ROW_H = 38;
const BASE_WIN_H = 15;
export const DOOR_W = 24;
export const DOOR_H = 40;
export const OVERHANG = 12;
const LAMP_GAP = 32;
const MAX_PER_ROW = 5;

function chunk<T>(items: T[], maxPerRow: number): T[][] {
  if (!items.length) return [];
  const rows = Math.ceil(items.length / maxPerRow);
  const perRow = Math.ceil(items.length / rows);
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) result.push(items.slice(i, i + perRow));
  return result;
}

export interface Story {
  rooms: HouseRoom[];
  basement: boolean;
}

/** Stacks Home Assistant floors into stories (highest level on top) and rooms into windows. */
export function buildStories(rooms: HouseRoom[], floors: HouseFloor[]): Story[] {
  const indoor = rooms.filter((r) => !r.outdoor && r.id !== UNASSIGNED);
  const known = new Map(floors.map((f, index) => [f.id, f.level ?? index]));
  const floored = indoor.some((r) => r.floorId && known.has(r.floorId));
  if (!floored) {
    const rows = Math.max(1, Math.ceil(indoor.length / 4));
    return chunk(indoor, Math.ceil(indoor.length / rows)).map((group) => ({ rooms: group, basement: false }));
  }
  const levels = [...new Set(known.values())].sort((a, b) => b - a);
  const populated = levels.filter((level) => indoor.some((r) => r.floorId && known.get(r.floorId) === level));
  // Rooms without a floor move in on the ground floor (level 0, else the lowest one above ground).
  const ground = populated.includes(0)
    ? 0
    : ([...populated].reverse().find((l) => l >= 0) ?? populated[populated.length - 1]);
  const lowestAbove = Math.min(...populated.filter((l) => l >= 0), Infinity);
  return populated.map((level) => ({
    rooms: indoor.filter((r) =>
      r.floorId && known.has(r.floorId) ? known.get(r.floorId) === level : level === ground,
    ),
    basement: level < 0 && level < lowestAbove && level !== ground,
  }));
}

export function layoutHouse(rooms: HouseRoom[], floors: HouseFloor[]): HouseLayout {
  const stories = buildStories(rooms, floors);
  const above = stories.filter((s) => !s.basement);
  const below = stories.filter((s) => s.basement);
  const aboveRows = above.map((s) => chunk(s.rooms, MAX_PER_ROW));
  const belowRows = below.flatMap((s) => chunk(s.rooms, MAX_PER_ROW));
  const rowWidth = (n: number, door: boolean) =>
    n * WIN_W + Math.max(0, n - 1) * GAP + 2 * PAD + (door ? DOOR_W + GAP : 0);

  const groundRows = aboveRows[aboveRows.length - 1] ?? [];
  let bodyW = 150;
  aboveRows.forEach((rows) =>
    rows.forEach((row) => (bodyW = Math.max(bodyW, rowWidth(row.length, row === groundRows[groundRows.length - 1])))),
  );
  belowRows.forEach((row) => (bodyW = Math.max(bodyW, rowWidth(row.length, false))));
  if (!aboveRows.length) bodyW = Math.max(bodyW, rowWidth(0, true));

  const windows: Slot[] = [];
  const bands: number[] = [];
  let door: HouseLayout['door'];
  let y = 0;
  // Build from the ground up so the ground floor sits on the grass line.
  for (let s = aboveRows.length - 1; s >= 0; s--) {
    const rows = aboveRows[s];
    for (let r = rows.length - 1; r >= 0; r--) {
      y -= ROW_H;
      const row = rows[r];
      const withDoor = s === aboveRows.length - 1 && r === rows.length - 1;
      const content = row.length * WIN_W + Math.max(0, row.length - 1) * GAP + (withDoor ? DOOR_W + GAP : 0);
      let x = (bodyW - content) / 2;
      const winY = y + (ROW_H - WIN_H) / 2 - 3;
      row.forEach((room, i) => {
        if (withDoor && i === Math.floor(row.length / 2)) {
          door = { x };
          x += DOOR_W + GAP;
        }
        windows.push({ room, x, y: winY, w: WIN_W, h: WIN_H, basement: false });
        x += WIN_W + GAP;
      });
      if (withDoor && !door) door = { x };
    }
    if (s > 0) bands.push(y);
  }
  if (!aboveRows.length) {
    y = -ROW_H;
    door = { x: (bodyW - DOOR_W) / 2 };
  }
  const topY = y;

  let by = 8;
  for (const row of belowRows) {
    const content = row.length * WIN_W + Math.max(0, row.length - 1) * GAP;
    let x = (bodyW - content) / 2;
    for (const room of row) {
      windows.push({ room, x, y: by + (BASE_ROW_H - BASE_WIN_H) / 2, w: WIN_W, h: BASE_WIN_H, basement: true });
      x += WIN_W + GAP;
    }
    by += BASE_ROW_H;
  }
  const basementH = belowRows.length ? by + 4 : 0;

  const lamps: Lamp[] = [];
  let left = 0;
  let right = 0;
  rooms
    .filter((r) => r.outdoor)
    .forEach((room, i) => {
      if (i % 2 === 0) lamps.push({ room, x: bodyW + OVERHANG + 26 + right++ * LAMP_GAP });
      else lamps.push({ room, x: -OVERHANG - 26 - left++ * LAMP_GAP });
    });

  const roofH = clamp(bodyW * 0.3, 34, 64);
  return {
    bodyW,
    topY,
    roofH,
    basementH,
    windows,
    lamps,
    door,
    bands,
    bounds: {
      left: Math.min(-OVERHANG - 14, ...lamps.map((l) => l.x - 14)),
      right: Math.max(bodyW + OVERHANG + 14, ...lamps.map((l) => l.x + 14)),
      top: topY - roofH - 6,
      bottom: Math.max(12, basementH),
    },
  };
}

export function skyMode(sun?: SunInfo, now = new Date()): SkyMode {
  if (sun?.elevation !== undefined) {
    if (sun.elevation > 6) return 'day';
    if (sun.elevation > -6) return 'dusk';
    return 'night';
  }
  if (sun?.aboveHorizon !== undefined) return sun.aboveHorizon ? 'day' : 'night';
  const hour = now.getHours();
  if (hour >= 8 && hour < 18) return 'day';
  if (hour === 7 || hour === 18 || hour === 19) return 'dusk';
  return 'night';
}
