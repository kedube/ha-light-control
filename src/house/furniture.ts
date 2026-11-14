// Furniture that makes each room recognizable when a floor is opened: a sofa in the living room,
// a bed in the bedroom, a car in the garage. Pieces stand against the room's back wall, so they
// never block the view into the room.

import type { RoomType } from '../room-types.ts';
import { PAINT, tint } from './materials.ts';
import type { MeshBuilder, Paint } from './mesh.ts';
import type { Rect } from './plan.ts';

/** Where lamps stand, relative to the furniture. */
export interface Spots {
  /** Floor and table lamps: beside the sofa, on nightstands, on the desk. [x, y, height of the shade's top]. */
  lamps: [number, number, number][];
  /** Over the table or the island. */
  pendant?: [number, number];
  /** The wall that strips of LEDs run along, as a segment at a height. */
  strip?: { from: [number, number]; to: [number, number]; z: number };
}

/**
 * Draws furniture given against a wall. `u` runs along the wall, `v` away from it into the room
 * and `h` up from the floor.
 */
class Placer {
  readonly length: number;
  readonly depth: number;
  readonly spots: Spots = { lamps: [] };
  private readonly m: MeshBuilder;
  private readonly rect: Rect;
  private readonly z: number;
  private readonly alongX: boolean;

  constructor(m: MeshBuilder, rect: Rect, z: number, alongX: boolean) {
    this.m = m;
    this.rect = rect;
    this.z = z;
    this.alongX = alongX;
    this.length = alongX ? rect.x1 - rect.x0 : rect.y1 - rect.y0;
    this.depth = alongX ? rect.y1 - rect.y0 : rect.x1 - rect.x0;
  }

  /** Along the left wall, u runs from the front of the room to the back, so tall pieces at its end stand at the back. */
  xy(u: number, v: number): [number, number] {
    return this.alongX ? [this.rect.x0 + u, this.rect.y0 + v] : [this.rect.x0 + v, this.rect.y1 - u];
  }

  box(paint: Paint, u0: number, v0: number, h0: number, u1: number, v1: number, h1: number): void {
    const [ax, ay] = this.xy(u0, v0);
    const [bx, by] = this.xy(u1, v1);
    // Wood grain runs along the piece's longer side.
    const alongU = Math.abs(u1 - u0) >= Math.abs(v1 - v0);
    this.m.with(paint, () => this.m.box(ax, ay, this.z + h0, bx, by, this.z + h1, 0, alongU !== this.alongX));
  }

  soft(paint: Paint, u0: number, v0: number, h0: number, u1: number, v1: number, h1: number, r = 0.05): void {
    const [ax, ay] = this.xy(u0, v0);
    const [bx, by] = this.xy(u1, v1);
    this.m.with(paint, () => this.m.softBox(ax, ay, this.z + h0, bx, by, this.z + h1, r));
  }

  round(paint: Paint, u: number, v: number, h0: number, h1: number, r0: number, r1 = r0, caps = 2): void {
    const [x, y] = this.xy(u, v);
    this.m.with(paint, () => this.m.cylinder(x, y, this.z + h0, this.z + h1, r0, r1, 14, caps));
  }

  /** A wheel or a roll lying on its side, its axle along u. */
  wheel(paint: Paint, u0: number, u1: number, v: number, h: number, r: number): void {
    const [ax, ay] = this.xy(u0, v);
    const [bx, by] = this.xy(u1, v);
    this.m.with(paint, () => {
      if (this.alongX) this.m.cylinder(ay, this.z + h, Math.min(ax, bx), Math.max(ax, bx), r, r, 14, 3, 'x');
      else this.m.cylinder(ax, this.z + h, Math.min(ay, by), Math.max(ay, by), r, r, 14, 3, 'y');
    });
  }

  blob(paint: Paint, u: number, v: number, h: number, r: number, tall = 1, seed = 1): void {
    const [x, y] = this.xy(u, v);
    let s = Math.round((x * 31 + y * 17 + h * 7 + seed) * 1000) % 2147483647 || 3;
    const rand = () => ((s = (s * 48271) % 2147483647) - 1) / 2147483646;
    this.m.with(paint, () => this.m.blob(x, y, this.z + h, r, r, r * tall, rand, 0.14, 1));
  }

  rug(paint: Paint, cu: number, cv: number, w: number, d: number): void {
    if (w < 0.4 || d < 0.4) return;
    const [ax, ay] = this.xy(cu - w / 2, cv - d / 2);
    const [bx, by] = this.xy(cu + w / 2, cv + d / 2);
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx);
    const y0 = Math.min(ay, by);
    const y1 = Math.max(ay, by);
    const h = this.z + 0.014;
    this.m.with(paint, () =>
      this.m.quad(
        [x0, y0, h],
        [x1, y0, h],
        [x1, y1, h],
        [x0, y1, h],
        [0, 0, 1],
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ),
    );
  }

  lamp(u: number, v: number, h: number): void {
    const [x, y] = this.xy(u, v);
    this.spots.lamps.push([x, y, h]);
  }

  pendant(u: number, v: number): void {
    this.spots.pendant = this.xy(u, v);
  }

  strip(u0: number, u1: number, v: number, h: number): void {
    this.spots.strip = { from: this.xy(u0, v), to: this.xy(u1, v), z: this.z + h };
  }
}

const P = PAINT;

function plant(p: Placer, u: number, v: number, tall = 1.1): void {
  p.round(P.potWhite, u, v, 0, 0.34, 0.15, 0.2);
  p.round(P.soil, u, v, 0.3, 0.32, 0.17, 0.17);
  p.round(P.bark, u, v, 0.3, tall * 0.5, 0.02, 0.015, 0);
  p.blob(P.leaf, u, v, tall * 0.62, 0.26, 1.15, 1);
  p.blob(P.leafLight, u + 0.1, v - 0.08, tall * 0.82, 0.2, 1.1, 2);
  p.blob(P.leafDark, u - 0.11, v + 0.07, tall * 0.5, 0.2, 1, 3);
}

function legs(p: Placer, paint: Paint, u0: number, v0: number, u1: number, v1: number, h: number, w = 0.05): void {
  const i = 0.04;
  p.box(paint, u0 + i, v0 + i, 0, u0 + i + w, v0 + i + w, h);
  p.box(paint, u1 - i - w, v0 + i, 0, u1 - i, v0 + i + w, h);
  p.box(paint, u0 + i, v1 - i - w, 0, u0 + i + w, v1 - i, h);
  p.box(paint, u1 - i - w, v1 - i - w, 0, u1 - i, v1 - i, h);
}

function table(p: Placer, u0: number, v0: number, u1: number, v1: number, h: number, paint: Paint): void {
  legs(p, paint, u0, v0, u1, v1, h - 0.04);
  p.box(paint, u0, v0, h - 0.045, u1, v1, h);
}

/** A sofa. With `facingWall` its back is toward the viewer, as when it faces a TV on the wall. */
function sofa(
  p: Placer,
  cu: number,
  v0: number,
  width: number,
  paint: Paint,
  facingWall = false,
  accent = P.fabricWarm,
): void {
  const u0 = cu - width / 2;
  const u1 = cu + width / 2;
  const d = 0.9;
  const arm = 0.18;
  const back: [number, number] = facingWall ? [v0 + d - 0.24, v0 + d] : [v0, v0 + 0.24];
  const seat: [number, number] = facingWall ? [v0 + 0.04, v0 + d - 0.22] : [v0 + 0.22, v0 + d - 0.04];
  legs(p, P.darkWood, u0, v0, u1, v0 + d, 0.09, 0.06);
  p.soft(paint, u0, v0, 0.08, u1, v0 + d, 0.32, 0.05);
  const cushions = width > 1.9 ? 3 : 2;
  const cw = (width - 2 * arm) / cushions;
  for (let i = 0; i < cushions; i++) {
    const a = u0 + arm + i * cw;
    p.soft(paint, a + 0.012, seat[0], 0.3, a + cw - 0.012, seat[1], 0.47, 0.055);
    // Back cushions lean against the back.
    const b: [number, number] = facingWall ? [back[0] - 0.14, back[0] + 0.03] : [back[1] - 0.03, back[1] + 0.14];
    p.soft(paint, a + 0.02, b[0], 0.44, a + cw - 0.02, b[1], 0.8, 0.06);
  }
  p.soft(paint, u0 + 0.02, back[0], 0.3, u1 - 0.02, back[1], 0.84, 0.06);
  p.soft(paint, u0, v0, 0.1, u0 + arm, v0 + d, 0.62, 0.06);
  p.soft(paint, u1 - arm, v0, 0.1, u1, v0 + d, 0.62, 0.06);
  // A throw pillow at one end.
  const pv = facingWall ? back[0] - 0.3 : back[1] + 0.02;
  p.soft(accent, u0 + arm + 0.04, pv, 0.46, u0 + arm + 0.36, pv + 0.28, 0.72, 0.07);
}

function chair(p: Placer, u: number, v: number, backAt: 'near' | 'far', paint: Paint = P.wood): void {
  const s = 0.21;
  legs(p, paint, u - s, v - s, u + s, v + s, 0.44, 0.035);
  p.soft(P.fabricWarm, u - s, v - s, 0.42, u + s, v + s, 0.49, 0.02);
  if (backAt === 'near') p.box(paint, u - s, v - s, 0.49, u + s, v - s + 0.04, 0.92);
  else p.box(paint, u - s, v + s - 0.04, 0.49, u + s, v + s, 0.92);
}

function bed(p: Placer, cu: number, width: number, blanket: Paint): void {
  const u0 = cu - width / 2;
  const u1 = cu + width / 2;
  const length = Math.min(2.05, p.depth - 0.5);
  const v0 = 0.14;
  // Headboard, frame and legs.
  p.soft(P.fabricWarm, u0 - 0.05, 0.04, 0.2, u1 + 0.05, v0 + 0.02, 1.12, 0.04);
  p.box(P.wood, u0 - 0.03, v0, 0.14, u1 + 0.03, v0 + length, 0.3);
  legs(p, P.darkWood, u0 - 0.03, v0, u1 + 0.03, v0 + length, 0.14, 0.07);
  p.soft(P.linen, u0, v0 + 0.01, 0.28, u1, v0 + length - 0.02, 0.52, 0.07);
  // The duvet, turned down below the pillows.
  p.soft(blanket, u0 - 0.03, v0 + length * 0.36, 0.44, u1 + 0.03, v0 + length - 0.01, 0.6, 0.08);
  p.soft(P.linen, u0 - 0.02, v0 + length * 0.36 - 0.16, 0.46, u1 + 0.02, v0 + length * 0.36 + 0.06, 0.585, 0.06);
  if (width > 1.2) {
    p.soft(P.pillow, u0 + 0.08, v0 + 0.07, 0.5, cu - 0.04, v0 + 0.46, 0.66, 0.08);
    p.soft(P.pillow, cu + 0.04, v0 + 0.07, 0.5, u1 - 0.08, v0 + 0.46, 0.66, 0.08);
  } else p.soft(P.pillow, u0 + 0.12, v0 + 0.07, 0.5, u1 - 0.12, v0 + 0.46, 0.66, 0.08);
}

const BOOKS: Paint[] = [
  tint(P.book, [150, 80, 70]),
  tint(P.book, [70, 96, 128]),
  tint(P.book, [196, 170, 110]),
  tint(P.book, [84, 110, 86]),
  tint(P.book, [228, 224, 214]),
  tint(P.book, [60, 62, 70]),
];

/** Open shelves against the wall, with books. */
function shelves(p: Placer, u0: number, u1: number, depth = 0.34, height = 1.9, paint: Paint = P.darkWood): void {
  const t = 0.03;
  p.box(paint, u0, 0.05, 0, u0 + t, 0.05 + depth, height);
  p.box(paint, u1 - t, 0.05, 0, u1, 0.05 + depth, height);
  p.box(paint, u0, 0.05, 0, u1, 0.07, height);
  const rows = Math.max(2, Math.round(height / 0.42));
  for (let r = 0; r <= rows; r++) {
    const h = Math.min(height - t, (height * r) / rows);
    p.box(paint, u0, 0.05, h, u1, 0.05 + depth, h + t);
    if (r === rows) break;
    // A run of books, each a little different.
    let u = u0 + t + 0.02;
    let n = r * 7 + Math.round(u0 * 10);
    while (u < u1 - t - 0.1) {
      const w = 0.035 + ((n * 37) % 5) * 0.008;
      const tall = 0.2 + ((n * 53) % 7) * 0.02;
      if ((n * 29) % 9 !== 0) p.box(BOOKS[n % BOOKS.length], u, 0.1, h + t, u + w, 0.05 + depth - 0.04, h + t + tall);
      else u += 0.1;
      u += w + 0.004;
      n++;
    }
  }
}

const clampWidth = (want: number, room: number, margin: number) => Math.max(0.6, Math.min(want, room - margin));

function tv(p: Placer, cu: number, half: number, base: number, top: number): void {
  p.box(P.black, cu - half, 0.07, base, cu + half, 0.11, top);
  p.box(P.screen, cu - half + 0.03, 0.11, base + 0.03, cu + half - 0.03, 0.115, top - 0.03);
  p.strip(cu - half, cu + half, 0.06, (base + top) / 2);
}

function living(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  // A TV on the back wall, and the sofa facing it with its back to the viewer.
  const half = Math.min(0.75, L / 2 - 0.6);
  p.box(P.wood, L / 2 - half - 0.25, 0.06, 0.1, L / 2 + half + 0.25, 0.48, 0.5);
  legs(p, P.darkWood, L / 2 - half - 0.25, 0.06, L / 2 + half + 0.25, 0.48, 0.1, 0.05);
  tv(p, L / 2, half, 0.9, 1.72);
  const sofaV = Math.min(D - 1.05, Math.max(2.1, D * 0.55));
  p.rug(P.rugSand, L / 2, (sofaV + 0.9) / 2 + 0.3, Math.min(2.8, L - 0.8), Math.max(0.8, sofaV - 0.4));
  if (sofaV > 2.3) {
    table(p, L / 2 - 0.5, sofaV - 1.05, L / 2 + 0.5, sofaV - 0.5, 0.4, P.wood);
    p.box(BOOKS[1], L / 2 - 0.3, sofaV - 0.92, 0.4, L / 2 - 0.06, sofaV - 0.74, 0.44);
    p.round(P.potWhite, L / 2 + 0.26, sofaV - 0.78, 0.4, 0.5, 0.07, 0.09);
  }
  sofa(p, L / 2, sofaV, clampWidth(2.3, L, 1), P.fabric, true);
  if (L > 3.2) {
    plant(p, 0.45, 0.45, 1.5);
    p.lamp(L - 0.45, sofaV + 0.35, 1.55);
  } else p.lamp(L / 2 + half + 0.45, 0.35, 1.45);
  if (L > 4.4 && D > 3.4) {
    // An armchair beside the sofa.
    p.soft(P.fabricWarm, L - 1.25, 1.25, 0.08, L - 0.45, 2.05, 0.42, 0.06);
    p.soft(P.fabricWarm, L - 0.62, 1.25, 0.3, L - 0.45, 2.05, 0.82, 0.06);
  }
}

function media(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  const half = Math.min(1.15, L / 2 - 0.4);
  p.box(P.darkWood, L / 2 - half - 0.2, 0.06, 0, L / 2 + half + 0.2, 0.5, 0.42);
  tv(p, L / 2, half, 0.72, 1.86);
  p.box(P.black, L / 2 - half * 0.6, 0.12, 0.42, L / 2 + half * 0.6, 0.24, 0.5);
  if (L > 3.6) {
    p.box(P.black, 0.25, 0.1, 0, 0.55, 0.42, 1.05);
    p.box(P.black, L - 0.55, 0.1, 0, L - 0.25, 0.42, 1.05);
  }
  p.rug(P.rugBlue, L / 2, D * 0.55, Math.min(2.8, L - 0.8), Math.min(1.9, D - 1.6));
  if (D > 2.6) sofa(p, L / 2, D - 1.1, clampWidth(2.5, L, 0.8), tint(P.fabric, [70, 74, 86]), true, P.blanketWarm);
  p.lamp(0.4, D - 0.5, 1.45);
}

function kitchen(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  const fridge = L > 2.6;
  const run = fridge ? L - 0.95 : L - 0.1;
  // Base cabinets under a worktop, with a sink and a hob.
  p.box(P.white, 0.1, 0.05, 0.1, run, 0.64, 0.88);
  p.box(P.black, 0.12, 0.07, 0, run - 0.02, 0.6, 0.1);
  p.box(P.counter, 0.08, 0.05, 0.88, run + 0.02, 0.68, 0.92);
  for (let u = 0.7; u < run - 0.2; u += 0.6) p.box(P.steel, u - 0.005, 0.64, 0.14, u + 0.005, 0.645, 0.86);
  const sink = Math.min(run - 0.9, 0.5);
  if (sink > 0.2) {
    p.box(P.steel, sink, 0.16, 0.9, sink + 0.6, 0.56, 0.925);
    p.box(P.counter, sink + 0.04, 0.2, 0.921, sink + 0.56, 0.52, 0.927);
    p.round(P.chrome, sink + 0.3, 0.12, 0.92, 1.16, 0.016, 0.016);
    p.box(P.chrome, sink + 0.285, 0.12, 1.14, sink + 0.315, 0.3, 1.17);
  }
  if (run > 2.2) {
    p.box(P.black, run - 0.85, 0.12, 0.921, run - 0.2, 0.58, 0.93);
    p.box(P.steel, run - 0.9, 0.05, 1.5, run - 0.15, 0.5, 1.62);
  }
  // Wall cabinets.
  p.box(P.white, 0.1, 0.05, 1.45, Math.max(0.6, run - (run > 2.2 ? 1.0 : 0.1)), 0.4, 2.15);
  if (fridge) {
    p.box(P.steel, L - 0.88, 0.05, 0, L - 0.12, 0.76, 1.95);
    p.box(P.chrome, L - 0.84, 0.76, 1.0, L - 0.81, 0.79, 1.7);
    p.box(P.black, L - 0.88, 0.755, 1.24, L - 0.12, 0.765, 1.26);
  }
  p.strip(0.15, Math.max(0.6, run - (run > 2.2 ? 1.0 : 0.1)), 0.38, 1.43);
  if (D >= 3.2 && L >= 2.8) {
    // An island with stools.
    const w = Math.min(0.95, L / 2 - 0.6);
    const v = Math.max(1.7, D / 2);
    p.box(P.white, L / 2 - w, v, 0.1, L / 2 + w, v + 0.85, 0.88);
    p.box(P.black, L / 2 - w + 0.03, v + 0.03, 0, L / 2 + w - 0.03, v + 0.82, 0.1);
    p.box(P.stone, L / 2 - w - 0.05, v - 0.05, 0.88, L / 2 + w + 0.05, v + 1.02, 0.925);
    for (const u of [L / 2 - w + 0.3, L / 2 + w - 0.3]) {
      p.round(P.chrome, u, v + 1.22, 0, 0.62, 0.02, 0.02, 0);
      p.round(P.chrome, u, v + 1.22, 0, 0.02, 0.16, 0.16);
      p.round(P.darkWood, u, v + 1.22, 0.62, 0.67, 0.17, 0.17);
    }
    p.round(P.potWhite, L / 2 - w + 0.3, v + 0.4, 0.925, 1.02, 0.12, 0.15, 0);
    p.pendant(L / 2, v + 0.42);
  } else p.pendant(L / 2, Math.min(D - 0.6, 1.4));
}

function dining(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  const hw = Math.max(0.5, Math.min(0.95, L / 2 - 0.75));
  const cv = Math.max(1.35, D / 2 + 0.1);
  p.rug(P.rugBlue, L / 2, cv, hw * 2 + 1.3, Math.min(2.3, D - 0.6));
  if (L > 2.8) {
    // A sideboard on the back wall.
    p.box(P.darkWood, L / 2 - 0.8, 0.05, 0.1, L / 2 + 0.8, 0.46, 0.82);
    legs(p, P.darkWood, L / 2 - 0.8, 0.05, L / 2 + 0.8, 0.46, 0.1, 0.05);
    p.round(P.potWhite, L / 2 + 0.5, 0.26, 0.82, 1.04, 0.07, 0.1, 0);
    p.blob(P.flowers, L / 2 + 0.5, 0.26, 1.16, 0.16, 1, 4);
  }
  table(p, L / 2 - hw, cv - 0.48, L / 2 + hw, cv + 0.48, 0.76, P.wood);
  p.round(P.potWhite, L / 2, cv, 0.76, 0.84, 0.13, 0.16, 0);
  for (const u of hw > 0.7 ? [L / 2 - hw / 2, L / 2 + hw / 2] : [L / 2]) {
    chair(p, u, cv - 0.7, 'near');
    chair(p, u, cv + 0.7, 'far');
  }
  p.pendant(L / 2, cv);
}

function bedroom(p: Placer, blanket: Paint, single = false): void {
  const L = p.length;
  const D = p.depth;
  const width = single ? Math.min(1, L - 0.8) : clampWidth(1.6, L, 1.3);
  const cu = single ? 0.3 + width / 2 : L / 2;
  bed(p, cu, width, blanket);
  if (!single && L - width > 1.2) {
    const left = cu - width / 2 - 0.58;
    const right = cu + width / 2 + 0.13;
    for (const u of [left, right]) {
      p.box(P.wood, u, 0.08, 0.12, u + 0.45, 0.5, 0.5);
      legs(p, P.darkWood, u, 0.08, u + 0.45, 0.5, 0.12, 0.04);
    }
    p.lamp(left + 0.22, 0.28, 0.9);
    p.lamp(right + 0.22, 0.28, 0.9);
  } else p.lamp(Math.min(L - 0.3, cu + width / 2 + 0.35), 0.3, 1.1);
  if (single) {
    // A play rug, a toy box and a little table.
    p.rug(P.rugRose, Math.min(L - 1, cu + width / 2 + 0.95), Math.min(D - 0.9, 1.6), 1.5, 1.5);
    if (L > 2.2) {
      p.box(P.toy, L - 0.85, 0.1, 0, L - 0.15, 0.5, 0.42);
      p.box(tint(P.toy, [86, 150, 190]), L - 0.87, 0.08, 0.42, L - 0.13, 0.52, 0.46);
      p.blob(tint(P.fabric, [176, 128, 92]), L - 0.5, 0.3, 0.6, 0.15, 1.1, 5);
    }
    if (L > 3 && D > 2.6) {
      p.round(P.toy, Math.min(L - 1, cu + width / 2 + 0.95), Math.min(D - 0.9, 1.6), 0, 0.3, 0.3, 0.3);
    }
  } else {
    if (D > 3) p.rug(P.rugSand, cu, Math.min(D - 0.55, 2.4), width + 1.1, 1);
    if (L > 4 && D > 3) {
      // A dresser with a mirror.
      p.box(P.paleWood, L - 1.25, 0.06, 0.08, L - 0.2, 0.5, 0.86);
      legs(p, P.darkWood, L - 1.25, 0.06, L - 0.2, 0.5, 0.08, 0.04);
      p.box(P.mirror, L - 1.05, 0.03, 1.0, L - 0.4, 0.05, 1.7);
    }
  }
}

function bathroom(p: Placer): void {
  const L = p.length;
  const tub = Math.min(1.75, L - (L > 2.5 ? 1.05 : 0.2));
  // A bath, with water in it.
  p.soft(P.white, 0.1, 0.05, 0, 0.1 + tub, 0.82, 0.56, 0.06);
  p.soft(P.water, 0.19, 0.14, 0.44, 0.01 + tub, 0.73, 0.52, 0.03);
  p.round(P.chrome, 0.2, 0.44, 0.56, 0.74, 0.015, 0.015);
  if (L > 2.5) {
    // A basin on a cabinet, under a mirror.
    p.box(P.wood, L - 0.95, 0.05, 0.14, L - 0.1, 0.55, 0.8);
    p.box(P.white, L - 0.98, 0.05, 0.8, L - 0.07, 0.58, 0.86);
    p.round(P.white, L - 0.52, 0.32, 0.86, 0.9, 0.2, 0.22, 0);
    p.round(P.chrome, L - 0.52, 0.12, 0.86, 1.02, 0.014, 0.014);
    p.box(P.mirror, L - 0.9, 0.03, 1.12, L - 0.15, 0.05, 1.86);
    p.strip(L - 0.9, L - 0.15, 0.07, 1.92);
  }
  if (p.depth > 2.0 && L > 1.6) {
    // A toilet beside the bath.
    const u = Math.min(L - 0.5, 0.1 + tub + 0.42);
    if (u + 0.3 < (L > 2.5 ? L - 1.0 : L - 0.1)) {
      p.box(P.white, u - 0.19, 0.05, 0.38, u + 0.19, 0.22, 0.8);
      p.round(P.white, u, 0.42, 0, 0.4, 0.15, 0.19);
      p.round(P.white, u, 0.42, 0.4, 0.43, 0.2, 0.2);
    }
  }
  if (p.depth > 2.2) p.rug(P.rugBlue, 0.1 + tub / 2, 1.25, Math.min(1, tub), 0.6);
}

function office(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  const w = Math.min(0.8, L / 2 - 0.3);
  table(p, L / 2 - w, 0.08, L / 2 + w, 0.78, 0.74, P.paleWood);
  // A monitor on a stand, a keyboard, and a chair.
  p.box(P.black, L / 2 - 0.34, 0.2, 0.86, L / 2 + 0.34, 0.24, 1.26);
  p.box(P.screen, L / 2 - 0.32, 0.24, 0.88, L / 2 + 0.32, 0.245, 1.24);
  p.box(P.black, L / 2 - 0.03, 0.18, 0.74, L / 2 + 0.03, 0.22, 0.9);
  p.box(P.black, L / 2 - 0.12, 0.14, 0.74, L / 2 + 0.12, 0.3, 0.755);
  p.box(P.steel, L / 2 - 0.22, 0.46, 0.74, L / 2 + 0.22, 0.6, 0.755);
  p.round(P.black, L / 2, 1.2, 0, 0.04, 0.26, 0.26);
  p.round(P.chrome, L / 2, 1.2, 0.04, 0.44, 0.025, 0.025, 0);
  p.soft(P.counter, L / 2 - 0.24, 0.96, 0.44, L / 2 + 0.24, 1.44, 0.53, 0.04);
  p.soft(P.counter, L / 2 - 0.22, 1.38, 0.5, L / 2 + 0.22, 1.46, 1.04, 0.04);
  if (L > 3.2) shelves(p, 0.12, 0.95);
  if (D > 2.6 && L > 2.6) plant(p, L - 0.4, D - 0.45, 0.95);
  p.lamp(L / 2 + w - 0.15, 0.3, 1.1);
}

function laundry(p: Placer): void {
  const L = p.length;
  for (const u of [0.12, 0.8]) {
    if (u + 0.62 > L - 0.05) break;
    p.box(P.white, u, 0.05, 0, u + 0.62, 0.66, 0.86);
    p.box(P.counter, u + 0.12, 0.66, 0.24, u + 0.5, 0.67, 0.62);
    p.box(P.steel, u + 0.06, 0.66, 0.72, u + 0.56, 0.665, 0.8);
  }
  if (L > 2) {
    p.box(P.wood, 1.55, 0.05, 0, Math.min(L - 0.1, 2.3), 0.6, 0.9);
    p.soft(P.linen, 1.65, 0.14, 0.9, Math.min(L - 0.2, 2.1), 0.5, 1.02, 0.04);
  }
  p.box(P.wood, 0.12, 0.05, 1.5, Math.min(L - 0.1, 2.3), 0.35, 1.54);
}

function garage(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  const cu = L / 2 + (L > 3.4 ? 0.2 : 0);
  const v0 = Math.max(0.6, D * 0.14);
  const v1 = Math.min(D - 0.5, v0 + 4.3);
  const len = v1 - v0;
  const hw = Math.min(0.88, L / 2 - 0.5);
  if (len > 2.4 && hw > 0.5) {
    // A car, nose toward the door.
    for (const v of [v0 + len * 0.2, v0 + len * 0.8]) {
      p.wheel(P.tire, cu - hw - 0.02, cu - hw + 0.2, v, 0.31, 0.31);
      p.wheel(P.tire, cu + hw - 0.2, cu + hw + 0.02, v, 0.31, 0.31);
      p.wheel(P.chrome, cu - hw - 0.03, cu - hw + 0.02, v, 0.31, 0.17);
      p.wheel(P.chrome, cu + hw - 0.02, cu + hw + 0.03, v, 0.31, 0.17);
    }
    p.soft(P.car, cu - hw, v0, 0.26, cu + hw, v1, 0.84, 0.14);
    p.soft(P.carGlass, cu - hw + 0.1, v0 + len * 0.26, 0.8, cu + hw - 0.1, v0 + len * 0.72, 1.32, 0.16);
    p.soft(P.car, cu - hw + 0.14, v0 + len * 0.3, 1.24, cu + hw - 0.14, v0 + len * 0.68, 1.36, 0.06);
    p.box(P.chrome, cu - hw + 0.1, v1 - 0.02, 0.5, cu - hw + 0.5, v1 + 0.005, 0.62);
    p.box(P.chrome, cu + hw - 0.5, v1 - 0.02, 0.5, cu + hw - 0.1, v1 + 0.005, 0.62);
  }
  if (L > 3.4) {
    // A workbench and shelves along the side.
    p.box(P.wood, 0.1, 0.08, 0.84, 0.62, Math.min(D - 0.4, 1.9), 0.9);
    legs(p, P.steel, 0.1, 0.08, 0.62, Math.min(D - 0.4, 1.9), 0.84, 0.05);
    p.box(tint(P.toy, [178, 60, 50]), 0.2, 0.3, 0.9, 0.5, 0.7, 1.08);
    p.box(P.steel, 0.1, Math.min(D - 0.3, 2.2), 0, 0.5, Math.min(D - 0.2, 3.4), 1.7);
  }
}

function gym(p: Placer): void {
  const L = p.length;
  // A treadmill, a mat with a ball, and a rack of weights.
  p.box(P.counter, 0.3, 0.2, 0, 1.05, 1.95, 0.2);
  p.box(P.black, 0.36, 0.26, 0.2, 0.99, 1.86, 0.215);
  p.box(P.steel, 0.32, 0.22, 0.2, 0.37, 0.27, 1.25);
  p.box(P.steel, 0.98, 0.22, 0.2, 1.03, 0.27, 1.25);
  p.box(P.black, 0.32, 0.18, 1.2, 1.03, 0.32, 1.38);
  p.rug(P.rugBlue, Math.min(L - 0.8, 2.1), 1.2, 0.9, 1.8);
  p.blob(tint(P.toy, [86, 150, 190]), Math.min(L - 0.8, 2.1), 0.9, 0.33, 0.32, 1, 6);
  if (L > 2.6) {
    p.box(P.steel, L - 0.6, 0.08, 0, L - 0.15, 1.2, 0.06);
    p.box(P.steel, L - 0.6, 0.08, 0.4, L - 0.15, 1.2, 0.44);
    p.box(P.steel, L - 0.6, 0.08, 0.78, L - 0.15, 1.2, 0.82);
    for (const v of [0.25, 0.6, 0.95]) {
      p.wheel(P.black, L - 0.56, L - 0.19, v, 0.56, 0.11);
      p.wheel(P.black, L - 0.5, L - 0.25, v, 0.93, 0.09);
    }
  }
}

function hallway(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  if (L >= D) p.rug(P.rugRose, L / 2, D / 2, Math.max(0.6, L - 1), Math.min(0.85, D - 0.6));
  else p.rug(P.rugRose, L / 2, D / 2, Math.min(0.85, L - 0.6), Math.max(0.6, D - 1));
  if (L > 1.8) {
    // A console table with a bowl.
    table(p, L / 2 - 0.5, 0.05, L / 2 + 0.5, 0.36, 0.8, P.darkWood);
    p.round(P.potWhite, L / 2 - 0.2, 0.2, 0.8, 0.88, 0.08, 0.12, 0);
    p.box(P.mirror, L / 2 - 0.35, 0.03, 1.1, L / 2 + 0.35, 0.05, 1.8);
  }
  if (L > 2.6 || D > 2.6) plant(p, 0.35, Math.max(0.35, D - 0.4), 1.2);
}

const CARDBOARD = tint(P.pot, [176, 140, 100]);

function storage(p: Placer): void {
  const L = p.length;
  const end = Math.min(L - 0.1, 2.4);
  // Metal shelving with boxes.
  for (const h of [0.1, 0.65, 1.2, 1.75]) p.box(P.steel, 0.1, 0.05, h, end, 0.5, h + 0.03);
  for (const u of [0.1, end - 0.04]) {
    p.box(P.steel, u, 0.05, 0, u + 0.04, 0.09, 1.8);
    p.box(P.steel, u, 0.46, 0, u + 0.04, 0.5, 1.8);
  }
  for (let u = 0.2, n = 0; u < end - 0.5; u += 0.52, n++) {
    p.box(CARDBOARD, u, 0.1, 0.13 + (n % 3) * 0.55, u + 0.42, 0.45, 0.4 + (n % 3) * 0.55 + (n % 2) * 0.08);
    p.box(CARDBOARD, u + 0.04, 0.12, 0.68 + ((n + 1) % 2) * 0.55, u + 0.4, 0.44, 0.98 + ((n + 1) % 2) * 0.55);
  }
  if (p.depth > 1.8 && L > 2.2) {
    // A water heater in the corner.
    p.round(P.white, L - 0.45, 0.45, 0.08, 1.5, 0.28, 0.28);
    p.round(P.steel, L - 0.45, 0.45, 1.5, 2.2, 0.04, 0.04, 0);
  }
}

function closet(p: Placer): void {
  const L = p.length;
  p.box(P.paleWood, 0.1, 0.05, 0, L - 0.1, 0.6, 2.1);
  for (let u = 0.1 + (L - 0.2) / 2; u < L - 0.3; u += (L - 0.2) / 2)
    p.box(P.darkWood, u - 0.006, 0.6, 0.05, u + 0.006, 0.605, 2.05);
}

function generic(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  p.rug(P.rugSand, L / 2, D / 2, Math.min(2, L - 0.8), Math.min(1.6, D - 0.8));
  // An armchair and a side table.
  p.soft(P.fabricWarm, L / 2 - 0.45, 0.15, 0.08, L / 2 + 0.45, 0.95, 0.42, 0.06);
  p.soft(P.fabricWarm, L / 2 - 0.45, 0.15, 0.3, L / 2 + 0.45, 0.36, 0.86, 0.06);
  p.soft(P.fabricWarm, L / 2 - 0.45, 0.15, 0.3, L / 2 - 0.3, 0.95, 0.6, 0.05);
  p.soft(P.fabricWarm, L / 2 + 0.3, 0.15, 0.3, L / 2 + 0.45, 0.95, 0.6, 0.05);
  if (L > 2.2) plant(p, L - 0.4, 0.4, 1.3);
  if (L > 2.8) shelves(p, 0.12, 0.8, 0.3, 1.5, P.paleWood);
  p.lamp(L / 2 - 0.75, 0.35, 1.5);
}

/**
 * Draws a room's furniture against its back wall (or its left wall in deep, narrow rooms), using
 * the mesh's current room and group. Returns where its lamps go.
 */
export function furnish(
  m: MeshBuilder,
  type: RoomType,
  rect: Rect,
  z: number,
  toward: 'front' | 'right' | null = null,
): Spots {
  const w = rect.x1 - rect.x0;
  const d = rect.y1 - rect.y0;
  // A garage's car faces its door; other rooms put their furniture against the longer back wall.
  const alongX = type === 'garage' ? toward !== 'right' : w >= d * 0.8;
  const p = new Placer(m, rect, z, alongX);
  if (p.length < 1.2 || p.depth < 1.2) return p.spots;
  switch (type) {
    case 'living':
      living(p);
      break;
    case 'media':
      media(p);
      break;
    case 'kitchen':
      kitchen(p);
      break;
    case 'dining':
      dining(p);
      break;
    case 'bedroom':
      bedroom(p, P.blanket);
      break;
    case 'guest':
      bedroom(p, P.blanketWarm);
      break;
    case 'kids':
      bedroom(p, tint(P.blanket, [226, 170, 74]), true);
      break;
    case 'bathroom':
      bathroom(p);
      break;
    case 'office':
      office(p);
      break;
    case 'laundry':
      laundry(p);
      break;
    case 'garage':
      garage(p);
      break;
    case 'gym':
      gym(p);
      break;
    case 'hallway':
      hallway(p);
      break;
    case 'storage':
    case 'basement':
    case 'attic':
      storage(p);
      break;
    case 'closet':
      closet(p);
      break;
    case 'stairs':
      break;
    default:
      generic(p);
  }
  return p.spots;
}
