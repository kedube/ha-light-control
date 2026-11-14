// The outside of the house: its walls story by story, the foundation, the garage built onto its
// side, and the roof and chimney on top.

import { MAT, PAINT } from '../materials.ts';
import { SKIP } from '../mesh.ts';
import { frontDoor, span, type PlanStory, type Side } from '../plan.ts';
import { Context, CUT_H, EXT_T, SILL_H, SLAB, WALL_H, type Point } from './context.ts';
import { under, WING_FLOOR, wingHeight, wingRoofAt } from './massing.ts';
import { buildRoof, chimney, type RoofSpan } from './roof.ts';
import {
  at,
  frameBox,
  frameOf,
  garageDoorUnit,
  SIDE,
  unit,
  wallRun,
  windowsAlong,
  windowUnit,
  type Frame,
  type Opening,
} from './walls.ts';

/** Every opening in the outside walls, so other parts of the model can find the windows. */
export interface Glazing {
  roomId: string | null;
  side: Side | 'wing';
  story: number;
  /** Middle of the stretch of wall, just outside it, at window height. */
  at: Point;
}

const SIDES: Side[] = ['front', 'right', 'back', 'left'];
const PLAIN = { shutters: null, arched: false, box: false };

/**
 * The outside walls of one story of the main house. A floor under the roof has walls too: low ones
 * under the eaves, and gable ends that the roof cuts to shape, with windows where it is high enough.
 */
function storyWalls(c: Context, story: PlanStory, glazing: Glazing[]): void {
  const plan = c.plan;
  const style = c.style;
  const roof = c.roof;
  const loft = roof.loft === story;
  const groups = { lower: c.groups.lower[story.index], upper: c.groups.upper[story.index] };
  const door = story.ground ? frontDoor(plan) : null;
  const wing = story.ground ? plan.wing : null;
  const above = !story.basement && !story.ground && story.z > plan.base;
  const cladding = story.basement ? style.foundation : above ? (style.upper ?? style.wall) : style.wall;
  // A basement's windows sit at the top of its walls, above the grass.
  const basement: [number, number] | null = story.basement ? [0.14 - story.z, plan.base - SLAB - 0.1 - story.z] : null;
  const windows = !story.basement || (basement !== null && basement[1] - basement[0] > 0.18 && basement[1] <= WALL_H);
  // Under the roof the walls are built to the ridge, and the roof cuts them off.
  const height = loft ? roof.ridge - story.z : WALL_H;
  const cross = loft ? roof.cross : null;
  const draw = () => {
    for (const side of SIDES) {
      const f = frameOf(plan, side);
      // A gable end is clad as gables are, from the floor under the roof up.
      const face = loft && roof.form === 'gable' && (side === 'left' || side === 'right') ? style.gable : cladding;
      // The slab's edge.
      c.mesh.with({ group: groups.lower, room: 0, ...face }, () =>
        c.mesh.quad(
          at(f, 0, 0, story.z - SLAB),
          at(f, f.length, 0, story.z - SLAB),
          at(f, f.length, 0, story.z),
          at(f, 0, 0, story.z),
          [f.nx, f.ny, 0],
        ),
      );
      for (const cell of story.cells) {
        const range = span(cell, plan, side);
        if (!range) continue;
        const room = c.roomOf(cell, story);
        // Modern houses clad the wall round the front door in a second material.
        const marked = story.ground && style.accent && door?.cell === cell && side === 'front';
        const paint = { outer: marked ? style.accent! : face, outerRoom: 0, inner: PAINT.plaster, room };
        // Where the garage is built on, this wall is an inside wall with a door through it.
        const attached = side === 'left' && wing ? ([wing.rect.y0, wing.rect.y1] as [number, number]) : null;
        // Under a gable that faces the front, the wall carries on up to its peak.
        const gabled =
          cross && side === 'front'
            ? ([Math.max(range[0], cross.at - cross.half), Math.min(range[1], cross.at + cross.half)] as const)
            : null;
        const parts: { a: number; b: number; inside: boolean; low?: boolean }[] = [];
        if (attached && range[1] > attached[0] && range[0] < attached[1]) {
          const a = Math.max(range[0], attached[0]);
          const b = Math.min(range[1], attached[1]);
          if (a > range[0]) parts.push({ a: range[0], b: a, inside: false });
          parts.push({ a, b, inside: true });
          if (b < range[1]) parts.push({ a: b, b: range[1], inside: false });
        } else if (gabled && gabled[1] - gabled[0] > 0.01) {
          if (gabled[0] > range[0]) parts.push({ a: range[0], b: gabled[0], inside: false });
          parts.push({ a: gabled[0], b: gabled[1], inside: false, low: true });
          if (gabled[1] < range[1]) parts.push({ a: gabled[1], b: range[1], inside: false });
        } else parts.push({ a: range[0], b: range[1], inside: false });

        for (const part of parts) {
          const openings: Opening[] = [];
          if (part.inside) {
            const y = Math.min(part.b - 1.3, Math.max(part.a + 0.4, wing!.rect.y0 + 1.1));
            if (part.b - part.a > 1.7 && y > part.a + 0.3) {
              openings.push({ a: y, b: y + 0.9, z0: 0, z1: 2.05, kind: 'passage' });
            }
          } else if (loft) {
            // Windows in a gable end, where the roof clears them. The eaves have dormers instead.
            for (const w of c.loftWindows.walls) {
              if (w.side === side && w.cell === cell && side !== 'front') {
                openings.push({ a: w.a, b: w.b, z0: w.z0, z1: w.z1, kind: 'window' });
              }
            }
          } else {
            const avoid: [number, number][] = [];
            if (door && side === 'front' && door.x > part.a && door.x < part.b) {
              openings.push({ a: door.x - 0.5, b: door.x + 0.5, z0: 0, z1: 2.12, kind: 'door' });
              avoid.push([door.x - 0.62, door.x + 0.62]);
            }
            if (windows) {
              openings.push(
                ...windowsAlong(part.a + EXT_T + 0.1, part.b - EXT_T - 0.1, cell.type, style.window, avoid, basement),
              );
            }
            // An upper window that the garage's roof would stand in front of is left out.
            if (side === 'left' && plan.wing && !story.ground && !story.basement) {
              const hidden = (o: Opening) =>
                o.kind === 'window' &&
                Math.max(...[o.a, (o.a + o.b) / 2, o.b].map((y) => wingRoofAt(plan, style, roof.pitch, y))) >
                  story.z + o.z0 - 0.35;
              for (let i = openings.length - 1; i >= 0; i--) if (hidden(openings[i])) openings.splice(i, 1);
            }
          }
          const garageRoom = part.inside && wing ? c.roomIndex(wing.id ?? '') : undefined;
          wallRun(
            c,
            f,
            part.a,
            part.b,
            story.z,
            part.low ? roof.knee : height,
            EXT_T,
            openings,
            part.inside ? { outer: PAINT.plaster, outerRoom: garageRoom ?? 0, inner: PAINT.plaster, room } : paint,
            groups,
            part.inside ? CUT_H : SILL_H,
            part.inside ? 0 : SIDE[side],
          );
          const front = side === 'front' && !story.basement && !loft;
          const dress = {
            shutters: front ? style.shutters : null,
            arched: Boolean(style.window.arched) && story.ground && (side === 'front' || side === 'right'),
            box: Boolean(style.window.boxes) && front,
          };
          c.mesh.with({ side: SIDE[side] }, () => {
            for (const o of openings) unit(c, f, o, story.z, room, groups.upper, dress);
          });
          let lit = !part.inside && openings.some((o) => o.kind !== 'passage');
          if (part.low && cross) {
            // The gable itself, standing on the low wall, with its window.
            const base = story.z + roof.knee;
            const high: Opening[] = c.loftWindows.walls
              .filter((w) => w.side === 'front' && w.cell === cell)
              .map((w) => ({ a: w.a, b: w.b, z0: w.z0 - roof.knee, z1: w.z1 - roof.knee, kind: 'window' }));
            wallRun(
              c,
              f,
              part.a,
              part.b,
              base,
              cross.peak - base + 0.05,
              EXT_T,
              high,
              { ...paint, outer: style.gable },
              groups,
              0,
              SIDE[side],
            );
            c.mesh.with({ side: SIDE[side] }, () => {
              for (const o of high) unit(c, f, o, base, room, groups.upper, PLAIN);
            });
            lit ||= high.length > 0;
          }
          if (lit) {
            const mid = (part.a + part.b) / 2;
            glazing.push({ roomId: cell.id, side, story: story.index, at: at(f, mid, -0.9, story.z + 1) });
          }
        }
      }
      // Corner boards on a house clad in wood, cut with the wall they are on.
      const wooden: number[] = [MAT.siding, MAT.shake, MAT.battens];
      if (!story.basement && wooden.includes(face.material)) {
        const w = 0.11;
        const board = (u0: number, u1: number) => {
          c.mesh.with({ group: groups.lower, room: 0, material: MAT.plain, color: style.trim }, () =>
            frameBox(c, f, u0, u1, -0.018, 0.01, story.z - SLAB, story.z + SILL_H),
          );
          c.mesh.with({ group: groups.upper, side: SIDE[side], room: 0, material: MAT.plain, color: style.trim }, () =>
            frameBox(c, f, u0, u1, -0.018, 0.01, story.z + SILL_H, story.z + height),
          );
        };
        board(-0.018, w);
        board(f.length - w, f.length + 0.018);
      }
    }
  };
  if (!loft) {
    draw();
    return;
  }
  c.mesh.with({ clip: under(roof, 0.012) }, draw);
  // The light of its rooms falls out through the dormers too.
  const seen = new Set<string>();
  for (const dormer of c.loftWindows.dormers) {
    const f = frameOf(plan, dormer.side);
    const glass = dormer.kind === 'skylight';
    for (const w of dormer.windows) {
      const key = `${dormer.side}:${w.cell.id}`;
      if (!w.cell.id || seen.has(key)) continue;
      seen.add(key);
      // Just above a skylight, or just in front of a dormer's face.
      const inward = glass ? (dormer.set + dormer.reach) / 2 : dormer.set - 0.7;
      const z = glass ? roof.top + inward * dormer.pitch + 0.6 : story.z + dormer.sill + 0.4;
      glazing.push({ roomId: w.cell.id, side: dormer.side, story: story.index, at: at(f, w.x, inward, z) });
    }
  }
}

/** The foundation of a house without a basement: a low concrete wall the house sits on. */
function foundation(c: Context): void {
  const plan = c.plan;
  const ground = c.ground;
  if (!ground || c.basement) return;
  const group = c.groups.lower[ground.index];
  c.mesh.with({ group, room: 0, ...c.style.foundation }, () => {
    c.mesh.box(-0.02, -0.02, -0.3, plan.width + 0.02, plan.depth + 0.02, plan.base - SLAB, SKIP.bottom);
  });
}

/** The garage wing: three walls of its own, a door for the car and a lower roof. */
function wingWalls(c: Context, glazing: Glazing[]): void {
  const plan = c.plan;
  const wing = plan.wing;
  const ground = c.ground;
  if (!wing || !ground) return;
  const r = wing.rect;
  const floor = WING_FLOOR;
  const room = c.roomOf(wing, ground);
  const groups = { lower: c.groups.lower[ground.index], upper: c.groups.upper[ground.index] };
  const height = wingHeight(plan);
  const paint = { outer: c.style.accent ?? c.style.wall, outerRoom: 0, inner: PAINT.plaster, room };
  const width = r.x1 - r.x0;
  const depth = r.y1 - r.y0;
  const front: Frame = { ox: r.x0, oy: r.y1, ax: 1, ay: 0, nx: 0, ny: 1, length: width };
  const back: Frame = { ox: r.x0, oy: r.y0, ax: 1, ay: 0, nx: 0, ny: -1, length: width };
  const left: Frame = { ox: r.x0, oy: r.y0, ax: 0, ay: 1, nx: -1, ny: 0, length: depth };
  const mid = width / 2;
  const half = Math.min(1.3, width / 2 - 0.45);
  const door: Opening = { a: mid - half, b: mid + half, z0: 0, z1: 2.15, kind: 'garage' };
  wallRun(c, front, 0, width, floor, height, EXT_T, [door], paint, groups, SILL_H, SIDE.front);
  c.mesh.with({ side: SIDE.front }, () => garageDoorUnit(c, front, door, floor, room, groups.upper));
  const sideWindows = windowsAlong(0.6, depth - 0.6, 'garage', c.style.window);
  wallRun(c, left, 0, depth, floor, height, EXT_T, sideWindows, paint, groups, SILL_H, SIDE.left);
  c.mesh.with({ side: SIDE.left }, () => {
    for (const o of sideWindows)
      windowUnit(c, left, o, floor, room, groups.upper, { shutters: null, arched: false, box: false });
  });
  wallRun(c, back, 0, width, floor, height, EXT_T, [], paint, groups, SILL_H, SIDE.back);
  // A concrete footing all round, and the slab the car stands on.
  c.mesh.with({ group: c.groups.base, room: 0, ...c.style.foundation }, () => {
    c.mesh.box(r.x0 - 0.02, r.y0 - 0.02, -0.2, r.x1, r.y1 + 0.02, floor, SKIP.bottom);
  });
  glazing.push({ roomId: wing.id, side: 'wing', story: ground.index, at: [(r.x0 + r.x1) / 2, r.y1 + 1, floor + 1] });
  buildRoof(c, {
    x0: r.x0,
    x1: r.x1,
    y0: r.y0,
    y1: r.y1,
    top: floor + height,
    pitch: c.roof.pitch,
    group: groups.upper,
    ends: { left: true, right: false },
    main: false,
  });
}

/** Builds the outside of the house. Returns where its windows are, for the light they let out. */
export function buildShell(c: Context): Glazing[] {
  const plan = c.plan;
  const style = c.style;
  const glazing: Glazing[] = [];
  if (!plan.stories.length) return glazing;
  // The garage's row in the room table has to exist before the wall it shares with the house.
  if (plan.wing && c.ground) c.roomOf(plan.wing, c.ground);
  for (const story of plan.stories) storyWalls(c, story, glazing);
  foundation(c);
  wingWalls(c, glazing);
  const top = c.top;
  if (top) {
    const roof = c.roof;
    const main: RoofSpan = {
      x0: roof.x0,
      x1: roof.x1,
      y0: roof.y0,
      y1: roof.y1,
      top: roof.top,
      pitch: roof.pitch,
      group: c.groups.roof,
      ends: { left: true, right: true },
      main: true,
    };
    const ridge = buildRoof(c, main);
    if (!roof.loft) {
      // The band of wall behind the eaves, from the last ceiling up to the roof.
      const band = top.z > plan.base ? (style.upper ?? style.wall) : style.wall;
      for (const side of SIDES) {
        const f = frameOf(plan, side);
        c.mesh.with({ group: c.groups.roof, room: 0, ...band }, () =>
          c.mesh.quad(
            at(f, 0, 0, top.z + WALL_H),
            at(f, f.length, 0, top.z + WALL_H),
            at(f, f.length, 0, roof.top),
            at(f, 0, 0, roof.top),
            [f.nx, f.ny, 0],
          ),
        );
      }
    }
    chimney(c, main, ridge);
  }
  return glazing;
}
