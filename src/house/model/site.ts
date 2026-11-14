// The plot the house stands on: a block of earth with a lawn on top, paths and a driveway, a
// garden planted to suit the design of the house, and a place for every outdoor area with a
// fixture for each of its lights.

import type { RGB } from '../../color.ts';
import { seeded } from '../math.ts';
import { PAINT, tint, type GardenKind, type HouseStyle } from '../materials.ts';
import { SKIP, type Paint } from '../mesh.ts';
import type { HousePlan, Rect } from '../plan.ts';
import { box, Context, SLAB, type Box, type RoomInput } from './context.ts';
import { planEntry, type Entry } from './entry.ts';
import { lightOutdoors } from './outdoor.ts';

export type ZoneKind = 'porch' | 'garden' | 'yard' | 'driveway' | 'pool' | 'patio' | 'lawn';

export interface Zone {
  roomId: string;
  kind: ZoneKind;
  rect: Rect;
}

export interface Site {
  /** The plot, from the bottom of the earth to the grass. */
  box: Box;
  /** What stands at the front door. */
  entry: Entry | null;
  zones: Zone[];
  /** How far the plot reaches in front of the house. */
  front: number;
  /** The path from the front steps to the pavement, and the driveway, where there are. */
  walk: Rect | null;
  drive: Rect | null;
  /** Where the fence along the road stands (y). */
  fence: number;
}

type TreeKind = 'oak' | 'fir' | 'cypress' | 'olive' | 'maple';

/** A garden to go with a design of house: what grows in it, what its paths are made of, what fences it. */
interface Garden {
  lawn: RGB;
  walk: Paint;
  /** A path of separate slabs with grass between them, instead of an unbroken one. */
  pads?: boolean;
  drive: Paint;
  bed: Paint;
  fence: 'none' | 'picket' | 'rail' | 'iron';
  /** What grows along the house: shrubs in bloom, clipped balls, tufts of grass, or pots. */
  border: 'shrubs' | 'balls' | 'grasses' | 'pots';
  blooms: Paint[];
  back: 'hedge' | 'firs' | 'cypress' | 'slats' | 'mixed';
  trees: TreeKind[];
}

const GARDENS: Record<GardenKind, Garden> = {
  // Clipped and symmetrical: boxwood either side of a brick path.
  formal: {
    lawn: [92, 140, 64],
    walk: PAINT.brickPath,
    drive: PAINT.concrete,
    bed: PAINT.mulch,
    fence: 'none',
    border: 'balls',
    blooms: [PAINT.whiteBloom, PAINT.boxwood],
    back: 'hedge',
    trees: ['oak', 'oak'],
  },
  // A picket fence, hydrangeas and roses, a gravel path.
  cottage: {
    lawn: [100, 146, 68],
    walk: PAINT.gravel,
    drive: PAINT.gravel,
    bed: PAINT.mulch,
    fence: 'picket',
    border: 'shrubs',
    blooms: [PAINT.hydrangea, PAINT.roses, PAINT.flowers, PAINT.lavender],
    back: 'mixed',
    trees: ['oak', 'maple'],
  },
  // A plain lawn with a few neat shrubs and a concrete walk.
  suburban: {
    lawn: [98, 146, 66],
    walk: PAINT.concrete,
    drive: PAINT.concrete,
    bed: PAINT.mulch,
    fence: 'none',
    border: 'balls',
    blooms: [PAINT.hedge, PAINT.leaf],
    back: 'hedge',
    trees: ['oak'],
  },
  // Roses behind an iron fence.
  ornate: {
    lawn: [90, 138, 62],
    walk: PAINT.brickPath,
    drive: PAINT.concrete,
    bed: PAINT.mulch,
    fence: 'iron',
    border: 'shrubs',
    blooms: [PAINT.roses, PAINT.whiteBloom, PAINT.roses, PAINT.hydrangea],
    back: 'hedge',
    trees: ['oak', 'maple'],
  },
  // Gravel, grasses and boulders; concrete slabs to the door; a screen of wooden slats behind.
  modern: {
    lawn: [104, 140, 76],
    walk: PAINT.concrete,
    pads: true,
    drive: PAINT.concrete,
    bed: PAINT.gravel,
    fence: 'none',
    border: 'grasses',
    blooms: [PAINT.reeds, PAINT.blueGrass],
    back: 'slats',
    trees: ['maple', 'olive'],
  },
  // A rail fence, wild flowers, a gravel drive and a big old tree.
  country: {
    lawn: [108, 146, 70],
    walk: PAINT.gravel,
    drive: PAINT.gravel,
    bed: PAINT.mulch,
    fence: 'rail',
    border: 'shrubs',
    blooms: [PAINT.flowers, PAINT.lavender, PAINT.whiteBloom, PAINT.flowers],
    back: 'mixed',
    trees: ['oak', 'oak', 'fir'],
  },
  // Dry grass, cypresses and olive trees, lavender and pots of flowers.
  mediterranean: {
    lawn: [146, 148, 92],
    walk: PAINT.terracotta,
    drive: PAINT.patio,
    bed: PAINT.gravel,
    fence: 'none',
    border: 'pots',
    blooms: [PAINT.lavender, PAINT.bougainvillea, PAINT.lavender],
    back: 'cypress',
    trees: ['cypress', 'olive', 'cypress'],
  },
  // Lush and green: hedges, roses, stepping stones across the lawn.
  english: {
    lawn: [84, 136, 60],
    walk: PAINT.flagstone,
    pads: true,
    drive: PAINT.gravel,
    bed: PAINT.mulch,
    fence: 'none',
    border: 'shrubs',
    blooms: [PAINT.roses, PAINT.boxwood, PAINT.hydrangea, PAINT.whiteBloom],
    back: 'hedge',
    trees: ['oak', 'fir'],
  },
};

/** Lays out the plot: what stands at the door, and a place for every outdoor area. */
export function layoutSite(plan: HousePlan, outdoor: RoomInput[], style: HouseStyle): Site {
  const W = plan.width;
  const D = plan.depth;
  const entry = planEntry(plan, style);
  const wing = plan.wing;
  const zones: Zone[] = [];
  const taken = new Set<ZoneKind>();
  const want: Record<string, ZoneKind[]> = {
    porch: ['porch', 'patio', 'yard'],
    balcony: ['patio', 'porch', 'yard'],
    garden: ['garden', 'yard', 'patio'],
    driveway: ['driveway', 'yard', 'garden'],
    pool: ['pool', 'garden', 'yard'],
  };
  const any: ZoneKind[] = ['garden', 'yard', 'patio', 'porch', 'pool', 'driveway'];
  const extras: Zone[] = [];
  for (const room of outdoor) {
    // Without a front door there is nowhere for a porch.
    const kind = [...(want[room.type] ?? []), ...any].find((k) => !taken.has(k) && (k !== 'porch' || entry));
    const zone: Zone = { roomId: room.id, kind: kind ?? 'lawn', rect: { x0: 0, y0: 0, x1: 0, y1: 0 } };
    if (kind) taken.add(kind);
    else extras.push(zone);
    zones.push(zone);
  }
  // A porch that wraps round the side pushes the garden out.
  const wrap = entry?.side ? entry.side.x1 - W + 0.3 : 0;
  const right = (taken.has('garden') || taken.has('pool') || extras.length ? 6.2 : 3.6) + wrap;
  const reach = entry ? entry.deck.y1 - D + entry.steps : 0;
  const front = Math.max(5.2, reach + 3);
  const left = wing ? wing.rect.x0 - 1.8 : -3;
  const back = -3.4;
  const walk = front - 1.5;

  // Along the right side, the garden and the pool share the space.
  const bothSide = taken.has('garden') && taken.has('pool');
  const sideSpan = (which: 'garden' | 'pool'): [number, number] => {
    const a = 0.4;
    const c = D - 0.4;
    if (!bothSide) return [a, c];
    const mid = a + (c - a) * 0.48;
    return which === 'garden' ? [a, mid - 0.2] : [mid + 0.2, c];
  };
  // In front, the entry and its path and the driveway are fixed; a patio and a yard take the
  // widest stretches of lawn left over.
  const blocked: [number, number][] = entry ? [[entry.deck.x0 - 0.4, entry.deck.x1 + 0.4]] : [];
  if (!wing && taken.has('driveway')) blocked.push([W - 3.5, W - 0.1]);
  if (extras.length) blocked.push([W + 0.3 + wrap, W + right]);
  const stretches: [number, number][] = [];
  let from = 0.2;
  for (const [a, c] of [...blocked].sort((p, q) => p[0] - q[0])) {
    if (a - from > 0.5) stretches.push([from, a]);
    from = Math.max(from, c);
  }
  if (W + right - 0.5 - from > 0.5) stretches.push([from, W + right - 0.5]);
  stretches.sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
  const bothFront = taken.has('patio') && taken.has('yard');
  const frontSpan = (which: 'patio' | 'yard'): [number, number] => {
    const pad = (s: [number, number]): [number, number] => [s[0] + 0.3, s[1] - 0.3];
    const [a, c] = stretches[bothFront && which === 'patio' && stretches.length > 1 ? 1 : 0] ?? [
      W + 0.4,
      W + right - 0.5,
    ];
    if (!bothFront || stretches.length > 1) return pad([a, c]);
    const mid = (a + c) / 2;
    return which === 'yard' ? pad([a, mid]) : pad([mid, c]);
  };
  const porchDepth = entry ? entry.deck.y1 - D : 0;
  for (const zone of zones) {
    switch (zone.kind) {
      case 'porch':
        zone.rect = { ...entry!.deck };
        break;
      case 'patio':
      case 'yard': {
        const [x0, x1] = frontSpan(zone.kind);
        const y0 = D + (x0 < (entry?.deck.x1 ?? 0) && x1 > (entry?.deck.x0 ?? 0) ? porchDepth + 0.4 : 0.9);
        zone.rect = { x0, y0, x1, y1: zone.kind === 'patio' ? Math.min(D + walk - 0.4, y0 + 2.9) : D + walk - 0.4 };
        break;
      }
      case 'garden': {
        const [y0, y1] = sideSpan('garden');
        zone.rect = { x0: W + 0.7 + wrap, y0, x1: W + right - 0.5, y1 };
        break;
      }
      case 'pool': {
        const [y0, y1] = sideSpan('pool');
        zone.rect = { x0: W + 1 + wrap, y0: y0 + 0.3, x1: W + right - 0.7, y1: y1 - 0.2 };
        break;
      }
      case 'driveway':
        zone.rect = wing
          ? { x0: wing.rect.x0 + 0.35, y0: wing.rect.y1, x1: wing.rect.x1 - 0.35, y1: D + walk }
          : { x0: W - 3.2, y0: D + 0.2, x1: W - 0.4, y1: D + walk };
        break;
    }
  }
  // Any more outdoor areas share a lawn at the front corner, side by side.
  extras.forEach((zone, i) => {
    const x0 = W + 0.7 + wrap;
    const width = (right - wrap - 1.2) / extras.length;
    zone.rect = { x0: x0 + width * i, y0: D + 0.6, x1: x0 + width * (i + 1) - 0.15, y1: D + walk - 0.4 };
  });
  const basement = [...plan.stories].reverse().find((s) => s.basement);
  const bottom = basement ? Math.min(...plan.stories.map((s) => s.z)) - SLAB - 0.7 : -1.1;
  const pavement = D + front - 1.5;
  const walkway = entry
    ? { x0: entry.door - 0.6, y0: entry.deck.y1 + entry.steps, x1: entry.door + 0.6, y1: pavement }
    : null;
  const driveway = zones.find((z) => z.kind === 'driveway');
  const drive = driveway
    ? driveway.rect
    : wing
      ? { x0: wing.rect.x0 + 0.35, y0: wing.rect.y1, x1: wing.rect.x1 - 0.35, y1: pavement }
      : null;
  return {
    box: box(left, back, bottom, W + right, D + front, 0),
    entry,
    zones,
    front,
    walk: walkway,
    drive,
    fence: D + front - 1.75,
  };
}

// ─── Plants ──────────────────────────────────────────────────────────────────

/** A broad-leaved tree: a trunk with a root flare, and a crown of clumps of leaves round a dark heart. */
function tree(
  c: Context,
  x: number,
  y: number,
  size: number,
  rand: () => number,
  group: number,
  leaves?: Paint[],
): void {
  const m = c.mesh;
  const height = 2.9 * size;
  m.with({ group, room: 0, ...PAINT.bark }, () => {
    m.cylinder(x, y, 0, height * 0.72, 0.17 * size, 0.08 * size, 9, 0);
    m.cylinder(x, y, 0, 0.3 * size, 0.27 * size, 0.16 * size, 9, 0);
  });
  const paints = leaves ?? [PAINT.leaf, PAINT.leafLight, PAINT.leafDark, PAINT.leaf, PAINT.hedge];
  const reach = 1.2 * size;
  m.with({ group, room: 0, ...(leaves ? leaves[0] : PAINT.leafDark) }, () =>
    m.blob(x, y, height, reach * 0.8, reach * 0.8, reach * 0.7, rand, 0.16, 2),
  );
  const clumps = 12;
  for (let i = 0; i < clumps; i++) {
    // Spread evenly over a sphere, leaving out its underside.
    const up = 1 - ((i + 0.5) / clumps) * 1.5;
    const flat = Math.sqrt(Math.max(0, 1 - up * up));
    const turn = i * 2.39996 + rand() * 0.5;
    const r = (0.5 + rand() * 0.26) * size;
    m.with({ group, room: 0, ...paints[i % paints.length] }, () =>
      m.blob(
        x + Math.cos(turn) * flat * reach * 0.82,
        y + Math.sin(turn) * flat * reach * 0.82,
        height + up * reach * 0.66,
        r,
        r,
        r * 0.82,
        rand,
        0.22,
        2,
      ),
    );
  }
}

/** A fir: tiers of boughs, wide at the bottom. A cypress is the same thing drawn up tall and thin. */
function conifer(c: Context, x: number, y: number, size: number, group: number, slim = false): void {
  const m = c.mesh;
  const rand = seeded(Math.round(x * 97 + y * 31));
  const tiers = slim ? 4 : 5;
  m.with({ group, room: 0, ...PAINT.bark }, () =>
    m.cylinder(x, y, 0, (slim ? 0.5 : 1) * size, 0.11 * size, 0.08 * size, 8, 0),
  );
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const z0 = slim ? (0.25 + t * 3.6) * size : (0.55 + t * 2.7) * size;
    const r = slim ? (0.48 - t * 0.2) * size : (1.15 - t * 0.78) * size;
    const tall = slim ? (2.2 - t * 0.5) * size : (1.35 - t * 0.35) * size;
    const paint = slim ? PAINT.cypress : i % 2 ? PAINT.leafDark : PAINT.hedge;
    m.with({ group, room: 0, ...paint }, () => m.leafCone(x, y, z0, z0 + tall, r, r * (slim ? 0.25 : 0.12), rand));
  }
}

function plantTree(
  c: Context,
  kind: TreeKind,
  x: number,
  y: number,
  size: number,
  rand: () => number,
  group: number,
): void {
  if (kind === 'fir') conifer(c, x, y, size, group);
  else if (kind === 'cypress') conifer(c, x, y, size * 1.15, group, true);
  else if (kind === 'olive')
    tree(c, x, y, size * 0.72, rand, group, [
      PAINT.olive,
      tint(PAINT.olive, [146, 156, 122]),
      tint(PAINT.olive, [104, 120, 92]),
    ]);
  else if (kind === 'maple')
    tree(c, x, y, size * 0.68, rand, group, [
      PAINT.maple,
      tint(PAINT.maple, [176, 70, 48]),
      tint(PAINT.maple, [124, 40, 40]),
    ]);
  else tree(c, x, y, size, rand, group);
}

function shrub(c: Context, x: number, y: number, size: number, rand: () => number, group: number, paint: Paint): void {
  const m = c.mesh;
  m.with({ group, room: 0, ...paint }, () => {
    m.blob(x, y, 0.36 * size, 0.56 * size, 0.56 * size, 0.46 * size, rand, 0.2, 1);
    m.blob(x + 0.3 * size, y + 0.12 * size, 0.3 * size, 0.4 * size, 0.4 * size, 0.36 * size, rand, 0.2, 1);
    m.blob(x - 0.26 * size, y - 0.1 * size, 0.28 * size, 0.38 * size, 0.38 * size, 0.33 * size, rand, 0.2, 1);
  });
}

/** One thing that grows along the house, as the garden has it. */
function borderPlant(c: Context, g: Garden, x: number, y: number, rand: () => number, group: number, n: number): void {
  const m = c.mesh;
  const paint = g.blooms[n % g.blooms.length];
  if (g.border === 'balls') {
    // Clipped into a ball.
    m.with({ group, room: 0, ...(n % 3 === 2 ? paint : PAINT.boxwood) }, () =>
      m.blob(x, y, 0.4, 0.46, 0.46, 0.44, rand, 0.05, 2),
    );
  } else if (g.border === 'grasses') {
    if (n % 3 === 1)
      m.with({ group, room: 0, ...PAINT.boulder }, () => m.blob(x, y, 0.16, 0.42, 0.34, 0.26, rand, 0.2, 1));
    else m.with({ group, room: 0, ...paint }, () => m.leafCone(x, y, 0, 0.95 + rand() * 0.3, 0.34, 0.05, rand));
  } else if (g.border === 'pots') {
    if (n % 2) {
      m.with({ group, room: 0, ...PAINT.terracotta }, () => m.cylinder(x, y, 0, 0.42, 0.2, 0.27, 12, 0));
      m.with({ group, room: 0, ...paint }, () => m.blob(x, y, 0.58, 0.32, 0.32, 0.28, rand, 0.2, 1));
    } else shrub(c, x, y, 0.62, rand, group, paint);
  } else shrub(c, x, y, 0.8 + rand() * 0.25, rand, group, paint);
}

/** A flat slab lying on the lawn: a path, a patio, a driveway. */
function slab(c: Context, r: Rect, paint: Paint = PAINT.path, group = c.groups.ground, height = 0.03): void {
  if (r.x1 - r.x0 < 0.05 || r.y1 - r.y0 < 0.05) return;
  c.mesh.with({ group, room: 0, ...paint }, () => c.mesh.box(r.x0, r.y0, 0, r.x1, r.y1, height, SKIP.bottom));
}

/** A fence along y, from x0 to x1, leaving the gaps open. */
function fence(
  c: Context,
  kind: Garden['fence'],
  x0: number,
  x1: number,
  y: number,
  gaps: [number, number][],
  group: number,
): void {
  if (kind === 'none') return;
  const m = c.mesh;
  const runs: [number, number][] = [];
  let from = x0;
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (a - from > 0.6) runs.push([from, Math.min(a, x1)]);
    from = Math.max(from, b);
  }
  if (x1 - from > 0.6) runs.push([from, x1]);
  const paint = kind === 'iron' ? PAINT.ironwork : PAINT.fence;
  for (const [a, b] of runs) {
    const posts = Math.max(1, Math.round((b - a) / (kind === 'rail' ? 2.2 : 1.9)));
    const tall = kind === 'iron' ? 1.05 : kind === 'rail' ? 1.05 : 0.95;
    m.with({ group, room: 0, ...paint }, () => {
      for (let i = 0; i <= posts; i++) {
        const x = a + ((b - a) * i) / posts;
        const w = kind === 'iron' ? 0.03 : kind === 'rail' ? 0.06 : 0.05;
        m.box(x - w, y - w, 0, x + w, y + w, tall + (kind === 'iron' ? 0.1 : 0.06));
      }
      if (kind === 'rail') {
        for (const h of [0.35, 0.65, 0.95]) m.box(a, y - 0.025, h - 0.05, b, y + 0.025, h + 0.05);
      } else if (kind === 'iron') {
        m.box(a, y - 0.015, 0.14, b, y + 0.015, 0.18);
        m.box(a, y - 0.015, tall - 0.08, b, y + 0.015, tall - 0.04);
        for (let x = a + 0.16; x < b - 0.05; x += 0.16)
          m.box(x - 0.011, y - 0.011, 0.14, x + 0.011, y + 0.011, tall + 0.06);
      } else {
        m.box(a, y - 0.03, 0.22, b, y - 0.005, 0.3);
        m.box(a, y - 0.03, 0.66, b, y - 0.005, 0.74);
        for (let x = a + 0.07; x < b - 0.03; x += 0.135) m.box(x - 0.038, y - 0.005, 0.06, x + 0.038, y + 0.014, tall);
      }
    });
  }
}

// ─── The ground ──────────────────────────────────────────────────────────────

/** The block of earth: its sides show the soil, and the front of it lifts away to reveal a basement. */
function terrain(c: Context, s: Site, g: Garden): void {
  const m = c.mesh;
  const { x0, y0, x1, y1, z0 } = s.box;
  const basement = c.plan.stories.find((st) => st.basement);
  const W = c.plan.width;
  const D = c.plan.depth;
  const base = c.groups.base;
  const front = c.groups.ground;
  const grass = tint(PAINT.grass, g.lawn);
  // The level the earth is dug down to in front of a basement.
  const dig = basement ? basement.z - SLAB : 0;
  const wallX = (x: number, a: number, b: number, lo: number, hi: number, n: number, group: number) =>
    m.with({ group, room: 0, ...PAINT.soil }, () => m.quad([x, a, lo], [x, b, lo], [x, b, hi], [x, a, hi], [n, 0, 0]));
  const wallY = (y: number, a: number, b: number, lo: number, hi: number, n: number, group: number) =>
    m.with({ group, room: 0, ...PAINT.soil }, () => m.quad([a, y, lo], [b, y, lo], [b, y, hi], [a, y, hi], [0, n, 0]));
  const top = (r: Rect, z: number, group: number, paint: Paint = grass) =>
    m.with({ group, room: 0, ...paint }, () =>
      m.quad([r.x0, r.y0, z], [r.x1, r.y0, z], [r.x1, r.y1, z], [r.x0, r.y1, z], [0, 0, 1]),
    );
  // Below the dig level the block is whole.
  wallY(y1, x0, x1, z0, dig, 1, base);
  wallX(x1, y0, y1, z0, dig, 1, base);
  wallY(y0, x0, x1, z0, 0, -1, base);
  wallX(x0, y0, y1, z0, 0, -1, base);
  // Above it, the back and left stay; the front right quarter can go.
  wallY(y1, x0, 0, dig, 0, 1, base);
  wallY(y1, 0, x1, dig, 0, 1, front);
  wallX(x1, y0, 0, dig, 0, 1, base);
  wallX(x1, 0, y1, dig, 0, 1, front);
  top({ x0, y0, x1: 0, y1 }, 0, base);
  top({ x0: 0, y0, x1, y1: 0 }, 0, base);
  top({ x0: 0, y0: 0, x1, y1 }, 0, front);
  if (basement) {
    // What shows once the front is dug away: the pit's floor and the cut earth behind it.
    top({ x0: 0, y0: 0, x1, y1 }, dig, base, tint(PAINT.soil, [124, 98, 76]));
    wallX(0, D, y1, dig, 0, 1, base);
    wallY(0, W, x1, dig, 0, 1, base);
  }
}

/** What grows along the house and behind it, the fence along the road, and a mailbox at the gate. */
function planting(c: Context, s: Site, g: Garden): void {
  const plan = c.plan;
  const m = c.mesh;
  const W = plan.width;
  const D = plan.depth;
  const rand = seeded(Math.round(W * 131 + D * 71 + s.zones.length * 17));
  const wing = plan.wing;
  const entry = s.entry;
  const blockedFront: [number, number][] = [];
  const blockedRight: [number, number][] = [];
  if (entry) blockedFront.push([entry.deck.x0 - 0.4, entry.deck.x1 + 0.4]);
  if (entry?.side) blockedRight.push([entry.side.y0 - 0.4, D + 0.5]);
  for (const zone of s.zones) {
    if (zone.rect.y0 <= D + 1 && zone.rect.y1 > D) blockedFront.push([zone.rect.x0 - 0.5, zone.rect.x1 + 0.5]);
    if (zone.rect.x0 <= W + 1.2 && zone.rect.x1 > W) blockedRight.push([zone.rect.y0 - 0.5, zone.rect.y1 + 0.5]);
  }
  const free = (u: number, blocked: [number, number][]) => !blocked.some(([a, b]) => u > a && u < b);
  const ground = c.groups.ground;
  // A bed along the front and the side of the house.
  const step = g.border === 'balls' ? 1.25 : 1.5;
  let n = 0;
  for (let x = 0.75; x < W - 0.5; x += step) {
    if (!free(x, blockedFront)) continue;
    slab(c, { x0: x - step / 2, y0: D, x1: x + step / 2, y1: D + 1.0 }, g.bed, ground, 0.025);
    borderPlant(c, g, x, D + 0.52, rand, ground, n++);
  }
  for (let y = 0.9; y < D - 0.5; y += step + 0.1) {
    if (!free(y, blockedRight)) continue;
    slab(c, { x0: W, y0: y - step / 2, x1: W + 1.0, y1: y + step / 2 }, g.bed, ground, 0.025);
    borderPlant(c, g, W + 0.52, y, rand, ground, n++);
  }
  // Flanking the path, where a formal garden puts a pair of something.
  if (entry && (g.border === 'balls' || g.border === 'pots')) {
    const y = entry.deck.y1 + entry.steps + 0.5;
    for (const dx of [-1.15, 1.15]) {
      if (g.border === 'pots') {
        m.with({ group: ground, room: 0, ...PAINT.terracotta }, () =>
          m.cylinder(entry.door + dx, y, 0, 0.5, 0.22, 0.3, 12, 0),
        );
        m.with({ group: ground, room: 0, ...g.blooms[1] }, () =>
          m.blob(entry.door + dx, y, 0.72, 0.36, 0.36, 0.32, rand, 0.2, 1),
        );
      } else {
        m.with({ group: ground, room: 0, ...PAINT.boxwood }, () => {
          m.leafCone(entry.door + dx, y, 0.05, 1.35, 0.36, 0.05, rand);
        });
      }
    }
  }
  // Behind the house.
  const { x0, y0, x1, y1 } = s.box;
  const back = c.groups.base;
  if (g.back === 'slats') {
    // A screen of wooden slats, with grasses in front of it.
    m.with({ group: back, room: 0, ...PAINT.wood }, () => {
      for (let x = x0 + 0.5; x < x1 - 0.3; x += 2) m.box(x - 0.05, y0 + 0.36, 0, x + 0.05, y0 + 0.46, 1.75);
      for (let h = 0.2; h < 1.7; h += 0.21) m.box(x0 + 0.45, y0 + 0.46, h, x1 - 0.35, y0 + 0.49, h + 0.15, 0, false);
    });
    for (let x = x0 + 1.4; x < x1 - 0.8; x += 2.3) {
      m.with({ group: back, room: 0, ...(rand() > 0.5 ? PAINT.reeds : PAINT.blueGrass) }, () =>
        m.leafCone(x, y0 + 1.05, 0, 1.2 + rand() * 0.4, 0.4, 0.05, rand),
      );
    }
  } else if (g.back === 'firs' || g.back === 'cypress') {
    for (let x = x0 + 1.1; x < x1 - 0.7; x += g.back === 'cypress' ? 1.9 : 2.4) {
      conifer(c, x, y0 + 1.0, 0.82 + rand() * 0.3, back, g.back === 'cypress');
    }
  } else {
    for (let x = x0 + 0.7; x < x1 - 0.4; x += 0.95) {
      m.with({ group: back, room: 0, ...PAINT.hedge }, () =>
        m.blob(x, y0 + 0.7, 0.62, 0.66, 0.6, 0.72, rand, g.back === 'mixed' ? 0.2 : 0.1, 1),
      );
    }
  }
  // Trees in the corners behind the house, and one beside it.
  const spots: [number, number, number][] = [
    [x0 + 1.7, y0 + 2.2, 1.2],
    [W + 1.6, y0 + 1.9, 1.0],
    [W * 0.5, y0 + 1.9, 1.0],
  ];
  g.trees.forEach((kind, i) => {
    const [x, y, size] = spots[i % spots.length];
    if (i === 2 && W < 9) return;
    plantTree(c, kind, x, y, size, rand, back);
  });
  if (!wing) plantTree(c, g.trees[0], x0 + 1.5, D + 1.5, 0.82, rand, back);
  else
    plantTree(
      c,
      g.trees[g.trees.length - 1] === 'oak' ? 'fir' : g.trees[g.trees.length - 1],
      x0 + 1.2,
      wing.rect.y0 + 1.5,
      0.8,
      rand,
      back,
    );
  // A fence along the road, open at the path and the driveway.
  const gaps: [number, number][] = [];
  if (entry) gaps.push([entry.door - 0.85, entry.door + 0.85]);
  if (wing) gaps.push([wing.rect.x0 + 0.1, wing.rect.x1 - 0.1]);
  for (const zone of s.zones) if (zone.kind === 'driveway') gaps.push([zone.rect.x0 - 0.25, zone.rect.x1 + 0.25]);
  fence(c, g.fence, x0 + 0.35, 0, s.fence, gaps, back);
  fence(c, g.fence, 0, x1 - 0.35, s.fence, gaps, ground);
  // A mailbox where the path meets the road.
  if (entry) {
    const mx = entry.door + 1.05;
    const my = y1 - 1.72;
    m.with({ group: ground, room: 0, ...PAINT.darkWood }, () =>
      m.box(mx - 0.04, my - 0.04, 0, mx + 0.04, my + 0.04, 1.0),
    );
    m.with({ group: ground, room: 0, ...PAINT.black }, () =>
      m.softBox(mx - 0.1, my - 0.22, 1.0, mx + 0.1, my + 0.22, 1.24, 0.07),
    );
    m.with({ group: ground, room: 0, ...tint(PAINT.car, [190, 50, 44]) }, () =>
      m.box(mx + 0.1, my + 0.1, 1.1, mx + 0.115, my + 0.16, 1.3),
    );
  }
}

/** The path from the door, the pavement along the road and the driveway. */
function paths(c: Context, s: Site, g: Garden): void {
  const plan = c.plan;
  const ground = c.groups.ground;
  const { x0, x1, y1 } = s.box;
  // The pavement along the front of the plot, in two parts so the left one stays with the earth.
  slab(c, { x0, y0: y1 - 1.5, x1: 0, y1: y1 - 0.12 }, PAINT.concrete, c.groups.base, 0.05);
  slab(c, { x0: 0, y0: y1 - 1.5, x1, y1: y1 - 0.12 }, PAINT.concrete, ground, 0.05);
  const walk = s.walk;
  if (walk) {
    if (g.pads) {
      // Separate slabs, with the lawn between them.
      for (let y = walk.y0 + 0.15; y < walk.y1 - 0.5; y += 1.0) {
        slab(
          c,
          { x0: walk.x0 - 0.02, y0: y, x1: walk.x1 + 0.02, y1: Math.min(y + 0.78, y1 - 1.55) },
          g.walk,
          ground,
          0.035,
        );
      }
    } else slab(c, walk, g.walk, ground);
  }
  // The driveway to the garage; one that is an outdoor area is drawn with it.
  if (s.drive && plan.wing && !s.zones.some((z) => z.kind === 'driveway'))
    slab(c, s.drive, g.drive, c.groups.base, 0.035);
}

/** Draws the outdoor areas. Returns a volume for each, so it can be picked and outlined. */
function drawZones(c: Context, s: Site, g: Garden): Map<string, Box> {
  const volumes = new Map<string, Box>();
  const m = c.mesh;
  const ground = c.groups.ground;
  const rand = seeded(977);
  for (const zone of s.zones) {
    const room = c.input.outdoor.find((r) => r.id === zone.roomId);
    if (!room) continue;
    const r = zone.rect;
    const tall = zone.kind === 'porch' ? c.plan.base + 2.4 : 1.4;
    volumes.set(zone.roomId, box(r.x0, r.y0, 0, r.x1, r.y1, tall));
    if (zone.kind === 'porch') continue;
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    if (zone.kind === 'driveway') slab(c, r, g.drive, c.plan.wing ? c.groups.base : ground, 0.035);
    else if (zone.kind === 'patio') {
      slab(c, r, PAINT.patio);
      // A table with a parasol and chairs.
      const size = Math.min(0.55, (r.x1 - r.x0) / 2 - 0.9, (r.y1 - r.y0) / 2 - 0.7);
      if (size > 0.3) {
        m.with({ group: ground, room: 0, ...PAINT.paleWood }, () => {
          m.cylinder(cx, cy, 0.7, 0.74, size, size, 18, 3);
          m.cylinder(cx, cy, 0.03, 0.7, 0.04, 0.04, 8, 0);
        });
        m.with({ group: ground, room: 0, ...PAINT.lampPost }, () => m.cylinder(cx, cy, 0.74, 2.3, 0.02, 0.02, 6, 0));
        m.with({ group: ground, room: 0, ...PAINT.linen }, () =>
          m.cylinder(cx, cy, 2.0, 2.35, size * 2.3, 0.03, 12, 0),
        );
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const px = cx + dx * (size + 0.3);
          const py = cy + dy * (size + 0.3);
          m.with({ group: ground, room: 0, ...PAINT.paleWood }, () => {
            m.box(px - 0.2, py - 0.2, 0.4, px + 0.2, py + 0.2, 0.45);
            m.box(
              px - 0.2 + (dx > 0 ? 0.36 : 0),
              py - 0.2 + (dy > 0 ? 0.36 : 0),
              0.45,
              px + 0.2 - (dx < 0 ? 0.36 : 0),
              py + 0.2 - (dy < 0 ? 0.36 : 0),
              0.85,
            );
            m.cylinder(px, py, 0.03, 0.4, 0.03, 0.03, 6, 0);
          });
        }
      }
    } else if (zone.kind === 'pool') {
      slab(c, r, PAINT.patio);
      const p = { x0: r.x0 + 0.45, y0: r.y0 + 0.45, x1: r.x1 - 0.45, y1: r.y1 - 0.45 };
      m.with({ group: ground, room: 0, ...PAINT.stone }, () => m.box(p.x0, p.y0, 0, p.x1, p.y1, 0.2, SKIP.bottom));
      m.with({ group: ground, room: 0, ...PAINT.water }, () =>
        m.quad(
          [p.x0 + 0.2, p.y0 + 0.2, 0.205],
          [p.x1 - 0.2, p.y0 + 0.2, 0.205],
          [p.x1 - 0.2, p.y1 - 0.2, 0.205],
          [p.x0 + 0.2, p.y1 - 0.2, 0.205],
          [0, 0, 1],
        ),
      );
      m.with({ group: ground, room: 0, ...PAINT.chrome }, () => {
        for (const dx of [0, 0.4]) m.cylinder(p.x0 + 0.5 + dx, p.y0 + 0.18, 0.2, 0.75, 0.018, 0.018, 6, 2);
      });
    } else {
      // A garden or a yard: the garden's own trees, a bed of what blooms in it, a shrub.
      const spots: [number, number, number][] =
        zone.kind === 'garden'
          ? [
              [r.x1 - 1.3, r.y0 + 1.3, 0.95],
              [r.x1 - 1.1, r.y1 - 1.6, 0.72],
            ]
          : [[cx, cy, 0.8]];
      spots.forEach(([x, y, size], i) => {
        if (x > r.x0 + 0.5 && x < r.x1 && y > r.y0 + 0.5 && y < r.y1)
          plantTree(c, g.trees[i % g.trees.length], x, y, size, rand, ground);
      });
      if (zone.kind === 'garden' && r.y1 - r.y0 > 3) {
        const bed = { x0: r.x0 + 0.3, y0: cy - 0.5, x1: Math.min(r.x1 - 2.2, r.x0 + 2.6), y1: cy + 0.9 };
        if (bed.x1 - bed.x0 > 0.8) {
          slab(c, bed, g.bed, ground, 0.03);
          let n = 0;
          for (let x = bed.x0 + 0.45; x < bed.x1 - 0.2; x += 0.75)
            borderPlant(
              c,
              { ...g, border: g.border === 'balls' ? 'shrubs' : g.border },
              x,
              (bed.y0 + bed.y1) / 2,
              rand,
              ground,
              n++,
            );
        }
      }
      shrub(c, r.x1 - 0.6, r.y1 - 0.5, 0.9, rand, ground, PAINT.hedge);
    }
  }
  return volumes;
}

/** Builds the plot. Returns a volume for every outdoor area. */
export function buildSite(c: Context, s: Site): Map<string, Box> {
  const g = GARDENS[c.style.garden];
  terrain(c, s, g);
  if (c.plan.stories.length) {
    paths(c, s, g);
    planting(c, s, g);
  }
  const volumes = drawZones(c, s, g);
  lightOutdoors(c, s);
  return volumes;
}
