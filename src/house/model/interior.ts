// The inside of the house: floors and ceilings, the walls between rooms, the stairs, the furniture
// and a fixture for every light.

import type { RoomType } from '../../room-types.ts';
import { fixtureKind, PENDANT } from '../fixtures.ts';
import { furnish, type Spots } from '../furniture.ts';
import { PAINT, type PaintName } from '../materials.ts';
import type { Plane } from '../mesh.ts';
import type { PlanCell, PlanStory, Rect } from '../plan.ts';
import { Context, CUT_H, EXT_T, INT_T, WALL_H, type Point, type RoomInput } from './context.ts';
import { LINING, roofAt, under, WING_FLOOR, wingHeight } from './massing.ts';
import { wallRun, type Frame, type Opening } from './walls.ts';

const OPEN_PLAN: ReadonlySet<RoomType> = new Set(['living', 'dining', 'kitchen']);

const FLOOR: Partial<Record<RoomType, PaintName>> = {
  kitchen: 'tile',
  bathroom: 'tile',
  laundry: 'tile',
  garage: 'concrete',
  storage: 'concrete',
  basement: 'concrete',
  attic: 'lightOak',
  gym: 'slate',
  closet: 'lightOak',
  kids: 'carpet',
  media: 'carpetBlue',
  hallway: 'lightOak',
  stairs: 'lightOak',
  bedroom: 'lightOak',
  guest: 'lightOak',
  office: 'walnut',
};

/** Spreads n points over a room, away from the walls. */
function grid(rect: Rect, n: number): [number, number][] {
  const w = rect.x1 - rect.x0;
  const d = rect.y1 - rect.y0;
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / d)));
  const rows = Math.ceil(n / cols);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const col = i % cols;
    out.push([rect.x0 + (w * (col + 0.5)) / inRow, rect.y0 + (d * (row + 0.5)) / rows]);
  }
  return out;
}

/** A rectangle with a hole cut out of it, as up to four rectangles. */
function around(r: Rect, hole: Rect | null): Rect[] {
  if (!hole) return [r];
  const out: Rect[] = [];
  if (hole.y0 > r.y0) out.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: hole.y0 });
  if (hole.y1 < r.y1) out.push({ x0: r.x0, y0: hole.y1, x1: r.x1, y1: r.y1 });
  if (hole.x0 > r.x0) out.push({ x0: r.x0, y0: hole.y0, x1: hole.x0, y1: hole.y1 });
  if (hole.x1 < r.x1) out.push({ x0: hole.x1, y0: hole.y0, x1: r.x1, y1: hole.y1 });
  return out;
}

const STEPS = 12;
/** Under a roof, furniture stands where the ceiling is at least this high. */
const STAND = 1.05;

/** Where the flight of stairs runs in a stairs cell: it climbs toward the back wall. */
function flight(cell: PlanCell): Rect & { run: number } {
  const r = cell.rect;
  const run = Math.min(0.26, (r.y1 - r.y0 - EXT_T - 0.3) / STEPS);
  const y0 = r.y0 + EXT_T + 0.05;
  return { x0: r.x0 + EXT_T + 0.1, x1: r.x1 - 0.12, y0, y1: y0 + run * STEPS, run };
}

function stairs(c: Context, cell: PlanCell, story: PlanStory, up: boolean, room: number): void {
  const m = c.mesh;
  const f = flight(cell);
  const lower = c.groups.lower[story.index];
  const upper = c.groups.upper[story.index];
  const z = story.z;
  if (!up) {
    // The top of the stairs: a railing around the opening.
    m.with({ group: lower, room, ...PAINT.darkWood }, () => {
      m.box(f.x0 - 0.03, f.y1, z + 0.86, f.x1 + 0.03, f.y1 + 0.05, z + 0.92);
      m.box(f.x1, f.y0, z + 0.86, f.x1 + 0.05, f.y1 + 0.05, z + 0.92);
      for (let y = f.y0 + 0.1; y < f.y1; y += 0.42) m.box(f.x1 + 0.012, y, z, f.x1 + 0.038, y + 0.026, z + 0.86);
      for (let x = f.x0 + 0.1; x < f.x1; x += 0.42) m.box(x, f.y1 + 0.012, z, x + 0.026, f.y1 + 0.038, z + 0.86);
    });
    return;
  }
  const rise = c.plan.storyHeight / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const top = (i + 1) * rise;
    const group = top <= CUT_H + 0.4 ? lower : upper;
    const y1 = f.y1 - i * f.run;
    m.with({ group, room, ...PAINT.lightOak }, () => m.box(f.x0, y1 - f.run, z, f.x1, y1, z + top - 0.03, 1, true));
    m.with({ group, room, ...PAINT.wood }, () =>
      m.box(f.x0, y1 - f.run - 0.02, z + top - 0.03, f.x1, y1, z + top, 0, true),
    );
  }
  // A handrail up the open side.
  m.with({ group: lower, room, ...PAINT.darkWood }, () => {
    m.box(f.x1, f.y1 - 0.04, z, f.x1 + 0.04, f.y1, z + 1.0);
  });
}

/**
 * A lamp for every light in a room, placed by its furniture. `ceiling` gives the height of the
 * ceiling over a point: under a roof it slopes, and lamps keep to where there is room for them.
 */
function fixtures(
  c: Context,
  rect: Rect,
  z: number,
  ceiling: (x: number, y: number) => number,
  room: RoomInput,
  index: number,
  spots: Spots,
  group: number,
): void {
  const m = c.mesh;
  const first = c.slotCount;
  const kinds = room.lights.map((l) => fixtureKind(l.name));
  const w = rect.x1 - rect.x0;
  const d = rect.y1 - rect.y0;
  const headroom = (x: number, y: number) => ceiling(x, y) - z;
  // Where the ceiling is highest: lamps that find no room where they would stand move toward it.
  let highest = 0;
  const lattice: [number, number][] = [];
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      const at: [number, number] = [rect.x0 + w * (0.14 + 0.12 * i), rect.y0 + d * (0.14 + 0.12 * j)];
      lattice.push(at);
      highest = Math.max(highest, headroom(at[0], at[1]));
    }
  }
  const clear = (x: number, y: number, need: number): [number, number] => {
    if (headroom(x, y) >= Math.min(need, highest - 0.02)) return [x, y];
    const enough = lattice.filter((at) => headroom(at[0], at[1]) >= Math.min(need, highest - 0.02));
    return enough.reduce((best, at) =>
      Math.hypot(at[0] - x, at[1] - y) < Math.hypot(best[0] - x, best[1] - y) ? at : best,
    );
  };
  // A lamp from the furniture keeps its place if it fits there, shortened under a slope.
  const lampSpots = spots.lamps
    .filter(([x, y, h]) => headroom(x, y) > Math.min(h, 0.8) + 0.1)
    .map(([x, y, h]): [number, number, number] => [x, y, Math.min(h, headroom(x, y) - 0.1)]);
  // Lamps without a place of their own stand along the front of the room.
  const extraLamps = Math.max(0, kinds.filter((k) => k === 'lamp').length - lampSpots.length);
  for (let i = 0; i < extraLamps; i++) {
    const [x, y] = clear(rect.x0 + (w * (i + 0.5)) / extraLamps, rect.y1 - 0.5, 1.6);
    if (headroom(x, y) > 0.9) lampSpots.push([x, y, Math.min(1.5, headroom(x, y) - 0.1)]);
  }
  let pendants = 0;
  const onCeiling = kinds.filter(
    (k) => k === 'ceiling' || (k === 'pendant' && (!spots.pendant || pendants++ > 0)),
  ).length;
  const ceilingSpots = grid(
    { x0: rect.x0 + w * 0.2, y0: rect.y0 + d * 0.22, x1: rect.x1 - w * 0.2, y1: rect.y1 - d * 0.18 },
    Math.max(1, onCeiling),
  ).map(([x, y]) => clear(x, y, 2.3));
  let pendantUsed = false;
  let stripUsed = false;
  room.lights.forEach((light, i) => {
    const slot = c.slot();
    if (!slot) return;
    const kind = kinds[i];
    const add = (at: Point, reach: number, along?: Point) =>
      c.fixtures.push({ slot, roomId: room.id, lightId: light.id, kind, outdoor: false, at, along, reach });
    if (kind === 'strip') {
      const s = !stripUsed ? spots.strip : undefined;
      stripUsed = true;
      const from: Point = s ? [s.from[0], s.from[1], s.z] : [rect.x0 + 0.3, rect.y0 + 0.08, z + 0.1];
      const to: Point = s ? [s.to[0], s.to[1], s.z] : [rect.x1 - 0.3, rect.y0 + 0.08, z + 0.1];
      // Under a slope the strip runs lower, where the wall still stands.
      from[2] = to[2] = Math.max(
        z + 0.06,
        Math.min(from[2], ceiling(from[0], from[1]) - 0.08, ceiling(to[0], to[1]) - 0.08),
      );
      m.with({ group, room: index, emit: slot, ...PAINT.strip }, () =>
        m.box(
          Math.min(from[0], to[0]) - 0.012,
          Math.min(from[1], to[1]) - 0.012,
          from[2] - 0.012,
          Math.max(from[0], to[0]) + 0.012,
          Math.max(from[1], to[1]) + 0.012,
          from[2] + 0.012,
        ),
      );
      add([from[0], from[1] + 0.04, from[2]], 2.8, [to[0] - from[0], to[1] - from[1], 0]);
      return;
    }
    if (kind === 'lamp' && lampSpots.length) {
      // A floor or table lamp: a base, a stem and a shade with the bulb inside.
      const [x, y, h] = lampSpots.shift()!;
      const top = z + h;
      const small = h < 1.2;
      const r = small ? 0.13 : 0.19;
      const stand = small ? z + h - 0.48 : z;
      m.with({ group, room: index, ...PAINT.lampPost }, () => {
        m.cylinder(x, y, stand, stand + 0.025, small ? 0.08 : 0.14, small ? 0.07 : 0.13, 14);
        m.cylinder(x, y, stand + 0.025, top - 0.2, 0.012, 0.012, 6, 0);
      });
      m.with({ group, room: index, emit: slot, ...PAINT.shade }, () =>
        m.cylinder(x, y, top - (small ? 0.2 : 0.28), top, r, r * 0.72, 16, 0),
      );
      m.with({ group, room: index, emit: slot, ...PAINT.bulb }, () =>
        m.cylinder(x, y, top - 0.16, top - 0.08, 0.04, 0.04, 8, 3),
      );
      add([x, y, top - 0.14], 4.4);
      return;
    }
    let x: number;
    let y: number;
    let drop: number;
    const hung = kind === 'pendant' || PENDANT.test(light.name);
    if (kind === 'pendant' && spots.pendant && !pendantUsed) {
      pendantUsed = true;
      [x, y] = clear(spots.pendant[0], spots.pendant[1], 2);
      drop = 1.72;
    } else {
      [x, y] = ceilingSpots.shift() ?? clear((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, 2.3);
      drop = hung ? 1.75 : 2.36;
    }
    const above = ceiling(x, y);
    // Hung from the ceiling on a rod, so it reads as a ceiling light even with the ceiling lifted off.
    const top = Math.min(z + drop, above - 0.16);
    m.with({ group, room: index, ...PAINT.lampPost }, () => {
      m.cylinder(x, y, top, above, 0.01, 0.01, 6, 0);
      m.cylinder(x, y, above - 0.03, above, 0.06, 0.06, 10, 1);
    });
    if (hung) {
      // A pendant: a glass shade that glows, open underneath.
      m.with({ group, room: index, emit: slot, ...PAINT.shade }, () =>
        m.cylinder(x, y, top - 0.22, top + 0.02, 0.2, 0.06, 18, 0),
      );
      m.with({ group, room: index, emit: slot, ...PAINT.bulb }, () =>
        m.cylinder(x, y, top - 0.22, top - 0.21, 0.19, 0.19, 18, 3),
      );
      add([x, y, top - 0.26], 4.6);
    } else {
      // A drum shade: it glows from every side, so it reads as a light even from above.
      m.with({ group, room: index, emit: slot, ...PAINT.shade }, () =>
        m.cylinder(x, y, top - 0.14, top + 0.02, 0.23, 0.23, 20, 3),
      );
      add([x, y, top - 0.2], 6);
    }
  });
  c.claim(index, first);
}

/** The walls between rooms: full height with a doorway, cut low when the floor is opened. */
function partitions(c: Context, story: PlanStory): void {
  const plan = c.plan;
  const groups = { lower: c.groups.lower[story.index], upper: c.groups.upper[story.index] };
  const clip = (from: number, to: number, limit: number): [number, number] => [
    from < 0.01 ? EXT_T : from,
    to > limit - 0.01 ? limit - EXT_T : to,
  ];
  const wall = (f: Frame, length: number, ra: number, rc: number) => {
    const openings: Opening[] = [];
    if (length > 1.7) {
      const door = Math.min(length / 2, 1.1);
      openings.push({ a: door - 0.45, b: door + 0.45, z0: 0, z1: 2.05, kind: 'passage' });
    }
    wallRun(
      c,
      f,
      0,
      length,
      story.z,
      WALL_H,
      INT_T,
      openings,
      { outer: PAINT.plaster, outerRoom: rc, inner: PAINT.plaster, room: ra },
      groups,
      CUT_H,
    );
  };
  for (const a of story.cells) {
    for (const b of story.cells) {
      if (a === b || (OPEN_PLAN.has(a.type) && OPEN_PLAN.has(b.type))) continue;
      const ra = c.roomOf(a, story);
      const rb = c.roomOf(b, story);
      // A wall on a's far side: along x = a.x1 (b to the right) or y = a.y1 (b in front).
      if (Math.abs(a.rect.x1 - b.rect.x0) < 0.01) {
        const [y0, y1] = clip(Math.max(a.rect.y0, b.rect.y0), Math.min(a.rect.y1, b.rect.y1), plan.depth);
        if (y1 - y0 > 0.05) {
          wall({ ox: a.rect.x1 + INT_T / 2, oy: y0, ax: 0, ay: 1, nx: 1, ny: 0, length: y1 - y0 }, y1 - y0, ra, rb);
        }
      }
      if (Math.abs(a.rect.y1 - b.rect.y0) < 0.01) {
        const [x0, x1] = clip(Math.max(a.rect.x0, b.rect.x0), Math.min(a.rect.x1, b.rect.x1), plan.width);
        if (x1 - x0 > 0.05) {
          wall({ ox: x0, oy: a.rect.y1 + INT_T / 2, ax: 1, ay: 0, nx: 0, ny: 1, length: x1 - x0 }, x1 - x0, ra, rb);
        }
      }
    }
  }
}

/**
 * The ceiling of a room under the roof: it follows the slopes down to the low walls, and is flat
 * under the ridge. It is open where a dormer stands, and under a gable that faces the front.
 */
function lining(c: Context, story: PlanStory, cell: PlanCell): void {
  const m = c.mesh;
  const roof = c.roof;
  const r = cell.rect;
  const slopes = under(roof, LINING)![0];
  const flat: Plane = { n: [0, 0, 1], d: story.z + WALL_H };
  // A rectangle of the plan, lifted onto a slope.
  const on = (plane: Plane, x0: number, x1: number, y0: number, y1: number) => {
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return;
    const z = (x: number, y: number) => plane.d - plane.n[0] * x - plane.n[1] * y;
    m.quad(
      [x0, y0, z(x0, y0)],
      [x1, y0, z(x1, y0)],
      [x1, y1, z(x1, y1)],
      [x0, y1, z(x0, y1)],
      [-plane.n[0], -plane.n[1], -1],
    );
  };
  slopes.forEach((plane, i) => {
    // The first two slopes are the front and the back; a hipped roof has two more at its ends.
    const side = i === 0 ? 'front' : i === 1 ? 'back' : null;
    const holes: { a: number; b: number; y0: number; y1: number }[] = [];
    if (side) {
      const hole = (a: number, b: number, t0: number, t1: number) => {
        if (b <= r.x0 || a >= r.x1) return;
        const [y0, y1] = side === 'front' ? [roof.y1 - t1, roof.y1 - t0] : [roof.y0 + t0, roof.y0 + t1];
        holes.push({ a: Math.max(a, r.x0), b: Math.min(b, r.x1), y0, y1 });
      };
      for (const d of c.loftWindows.dormers) {
        if (d.side === side && d.kind !== 'skylight') hole(d.x - d.half, d.x + d.half, d.set, d.reach);
      }
      const cross = roof.cross;
      if (cross && side === 'front') hole(cross.at - cross.half, cross.at + cross.half, 0, roof.y1 - cross.dies);
    }
    holes.sort((p, q) => p.a - q.a);
    // Each slope's ceiling ends where another slope, or the flat part, comes lower.
    m.with({ clip: [[...slopes.filter((_, j) => j !== i), flat]] }, () => {
      let from = r.x0;
      for (const h of holes) {
        on(plane, from, h.a, r.y0, r.y1);
        on(plane, h.a, h.b, r.y0, Math.min(r.y1, h.y0));
        on(plane, h.a, h.b, Math.max(r.y0, h.y1), r.y1);
        from = Math.max(from, h.b);
      }
      on(plane, from, r.x1, r.y0, r.y1);
    });
  });
  m.with({ clip: [slopes] }, () =>
    m.quad([r.x0, r.y0, flat.d], [r.x1, r.y0, flat.d], [r.x1, r.y1, flat.d], [r.x0, r.y1, flat.d], [0, 0, -1]),
  );
}

function storyInterior(c: Context, story: PlanStory): void {
  const plan = c.plan;
  const m = c.mesh;
  const z = story.z;
  const lower = c.groups.lower[story.index];
  const above = plan.stories[story.index + 1];
  const below = plan.stories[story.index - 1];
  const ceilingGroup = above ? c.groups.lower[above.index] : c.groups.roof;
  // Under the roof, the ceiling slopes, and whatever stands under a slope is cut to fit.
  const loft = c.roof.loft === story;
  const ceiling = loft
    ? (x: number, y: number) => Math.min(z + WALL_H, roofAt(c.roof, x, y) - LINING)
    : () => z + WALL_H;
  const draw = () => {
    for (const cell of story.cells) {
      const r = cell.rect;
      const room = c.roomOf(cell, story);
      const isStairs = cell.type === 'stairs';
      // The stairwell is open where the flight from below arrives, and above the last flight.
      const well = isStairs ? flight(cell) : null;
      const floorHole = well && below && !above ? well : null;
      const ceilingHole = well && above && !plan.stories[above.index + 1] ? well : null;
      m.with({ group: lower, room, ...PAINT[FLOOR[cell.type] ?? 'oak'] }, () => {
        for (const part of around(r, floorHole)) {
          m.quad([part.x0, part.y0, z], [part.x1, part.y0, z], [part.x1, part.y1, z], [part.x0, part.y1, z], [0, 0, 1]);
        }
      });
      m.with({ group: ceilingGroup, room, ...PAINT.ceiling }, () => {
        if (loft) {
          lining(c, story, cell);
          return;
        }
        const h = z + WALL_H;
        for (const part of around(r, ceilingHole)) {
          m.quad(
            [part.x0, part.y0, h],
            [part.x1, part.y0, h],
            [part.x1, part.y1, h],
            [part.x0, part.y1, h],
            [0, 0, -1],
          );
        }
      });
      // Furniture keeps clear of the outside walls.
      const inner: Rect = {
        x0: r.x0 + (r.x0 < 0.01 ? EXT_T : INT_T / 2),
        y0: r.y0 + (r.y0 < 0.01 ? EXT_T : INT_T / 2),
        x1: r.x1 - (r.x1 > plan.width - 0.01 ? EXT_T : INT_T / 2),
        y1: r.y1 - (r.y1 > plan.depth - 0.01 ? EXT_T : INT_T / 2),
      };
      if (loft) {
        // And of the low space under the eaves, where nothing taller than a box would fit.
        const roof = c.roof;
        const low = (STAND + LINING - roof.knee) / roof.pitch;
        inner.y0 = Math.max(inner.y0, roof.y0 + low);
        inner.y1 = Math.min(inner.y1, roof.y1 - low);
        if (roof.form === 'hip') {
          const ends = (STAND + LINING - roof.knee) / roof.endPitch;
          inner.x0 = Math.max(inner.x0, roof.x0 + ends);
          inner.x1 = Math.min(inner.x1, roof.x1 - ends);
        }
      }
      const toward = Math.abs(r.y1 - plan.depth) < 0.01 ? 'front' : Math.abs(r.x1 - plan.width) < 0.01 ? 'right' : null;
      let spots: Spots = { lamps: [] };
      m.with({ group: lower, room }, () => {
        spots = furnish(m, cell.type, inner, z, toward);
      });
      if (isStairs) stairs(c, cell, story, Boolean(above), room);
      const input = cell.id ? c.input.rooms.get(cell.id) : undefined;
      if (input) fixtures(c, inner, z, ceiling, input, room, spots, lower);
    }
    partitions(c, story);
  };
  if (loft) m.with({ clip: under(c.roof, LINING + 0.006) }, draw);
  else draw();
}

function wingInterior(c: Context): void {
  const wing = c.plan.wing;
  const ground = c.ground;
  if (!wing || !ground) return;
  const m = c.mesh;
  const r = wing.rect;
  const room = c.roomOf(wing, ground);
  const lower = c.groups.lower[ground.index];
  const upper = c.groups.upper[ground.index];
  const z = WING_FLOOR;
  const top = z + wingHeight(c.plan);
  m.with({ group: lower, room, ...PAINT.concrete }, () =>
    m.quad([r.x0, r.y0, z], [r.x1, r.y0, z], [r.x1, r.y1, z], [r.x0, r.y1, z], [0, 0, 1]),
  );
  m.with({ group: upper, room, ...PAINT.ceiling }, () =>
    m.quad([r.x0, r.y0, top], [r.x1, r.y0, top], [r.x1, r.y1, top], [r.x0, r.y1, top], [0, 0, -1]),
  );
  const inner: Rect = { x0: r.x0 + EXT_T, y0: r.y0 + EXT_T, x1: r.x1, y1: r.y1 - EXT_T };
  let spots: Spots = { lamps: [] };
  m.with({ group: lower, room }, () => {
    spots = furnish(m, 'garage', inner, z, 'front');
  });
  const input = wing.id ? c.input.rooms.get(wing.id) : undefined;
  if (input) fixtures(c, inner, z, () => top, input, room, spots, lower);
}

export function buildInterior(c: Context): void {
  for (const story of c.plan.stories) storyInterior(c, story);
  wingInterior(c);
}
