// Walls with real openings, and what is set into them: windows with their casings, sills and
// glazing bars, the front door, and the door of the garage.

import type { RGB } from '../../color.ts';
import type { RoomType } from '../../room-types.ts';
import { seeded } from '../math.ts';
import { MAT, PAINT, type WindowStyle } from '../materials.ts';
import type { Paint } from '../mesh.ts';
import type { HousePlan, Side } from '../plan.ts';
import { EXT_T, type Context, type Point } from './context.ts';

/**
 * A wall seen from outside. `u` runs along it, `t` goes in through its thickness and z is up.
 * All walls are parallel to the plan's axes.
 */
export interface Frame {
  ox: number;
  oy: number;
  ax: number;
  ay: number;
  nx: number;
  ny: number;
  length: number;
}

export const at = (f: Frame, u: number, t: number, z: number): Point => [
  f.ox + f.ax * u - f.nx * t,
  f.oy + f.ay * u - f.ny * t,
  z,
];

export function frameOf(plan: HousePlan, side: Side): Frame {
  const W = plan.width;
  const D = plan.depth;
  switch (side) {
    case 'front':
      return { ox: 0, oy: D, ax: 1, ay: 0, nx: 0, ny: 1, length: W };
    case 'right':
      return { ox: W, oy: 0, ax: 0, ay: 1, nx: 1, ny: 0, length: D };
    case 'back':
      return { ox: 0, oy: 0, ax: 1, ay: 0, nx: 0, ny: -1, length: W };
    default:
      return { ox: 0, oy: 0, ax: 0, ay: 1, nx: -1, ny: 0, length: D };
  }
}

export interface Opening {
  a: number;
  b: number;
  /** Heights above the floor. */
  z0: number;
  z1: number;
  kind: 'window' | 'door' | 'garage' | 'passage';
}

/** The size of a room's windows: big in the living room, small and high in a bathroom, and to the style's taste. */
function windowSize(type: RoomType, style: WindowStyle): { w: number; z0: number; z1: number } | null {
  const size = (w: number, z0: number, z1: number, main = true) => {
    if (!main) return { w, z0, z1 };
    // The style stretches the main windows; their heads stay in line.
    const tall = (z1 - z0) * style.scale[1];
    return { w: w * style.scale[0], z0: style.low ? 0.22 : Math.max(0.3, z1 - tall), z1: style.low ? 2.42 : z1 };
  };
  switch (type) {
    case 'living':
    case 'dining':
      return size(1.5, 0.6, 2.3);
    case 'kitchen':
      return size(1.15, 1.08, 2.25, false);
    case 'bathroom':
    case 'laundry':
    case 'storage':
      return size(0.62, 1.35, 2.15, false);
    case 'garage':
      return size(0.85, 1.15, 2.05, false);
    case 'closet':
      return null;
    case 'stairs':
      return size(0.8, 1.1, 2.25, false);
    default:
      return size(0.98, 0.88, 2.3);
  }
}

/** Windows spread evenly along a stretch of wall, keeping clear of doors. */
export function windowsAlong(
  from: number,
  to: number,
  type: RoomType,
  style: WindowStyle,
  avoid: [number, number][] = [],
  basement: [number, number] | null = null,
): Opening[] {
  const size = basement ? { w: 0.8, z0: basement[0], z1: basement[1] } : windowSize(type, style);
  if (!size) return [];
  const length = to - from;
  let w = size.w;
  if (length < w + 0.7) w = Math.min(w, length - 0.7);
  if (w < 0.45) return [];
  const count = Math.max(1, Math.floor((length - 0.5) / (w + (basement ? 1.8 : 1.25))));
  const out: Opening[] = [];
  for (let i = 0; i < count; i++) {
    const c = from + (length * (i + 0.5)) / count;
    const a = c - w / 2;
    const b = c + w / 2;
    if (avoid.some(([l, r]) => b > l - 0.3 && a < r + 0.3)) continue;
    out.push({ a, b, z0: size.z0, z1: size.z1, kind: 'window' });
  }
  return out;
}

interface WallPaint {
  outer: Paint;
  /** The room (table row) the outer face is lit as: 0 outdoors. */
  outerRoom: number;
  inner: Paint;
  room: number;
}

/** One solid piece of wall: both faces, its top and, beside an opening, its ends. */
function wallPiece(
  c: Context,
  f: Frame,
  u0: number,
  u1: number,
  z0: number,
  z1: number,
  thick: number,
  paint: WallPaint,
  group: number,
): void {
  if (u1 - u0 < 0.004 || z1 - z0 < 0.004) return;
  const n: Point = [f.nx, f.ny, 0];
  const back: Point = [-f.nx, -f.ny, 0];
  const cut = { group, room: paint.room, ...PAINT.cut };
  // Ends sit a hair inside, so they never fight with the face of the wall around the corner.
  const e = 0.003;
  // Given as a solid, so a wall that the roof cuts off is closed again along the slope.
  c.mesh.solid(
    [
      {
        points: [at(f, u0, 0, z0), at(f, u1, 0, z0), at(f, u1, 0, z1), at(f, u0, 0, z1)],
        normal: n,
        paint: { group, room: paint.outerRoom, ...paint.outer },
      },
      {
        points: [at(f, u0, thick, z0), at(f, u1, thick, z0), at(f, u1, thick, z1), at(f, u0, thick, z1)],
        normal: back,
        paint: { group, room: paint.room, ...paint.inner },
      },
      {
        points: [at(f, u0, 0, z1), at(f, u1, 0, z1), at(f, u1, thick, z1), at(f, u0, thick, z1)],
        normal: [0, 0, 1],
        paint: cut,
      },
      {
        points: [at(f, u0 + e, 0, z0), at(f, u0 + e, thick, z0), at(f, u0 + e, thick, z1), at(f, u0 + e, 0, z1)],
        normal: [-f.ax, -f.ay, 0],
        paint: cut,
      },
      {
        points: [at(f, u1 - e, 0, z0), at(f, u1 - e, thick, z0), at(f, u1 - e, thick, z1), at(f, u1 - e, 0, z1)],
        normal: [f.ax, f.ay, 0],
        paint: cut,
      },
      {
        points: [at(f, u0, 0, z0), at(f, u1, 0, z0), at(f, u1, thick, z0), at(f, u0, thick, z0)],
        normal: [0, 0, -1],
        skip: true,
      },
    ],
    cut,
  );
}

/**
 * A stretch of wall with holes for its openings. `cut` is the height above the floor where the
 * wall is sliced when its story is opened: what is below stays, what is above lifts away. For an
 * outside wall, `side` says which side of the house it is on (1 front, 2 right, 3 back, 4 left):
 * then only the walls between the viewer and the rooms lift away.
 */
export function wallRun(
  c: Context,
  f: Frame,
  u0: number,
  u1: number,
  floor: number,
  height: number,
  thick: number,
  openings: Opening[],
  paint: WallPaint,
  groups: { lower: number; upper: number },
  cut: number | null,
  side = 0,
): void {
  const above = (a: number, b: number, h0: number, h1: number) =>
    c.mesh.with({ side }, () => wallPiece(c, f, a, b, floor + h0, floor + h1, thick, paint, groups.upper));
  const piece = (a: number, b: number, h0: number, h1: number) => {
    if (b - a < 0.004 || h1 - h0 < 0.004) return;
    if (cut === null || h1 <= cut + 1e-6) wallPiece(c, f, a, b, floor + h0, floor + h1, thick, paint, groups.lower);
    else if (h0 >= cut - 1e-6) above(a, b, h0, h1);
    else {
      wallPiece(c, f, a, b, floor + h0, floor + cut, thick, paint, groups.lower);
      above(a, b, cut, h1);
    }
  };
  let from = u0;
  for (const o of [...openings].sort((p, q) => p.a - q.a)) {
    piece(from, o.a, 0, height);
    piece(o.a, o.b, 0, o.z0);
    piece(o.a, o.b, o.z1, height);
    from = o.b;
  }
  piece(from, u1, 0, height);
}

/** The number the mesh knows each side of the house by. */
export const SIDE: Record<Side, number> = { front: 1, right: 2, back: 3, left: 4 };

/** A box given along a wall: u along it, t out of it (negative is outside the wall's face). */
export function frameBox(
  c: Context,
  f: Frame,
  u0: number,
  u1: number,
  t0: number,
  t1: number,
  z0: number,
  z1: number,
): void {
  const p = at(f, u0, t0, z0);
  const q = at(f, u1, t1, z1);
  c.mesh.box(p[0], p[1], p[2], q[0], q[1], q[2]);
}

/** A round head over a window or a door: glass (or the door's own wood) in a curved frame, set on the wall. */
function roundHead(c: Context, f: Frame, a: number, b: number, z: number, fill: Paint, group: number): void {
  const m = c.mesh;
  const mid = (a + b) / 2;
  const r = (b - a) / 2;
  const fan = (radius: number, t: number): Point[] => {
    const points: Point[] = [];
    for (let i = 0; i <= 12; i++) {
      const angle = (i / 12) * Math.PI;
      points.push(at(f, mid + Math.cos(angle) * radius, t, z + Math.sin(angle) * radius));
    }
    return points;
  };
  m.with({ group, room: 0, material: MAT.plain, color: c.style.trim }, () =>
    m.poly(fan(r + 0.09, -0.012), [f.nx, f.ny, 0]),
  );
  m.with({ group, room: 0, ...fill }, () => m.poly(fan(r, -0.02), [f.nx, f.ny, 0]));
  m.with({ group, room: 0, material: MAT.plain, color: c.style.window.frame }, () => {
    frameBox(c, f, mid - 0.018, mid + 0.018, -0.03, -0.02, z, z + r);
  });
}

/** A window set into its opening: casing, sill, sashes with glazing bars, and the glass. */
export function windowUnit(
  c: Context,
  f: Frame,
  o: Opening,
  floor: number,
  room: number,
  group: number,
  dress: { shutters: RGB | null; arched: boolean; box: boolean },
): void {
  const m = c.mesh;
  const style = c.style.window;
  const trim: Paint = { material: MAT.plain, color: c.style.trim };
  const frame: Paint = { material: MAT.plain, color: style.frame };
  const z0 = floor + o.z0;
  const z1 = floor + o.z1;
  const tall = o.z1 - o.z0 > 1;
  const plain = c.style.trim === style.frame || !style.low;
  m.with({ group, room: 0, ...(plain ? trim : frame) }, () => {
    // Casing around the opening, and a sill that sheds the rain.
    const casing = style.low ? 0.05 : 0.09;
    frameBox(c, f, o.a - casing, o.a, -0.025, 0.04, z0, z1);
    frameBox(c, f, o.b, o.b + casing, -0.025, 0.04, z0, z1);
    frameBox(c, f, o.a - casing - 0.03, o.b + casing + 0.03, -0.035, 0.04, z1, z1 + (style.low ? 0.06 : 0.11));
    frameBox(c, f, o.a - casing - 0.03, o.b + casing + 0.03, -0.07, 0.1, z0 - 0.055, z0);
  });
  m.with({ group, room: 0, ...frame }, () => {
    // The sash: a frame, a meeting rail, and glazing bars.
    const bar = 0.045;
    const d0 = 0.075;
    const d1 = 0.12;
    frameBox(c, f, o.a, o.a + bar, d0, d1, z0, z1);
    frameBox(c, f, o.b - bar, o.b, d0, d1, z0, z1);
    frameBox(c, f, o.a, o.b, d0, d1, z0, z0 + bar);
    frameBox(c, f, o.a, o.b, d0, d1, z1 - bar, z1);
    const [across, down] = style.panes;
    const sashes = tall && !style.low ? 2 : 1;
    const middle = (z0 + z1) / 2;
    if (sashes === 2) frameBox(c, f, o.a, o.b, d0 - 0.01, d1, middle - bar / 2, middle + bar / 2);
    const thin = 0.022;
    // Big modern panes are divided only where they are too wide for one sheet of glass.
    const columns =
      across === 1 ? Math.max(1, Math.round((o.b - o.a) / 1.1)) : Math.max(across, Math.round((o.b - o.a) / 0.5));
    const bars0 = style.topOnly && sashes === 2 ? middle : z0;
    for (let i = 1; i < columns; i++) {
      const u = o.a + ((o.b - o.a) * i) / columns;
      frameBox(c, f, u - thin / 2, u + thin / 2, d0 + 0.01, d1 - 0.01, bars0, z1);
    }
    for (let sash = 0; sash < sashes; sash++) {
      if (style.topOnly && sashes === 2 && sash === 0) continue;
      const s0 = sashes === 2 ? (sash ? middle : z0) : z0;
      const s1 = sashes === 2 ? (sash ? z1 : middle) : z1;
      for (let j = 1; j < down; j++) {
        const z = s0 + ((s1 - s0) * j) / down;
        frameBox(c, f, o.a, o.b, d0 + 0.01, d1 - 0.01, z - thin / 2, z + thin / 2);
      }
    }
  });
  // Inside: a stool under the window, lit by the room.
  m.with({ group, room, ...PAINT.baseboard }, () => {
    frameBox(c, f, o.a - 0.02, o.b + 0.02, EXT_T - 0.03, EXT_T + 0.045, z0 - 0.035, z0);
  });
  if (dress.shutters && tall && !style.low) {
    m.with({ group, room: 0, material: MAT.siding, color: dress.shutters }, () => {
      const w = Math.min(0.36, (o.b - o.a) / 2);
      frameBox(c, f, o.a - 0.1 - w, o.a - 0.1, -0.04, 0, z0, z1);
      frameBox(c, f, o.b + 0.1, o.b + 0.1 + w, -0.04, 0, z0, z1);
    });
  }
  if (dress.arched && tall) roundHead(c, f, o.a, o.b, z1 + 0.02, { material: MAT.gloss, color: [44, 52, 62] }, group);
  if (dress.box && tall) {
    // A box of flowers under the sill.
    m.with({ group, room: 0, ...PAINT.darkWood }, () =>
      frameBox(c, f, o.a - 0.04, o.b + 0.04, -0.24, -0.02, z0 - 0.28, z0 - 0.07),
    );
    const rand = seeded(Math.round((o.a * 7 + z0 * 13 + f.ox * 3 + f.oy * 5) * 100));
    for (let u = o.a + 0.1; u < o.b - 0.02; u += 0.2) {
      const p = at(f, u, -0.13, z0 - 0.02);
      m.with({ group, room: 0, ...(rand() > 0.5 ? PAINT.flowers : PAINT.roses) }, () =>
        m.blob(p[0], p[1], p[2], 0.13, 0.13, 0.11, rand, 0.15, 1),
      );
    }
  }
  m.with({ group, room, blend: true, ...PAINT.white, material: MAT.glass }, () => {
    m.quad(at(f, o.a, 0.097, z0), at(f, o.b, 0.097, z0), at(f, o.b, 0.097, z1), at(f, o.a, 0.097, z1), [f.nx, f.ny, 0]);
  });
}

/** The front door: a paneled leaf with a small light, in a cased frame. */
function doorUnit(c: Context, f: Frame, o: Opening, floor: number, room: number, group: number): void {
  const m = c.mesh;
  const style = c.style;
  const trim: Paint = { material: MAT.plain, color: style.trim };
  const z1 = floor + o.z1;
  const modern = style.window.low;
  m.with({ group, room: 0, ...trim }, () => {
    frameBox(c, f, o.a - 0.11, o.a, -0.03, 0.05, floor, z1);
    frameBox(c, f, o.b, o.b + 0.11, -0.03, 0.05, floor, z1);
    if (style.archedDoor) return;
    frameBox(c, f, o.a - 0.16, o.b + 0.16, -0.045, 0.05, z1, z1 + (modern ? 0.08 : 0.17));
    if (!modern) frameBox(c, f, o.a - 0.2, o.b + 0.2, -0.06, 0.03, z1 + 0.17, z1 + 0.21);
  });
  const leaf: Paint = { material: modern || style.archedDoor ? MAT.wood : MAT.gloss, color: style.door };
  m.with({ group, room: 0, ...leaf }, () => {
    frameBox(c, f, o.a, o.b, 0.07, 0.115, floor + 0.01, z1);
    if (modern) return;
    // Raised panels.
    const w = o.b - o.a;
    for (const [u0, u1, h0, h1] of [
      [0.12, 0.44, 0.14, 0.42],
      [0.56, 0.88, 0.14, 0.42],
      [0.12, 0.44, 0.48, 0.66],
      [0.56, 0.88, 0.48, 0.66],
    ]) {
      frameBox(c, f, o.a + w * u0, o.a + w * u1, 0.055, 0.07, floor + o.z1 * h0, floor + o.z1 * h1);
    }
  });
  m.with({ group, room: 0, ...PAINT.chrome }, () => {
    if (modern) frameBox(c, f, o.b - 0.14, o.b - 0.1, 0.01, 0.07, floor + 0.8, floor + 1.5);
    else frameBox(c, f, o.b - 0.16, o.b - 0.1, 0.02, 0.07, floor + 0.98, floor + 1.08);
  });
  if (style.archedDoor) roundHead(c, f, o.a, o.b, z1, leaf, group);
  m.with({ group, room, blend: true, ...PAINT.white, material: MAT.glass }, () => {
    const w = o.b - o.a;
    // A light in the door: a slot down a modern one, a pane across the top of a paneled one.
    const [u0, u1, h0, h1] = modern ? [0.16, 0.32, 0.12, 0.9] : [0.14, 0.86, 0.73, 0.92];
    m.quad(
      at(f, o.a + w * u0, 0.05, floor + o.z1 * h0),
      at(f, o.a + w * u1, 0.05, floor + o.z1 * h0),
      at(f, o.a + w * u1, 0.05, floor + o.z1 * h1),
      at(f, o.a + w * u0, 0.05, floor + o.z1 * h1),
      [f.nx, f.ny, 0],
    );
  });
}

/** A sectional garage door: four panels, the top one glazed. */
export function garageDoorUnit(c: Context, f: Frame, o: Opening, floor: number, room: number, group: number): void {
  const m = c.mesh;
  const trim: Paint = { material: MAT.plain, color: c.style.trim };
  const z1 = floor + o.z1;
  m.with({ group, room: 0, ...trim }, () => {
    frameBox(c, f, o.a - 0.12, o.a, -0.03, 0.06, floor, z1);
    frameBox(c, f, o.b, o.b + 0.12, -0.03, 0.06, floor, z1);
    frameBox(c, f, o.a - 0.16, o.b + 0.16, -0.04, 0.06, z1, z1 + 0.16);
  });
  const panels = 4;
  const h = (o.z1 - 0.02) / panels;
  m.with({ group, room: 0, material: MAT.gloss, color: c.style.garageDoor }, () => {
    for (let i = 0; i < panels; i++) {
      const p0 = floor + 0.02 + i * h + 0.012;
      const p1 = floor + 0.02 + (i + 1) * h - 0.012;
      frameBox(c, f, o.a, o.b, 0.07, 0.11, p0, p1);
      // Recessed fields across each panel.
      const fields = 4;
      const w = (o.b - o.a) / fields;
      if (i < panels - 1) {
        for (let j = 0; j < fields; j++) {
          frameBox(c, f, o.a + j * w + 0.07, o.a + (j + 1) * w - 0.07, 0.055, 0.07, p0 + 0.08, p1 - 0.08);
        }
      }
    }
  });
  m.with({ group, room, blend: true, ...PAINT.white, material: MAT.glass }, () => {
    const fields = 4;
    const w = (o.b - o.a) / fields;
    const p0 = floor + 0.02 + (panels - 1) * h + 0.1;
    const p1 = floor + 0.02 + panels * h - 0.1;
    for (let j = 0; j < fields; j++) {
      m.quad(
        at(f, o.a + j * w + 0.1, 0.06, p0),
        at(f, o.a + (j + 1) * w - 0.1, 0.06, p0),
        at(f, o.a + (j + 1) * w - 0.1, 0.06, p1),
        at(f, o.a + j * w + 0.1, 0.06, p1),
        [f.nx, f.ny, 0],
      );
    }
  });
}

export function unit(
  c: Context,
  f: Frame,
  o: Opening,
  floor: number,
  room: number,
  group: number,
  dress: { shutters: RGB | null; arched: boolean; box: boolean },
): void {
  if (o.kind === 'window') windowUnit(c, f, o, floor, room, group, dress);
  else if (o.kind === 'door') doorUnit(c, f, o, floor, room, group);
  else if (o.kind === 'garage') garageDoorUnit(c, f, o, floor, room, group);
}
