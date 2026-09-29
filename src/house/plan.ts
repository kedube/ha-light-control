// Turns Home Assistant floors and areas into the floor plan of a believable house.
//
// Every floor shares one rectangular footprint. The 3D view looks at the house from the front
// right, so two walls face the viewer: the front (y = depth) and the right side (x = width).
// Rooms are laid along those two walls, so each one has windows the viewer can see. Closets,
// storage and the stairs go into a core at the back left, and the stairs sit in the same spot on
// every floor.

import type { RoomType } from '../room-types.ts';

export interface PlanRoomInput {
  id: string;
  type: RoomType;
}

export interface PlanFloorInput {
  id: string;
  /** Home Assistant floor level; floors without one keep their place in the list. */
  level: number | null;
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

export interface PlanStory {
  /** Home Assistant floor id, or GROUND_ID when the home has no floors. */
  id: string;
  /** 0 for the lowest story. */
  index: number;
  /** Height of the floor surface; the ground floor sits a little above the grass. */
  z: number;
  basement: boolean;
  /** The story holding rooms without a floor, and the front door. */
  ground: boolean;
  cells: PlanCell[];
}

export interface HousePlan {
  /** Size along x (the front wall's length), in meters. */
  width: number;
  /** Size along y (the right wall's length), in meters. */
  depth: number;
  storyHeight: number;
  /** Height of the ground floor above the grass. */
  base: number;
  /** Bottom to top. */
  stories: PlanStory[];
}

export const GROUND_ID = '__ground__';
export const STORY_HEIGHT = 3;
/** The stairwell at the back left of every floor. */
export const STAIRS_WIDTH = 2;
export const STAIRS_DEPTH = 3.4;
/** The core must be deep enough to walk through. */
const MIN_CORE_DEPTH = 2.4;

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

function rect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x0: round(x0), y0: round(y0), x1: round(x1), y1: round(y1) };
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

function aspectOf(r: Rect): number {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  return Math.max(w, h) / Math.max(0.01, Math.min(w, h));
}

/** How far a layout is from looking like a real house: 0 is ideal, higher is worse. */
function badness(cells: PlanCell[], core: Rect | null, stairs: boolean): number {
  let cost = 0;
  for (const cell of cells) {
    const aspect = aspectOf(cell.rect);
    // A gentle pull toward square rooms, and a strong push away from corridors.
    cost += (aspect - 1) ** 2 * 0.1 + Math.max(0, aspect - (MAX_ASPECT[cell.type] ?? 2)) ** 2 * 2;
    const short = Math.min(cell.rect.x1 - cell.rect.x0, cell.rect.y1 - cell.rect.y0);
    if (short < 1.8) cost += (1.8 - short) * 2;
  }
  if (core) {
    const cw = core.x1 - core.x0;
    const cd = core.y1 - core.y0;
    if (stairs && cw < STAIRS_WIDTH) cost += (STAIRS_WIDTH - cw) * 3;
    if (cd < MIN_CORE_DEPTH) cost += (MIN_CORE_DEPTH - cd) * 3;
  }
  return cost;
}

const HALL = (weight: number): Item => ({ id: null, type: 'hallway', weight });

/** The stairs at the back left, then everything else in the core beside them. */
function layoutCore(core: Item[], stairs: Item | null, area: Rect, out: PlanCell[]): void {
  let from = area.x0;
  const depth = area.y1 - area.y0;
  if (stairs) {
    const sw = Math.min(STAIRS_WIDTH, area.x1 - area.x0);
    const sd = depth - STAIRS_DEPTH > 1.2 ? STAIRS_DEPTH : depth;
    out.push({ id: stairs.id, type: stairs.type, rect: rect(area.x0, area.y0, area.x0 + sw, area.y0 + sd) });
    // A landing in front of the stairs when the core is deeper than the flight.
    if (sd < depth) out.push({ id: null, type: 'hallway', rect: rect(area.x0, area.y0 + sd, area.x0 + sw, area.y1) });
    from += sw;
  }
  if (area.x1 - from < 0.3) return;
  split(core.length ? core : [HALL(1)], { ...area, x0: from }, out);
}

/** Adds hall space to the core, growing the filler hall if there already is one. */
function mergeHall(core: Item[], extra: number): Item[] {
  const hall = core.find((item) => item.id === null && item.type === 'hallway');
  if (!hall) return [...core, HALL(extra)];
  return core.map((item) => (item === hall ? HALL(item.weight + extra) : item));
}

/**
 * One story: `facade` rooms along the front and right walls, in order from the left of the
 * picture to the right, and `core` rooms plus the stairs at the back left.
 */
function layoutStory(facade: Item[], core: Item[], width: number, depth: number, stairs: Item | null): PlanCell[] {
  if (!facade.length && core.length) return layoutStory(core, [], width, depth, stairs);
  if (!facade.length) {
    const cells: PlanCell[] = [];
    if (stairs) layoutCore([], stairs, { x0: 0, y0: 0, x1: width, y1: depth }, cells);
    return cells;
  }
  if (facade.length === 1 && !core.length && !stairs) {
    return [{ id: facade[0].id, type: facade[0].type, rect: rect(0, 0, width, depth) }];
  }

  const n = facade.length;
  let best: { score: number; cells: PlanCell[] } | undefined;
  for (let k = 0; k <= n; k++) {
    const front = facade.slice(0, k);
    const right = facade.slice(k);
    const wf = sum(front);
    const wr = sum(right);
    // Extra hall space in the core, used when it gives the other rooms better proportions.
    for (const extra of [0, 0.4, 0.8, 1.3, 2]) {
      const coreItems = extra ? mergeHall(core, extra) : core;
      const coreWeight = sum(coreItems) + (stairs ? stairs.weight : 0);
      const total = wf + wr + coreWeight;
      const rightW = (width * wr) / total;
      const leftW = width - rightW;
      const frontD = wf + coreWeight > 0 ? (depth * wf) / (wf + coreWeight) : 0;
      const coreD = depth - frontD;

      const cells: PlanCell[] = [];
      let x = 0;
      for (const item of front) {
        const w = (leftW * item.weight) / wf;
        cells.push({ id: item.id, type: item.type, rect: rect(x, depth - frontD, x + w, depth) });
        x += w;
      }
      let y = depth;
      for (const item of right) {
        const l = (depth * item.weight) / wr;
        cells.push({ id: item.id, type: item.type, rect: rect(width - rightW, y - l, width, y) });
        y -= l;
      }
      let coreRect: Rect | null = null;
      if (coreWeight > 0) {
        coreRect = { x0: 0, y0: 0, x1: leftW, y1: coreD };
        layoutCore(coreItems, stairs, coreRect, cells);
      }
      const score = badness(cells, coreRect, Boolean(stairs)) + extra * 0.1;
      if (!best || score < best.score - 1e-6) best = { score, cells };
    }
  }
  return best!.cells;
}

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

interface StoryInput {
  id: string;
  rank: number;
  rooms: PlanRoomInput[];
  ground: boolean;
}

/** Orders Home Assistant floors into stories and finds the ground floor. */
function stack(floors: PlanFloorInput[], orphans: PlanRoomInput[]): StoryInput[] {
  const populated = floors.filter((f) => f.rooms.length);
  if (!populated.length) return orphans.length ? [{ id: GROUND_ID, rank: 0, rooms: orphans, ground: true }] : [];
  const levelOf = floorLevels(populated);
  const levels = [...new Set(populated.map((f) => levelOf.get(f.id)!))].sort((a, b) => a - b);
  const ground = groundLevel(levels);
  const groundIndex = levels.indexOf(ground);
  const stories: StoryInput[] = [];
  for (const level of levels) {
    const onLevel = populated.filter((f) => levelOf.get(f.id) === level);
    const rank = levels.indexOf(level) - groundIndex;
    // Two floors on the same level share a story; the first one names it.
    stories.push({
      id: onLevel[0].id,
      rank,
      rooms: [...onLevel.flatMap((f) => f.rooms), ...(level === ground ? orphans : [])],
      ground: level === ground,
    });
  }
  return stories;
}

/**
 * Builds the house. `floors` are Home Assistant floors with their indoor rooms, in Home Assistant
 * order; `orphans` are indoor rooms without a floor, which move in on the ground floor.
 */
export function planHouse(floors: PlanFloorInput[], orphans: PlanRoomInput[] = []): HousePlan {
  const stories = stack(floors, orphans);
  const multiStory = stories.length > 1;

  const prepared = stories.map((story) => {
    const items: Item[] = story.rooms.map((room) => ({ id: room.id, type: room.type, weight: roomWeight(room.type) }));
    const stairsRoom = multiStory ? items.find((item) => item.type === 'stairs') : undefined;
    const rest = items.filter((item) => item !== stairsRoom);
    const facade = rest.filter((item) => !CORE_TYPES.has(item.type));
    const core = rest.filter((item) => CORE_TYPES.has(item.type));
    // The garage sits at the end of the house, like most attached garages.
    facade.sort((a, b) => Number(a.type === 'garage') - Number(b.type === 'garage'));
    const stairs: Item | null = multiStory
      ? (stairsRoom ?? { id: null, type: 'stairs', weight: roomWeight('stairs') })
      : null;
    return { story, facade, core, stairs };
  });

  const weightOf = (p: (typeof prepared)[number]) => sum(p.facade) + sum(p.core) + (p.stairs?.weight ?? 0);
  const heaviest = Math.max(1, ...prepared.map(weightOf));
  const area = Math.max(48, heaviest * SQ_METERS_PER_WEIGHT);
  const width = Math.max(7, snap(Math.sqrt(area * ASPECT)));
  const depth = Math.max(6, snap(area / width));

  // A house with a basement stands a little higher, with basement windows at the bottom.
  const base = stories.some((s) => s.rank < 0) ? 0.5 : 0.25;

  const planned: PlanStory[] = prepared.map(({ story, facade, core, stairs }, index) => {
    // Sparse floors get a hall or storage space, so their rooms keep a sensible size.
    const deficit = heaviest * 0.72 - weightOf(prepared[index]);
    const coreItems = [...core];
    if (deficit > 0.35 && facade.length + core.length > 0) {
      coreItems.push({ id: null, type: story.rank < 0 ? 'storage' : 'hallway', weight: deficit });
    }
    // Only so many rooms fit along the outside walls; the smallest ones move to the core.
    const capacity = Math.max(3, Math.round((width + depth) / 3.2));
    const onFacade = [...facade];
    while (onFacade.length > capacity) {
      let smallest = onFacade.length - 1;
      for (let i = onFacade.length - 1; i >= 0; i--) {
        if (onFacade[i].weight < onFacade[smallest].weight) smallest = i;
      }
      coreItems.push(...onFacade.splice(smallest, 1));
    }
    return {
      id: story.id,
      index,
      z: round(base + story.rank * STORY_HEIGHT),
      basement: story.rank < 0,
      ground: story.ground,
      cells: layoutStory(onFacade, coreItems, width, depth, stairs),
    };
  });

  return { width, depth, storyHeight: STORY_HEIGHT, base, stories: planned };
}

/** The walls of a cell that face the viewer: 'front' (y = depth) and 'right' (x = width). */
export function facadesOf(cell: PlanCell, plan: HousePlan): ('front' | 'right')[] {
  const sides: ('front' | 'right')[] = [];
  if (Math.abs(cell.rect.y1 - plan.depth) < 0.01) sides.push('front');
  if (Math.abs(cell.rect.x1 - plan.width) < 0.01) sides.push('right');
  return sides;
}
