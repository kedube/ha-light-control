// Turns Home Assistant floors and areas into the floor plan of a believable house.
//
// A house is planned from the outside in, as an architect draws one. Its walls are divided into
// bays of one width, each with a window in its middle: an odd number of them across the front, so
// the front door has the middle one and the windows either side of it match. The rooms are then
// fitted in behind the windows: a wall between two rooms meets the outside wall between two
// windows, never across one, and every room along the outside has a window of its own. A floor
// built into the roof has its windows where the roof lets them be, in dormers and in the gable
// ends, and its rooms are fitted in behind those.
//
// Every floor shares one rectangular footprint. The 3D view looks at the house from the front
// right, so two walls face the viewer: the front (y = depth) and the right side (x = width). Rooms
// are laid along those two walls, so each one has windows the viewer can see. The stairs rise in
// the middle bay at the back, behind the front door, in the same place on every floor, with
// closets and storage either side of them. A garage is built on as a wing of its own, beside the
// house on the left.

import type { RoomType } from '../room-types.ts';

export interface PlanRoomInput {
  id: string;
  type: RoomType;
}

export interface PlanFloorInput {
  id: string;
  /** Home Assistant floor level; floors without one keep their place in the list. */
  level: number | null;
  /** Named as an attic or a loft: a floor like this is built into the roof. */
  attic?: boolean;
  rooms: PlanRoomInput[];
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlanCell {
  /** The area id, or null for space the card adds on its own (stairs, halls, storage). */
  id: string | null;
  type: RoomType;
  rect: Rect;
}

/** A story of the house, before its rooms are laid out. */
export interface StoryShape {
  /** Home Assistant floor id, or GROUND_ID when the home has no floors. */
  id: string;
  /** 0 for the lowest story. */
  index: number;
  /** Height of the floor surface; the ground floor sits a little above the grass. */
  z: number;
  basement: boolean;
  /** The story holding rooms without a floor, and the front door. */
  ground: boolean;
  /** An attic by name, or with nothing but attic rooms on it. Whether it is built into the roof is up to the model. */
  attic: boolean;
}

export interface PlanStory extends StoryShape {
  cells: PlanCell[];
}

/** How the outside walls are divided: into bays of one width, with a window in the middle of each. */
export interface Bays {
  /** Across the front and the back: always an odd number, so the front door has the middle one. */
  front: number;
  /** Along the two sides. */
  side: number;
}

/** The size and shape of the house, before the rooms of its stories are laid out. */
export interface PlanShape {
  /** Size along x (the front wall's length), in meters. */
  width: number;
  /** Size along y (the right wall's length), in meters. */
  depth: number;
  storyHeight: number;
  /** Height of the ground floor above the grass. */
  base: number;
  /** Bottom to top. */
  stories: readonly StoryShape[];
  /** The garage, one story high, built onto the left side of the ground floor (x < 0). */
  wing: PlanCell | null;
  bays: Bays;
}

export interface HousePlan extends PlanShape {
  stories: PlanStory[];
}

/** A stretch of an outside wall, from a to b along it: a window, or something wider that stands there. */
export interface Slot {
  a: number;
  b: number;
}

/** Where the windows of the floor built into the roof are, so its rooms can be fitted in behind them. */
export interface RoofSlots {
  /** The index of that story. */
  story: number;
  /** Its windows along the front (by x) and the right side (by y). */
  front: Slot[];
  right: Slot[];
  /** What no wall between two rooms may meet, front and right: a dormer is wider than its window. */
  keepFront: Slot[];
  keepRight: Slot[];
}

/** What the design of the house asks of its plan. */
export interface Facade {
  /** How wide its windows are: the bays are spaced for them. */
  window: number;
  /** The windows of a floor built into the roof, once the shape of the house is known; null when none is. */
  roof?: (shape: PlanShape) => RoofSlots | null;
}

export const GROUND_ID = '__ground__';
export const STORY_HEIGHT = 3;
/** The garage wing: wide enough for a car and a workbench, and set back a little from the front. */
const WING_WIDTH = 4;
const WING_DEPTH = 6.2;
const WING_SETBACK = 0.8;
/** How deep the stairwell at the back is; it is as wide as a bay. */
const STAIRS_DEPTH = 3.4;
/** The core must be deep enough to walk through, and the rooms in front of it deep enough to live in. */
const MIN_CORE_DEPTH = 2.4;
const MIN_FRONT_DEPTH = 2.2;
/** How far either side of the middle of the front door the room it opens into must reach. */
const DOOR_CLEAR = 0.6;

/** A design with ordinary windows, for a plan made without one. */
const PLAIN: Facade = { window: 0.98 };

/** How much floor space each kind of room gets, relative to an ordinary room. */
const WEIGHT: Record<RoomType, number> = {
  living: 1.7,
  kitchen: 1.3,
  dining: 1.1,
  bedroom: 1.3,
  kids: 1,
  guest: 1,
  bathroom: 0.65,
  office: 0.9,
  laundry: 0.6,
  garage: 1.8,
  media: 1.3,
  gym: 1,
  hallway: 0.7,
  stairs: 0.55,
  closet: 0.4,
  storage: 0.45,
  basement: 1.2,
  attic: 1.3,
  room: 1,
  porch: 1,
  balcony: 1,
  garden: 1,
  driveway: 1,
  pool: 1,
};

/** Rooms that live in the windowless core instead of along the outside walls. */
const CORE_TYPES: ReadonlySet<RoomType> = new Set(['closet', 'storage']);
/** How elongated each kind of room may be before it stops looking like one. */
const MAX_ASPECT: Partial<Record<RoomType, number>> = {
  living: 1.8,
  dining: 1.7,
  bedroom: 1.7,
  kitchen: 2.3,
  bathroom: 2.2,
  laundry: 2.4,
  gym: 2.2,
  attic: 2.2,
  hallway: 3.5,
  stairs: 3.5,
  closet: 3.5,
  storage: 3.5,
};
/** The rooms a front door opens into, the most fitting first. */
const ENTRANCES: RoomType[] = ['hallway', 'living', 'dining', 'kitchen', 'room'];

const SQ_METERS_PER_WEIGHT = 13;
const ASPECT = 1.35;

export const roomWeight = (type: RoomType): number => WEIGHT[type] ?? 1;

interface Item {
  id: string | null;
  type: RoomType;
  weight: number;
}

const sum = (items: Item[]) => items.reduce((total, item) => total + item.weight, 0);
const snap = (value: number) => Math.round(value * 2) / 2;
const round = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

function rect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x0: round(x0), y0: round(y0), x1: round(x1), y1: round(y1) };
}

const areaOf = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);

// ─── Bays ────────────────────────────────────────────────────────────────────

/** How wide a bay is for windows of a width: the window, and the wall between it and the next one. */
const bayWidth = (window: number): number => clamp(window + 1.15, 1.9, 3.2);

/** No bay is narrower than this: a window, and wall enough either side for a wall between rooms. */
const LEAST_BAY = 1.8;

/** How many bays a wall of a length is divided into, to come nearest to bays of a width. */
function bayCount(length: number, width: number, odd: boolean): number {
  let best = 1;
  let off = Infinity;
  for (let n = 1; n <= 25; n += odd ? 2 : 1) {
    if (n > 1 && length / n < LEAST_BAY - 1e-9) break;
    const d = Math.abs(Math.log(length / n / width));
    if (d < off - 1e-9) {
      off = d;
      best = n;
    }
  }
  return best;
}

/** The middle of each bay along a side of the house, as a distance along that wall. */
export function bayMiddles(plan: PlanShape, side: Side): number[] {
  const across = side === 'front' || side === 'back';
  const count = across ? plan.bays.front : plan.bays.side;
  const length = across ? plan.width : plan.depth;
  return Array.from({ length: count }, (_, j) => round(((j + 0.5) * length) / count));
}

/** Where the stairs rise on every floor: the middle bay of the front, at the back of the house. */
export function stairsBay(plan: PlanShape): [number, number] {
  const bay = plan.width / plan.bays.front;
  const middle = (plan.bays.front - 1) / 2;
  return [round(middle * bay), round((middle + 1) * bay)];
}

// ─── Laying out a story ──────────────────────────────────────────────────────

/** An outside wall as the planner sees it: its openings, and where the walls between rooms may meet it. */
interface Wall {
  length: number;
  slots: Slot[];
  /** From 0 to the length, in order. */
  cuts: number[];
}

/** A wall of bays: a window in the middle of each, and walls between rooms only where two bays meet. */
function bayWall(length: number, count: number): Wall {
  const bay = length / count;
  return {
    length,
    slots: Array.from({ length: count }, (_, j) => ({ a: (j + 0.5) * bay - 0.3, b: (j + 0.5) * bay + 0.3 })),
    cuts: Array.from({ length: count + 1 }, (_, j) => round(j * bay)),
  };
}

/**
 * A wall of the floor under the roof: its windows are where the roof has them. Walls between rooms
 * meet it on the lines of the bays below, or halfway between two of its windows, and never where a
 * window or a dormer is.
 */
function roofWall(length: number, count: number, slots: Slot[], keep: Slot[]): Wall {
  const bay = length / count;
  const sorted = [...slots].sort((p, q) => p.a - q.a);
  const points = Array.from({ length: count + 1 }, (_, j) => j * bay);
  for (let i = 1; i < sorted.length; i++) points.push((sorted[i - 1].b + sorted[i].a) / 2);
  const clear = (u: number) => ![...keep, ...sorted].some((k) => u > k.a - 0.08 && u < k.b + 0.08);
  const cuts = [...new Set(points.map(round))]
    .filter((u) => u < 1e-6 || u > length - 1e-6 || clear(u))
    .sort((p, q) => p - q);
  return { length, slots: sorted, cuts };
}

/** Whether a stretch of wall from a to b holds one of the openings, clear of its ends. */
const holds = (slots: Slot[], a: number, b: number) => slots.some((s) => s.a >= a + 0.04 && s.b <= b - 0.04);

/** How far a room is from looking like one: 0 is ideal, higher is worse. */
function shapeCost(type: RoomType, r: Rect): number {
  const w = r.x1 - r.x0;
  const d = r.y1 - r.y0;
  const aspect = Math.max(w, d) / Math.max(0.01, Math.min(w, d));
  // A gentle pull toward square rooms, and a strong push away from corridors.
  let cost = (aspect - 1) ** 2 * 0.1 + Math.max(0, aspect - (MAX_ASPECT[type] ?? 2)) ** 2 * 2;
  const short = Math.min(w, d);
  if (short < 1.8) cost += (1.8 - short) * 2;
  return cost;
}

/** A room along the outside: its shape, how near its size is to its share, and whether it has a window. */
function roomCost(item: Item, r: Rect, ideal: number, lit: boolean): number {
  let cost = shapeCost(item.type, r);
  if (item.id) {
    cost += Math.log(areaOf(r) / ideal) ** 2 * 0.6;
    if (!lit) cost += 4;
  }
  return cost;
}

/** Every way to choose `count` of `n` things in order, as lists of their indices. */
function* picks(n: number, count: number, from = 0): Generator<number[]> {
  if (count === 0) {
    yield [];
    return;
  }
  for (let i = from; i <= n - count; i++) for (const rest of picks(n, count - 1, i + 1)) yield [i, ...rest];
}

interface Layout {
  cost: number;
  cells: PlanCell[];
}

/** Splits `items` over `area` in order, cutting across its longer side, like a treemap. */
function split(items: Item[], area: Rect, out: PlanCell[]): void {
  if (!items.length) return;
  if (items.length === 1) {
    out.push({ id: items[0].id, type: items[0].type, rect: rect(area.x0, area.y0, area.x1, area.y1) });
    return;
  }
  const total = sum(items);
  let acc = 0;
  let cut = 1;
  let bestGap = Infinity;
  for (let i = 1; i < items.length; i++) {
    acc += items[i - 1].weight;
    const gap = Math.abs(acc - total / 2);
    if (gap < bestGap) {
      bestGap = gap;
      cut = i;
    }
  }
  const first = items.slice(0, cut);
  const share = sum(first) / total;
  const w = area.x1 - area.x0;
  const h = area.y1 - area.y0;
  if (w >= h) {
    const x = area.x0 + w * share;
    split(first, { ...area, x1: x }, out);
    split(items.slice(cut), { ...area, x0: x }, out);
  } else {
    const y = area.y0 + h * share;
    split(first, { ...area, y1: y }, out);
    split(items.slice(cut), { ...area, y0: y }, out);
  }
}

/** Splits `items` over `area` in order, side by side, each as deep as the area. */
function columns(items: Item[], area: Rect, out: PlanCell[]): void {
  const total = sum(items);
  let x = area.x0;
  items.forEach((item, i) => {
    const x1 = i === items.length - 1 ? area.x1 : x + ((area.x1 - area.x0) * item.weight) / total;
    out.push({ id: item.id, type: item.type, rect: rect(x, area.y0, x1, area.y1) });
    x = x1;
  });
}

/**
 * The core at the back: the stairs in the middle bay, a landing in front of them where the core is
 * deeper than the flight, and the closets and storage either side. Where the core reaches the
 * right side, its rooms stand side by side, so their walls meet it only at its corners.
 */
function layoutCore(
  core: Item[],
  stairs: Item | null,
  area: Rect,
  at: [number, number],
  filler: RoomType,
  width: number,
  out: PlanCell[],
): void {
  const depth = area.y1 - area.y0;
  const parts: Rect[] = [];
  if (stairs) {
    const x0 = Math.max(area.x0, at[0]);
    const x1 = Math.min(area.x1, at[1]);
    const sd = depth - STAIRS_DEPTH > 1.2 ? STAIRS_DEPTH : depth;
    out.push({ id: stairs.id, type: stairs.type, rect: rect(x0, area.y0, x1, area.y0 + sd) });
    if (sd < depth - 1e-6) out.push({ id: null, type: 'hallway', rect: rect(x0, area.y0 + sd, x1, area.y1) });
    if (x0 - area.x0 > 0.3) parts.push({ ...area, x1: x0 });
    if (area.x1 - x1 > 0.3) parts.push({ ...area, x0: x1 });
  } else parts.push(area);
  if (!parts.length) return;
  const space = (): Item => ({ id: null, type: filler, weight: 1 });
  const items = core.length ? core : [space()];
  const fill = (list: Item[], part: Rect) =>
    part.x1 >= width - 1e-6 && list.length > 1 ? columns(list, part, out) : split(list, part, out);
  if (parts.length === 1) {
    fill(items, parts[0]);
    return;
  }
  // The rooms are shared out between the two sides, in order, as their space allows.
  const share = areaOf(parts[0]) / (areaOf(parts[0]) + areaOf(parts[1]));
  const total = sum(items);
  let cut = 0;
  let gap = Infinity;
  let acc = 0;
  for (let i = 0; i <= items.length; i++) {
    const g = Math.abs(acc / total - share);
    if (g < gap - 1e-9) {
      gap = g;
      cut = i;
    }
    if (i < items.length) acc += items[i].weight;
  }
  const left = items.slice(0, cut);
  const right = items.slice(cut);
  fill(left.length ? left : [space()], parts[0]);
  fill(right.length ? right : [space()], parts[1]);
}

/** The rooms along the front, left to right, each between two of the places where walls may meet it. */
function rowLayout(
  items: Item[],
  wall: Wall,
  end: number,
  y0: number,
  y1: number,
  ideal: (item: Item) => number,
  entry: Item | null,
  door: number | null,
): Layout | null {
  if (!items.length) return { cost: 0, cells: [] };
  const points = wall.cuts.filter((u) => u > 1e-6 && u < end - 1e-6);
  let best: Layout | null = null;
  for (const pick of picks(points.length, items.length - 1)) {
    const xs = [0, ...pick.map((i) => points[i]), end];
    let cost = 0;
    let fits = true;
    const cells: PlanCell[] = [];
    for (let j = 0; j < items.length && fits; j++) {
      const r = rect(xs[j], y0, xs[j + 1], y1);
      const item = items[j];
      // The front door opens into the entrance, never across a wall.
      if (item === entry && door !== null && (r.x0 > door - DOOR_CLEAR || r.x1 < door + DOOR_CLEAR)) fits = false;
      cost += roomCost(item, r, ideal(item), holds(wall.slots, r.x0, r.x1));
      cells.push({ id: item.id, type: item.type, rect: r });
    }
    if (fits && (!best || cost < best.cost - 1e-9)) best = { cost, cells };
  }
  return best;
}

/** The rooms along the right side, from the front to the back, beside the end of the front row. */
function columnLayout(
  items: Item[],
  wall: Wall,
  front: Wall,
  x0: number,
  width: number,
  ideal: (item: Item) => number,
): Layout | null {
  if (!items.length) return { cost: 0, cells: [] };
  const depth = wall.length;
  const points = wall.cuts.filter((u) => u > 1e-6 && u < depth - 1e-6).sort((p, q) => q - p);
  let best: Layout | null = null;
  for (const pick of picks(points.length, items.length - 1)) {
    const ys = [depth, ...pick.map((i) => points[i]), 0];
    let cost = 0;
    const cells: PlanCell[] = [];
    for (let j = 0; j < items.length; j++) {
      const r = rect(x0, ys[j + 1], width, ys[j]);
      // The room on the corner has the end of the front as well.
      const lit = holds(wall.slots, r.y0, r.y1) || (j === 0 && holds(front.slots, x0, width));
      cost += roomCost(items[j], r, ideal(items[j]), lit);
      cells.push({ id: items[j].id, type: items[j].type, rect: r });
    }
    if (!best || cost < best.cost - 1e-9) best = { cost, cells };
  }
  return best;
}

/**
 * How deep the rooms along the front may be: to a line of the bays of the sides, so the walls
 * behind them meet the sides between two windows, or as deep as their share of the floor asks.
 */
function frontDepths(row: boolean, core: boolean, depth: number, right: Wall, want: number): number[] {
  if (!row) return [0];
  const out = new Set<number>();
  if (!core) out.add(depth);
  // The core may be a little shallower than it likes here: what it costs decides.
  const hi = depth - 2;
  for (const y of right.cuts) {
    const d = depth - y;
    if (d >= 2 - 1e-6 && d <= hi + 1e-6) out.add(round(d));
  }
  if (depth - MIN_CORE_DEPTH >= MIN_FRONT_DEPTH) out.add(round(clamp(want, MIN_FRONT_DEPTH, depth - MIN_CORE_DEPTH)));
  return [...out];
}

/**
 * How many times a wall between two rooms meets an outside wall somewhere other than between two
 * bays, where it would cross a window: at the front and the right side, which face the viewer,
 * and at the left side, which counts for less.
 */
function misaligned(
  cells: PlanCell[],
  front: Wall,
  right: Wall,
  width: number,
  depth: number,
): { seen: number; left: number } {
  const on = (cuts: number[], u: number) => cuts.some((c) => Math.abs(c - u) < 2e-3);
  let seen = 0;
  let left = 0;
  for (const { rect: r } of cells) {
    if (Math.abs(r.y1 - depth) < 0.01) seen += Number(!on(front.cuts, r.x0)) + Number(!on(front.cuts, r.x1));
    if (Math.abs(r.x1 - width) < 0.01) seen += Number(!on(right.cuts, r.y0)) + Number(!on(right.cuts, r.y1));
    if (r.x0 < 0.01) left += Number(!on(right.cuts, r.y0)) + Number(!on(right.cuts, r.y1));
  }
  return { seen, left };
}

/** What the core costs: its rooms' shapes, space nobody asked for, and a flight of stairs too steep. */
function coreCost(cells: PlanCell[], depth: number, stairs: boolean, at: [number, number], total: number): number {
  let cost = 0;
  for (const cell of cells) {
    cost += shapeCost(cell.type, cell.rect);
    const landing = Math.abs(cell.rect.x0 - at[0]) < 1e-3 && Math.abs(cell.rect.x1 - at[1]) < 1e-3;
    if (!cell.id && cell.type !== 'stairs' && !(stairs && landing)) cost += (areaOf(cell.rect) / total) * 1.2;
  }
  if (stairs && depth < STAIRS_DEPTH) cost += (STAIRS_DEPTH - depth) * 0.4;
  if (depth < MIN_CORE_DEPTH) cost += (MIN_CORE_DEPTH - depth) * 3;
  return cost;
}

/**
 * One story: `facade` rooms along the front and right walls, `core` rooms and the stairs at the back.
 * The rooms along the front go left to right, then the rest down the right side from the front; the
 * order is kept, but the room the front door opens into moves to the middle. Of every way to fit
 * them in behind the windows, the one where the rooms look most like rooms wins. Null when they do
 * not fit at all.
 */
function layoutStory(
  facade: Item[],
  core: Item[],
  width: number,
  depth: number,
  stairs: Item | null,
  front: Wall,
  right: Wall,
  entry: Item | null,
  at: [number, number],
  filler: RoomType,
): PlanCell[] | null {
  if (!facade.length && core.length) {
    return layoutStory(core, [], width, depth, stairs, front, right, null, at, filler);
  }
  const whole: Rect = { x0: 0, y0: 0, x1: width, y1: depth };
  if (!facade.length) {
    const cells: PlanCell[] = [];
    if (stairs) layoutCore([], stairs, whole, at, filler, width, cells);
    return cells;
  }
  if (facade.length === 1 && !core.length && !stairs) {
    return [{ id: facade[0].id, type: facade[0].type, rect: rect(0, 0, width, depth) }];
  }
  const total = sum(facade) + sum(core) + (stairs?.weight ?? 0);
  const ideal = (item: Item) => (item.weight / total) * width * depth;
  const door = entry ? width / 2 : null;
  // The front row reaches past the stairs, and past the front door.
  const reach = Math.max(stairs ? at[1] : 0, door === null ? 0 : door + DOOR_CLEAR);
  const coreWeight = sum(core) + (stairs?.weight ?? 0);
  const others = entry ? facade.filter((item) => item !== entry) : facade;
  let best: Layout | null = null;
  for (let k = entry ? 1 : 0; k <= facade.length; k++) {
    for (let place = 0; place < (entry ? k : 1); place++) {
      const row = entry ? [...others.slice(0, place), entry, ...others.slice(place, k - 1)] : others.slice(0, k);
      const column = others.slice(entry ? k - 1 : k);
      for (const end of front.cuts) {
        if (end < reach - 1e-6 || end < 1e-6) continue;
        if (column.length ? width - end < 1.5 : end < width - 1e-6) continue;
        const side = columnLayout(column, right, front, end, width, ideal);
        if (!side) continue;
        const wf = sum(row);
        const want = coreWeight > 0 ? (depth * wf) / (wf + coreWeight) : depth;
        for (const d of frontDepths(row.length > 0, coreWeight > 0, depth, right, want)) {
          const ahead = rowLayout(row, front, end, depth - d, depth, ideal, entry, door);
          if (!ahead) continue;
          let cost = ahead.cost + side.cost;
          const cells = [...ahead.cells, ...side.cells];
          if (d < depth - 1e-6) {
            const inner: PlanCell[] = [];
            layoutCore(core, stairs, { x0: 0, y0: 0, x1: end, y1: depth - d }, at, filler, width, inner);
            cost += coreCost(inner, depth - d, stairs !== null, at, width * depth);
            cells.push(...inner);
          }
          const off = misaligned(cells, front, right, width, depth);
          cost += off.seen * 5 + off.left * 0.15;
          if (!best || cost < best.cost - 1e-6) best = { cost, cells };
        }
      }
    }
  }
  return best?.cells ?? null;
}

/** The room the front door opens into: a hall if there is one, else a room to receive guests in. */
function entranceOf(rooms: Item[]): Item | null {
  for (const type of ENTRANCES) {
    const found = rooms.find((item) => item.id && item.type === type);
    if (found) return found;
  }
  return rooms.find((item) => item.id && item.type !== 'garage') ?? null;
}

// ─── Floors ──────────────────────────────────────────────────────────────────

/**
 * Every floor's level. Floors Home Assistant has no level for go above the known ones, in list
 * order, so they never share a story with a floor that has one. With no levels at all, the list
 * order is the level.
 */
export function floorLevels(floors: readonly { id: string; level: number | null }[]): Map<string, number> {
  const known = floors.map((f) => f.level).filter((l): l is number => typeof l === 'number');
  const levels = new Map<string, number>();
  if (!known.length) {
    floors.forEach((f, index) => levels.set(f.id, index));
    return levels;
  }
  let next = Math.max(...known) + 1;
  for (const f of floors) levels.set(f.id, typeof f.level === 'number' ? f.level : next++);
  return levels;
}

/** The ground floor's level: 0, else the lowest one above ground, else the highest one. */
export function groundLevel(levels: readonly number[]): number {
  if (levels.includes(0)) return 0;
  const above = levels.filter((l) => l >= 0);
  return above.length ? Math.min(...above) : Math.max(...levels);
}

/** Floors from the lowest to the highest, as the card lists them. Floors on one level keep their order. */
export function sortFloors<T extends { id: string; level: number | null }>(floors: readonly T[]): T[] {
  const levels = floorLevels(floors);
  return [...floors].sort((a, b) => levels.get(a.id)! - levels.get(b.id)!);
}

interface StoryInput {
  id: string;
  rank: number;
  rooms: PlanRoomInput[];
  ground: boolean;
  attic: boolean;
}

/** Orders Home Assistant floors into stories and finds the ground floor. */
function stack(floors: PlanFloorInput[], orphans: PlanRoomInput[]): StoryInput[] {
  const populated = floors.filter((f) => f.rooms.length);
  if (!populated.length) {
    return orphans.length ? [{ id: GROUND_ID, rank: 0, rooms: orphans, ground: true, attic: false }] : [];
  }
  const levelOf = floorLevels(populated);
  const levels = [...new Set(populated.map((f) => levelOf.get(f.id)!))].sort((a, b) => a - b);
  const ground = groundLevel(levels);
  const groundIndex = levels.indexOf(ground);
  const stories: StoryInput[] = [];
  for (const level of levels) {
    const onLevel = populated.filter((f) => levelOf.get(f.id) === level);
    const rank = levels.indexOf(level) - groundIndex;
    // Two floors on the same level share a story; the first one names it.
    const rooms = [...onLevel.flatMap((f) => f.rooms), ...(level === ground ? orphans : [])];
    stories.push({
      id: onLevel[0].id,
      rank,
      rooms,
      ground: level === ground,
      attic: onLevel.some((f) => f.attic) || rooms.every((room) => room.type === 'attic'),
    });
  }
  return stories;
}

/**
 * Builds the house. `floors` are Home Assistant floors with their indoor rooms, in Home Assistant
 * order; `orphans` are indoor rooms without a floor, which move in on the ground floor. `facade` is
 * what the design of the house asks: how wide its windows are, and where a floor in its roof has them.
 */
export function planHouse(floors: PlanFloorInput[], orphans: PlanRoomInput[] = [], facade: Facade = PLAIN): HousePlan {
  const stories = stack(floors, orphans);
  const multiStory = stories.length > 1;

  // The first garage on the ground floor becomes the wing, unless it is all there is.
  const groundRooms = stories.find((s) => s.ground)?.rooms ?? [];
  const garage = groundRooms.length > 1 ? groundRooms.find((room) => room.type === 'garage') : undefined;

  const prepared = stories.map((story) => {
    const items: Item[] = story.rooms
      .filter((room) => room !== garage)
      .map((room) => ({ id: room.id, type: room.type, weight: roomWeight(room.type) }));
    const stairsRoom = multiStory ? items.find((item) => item.type === 'stairs') : undefined;
    const rest = items.filter((item) => item !== stairsRoom);
    const outside = rest.filter((item) => !CORE_TYPES.has(item.type));
    const core = rest.filter((item) => CORE_TYPES.has(item.type));
    // A second garage sits at the end of the house.
    outside.sort((a, b) => Number(a.type === 'garage') - Number(b.type === 'garage'));
    const stairs: Item | null = multiStory
      ? (stairsRoom ?? { id: null, type: 'stairs', weight: roomWeight('stairs') })
      : null;
    return { story, outside, core, stairs };
  });

  const weightOf = (p: (typeof prepared)[number]) => sum(p.outside) + sum(p.core) + (p.stairs?.weight ?? 0);
  const heaviest = Math.max(1, ...prepared.map(weightOf));
  const area = Math.max(48, heaviest * SQ_METERS_PER_WEIGHT);
  const width = Math.max(7, snap(Math.sqrt(area * ASPECT)));
  const depth = Math.max(6, snap(area / width));

  // A house with a basement stands higher, with the basement's windows above the grass.
  const base = stories.some((s) => s.rank < 0) ? 0.9 : 0.35;
  const bay = bayWidth(facade.window);
  const bays: Bays = { front: Math.max(3, bayCount(width, bay, true)), side: bayCount(depth, bay, false) };

  const shapes: StoryShape[] = stories.map((story, index) => ({
    id: story.id,
    index,
    z: round(base + story.rank * STORY_HEIGHT),
    basement: story.rank < 0,
    ground: story.ground,
    attic: story.attic && story.rank > 0,
  }));
  let wing: PlanCell | null = null;
  if (garage) {
    const y1 = depth - WING_SETBACK;
    wing = { id: garage.id, type: 'garage', rect: rect(-WING_WIDTH, Math.max(0, y1 - WING_DEPTH), 0, y1) };
  }
  const shape: PlanShape = { width, depth, storyHeight: STORY_HEIGHT, base, stories: shapes, wing, bays };
  const roof = facade.roof?.(shape) ?? null;
  const at = stairsBay(shape);

  const planned: PlanStory[] = prepared.map(({ story, outside, core, stairs }, index) => {
    // Sparse floors get a hall or storage space, so their rooms keep a sensible size.
    const deficit = heaviest * 0.72 - weightOf(prepared[index]);
    const coreItems = [...core];
    // A basement fills up with storage, an attic with what is kept under the roof.
    const filler: RoomType = story.rank < 0 ? 'storage' : shapes[index].attic ? 'attic' : 'hallway';
    if (deficit > 0.35 && outside.length + core.length > 0) coreItems.push({ id: null, type: filler, weight: deficit });
    // Under the roof the windows are where the roof has them; elsewhere one is in every bay.
    const loft = roof?.story === index ? roof : null;
    const front = loft ? roofWall(width, bays.front, loft.front, loft.keepFront) : bayWall(width, bays.front);
    const right = loft ? roofWall(depth, bays.side, loft.right, loft.keepRight) : bayWall(depth, bays.side);
    // Only so many rooms fit along the outside walls; the smallest ones move to the core. Under the
    // roof that is as many as it has windows for.
    let capacity = Math.max(3, Math.round((width + depth) / 3.2));
    const windows = loft ? loft.front.length + loft.right.length : 0;
    if (windows) capacity = Math.min(capacity, windows);
    const onFacade = [...outside];
    const entry = story.ground ? entranceOf(onFacade) : null;
    const shrink = () => {
      let smallest = -1;
      for (let i = onFacade.length - 1; i >= 0; i--) {
        if (onFacade[i] === entry && onFacade.length > 1) continue;
        if (smallest < 0 || onFacade[i].weight < onFacade[smallest].weight) smallest = i;
      }
      coreItems.push(...onFacade.splice(smallest, 1));
    };
    while (onFacade.length > capacity) shrink();
    const lay = () =>
      layoutStory(
        onFacade,
        coreItems,
        width,
        depth,
        stairs,
        front,
        right,
        entry && onFacade.includes(entry) ? entry : null,
        at,
        filler,
      );
    let cells = lay();
    while (!cells && onFacade.length) {
      shrink();
      cells = lay();
    }
    if (!cells) {
      // Nothing fits behind the windows: the rooms share the floor as they can.
      cells = [];
      split([...onFacade, ...coreItems, ...(stairs ? [stairs] : [])], { x0: 0, y0: 0, x1: width, y1: depth }, cells);
    }
    return { ...shapes[index], cells };
  });
  return { ...shape, stories: planned };
}

// ─── Questions about a plan ──────────────────────────────────────────────────

/** The walls of a cell that face the viewer: 'front' (y = depth) and 'right' (x = width). */
export function facadesOf(cell: PlanCell, plan: HousePlan): ('front' | 'right')[] {
  const sides: ('front' | 'right')[] = [];
  if (Math.abs(cell.rect.y1 - plan.depth) < 0.01) sides.push('front');
  if (Math.abs(cell.rect.x1 - plan.width) < 0.01) sides.push('right');
  return sides;
}

export type Side = 'front' | 'right' | 'back' | 'left';

/** The stretch of an outside wall that belongs to a cell, or null if the cell does not touch it. */
export function span(cell: PlanCell, plan: PlanShape, side: Side): [number, number] | null {
  const r = cell.rect;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  if (side === 'front') return near(r.y1, plan.depth) ? [r.x0, r.x1] : null;
  if (side === 'back') return near(r.y0, 0) ? [r.x0, r.x1] : null;
  if (side === 'right') return near(r.x1, plan.width) ? [r.y0, r.y1] : null;
  return near(r.x0, 0) ? [r.y0, r.y1] : null;
}

/** The rooms a back door opens out of, the most fitting first. */
const BACK_DOORS: RoomType[] = ['kitchen', 'dining', 'living', 'laundry', 'hallway', 'room', 'office'];

/**
 * The back door: in a bay of a room on the ground floor that opens onto the garden, the kitchen's
 * if it can, and of that room's bays the one nearest the middle of the house.
 */
export function backDoor(plan: HousePlan): { x: number; cell: PlanCell } | null {
  const ground = plan.stories.find((s) => s.ground);
  if (!ground) return null;
  let best: { x: number; cell: PlanCell; score: number } | null = null;
  for (const x of bayMiddles(plan, 'back')) {
    const cell = ground.cells.find((c) => {
      const range = span(c, plan, 'back');
      return range !== null && range[0] < x - DOOR_CLEAR && range[1] > x + DOOR_CLEAR;
    });
    const rank = cell ? BACK_DOORS.indexOf(cell.type) : -1;
    if (!cell || rank < 0) continue;
    const score = rank * 100 + Math.abs(x - plan.width / 2);
    if (!best || score < best.score) best = { x, cell, score };
  }
  return best && { x: best.x, cell: best.cell };
}

/** The front door: in the middle of the front, and the room on the ground floor it opens into. */
export function frontDoor(plan: HousePlan): { x: number; cell: PlanCell } | null {
  const ground = plan.stories.find((s) => s.ground);
  if (!ground) return null;
  const x = plan.width / 2;
  const cell = ground.cells.find((c) => {
    const range = span(c, plan, 'front');
    return range !== null && range[0] < x && range[1] > x && c.type !== 'garage';
  });
  return cell ? { x, cell } : null;
}
