// Furniture that makes each room recognizable in the cutaway view: a sofa in the living room, a
// bed in the bedroom, a car in the garage. Pieces are simple boxes, placed against the room's back
// wall so they never block the view into the room.

import type { RoomType } from '../room-types.ts';
import { box, type Box } from './iso.ts';
import type { Material } from './palette.ts';
import type { Rect } from './plan.ts';

export interface Piece {
  box: Box;
  material: Material;
  /** Glows by itself, like a screen, when the room is lit. */
  screen?: boolean;
}

/** Where lamps stand, relative to the furniture. */
export interface Spots {
  /** Floor and table lamps: beside the sofa, on nightstands, on the desk. */
  lamps: [number, number, number][];
  /** Over the table or the island. */
  pendant?: [number, number];
  /** The wall that strips of LEDs run along, as a segment at a height. */
  strip?: { from: [number, number]; to: [number, number]; z: number };
}

export interface Furnished {
  pieces: Piece[];
  spots: Spots;
}

type Part = [u0: number, v0: number, h0: number, u1: number, v1: number, h1: number, material: Material];

/**
 * Maps furniture drawn against a wall onto the room. `u` runs along the wall, `v` away from it into
 * the room and `h` up from the floor.
 */
class Placer {
  readonly length: number;
  readonly depth: number;
  private readonly rect: Rect;
  private readonly z: number;
  private readonly alongX: boolean;
  readonly pieces: Piece[] = [];
  readonly spots: Spots = { lamps: [] };

  constructor(rect: Rect, z: number, alongX: boolean) {
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

  add(...parts: Part[]): void {
    for (const [u0, v0, h0, u1, v1, h1, material] of parts) {
      const [ax, ay] = this.xy(u0, v0);
      const [bx, by] = this.xy(u1, v1);
      this.pieces.push({ box: box(ax, ay, this.z + h0, bx, by, this.z + h1), material });
    }
  }

  screen(u0: number, v0: number, h0: number, u1: number, v1: number, h1: number): void {
    const [ax, ay] = this.xy(u0, v0);
    const [bx, by] = this.xy(u1, v1);
    this.pieces.push({ box: box(ax, ay, this.z + h0, bx, by, this.z + h1), material: 'screen', screen: true });
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

const rug = (p: Placer, cu: number, cv: number, w: number, d: number, material: Material) =>
  p.add([cu - w / 2, cv - d / 2, 0, cu + w / 2, cv + d / 2, 0.02, material]);

function plant(p: Placer, u: number, v: number, tall = 1.1): void {
  p.add(
    [u - 0.18, v - 0.18, 0, u + 0.18, v + 0.18, 0.36, 'pot'],
    [u - 0.28, v - 0.28, 0.36, u + 0.28, v + 0.28, tall, 'leaf'],
  );
}

function sofa(p: Placer, cu: number, v0: number, width: number, material: Material, facingWall = false): void {
  const u0 = cu - width / 2;
  const u1 = cu + width / 2;
  const back: [number, number] = facingWall ? [v0 + 0.62, v0 + 0.85] : [v0, v0 + 0.24];
  p.add(
    [u0, v0, 0, u1, v0 + 0.85, 0.42, material],
    [u0, back[0], 0.42, u1, back[1], 0.82, material],
    [u0, v0, 0.42, u0 + 0.2, v0 + 0.85, 0.6, material],
    [u1 - 0.2, v0, 0.42, u1, v0 + 0.85, 0.6, material],
  );
}

function table(p: Placer, u0: number, v0: number, u1: number, v1: number, h: number, material: Material): void {
  const leg = 0.06;
  p.add(
    [u0 + 0.05, v0 + 0.05, 0, u0 + 0.05 + leg, v0 + 0.05 + leg, h - 0.04, material],
    [u1 - 0.05 - leg, v0 + 0.05, 0, u1 - 0.05, v0 + 0.05 + leg, h - 0.04, material],
    [u0 + 0.05, v1 - 0.05 - leg, 0, u0 + 0.05 + leg, v1 - 0.05, h - 0.04, material],
    [u1 - 0.05 - leg, v1 - 0.05 - leg, 0, u1 - 0.05, v1 - 0.05, h - 0.04, material],
    [u0, v0, h - 0.04, u1, v1, h, material],
  );
}

function chair(p: Placer, u: number, v: number, backAt: 'near' | 'far'): void {
  const s = 0.21;
  p.add([u - s, v - s, 0, u + s, v + s, 0.46, 'wood']);
  if (backAt === 'near') p.add([u - s, v - s, 0.46, u + s, v - s + 0.06, 0.9, 'wood']);
  else p.add([u - s, v + s - 0.06, 0.46, u + s, v + s, 0.9, 'wood']);
}

function bed(p: Placer, cu: number, width: number, blanket: Material): void {
  const u0 = cu - width / 2;
  const u1 = cu + width / 2;
  const length = Math.min(2.05, p.depth - 0.5);
  p.add(
    [u0 - 0.04, 0.05, 0, u1 + 0.04, 0.16, 1.05, 'darkWood'],
    [u0, 0.16, 0, u1, 0.16 + length, 0.3, 'wood'],
    [u0 + 0.03, 0.16, 0.3, u1 - 0.03, 0.16 + length - 0.02, 0.52, 'linen'],
    [u0 + 0.02, 0.16 + length * 0.42, 0.52, u1 - 0.02, 0.16 + length, 0.57, blanket],
    [u0 + 0.1, 0.24, 0.52, cu - 0.05, 0.6, 0.64, 'white'],
    [cu + 0.05, 0.24, 0.52, u1 - 0.1, 0.6, 0.64, 'white'],
  );
}

function shelves(p: Placer, u0: number, u1: number, depth = 0.4, height = 1.9, material: Material = 'darkWood'): void {
  p.add([u0, 0.05, 0, u1, 0.05 + depth, height, material]);
}

const clampWidth = (want: number, room: number, margin: number) => Math.max(0.6, Math.min(want, room - margin));

function living(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  // A TV on the back wall, and the sofa facing it with its back to the viewer.
  const tv = Math.min(0.75, L / 2 - 0.6);
  p.add([L / 2 - tv - 0.25, 0.06, 0, L / 2 + tv + 0.25, 0.48, 0.5, 'wood']);
  p.screen(L / 2 - tv, 0.08, 0.95, L / 2 + tv, 0.13, 1.7);
  p.strip(L / 2 - tv, L / 2 + tv, 0.1, 1.32);
  const sofaV = Math.min(D - 1.05, Math.max(2.1, D * 0.55));
  rug(p, L / 2, (sofaV + 0.9) / 2 + 0.3, Math.min(2.6, L - 0.8), Math.max(0.8, sofaV - 0.5), 'rugSand');
  if (sofaV > 2.3) table(p, L / 2 - 0.5, sofaV - 1.05, L / 2 + 0.5, sofaV - 0.5, 0.4, 'wood');
  sofa(p, L / 2, sofaV, clampWidth(2.2, L, 1), 'fabric', true);
  if (L > 3.2) {
    plant(p, 0.45, 0.45);
    p.lamp(L - 0.45, sofaV + 0.35, 1.5);
  } else p.lamp(L / 2 + tv + 0.45, 0.35, 1.4);
}

function media(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  const tv = Math.min(1.1, L / 2 - 0.4);
  p.add([L / 2 - tv - 0.2, 0.06, 0, L / 2 + tv + 0.2, 0.5, 0.45, 'darkWood']);
  p.screen(L / 2 - tv, 0.06, 0.75, L / 2 + tv, 0.12, 1.75);
  p.strip(L / 2 - tv, L / 2 + tv, 0.1, 1.25);
  rug(p, L / 2, D * 0.55, Math.min(2.6, L - 0.8), Math.min(1.8, D - 1.6), 'rugBlue');
  if (D > 2.6) sofa(p, L / 2, D - 1.1, clampWidth(2.4, L, 0.8), 'fabric', true);
  p.lamp(0.4, D - 0.5, 1.4);
}

function kitchen(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  const fridge = L > 2.6;
  const run = fridge ? L - 0.95 : L - 0.1;
  p.add([0.1, 0.05, 0, run, 0.66, 0.88, 'white'], [0.1, 0.05, 0.88, run, 0.68, 0.93, 'counter']);
  p.add([0.1, 0.05, 1.45, Math.max(0.6, run - 0.6), 0.4, 2.1, 'white']);
  if (fridge) p.add([L - 0.88, 0.05, 0, L - 0.12, 0.78, 1.95, 'steel']);
  p.strip(0.15, Math.max(0.6, run - 0.6), 0.4, 1.4);
  if (D >= 3.2 && L >= 2.8) {
    const w = Math.min(0.9, L / 2 - 0.6);
    const v = Math.max(1.7, D / 2);
    p.add(
      [L / 2 - w, v, 0, L / 2 + w, v + 0.85, 0.88, 'white'],
      [L / 2 - w - 0.05, v - 0.05, 0.88, L / 2 + w + 0.05, v + 0.9, 0.93, 'counter'],
    );
    p.add(
      [L / 2 - w + 0.1, v + 1.05, 0, L / 2 - w + 0.45, v + 1.4, 0.65, 'darkWood'],
      [L / 2 + w - 0.45, v + 1.05, 0, L / 2 + w - 0.1, v + 1.4, 0.65, 'darkWood'],
    );
    p.pendant(L / 2, v + 0.42);
  } else p.pendant(L / 2, Math.min(D - 0.6, 1.4));
}

function dining(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  const hw = Math.max(0.5, Math.min(0.95, L / 2 - 0.75));
  const cv = Math.max(1.35, D / 2 + 0.1);
  rug(p, L / 2, cv, hw * 2 + 1.3, Math.min(2.2, D - 0.6), 'rugBlue');
  if (L > 2.8) p.add([L / 2 - 0.8, 0.05, 0, L / 2 + 0.8, 0.48, 0.8, 'darkWood']);
  table(p, L / 2 - hw, cv - 0.48, L / 2 + hw, cv + 0.48, 0.76, 'wood');
  for (const u of hw > 0.7 ? [L / 2 - hw / 2, L / 2 + hw / 2] : [L / 2]) {
    chair(p, u, cv - 0.72, 'near');
    chair(p, u, cv + 0.72, 'far');
  }
  p.pendant(L / 2, cv);
}

function bedroom(p: Placer, blanket: Material, single = false): void {
  const L = p.length;
  const D = p.depth;
  const width = single ? Math.min(1, L - 0.8) : clampWidth(1.6, L, 1.3);
  const cu = single ? 0.25 + width / 2 : L / 2;
  bed(p, cu, width, blanket);
  if (!single && L - width > 1.2) {
    const left = cu - width / 2 - 0.55;
    const right = cu + width / 2 + 0.1;
    p.add([left, 0.08, 0, left + 0.45, 0.5, 0.5, 'wood'], [right, 0.08, 0, right + 0.45, 0.5, 0.5, 'wood']);
    p.lamp(left + 0.22, 0.28, 0.85);
    p.lamp(right + 0.22, 0.28, 0.85);
  } else p.lamp(Math.min(L - 0.3, cu + width / 2 + 0.35), 0.3, 1.1);
  if (single) {
    rug(p, Math.min(L - 1, cu + width / 2 + 0.9), Math.min(D - 0.9, 1.6), 1.4, 1.4, 'rugRose');
    if (L > 2.2) p.add([L - 0.8, 0.1, 0, L - 0.15, 0.5, 0.45, 'car']);
  } else if (D > 3) rug(p, cu, Math.min(D - 0.55, 2.35), width + 1, 0.9, 'rugSand');
}

function bathroom(p: Placer): void {
  const L = p.length;
  const tub = Math.min(1.75, L - (L > 2.5 ? 1.05 : 0.2));
  p.add([0.1, 0.05, 0, 0.1 + tub, 0.82, 0.56, 'white'], [0.18, 0.13, 0.5, 0.02 + tub, 0.74, 0.51, 'water']);
  if (L > 2.5) {
    p.add([L - 0.95, 0.05, 0, L - 0.1, 0.55, 0.82, 'wood'], [L - 0.9, 0.08, 0.82, L - 0.15, 0.52, 0.88, 'white']);
    p.add([L - 0.85, 0.02, 1.15, L - 0.2, 0.05, 1.85, 'steel']);
    p.strip(L - 0.85, L - 0.2, 0.06, 1.9);
  }
  if (p.depth > 2.2) rug(p, 0.1 + tub / 2, 1.25, Math.min(1, tub), 0.6, 'rugBlue');
}

function office(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  const w = Math.min(0.8, L / 2 - 0.3);
  table(p, L / 2 - w, 0.05, L / 2 + w, 0.75, 0.75, 'wood');
  p.screen(L / 2 - 0.32, 0.18, 0.82, L / 2 + 0.32, 0.23, 1.2);
  p.add(
    [L / 2 - 0.25, 0.95, 0, L / 2 + 0.25, 1.4, 0.5, 'counter'],
    [L / 2 - 0.25, 1.32, 0.5, L / 2 + 0.25, 1.4, 1.02, 'counter'],
  );
  if (L > 3.2) shelves(p, 0.1, 0.9);
  if (D > 2.6 && L > 2.6) plant(p, L - 0.4, D - 0.45, 0.9);
  p.lamp(L / 2 + w - 0.15, 0.3, 1.05);
}

function laundry(p: Placer): void {
  const L = p.length;
  p.add([0.12, 0.05, 0, 0.74, 0.68, 0.86, 'white'], [0.8, 0.05, 0, 1.42, 0.68, 0.86, 'white']);
  if (L > 2) p.add([1.55, 0.05, 0, Math.min(L - 0.1, 2.3), 0.6, 0.9, 'wood']);
  p.add([0.12, 0.05, 1.5, Math.min(L - 0.1, 2.3), 0.35, 1.54, 'wood']);
}

function garage(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  const cu = L / 2;
  const v0 = Math.max(0.5, D * 0.12);
  const v1 = Math.min(D - 0.4, v0 + 4.3);
  const len = v1 - v0;
  const hw = Math.min(0.9, L / 2 - 0.4);
  p.add(
    [cu - hw - 0.06, v0 + len * 0.12, 0, cu - hw + 0.18, v0 + len * 0.28, 0.36, 'tire'],
    [cu + hw - 0.18, v0 + len * 0.12, 0, cu + hw + 0.06, v0 + len * 0.28, 0.36, 'tire'],
    [cu - hw - 0.06, v0 + len * 0.72, 0, cu - hw + 0.18, v0 + len * 0.88, 0.36, 'tire'],
    [cu + hw - 0.18, v0 + len * 0.72, 0, cu + hw + 0.06, v0 + len * 0.88, 0.36, 'tire'],
    [cu - hw, v0, 0.22, cu + hw, v1, 0.82, 'car'],
    [cu - hw + 0.12, v0 + len * 0.3, 0.82, cu + hw - 0.12, v0 + len * 0.75, 1.3, 'screen'],
  );
  if (L > 3.4) p.add([0.1, 0.05, 0, 0.55, Math.min(D - 0.2, 1.8), 1.8, 'steel']);
}

function gym(p: Placer): void {
  const L = p.length;
  p.add([0.3, 0.1, 0, 1.1, 1.9, 0.22, 'counter'], [0.35, 0.1, 0.22, 1.05, 0.25, 1.25, 'counter']);
  rug(p, Math.min(L - 0.8, 2.1), 1.2, 0.9, 1.8, 'rugBlue');
  if (L > 2.6) p.add([L - 0.6, 0.08, 0, L - 0.15, 1.2, 0.9, 'steel']);
}

function hallway(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  if (L >= D) rug(p, L / 2, D / 2, Math.max(0.6, L - 1), Math.min(0.8, D - 0.6), 'rugRose');
  else rug(p, L / 2, D / 2, Math.min(0.8, L - 0.6), Math.max(0.6, D - 1), 'rugRose');
  if (L > 1.8) p.add([L / 2 - 0.5, 0.05, 0, L / 2 + 0.5, 0.36, 0.8, 'darkWood']);
  if (L > 2.6 || D > 2.6) plant(p, 0.35, Math.max(0.35, D - 0.4), 0.95);
}

function storage(p: Placer): void {
  const L = p.length;
  shelves(p, 0.1, Math.min(L - 0.1, 2.4), 0.45, 1.8, 'steel');
  if (p.depth > 1.8) p.add([0.3, 0.8, 0, 0.8, 1.3, 0.45, 'rugSand'], [0.95, 0.85, 0, 1.35, 1.25, 0.35, 'rugSand']);
}

function closet(p: Placer): void {
  shelves(p, 0.1, p.length - 0.1, 0.55, 2.1, 'wood');
}

function generic(p: Placer): void {
  const L = p.length;
  const D = p.depth;
  rug(p, L / 2, D / 2, Math.min(2, L - 0.8), Math.min(1.6, D - 0.8), 'rugSand');
  p.add(
    [L / 2 - 0.45, 0.15, 0, L / 2 + 0.45, 0.95, 0.42, 'fabricWarm'],
    [L / 2 - 0.45, 0.15, 0.42, L / 2 + 0.45, 0.35, 0.85, 'fabricWarm'],
  );
  if (L > 2.2) plant(p, L - 0.4, 0.4);
  p.lamp(L / 2 - 0.75, 0.35, 1.45);
}

/** Furniture for a room, placed against its back wall (or its left wall in deep, narrow rooms). */
export function furnish(type: RoomType, rect: Rect, z: number, toward: 'front' | 'right' | null = null): Furnished {
  const w = rect.x1 - rect.x0;
  const d = rect.y1 - rect.y0;
  // A garage's car faces its door; other rooms put their furniture against the longer back wall.
  const alongX = type === 'garage' ? toward !== 'right' : w >= d * 0.8;
  const p = new Placer(rect, z, alongX);
  if (p.length < 1.2 || p.depth < 1.2) return { pieces: [], spots: { lamps: [] } };
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
      bedroom(p, 'blanket');
      break;
    case 'guest':
      bedroom(p, 'blanketWarm');
      break;
    case 'kids':
      bedroom(p, 'blanketWarm', true);
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
  return { pieces: p.pieces, spots: p.spots };
}
