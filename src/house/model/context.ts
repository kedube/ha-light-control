// What the parts of the house model share while it is being built: the mesh, the plan, which
// group every piece belongs to, and the tables of rooms and lamps.

import type { RoomType } from '../../room-types.ts';
import type { FixtureKind } from '../fixtures.ts';
import type { HouseStyle } from '../materials.ts';
import { MeshBuilder } from '../mesh.ts';
import type { HousePlan, PlanCell, PlanStory } from '../plan.ts';

/** How a light outdoors is mounted. */
export type OutdoorMount = 'post' | 'bollard' | 'wall' | 'string';

export interface LightInput {
  id: string;
  name: string;
}

export interface RoomInput {
  id: string;
  type: RoomType;
  lights: LightInput[];
}

export interface ModelInput {
  plan: HousePlan;
  /** Indoor rooms by area id. */
  rooms: ReadonlyMap<string, RoomInput>;
  /** Outdoor areas, in Home Assistant order. */
  outdoor: RoomInput[];
  style: HouseStyle;
}

/** A point or a box in plan space: x along the front wall, y from back to front, z up. */
export type Point = [number, number, number];

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

export const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => ({
  x0: Math.min(x0, x1),
  y0: Math.min(y0, y1),
  z0: Math.min(z0, z1),
  x1: Math.max(x0, x1),
  y1: Math.max(y0, y1),
  z1: Math.max(z0, z1),
});

export const corners = (b: Box): Point[] => [
  [b.x0, b.y0, b.z0],
  [b.x1, b.y0, b.z0],
  [b.x1, b.y1, b.z0],
  [b.x0, b.y1, b.z0],
  [b.x0, b.y0, b.z1],
  [b.x1, b.y0, b.z1],
  [b.x1, b.y1, b.z1],
  [b.x0, b.y1, b.z1],
];

/** One lamp: a row in the light table, and where it hangs. */
export interface Fixture {
  slot: number;
  roomId: string;
  lightId: string;
  kind: FixtureKind;
  outdoor: boolean;
  at: Point;
  /** For a strip of LEDs: from `at` to its far end. */
  along?: Point;
  /** How far its light reaches, in meters. */
  reach: number;
}

/** Light from a room's windows falling on the ground outside. */
export interface Spill {
  slot: number;
  roomId: string;
  at: Point;
}

/** A row of the room table: which lamps light the room, and how open it is to the sky. */
export interface RoomSlot {
  index: number;
  /** The area id; null for the outdoors and for halls and stairs the planner added. */
  id: string | null;
  /** Index of the story in the plan; -1 outdoors. */
  story: number;
  first: number;
  count: number;
  /** Floor area in square meters. */
  area: number;
}

/** Parts of the house that are lifted away together to open a floor. Higher groups go first. */
export interface Groups {
  /** Always there: the ground the house stands on. */
  base: number;
  /** The garden and the earth in front of a basement. */
  ground: number;
  /** For each story of the plan: what stays when it is opened, and what goes. */
  lower: number[];
  upper: number[];
  roof: number;
  count: number;
}

/** Height of the walls inside, floor to ceiling. */
export const WALL_H = 2.7;
/** Thickness of the floor between stories. */
export const SLAB = 0.3;
/** Where inside walls are cut when a floor is opened. */
export const CUT_H = 1.15;
/** What is left of the walls facing the viewer when a floor is opened. */
export const SILL_H = 0.3;
export const EXT_T = 0.25;
export const INT_T = 0.12;

/** The most groups the shaders handle; taller houses share the last ones. */
const MAX_GROUPS = 24;

export function groupsFor(plan: HousePlan): Groups {
  let next = 0;
  const lower: number[] = [];
  const upper: number[] = [];
  const take = () => Math.min(MAX_GROUPS - 1, ++next);
  for (const story of plan.stories) {
    if (!story.basement) continue;
    lower[story.index] = take();
    upper[story.index] = take();
  }
  const ground = take();
  for (const story of plan.stories) {
    if (story.basement) continue;
    lower[story.index] = take();
    upper[story.index] = take();
  }
  const roof = take();
  return { base: 0, ground, lower, upper, roof, count: Math.min(MAX_GROUPS, next + 1) };
}

export class Context {
  readonly mesh = new MeshBuilder();
  readonly plan: HousePlan;
  readonly input: ModelInput;
  readonly style: HouseStyle;
  readonly groups: Groups;
  readonly rooms: RoomSlot[] = [];
  readonly fixtures: Fixture[] = [];
  readonly spills: Spill[] = [];
  private readonly byId = new Map<string, number>();
  private readonly anonymous = new Map<number, number>();
  private nextSlot = 1;

  constructor(input: ModelInput) {
    this.input = input;
    this.plan = input.plan;
    this.style = input.style;
    this.groups = groupsFor(input.plan);
    this.rooms.push({ index: 0, id: null, story: -1, first: 0, count: 0, area: 0 });
  }

  get basement(): PlanStory | undefined {
    return [...this.plan.stories].reverse().find((s) => s.basement);
  }

  get ground(): PlanStory | undefined {
    return this.plan.stories.find((s) => s.ground);
  }

  /** The top story above ground. */
  get top(): PlanStory | undefined {
    return [...this.plan.stories].reverse().find((s) => !s.basement);
  }

  /** The room-table row for a cell: its own for an area, a shared one for added halls and stairs. */
  roomOf(cell: PlanCell, story: PlanStory): number {
    const area = (cell.rect.x1 - cell.rect.x0) * (cell.rect.y1 - cell.rect.y0);
    if (cell.id && this.input.rooms.has(cell.id)) {
      let index = this.byId.get(cell.id);
      if (index === undefined) {
        index = this.rooms.length;
        if (index > 254) return this.shared(story);
        this.rooms.push({ index, id: cell.id, story: story.index, first: 0, count: 0, area });
        this.byId.set(cell.id, index);
      }
      return index;
    }
    return this.shared(story);
  }

  private shared(story: PlanStory): number {
    let index = this.anonymous.get(story.index);
    if (index === undefined) {
      index = Math.min(254, this.rooms.length);
      if (index === this.rooms.length) {
        this.rooms.push({ index, id: null, story: story.index, first: 0, count: 0, area: 12 });
      }
      this.anonymous.set(story.index, index);
    }
    return index;
  }

  /** The row for an area by id, if it has one. */
  roomIndex(id: string): number | undefined {
    return this.byId.get(id);
  }

  /**
   * Reserves a row in the light table, or returns 0 when the table is full. A room's lamps must be
   * added one after another, so its rows sit together.
   */
  slot(): number {
    return this.nextSlot < 255 ? this.nextSlot++ : 0;
  }

  /** Marks the rows reserved since `first` as the lamps of a room. */
  claim(room: number, first: number): void {
    const slot = this.rooms[room];
    if (!slot || this.nextSlot <= first) return;
    slot.first = first;
    slot.count = this.nextSlot - first;
  }

  get slotCount(): number {
    return this.nextSlot;
  }
}
