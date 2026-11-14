// The house as a 3D model, built from the floor plan: its mesh, the lamps in it, and for each way
// of looking at it (from outside, or with one floor opened) what can be picked and what to frame.

import type { RGB } from '../color.ts';
import type { Stage } from './life.ts';
import { toWorld } from './math.ts';
import { boxSides, wireOf, type Mesh, type Region, type Wire } from './mesh.ts';
import { span, type HousePlan, type Side } from './plan.ts';
import {
  box,
  Context,
  corners,
  CUT_H,
  SLAB,
  WALL_H,
  type Box,
  type Fixture,
  type Groups,
  type ModelInput,
  type Point,
  type RoomSlot,
  type Spill,
} from './model/context.ts';
import { buildBackStep, buildEntry } from './model/entry.ts';
import { buildInterior } from './model/interior.ts';
import { chimneySpot, under, WING_FLOOR, wingHeight } from './model/massing.ts';
import { buildShell } from './model/shell.ts';
import { buildSite, layoutSite } from './model/site.ts';
import { at, frameOf } from './model/walls.ts';

export type { Box, Fixture, Groups, ModelInput, Point, RoomInput, LightInput } from './model/context.ts';
export { facadeFor, type DormerChoice, type TopFloor } from './model/massing.ts';
export { fixtureKind, type FixtureKind } from './fixtures.ts';

/** Something that can be picked: the points around it, in plan space. */
export interface Hit {
  roomId: string;
  points: Point[];
}

export interface Anchor {
  roomId: string;
  at: Point;
}

/** A room's space as a wire frame: a box, or under a roof what the slopes leave of one. */
export type Volume = Wire;

const solid = (b: Box, region?: Region): Volume => wireOf(boxSides(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, region));

/** One way of looking at the house. */
export interface ViewData {
  hits: Hit[];
  /** Where each room's label goes. */
  anchors: Anchor[];
  /** A room's volume, for the selection outline. */
  volumes: Map<string, Volume>;
  /** What the camera frames. */
  frame: Box[];
  /** Groups up to this one are showing; the rest have lifted away. */
  cut: number;
  /** The story that is open, or -1 from outside. */
  story: number;
}

export interface Model {
  plan: HousePlan;
  mesh: Mesh;
  groups: Groups;
  rooms: RoomSlot[];
  fixtures: Fixture[];
  spills: Spill[];
  exterior: ViewData;
  /** One per story of the plan. */
  stories: ViewData[];
  /** A sphere around everything, in world space. */
  center: [number, number, number];
  radius: number;
  /** The highest point of the house, for keeping the title clear of it. */
  top: number;
  /** The index of the story that is built into the roof, or -1 when every floor has walls of its own. */
  loft: number;
  /** Where birds can fly, fireflies glow and smoke rises, around the house. */
  stage: Stage;
}

export function buildModel(input: ModelInput): Model {
  const c = new Context(input);
  const plan = input.plan;
  const site = layoutSite(plan, input.outdoor, input.style);
  const glazing = buildShell(c);
  buildEntry(c, site.entry);
  buildBackStep(c);
  buildInterior(c);
  // Everything outdoors shares one list of lamps: the garden's own, then the light from windows.
  const firstOutdoor = c.slotCount;
  const zones = buildSite(c, site);
  const ground = c.ground;
  const nearGround = (story: number) => (ground ? Math.abs(story - ground.index) : 0);
  for (const g of [...glazing].sort((a, b) => nearGround(a.story) - nearGround(b.story))) {
    if (!g.roomId || !input.rooms.has(g.roomId)) continue;
    const slot = c.slot();
    if (!slot) break;
    c.spills.push({ slot, roomId: g.roomId, at: g.at });
  }
  c.claim(0, firstOutdoor);

  const W = plan.width;
  const D = plan.depth;
  const roof = c.roof;
  const ridge = roof.ridge;
  // What the slopes of the roof leave of a room under them.
  const slopes = roof.loft ? under(roof)?.[0] : undefined;
  const wing = plan.wing;
  const wingBox = wing
    ? box(wing.rect.x0, wing.rect.y0, 0, wing.rect.x1, wing.rect.y1, WING_FLOOR + wingHeight(plan) + 1.6)
    : null;

  // From outside: a room is picked by the stretches of outside wall it lies behind. The house can
  // be turned, so all four sides count; the walls nearest the viewer are the ones that are hit.
  const exterior: ViewData = {
    hits: [],
    anchors: [],
    volumes: new Map([...zones].map(([id, volume]) => [id, solid(volume)])),
    frame: [],
    cut: c.groups.count,
    story: -1,
  };
  const edge = (side: Side) => (side === 'front' ? D : side === 'right' ? W : 0);
  for (const story of plan.stories) {
    for (const cell of story.cells) {
      if (!cell.id) continue;
      const r = cell.rect;
      if (story === roof.loft && slopes) {
        // A room under the roof is picked by the roof over it, and by its wall in a gable end.
        const sides = boxSides(r.x0, r.y0, story.z - SLAB, r.x1, r.y1, ridge, slopes);
        exterior.volumes.set(cell.id, wireOf(sides));
        for (const face of sides) {
          const outside = (['front', 'right', 'back', 'left'] as Side[]).find((side) => {
            const along = side === 'front' || side === 'back' ? 1 : 0;
            const out = side === 'front' || side === 'right' ? 1 : -1;
            return (
              span(cell, plan, side) &&
              face.normal[along] === out &&
              Math.abs(face.points[0][along] - edge(side)) < 0.01
            );
          });
          if (!face.cut && !outside) continue;
          const n = face.normal;
          const length = Math.hypot(n[0], n[1], n[2]);
          const lift = (p: Point): Point => [
            p[0] + (n[0] / length) * 0.05,
            p[1] + (n[1] / length) * 0.05,
            p[2] + (n[2] / length) * 0.05,
          ];
          exterior.hits.push({ roomId: cell.id, points: face.points.map(lift) });
          // The label goes on the roof or the gable, not on the low wall under the eaves.
          const heights = face.points.map((p) => p[2]);
          if (!face.cut && Math.max(...heights) - Math.min(...heights) < 1.2) continue;
          const middle: Point = [0, 0, 0];
          for (const p of face.points) for (let i = 0; i < 3; i++) middle[i] += p[i] / face.points.length;
          exterior.anchors.push({ roomId: cell.id, at: lift(lift(middle)) });
        }
        continue;
      }
      // A basement shows as the strip of foundation above the grass.
      const z0 = story.basement ? 0 : story.z - SLAB;
      const z1 = story.basement ? plan.base - SLAB : story.z + WALL_H;
      exterior.volumes.set(cell.id, solid(box(r.x0, r.y0, z0, r.x1, r.y1, z1)));
      for (const side of ['front', 'right', 'back', 'left'] as Side[]) {
        const range = span(cell, plan, side);
        if (!range) continue;
        const f = frameOf(plan, side);
        const [a, b] = range;
        exterior.hits.push({
          roomId: cell.id,
          points: [at(f, a, -0.05, z0), at(f, b, -0.05, z0), at(f, b, -0.05, z1), at(f, a, -0.05, z1)],
        });
        exterior.anchors.push({ roomId: cell.id, at: at(f, (a + b) / 2, -0.1, z1 - (story.basement ? 0 : 0.35)) });
      }
    }
  }
  if (wing?.id && wingBox) {
    const body = box(wing.rect.x0, wing.rect.y0, 0, wing.rect.x1, wing.rect.y1, WING_FLOOR + wingHeight(plan));
    exterior.hits.push({ roomId: wing.id, points: corners(body) });
    exterior.anchors.push({
      roomId: wing.id,
      at: [(wing.rect.x0 + wing.rect.x1) / 2, (wing.rect.y0 + wing.rect.y1) / 2, body.z1 - 0.2],
    });
    exterior.volumes.set(wing.id, solid(body));
  }
  for (const [roomId, volume] of zones) {
    exterior.hits.push({ roomId, points: corners({ ...volume, z1: 0.3 }) });
    exterior.anchors.push({ roomId, at: [(volume.x0 + volume.x1) / 2, (volume.y0 + volume.y1) / 2, 1.7] });
  }
  if (plan.stories.length) {
    exterior.frame.push(box(-0.5, -0.5, 0, W + 0.5, D + 0.5, ridge + 0.9));
    if (wingBox) exterior.frame.push(wingBox);
  } else exterior.frame.push(box(site.box.x0, site.box.y0, 0, site.box.x1, site.box.y1, 1));
  for (const volume of zones.values()) exterior.frame.push({ ...volume, z1: Math.max(volume.z1, 2.2) });
  // The whole plot is in the picture, bar its very corners.
  exterior.frame.push(box(site.box.x0 + 1.2, site.box.y0 + 1.2, 0, site.box.x1 - 1.2, site.box.y1 - 1.2, 0));
  // And a little of the earth under its front corner; the rest may run behind the floor switcher.
  exterior.frame.push(box(site.box.x1 - 1, site.box.y1 - 1, Math.max(site.box.z0, -0.5), site.box.x1, site.box.y1, 0));

  // Opened up: every room is its own floor, to the height its walls are cut at.
  const stories: ViewData[] = plan.stories.map((story) => {
    const view: ViewData = {
      hits: [],
      anchors: [],
      volumes: new Map(),
      frame: [],
      cut: c.groups.lower[story.index],
      story: story.index,
    };
    // Under the roof, a room's walls are cut lower toward the eaves, where the slope comes down.
    const region = story === roof.loft ? slopes : undefined;
    const add = (id: string, volume: Box) => {
      const wire = solid(volume, region);
      view.hits.push({ roomId: id, points: wire.points });
      view.anchors.push({
        roomId: id,
        at: [(volume.x0 + volume.x1) / 2, (volume.y0 + volume.y1) / 2, volume.z0 + 1.5],
      });
      view.volumes.set(id, wire);
    };
    for (const cell of story.cells) {
      if (cell.id) add(cell.id, box(cell.rect.x0, cell.rect.y0, story.z, cell.rect.x1, cell.rect.y1, story.z + CUT_H));
    }
    view.frame.push(box(0, 0, story.z - SLAB, W, D, story.z + WALL_H + 0.3));
    // The gable end left standing at the back reaches the ridge.
    if (region && roof.form === 'gable') view.frame.push(box(0, D / 2, story.z, W, D / 2, ridge));
    if (story.ground) {
      if (wing?.id)
        add(wing.id, box(wing.rect.x0, wing.rect.y0, WING_FLOOR, wing.rect.x1, wing.rect.y1, WING_FLOOR + CUT_H));
      if (wing) view.frame.push(box(wing.rect.x0, wing.rect.y0, 0, wing.rect.x1, wing.rect.y1, WING_FLOOR + WALL_H));
      // The garden stays in the picture around the ground floor, and can still be picked.
      for (const [roomId, volume] of zones) {
        view.hits.push({ roomId, points: corners({ ...volume, z1: 0.3 }) });
        view.volumes.set(roomId, solid(volume));
      }
    }
    return view;
  });

  // Where life goes on around the house. The chimney's pots stand on its stack, above the roof.
  const spot = chimneySpot(roof);
  const low = roof.form === 'flat' || roof.form === 'shed';
  const stage: Stage = {
    center: [W / 2, D / 2, 0],
    radius: Math.hypot(W, D) / 2 + 1,
    ridge,
    plot: { x0: site.box.x0, y0: site.box.y0, x1: site.box.x1, y1: site.box.y1 },
    buildings: plan.stories.length ? [{ x0: 0, y0: 0, x1: W, y1: D }, ...(wing ? [wing.rect] : [])] : [],
    chimney: plan.stories.length
      ? [
          (spot.x0 + spot.x1) / 2,
          (spot.y0 + spot.y1) / 2,
          ridge + (low ? 0.5 : 0.75) + (input.style.chimneyPots ? 0.6 : 0.42),
        ]
      : null,
  };

  // A sphere around the plot and the roof, for the shadows.
  const cx = (site.box.x0 + site.box.x1) / 2;
  const cy = (site.box.y0 + site.box.y1) / 2;
  const cz = (site.box.z0 + ridge + 1.5) / 2;
  const radius = Math.hypot(site.box.x1 - cx, site.box.y1 - cy, ridge + 1.5 - cz) + 0.5;
  return {
    plan,
    mesh: c.mesh.finish(),
    groups: c.groups,
    rooms: c.rooms,
    fixtures: c.fixtures,
    spills: c.spills,
    exterior,
    stories,
    center: toWorld(cx, cy, cz),
    radius,
    top: ridge + 0.9,
    loft: roof.loft?.index ?? -1,
    stage,
  };
}

// ─── Lighting ────────────────────────────────────────────────────────────────

export interface LightState {
  on: boolean;
  rgb: RGB;
  /** Brightness 0–1. */
  level: number;
}

/** Width of the tables the renderer reads, and their rows. */
export const TABLE_WIDTH = 256;
export const LIGHT_ROWS = 4;
export const ROOM_ROWS = 2;

/** How much daylight reaches a room with the roof on, compared to one that is open to the sky. */
const INDOORS = 0.2;
const WARM_WHITE: [number, number, number] = [1, 0.74, 0.5];

const linear = (rgb: RGB): [number, number, number] => [
  (rgb[0] / 255) ** 2.2,
  (rgb[1] / 255) ** 2.2,
  (rgb[2] / 255) ** 2.2,
];

/** How far each kind of fixture throws its light, and how: 1 a cone downward, 2 a shaded lamp, 3 a line. */
const KIND = {
  ceiling: { power: 3.4, shape: 1, cone: [0.1, 0.78], share: 1 },
  pendant: { power: 2.5, shape: 1, cone: [0.25, 0.9], share: 0.9 },
  lamp: { power: 1.7, shape: 2, cone: [0, 0], share: 0.75 },
  strip: { power: 0.9, shape: 3, cone: [0, 0], share: 0.35 },
} as const;

/** The light a room's lamps bounce around it: their mixed color, softened, and how much of it. */
export function roomGlow(
  lights: { kind: Fixture['kind']; state: LightState }[],
): { rgb: [number, number, number]; level: number } | null {
  let weight = 0;
  let level = 0;
  const sum = [0, 0, 0];
  for (const { kind, state } of lights) {
    if (!state.on) continue;
    // Accent strips color their own wall more than the whole room.
    const w = (0.15 + 0.85 * state.level) * KIND[kind].share;
    const rgb = linear(state.rgb);
    weight += w;
    level += w * 0.7;
    for (let i = 0; i < 3; i++) sum[i] += rgb[i] * w;
  }
  if (!weight) return null;
  // Walls bounce a softer version of colored light: keep the hue, lose some of the saturation.
  const rgb = sum.map((v, i) => (v / weight) * 0.7 + WARM_WHITE[i] * 0.3) as [number, number, number];
  return { rgb, level: Math.min(1, level) };
}

export interface Tables {
  lights: Float32Array;
  rooms: Float32Array;
}

/**
 * Fills the tables the renderer lights the house from. `states` gives each light's state by entity
 * id, `lamp` is how strongly lamps show against the daylight, and `open` is how far each story has
 * been opened to the sky (0–1).
 */
export function lightTables(
  model: Model,
  states: ReadonlyMap<string, LightState>,
  lamp: number,
  open: readonly number[],
  into?: Tables,
): Tables {
  const tables = into ?? {
    lights: new Float32Array(TABLE_WIDTH * LIGHT_ROWS * 4),
    rooms: new Float32Array(TABLE_WIDTH * ROOM_ROWS * 4),
  };
  const { lights, rooms } = tables;
  lights.fill(0);
  rooms.fill(0);
  const row = (r: number, col: number) => (r * TABLE_WIDTH + col) * 4;
  const off: LightState = { on: false, rgb: [255, 255, 255], level: 0 };
  const byRoom = new Map<string, { kind: Fixture['kind']; state: LightState }[]>();
  // Lamps glow whatever the hour; how much they light the room depends on the daylight.
  const glowScale = 2.6 * (0.5 + 0.5 * lamp);
  for (const f of model.fixtures) {
    const state = states.get(f.lightId) ?? off;
    if (!f.outdoor) {
      const list = byRoom.get(f.roomId) ?? [];
      list.push({ kind: f.kind, state });
      byRoom.set(f.roomId, list);
    }
    const spec = KIND[f.kind];
    const p = toWorld(f.at[0], f.at[1], f.at[2]);
    lights.set([p[0], p[1], p[2], f.reach], row(0, f.slot));
    // Outdoors there is no shade to speak of: lanterns shine all round.
    const shape = f.outdoor && spec.shape !== 3 ? 0 : spec.shape;
    lights[row(1, f.slot) + 3] = shape;
    if (shape === 3 && f.along) lights.set(toWorld(f.along[0], f.along[1], f.along[2]), row(2, f.slot));
    else lights.set(spec.cone, row(2, f.slot));
    if (!state.on) continue;
    const rgb = linear(state.rgb);
    const power = (0.15 + 0.85 * state.level) * spec.power * (f.outdoor ? 0.8 : 1) * lamp;
    lights.set([rgb[0] * power, rgb[1] * power, rgb[2] * power], row(1, f.slot));
    const glow = (0.35 + 0.65 * state.level) * glowScale;
    lights.set(
      rgb.map((v) => (v * 0.7 + 0.3) * glow),
      row(3, f.slot),
    );
  }
  const glows = new Map<string, { rgb: [number, number, number]; level: number }>();
  for (const [id, list] of byRoom) {
    const glow = roomGlow(list);
    if (glow) glows.set(id, glow);
  }
  for (const slot of model.rooms) {
    const at = row(0, slot.index);
    rooms[at] = slot.first;
    rooms[at + 1] = slot.count;
    rooms[at + 2] = slot.story < 0 ? 1 : INDOORS + (0.92 - INDOORS) * (open[slot.story] ?? 0);
    const glow = slot.id ? glows.get(slot.id) : undefined;
    if (glow) {
      // A small room is brighter for the same lamps.
      const k = glow.level * 0.11 * lamp * Math.min(1.6, Math.sqrt(16 / Math.max(6, slot.area)));
      rooms.set([glow.rgb[0] * k, glow.rgb[1] * k, glow.rgb[2] * k], row(1, slot.index));
    }
  }
  // Light from lit rooms falls through their windows onto whatever is outside.
  for (const spill of model.spills) {
    const glow = glows.get(spill.roomId);
    const p = toWorld(spill.at[0], spill.at[1], spill.at[2]);
    lights.set([p[0], p[1], p[2], 4.6], row(0, spill.slot));
    if (!glow) continue;
    const k = glow.level * 0.55 * lamp;
    lights.set([glow.rgb[0] * k, glow.rgb[1] * k, glow.rgb[2] * k, 0], row(1, spill.slot));
  }
  return tables;
}
