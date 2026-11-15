// Life around the house: birds that fly by in the day and bats at dusk, fireflies on summer
// nights, shooting stars, now and then a plane or a satellite, and smoke from the chimney when it
// is cold. None of it is part of the picture of the house: the sky pass draws it, frame by frame,
// over the sky and, where it is nearer, over the house too.
//
// Nothing comes at a set time, from the same side or in the same way twice in a row, so it never
// turns into a loop that the eye learns.

import { BIRD_FLOATS, DAYLIGHT, layBird, posture, type Kind, type Light } from './birds.ts';
import { FOV, type Camera, type SkyFrame } from './camera.ts';
import { cross, dot, normalize, toWorld, transform, type Vec3 } from './math.ts';

export { BIRD_FLOATS, KINDS, type Kind } from './birds.ts';

/** A point in plan space: x along the front of the house, y from its back to its front, z up. */
export type Point = [number, number, number];
export type Rand = () => number;
type RGB = [number, number, number];

export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where things happen, in plan space. */
export interface Stage {
  /** The middle of the house at the ground, and how far its corners are from there. */
  center: Point;
  radius: number;
  /** The highest point of the roof. */
  ridge: number;
  /** The plot, and the ground the buildings stand on. */
  plot: Area;
  buildings: Area[];
  /** The top of the chimney, where smoke comes out. */
  chimney: Point | null;
}

/** The time of day, the season and the weather. */
export interface Conditions {
  /** The sun's height above the horizon, in degrees. */
  sun: number;
  /** How well the stars show, 0–1. */
  stars: number;
  /** How much of the sky is cloud, 0–1. */
  clouds: number;
  /** 0 for January. */
  month: number;
  southern: boolean;
  /** Days since 1970, so that a night keeps its fireflies, or its lack of them. */
  day: number;
  /** In °C, when a weather entity says. */
  temperature?: number;
  /** Where the wind blows toward, in plan space, and its speed in m/s. */
  wind?: { x: number; y: number; speed: number };
  /** Rain or snow. */
  wet?: boolean;
  /** How much of the roof shows, 0–1: it lifts away when a floor is opened. */
  roof: number;
  /** The sun or the moon and the light of the sky, as they light the house; daylight when not given. */
  light?: Light;
}

/** How things are put on the screen. */
export interface Lens {
  /**
   * A point on the screen: CSS pixels from the top left, its depth (0–1), how many pixels a meter is
   * there, and how far it is from the viewer along the line of sight, in meters.
   */
  point(p: Point): { x: number; y: number; depth: number; scale: number; distance: number } | null;
  /** A direction in the sky (world space) on the screen, in CSS pixels; null when it is behind the viewer. */
  sky(d: Vec3): [number, number] | null;
  /** The direction in the sky behind a spot on the screen. */
  ray(x: number, y: number): Vec3;
  /** Which way the viewer looks along the ground, in plan space. */
  forward: [number, number];
  width: number;
  height: number;
  /** Where the viewer is, in plan space. */
  eye: Point;
}

/** The lens of a camera, with the sky seen through the frame behind the house. */
export function lensFor(camera: Camera, frame: SkyFrame, target: Vec3, width: number, height: number): Lens {
  const focal = height / 2 / Math.tan(FOV / 2);
  const look = [target[0] - camera.eye[0], target[2] - camera.eye[2]];
  const l = Math.hypot(look[0], look[1]) || 1;
  const { forward: F, right: R, up: U } = frame;
  const rr = dot(R, R);
  const uu = dot(U, U);
  return {
    point(p) {
      const c = transform(camera.viewProj, toWorld(p[0], p[1], p[2]));
      if (c[3] < 0.1) return null;
      return {
        x: ((c[0] / c[3]) * 0.5 + 0.5) * width,
        y: (0.5 - (c[1] / c[3]) * 0.5) * height,
        depth: (c[2] / c[3]) * 0.5 + 0.5,
        scale: focal / c[3],
        distance: c[3],
      };
    },
    sky(d) {
      const f = dot(d, F);
      if (f < 0.05) return null;
      return [((dot(d, R) / (f * rr) + 1) / 2) * width, ((1 - dot(d, U) / (f * uu)) / 2) * height];
    },
    ray(x, y) {
      const a = (2 * x) / width - 1;
      const b = 1 - (2 * y) / height;
      return normalize([F[0] + R[0] * a + U[0] * b, F[1] + R[1] * a + U[1] * b, F[2] + R[2] * a + U[2] * b]);
    },
    forward: [look[0] / l, look[1] / l],
    width,
    height,
    eye: [camera.eye[0], camera.eye[2], camera.eye[1]],
  };
}

// ─── What the sky pass is handed ─────────────────────────────────────────────

export const MAX_BIRDS = 10;
export const MAX_GLOWS = 20;
export const MAX_PUFFS = 14;
export const MAX_METEORS = 2;
export const MAX_SKY_LIGHTS = 6;
/** Numbers per glow and so on, in the arrays below: whole vec4s for the shader. Birds are in birds.ts. */
export const GLOW_FLOATS = 8;
export const PUFF_FLOATS = 8;
export const METEOR_FLOATS = 12;
export const LIGHT_FLOATS = 8;

/**
 * One frame of it, in CSS pixels from the top left. Birds: a row of triangles each, nearest last
 * (see `BIRD_TEXELS` in birds.ts). Glows: where, how far the glow reaches, depth,
 * color and the size of the spark. Puffs of smoke: where, radius, depth, color and opacity.
 * Meteors: from, to, how far along, brightness, width, whether a fireball, color, and its glowing
 * train. Lights in the sky: where, size and color. The trail: head, tail, its widths and opacity.
 */
export interface Scene {
  birds: Float32Array;
  birdCount: number;
  glows: Float32Array;
  glowCount: number;
  puffs: Float32Array;
  puffCount: number;
  meteors: Float32Array;
  meteorCount: number;
  lights: Float32Array;
  lightCount: number;
  trail: Float32Array;
  /** Something is moving fast enough to need every frame. */
  busy: boolean;
}

export const emptyScene = (): Scene => ({
  birds: new Float32Array(MAX_BIRDS * BIRD_FLOATS),
  birdCount: 0,
  glows: new Float32Array(MAX_GLOWS * GLOW_FLOATS),
  glowCount: 0,
  puffs: new Float32Array(MAX_PUFFS * PUFF_FLOATS),
  puffCount: 0,
  meteors: new Float32Array(MAX_METEORS * METEOR_FLOATS),
  meteorCount: 0,
  lights: new Float32Array(MAX_SKY_LIGHTS * LIGHT_FLOATS),
  lightCount: 0,
  trail: new Float32Array(8),
  busy: false,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const add = (a: Point, b: Point, k = 1): Point => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** A path, walked at an even pace. */
class Route {
  readonly points: Point[];
  private readonly at: number[] = [0];
  readonly length: number;

  constructor(points: Point[]) {
    this.points = points;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      this.at.push(this.at[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    this.length = this.at[this.at.length - 1];
  }

  /** The point a distance along it. */
  get(d: number): Point {
    const at = this.at;
    if (d <= 0) return this.points[0];
    if (d >= this.length) return this.points[this.points.length - 1];
    let lo = 0;
    let hi = at.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (at[mid] <= d) lo = mid;
      else hi = mid;
    }
    const t = (d - at[lo]) / Math.max(1e-9, at[hi] - at[lo]);
    const a = this.points[lo];
    const b = this.points[hi];
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, n = 48): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = 1 - t;
    const k = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
    out.push([0, 1, 2].map((j) => k[0] * p0[j] + k[1] * p1[j] + k[2] * p2[j] + k[3] * p3[j]) as Point);
  }
  return out;
}

/** Lifts a path over the house where it would go through it, and keeps it off the ground. */
function overRoofs(points: Point[], stage: Stage): Point[] {
  const clear = stage.ridge + 1.6;
  return points.map((p) => {
    let near = Infinity;
    for (const b of stage.buildings) {
      const dx = Math.max(b.x0 - p[0], 0, p[0] - b.x1);
      const dy = Math.max(b.y0 - p[1], 0, p[1] - b.y1);
      near = Math.min(near, Math.hypot(dx, dy));
    }
    const z = Math.max(p[2], lerp(p[2], clear, smooth(4, 0.5, near)));
    return [p[0], p[1], Math.max(0.8, z)];
  });
}

// ─── Birds ───────────────────────────────────────────────────────────────────

// How each kind looks and holds its wings is in birds.ts; here is where and how fast it flies.

interface Species {
  /** Wingspan, in meters, and speed, in meters a second. */
  span: number;
  speed: [number, number];
  /** How high it flies: above the ground, and above the ridge of the roof. */
  low: (ridge: number) => number;
  high: (ridge: number) => number;
}

const SPECIES: Record<Kind, Species> = {
  songbird: {
    span: 0.25,
    speed: [7.5, 10],
    low: () => 2.2,
    high: (r) => r + 2.5,
  },
  swallow: {
    span: 0.32,
    speed: [10, 13],
    low: () => 1.4,
    high: (r) => r + 1,
  },
  crow: {
    span: 0.95,
    speed: [8.5, 10.5],
    low: (r) => r - 2,
    high: (r) => r + 3,
  },
  gull: {
    span: 1.25,
    speed: [8.5, 11],
    low: (r) => r - 1,
    high: (r) => r + 4,
  },
  goose: {
    span: 1.6,
    speed: [12, 14.5],
    low: (r) => r + 1,
    high: (r) => r + 5,
  },
  hawk: {
    span: 1.25,
    speed: [6, 7.5],
    low: (r) => r + 1.5,
    high: (r) => r + 4.5,
  },
  bat: {
    span: 0.3,
    speed: [4.5, 6.5],
    low: () => 1.6,
    high: (r) => r + 1,
  },
};

interface Bird {
  /** Where it flies in the flock: meters behind the leader, to its side, and above. */
  back: number;
  across: number;
  up: number;
  span: number;
  /** Its own timing, and numbers for its own wobbles. */
  phase: number;
  seed: number[];
}

type Approach = 'across' | 'toward' | 'away' | 'circle';

interface Flight {
  kind: Kind;
  start: number;
  speed: number;
  route: Route;
  birds: Bird[];
  /** When the last of them is done. */
  end: number;
}

/** How a bird of a kind strays from the line its flock flies along, as a swallow swoops or a bat jinks. */
function wander(kind: Kind, t: number, bird: Bird): { across: number; up: number } {
  const s = bird.seed;
  switch (kind) {
    case 'songbird': {
      // It rises while it beats its wings and sinks while they are shut, in time with `posture`.
      const length = 0.7 + s[1] * 0.25;
      const c = (((t + s[0] * 10) % length) + length) % length;
      const rise = c < 0.36 ? c / 0.36 : 1 - (c - 0.36) / (length - 0.36);
      return { across: 0, up: 0.22 * smooth(0, 1, rise) };
    }
    case 'swallow':
      return {
        across: 1.8 * Math.sin(t * (3.4 + s[2] * 2) + s[3] * TAU),
        up: 1.3 * Math.sin(t * (2.6 + s[4] * 2) + s[5] * TAU),
      };
    case 'bat':
      return {
        across: 0.9 * Math.sin(t * (7 + s[2] * 5) + s[3] * TAU) + 0.5 * Math.sin(t * (13 + s[4] * 4)),
        up: 0.6 * Math.sin(t * (8 + s[5] * 5) + s[1] * TAU) + 0.3 * Math.sin(t * (17 + s[2] * 3)),
      };
    default:
      return { across: 0, up: 0 };
  }
}

// ─── Meteors, planes and satellites ──────────────────────────────────────────

interface Meteor {
  start: number;
  duration: number;
  /** From and to, as shares of the width and height of the picture. */
  from: [number, number];
  to: [number, number];
  brightness: number;
  width: number;
  color: RGB;
  fireball: boolean;
  /** How long its train glows after it has gone, in seconds. */
  train: number;
}

interface Crossing {
  start: number;
  duration: number;
  from: Vec3;
  to: Vec3;
  /** A plane leaves a trail by day, and shows its lights at night. */
  trail: boolean;
  lit: boolean;
  satellite: boolean;
  brightness: number;
}

interface Firefly {
  home: Point;
  seed: number[];
  period: number;
  flash: number;
}

interface Puff {
  born: number;
  life: number;
  from: Point;
  seed: number;
}

/** What can be asked for, for the demo and for tests. */
export type Happening = Kind | 'meteor' | 'fireball' | 'plane' | 'satellite';

type Channel = 'flight' | 'meteor' | 'plane' | 'satellite' | 'puff';

/** The life around one house. Call `frame` for every picture; it works out what to show. */
export class Life {
  readonly scene: Scene = emptyScene();
  private readonly rand: Rand;
  private flights: Flight[] = [];
  /** Room to lay out each bird before the nearest are chosen, kept from frame to frame. */
  private rows: Float32Array[] = [];
  private meteors: Meteor[] = [];
  private crossings: Crossing[] = [];
  private fireflies: Firefly[] = [];
  private fireflyStage?: Stage;
  private fireflyStart = 0;
  private puffs: Puff[] = [];
  private next: Partial<Record<Channel, number>> = {};
  private requests: Happening[] = [];
  /** Things to do a moment later, on this clock, so a card that pauses does not lose them. */
  private pending: { at: number; run: () => void }[] = [];
  /** What came last, so the next is something else. */
  private last = { kind: '', approach: '', side: 0, meteor: { x: -1, angle: 999 }, plane: 0 };
  private lastHawk = -Infinity;
  /** Kinds of bird that have flown, in order; for tests. */
  readonly log: { kind: Kind; approach: Approach; side: number; at: number }[] = [];
  readonly meteorLog: { at: number; angle: number; x: number; fireball: boolean }[] = [];

  constructor(rand: Rand = Math.random) {
    this.rand = rand;
  }

  /** Asks for something to happen at the next frame, whatever the schedule says. */
  request(what: Happening): void {
    this.requests.push(what);
  }

  get busy(): boolean {
    return this.scene.busy;
  }

  /** Works out what shows at a moment (milliseconds, as `performance.now()`), and returns it. */
  frame(nowMs: number, cond: Conditions, stage: Stage, lens: Lens): Scene {
    const now = nowMs / 1000;
    const r = this.rand;
    if (this.due('flight', now, cond.sun > -9, [7, 20], cond.sun > 2 ? [28, 80] : [16, 45])) {
      // Birds mostly shelter from the rain.
      if (!cond.wet || r() < 0.25) this.flight(now, cond, stage, lens);
    }
    if (this.due('meteor', now, cond.stars > 0.45 && cond.clouds < 0.85, [5, 16], [22, 75]))
      this.meteor(now, this.rand() < 0.1);
    if (this.due('plane', now, cond.clouds < 0.8, [70, 200], [240, 600])) this.plane(now, cond, lens);
    if (this.due('satellite', now, cond.stars > 0.6 && cond.sun < -10 && cond.clouds < 0.6, [40, 140], [150, 420])) {
      this.satellite(now, lens);
    }
    this.runPending(now);
    for (const want of this.requests.splice(0)) {
      if (want === 'meteor' || want === 'fireball') this.meteor(now, want === 'fireball');
      else if (want === 'plane') this.plane(now, cond, lens);
      else if (want === 'satellite') this.satellite(now, lens);
      else this.flight(now, cond, stage, lens, want);
    }
    this.flights = this.flights.filter((f) => now < f.end);
    this.meteors = this.meteors.filter((m) => now < m.start + m.duration + m.train);
    this.crossings = this.crossings.filter((c) => now < c.start + c.duration);
    this.smoke(now, cond, stage);
    this.updateFireflies(now, cond, stage);

    const scene = this.scene;
    scene.busy = this.flights.length > 0 || this.meteors.some((m) => now < m.start + m.duration);
    this.drawPuffs(now, cond, lens);
    this.drawBirds(now, cond, lens);
    this.drawFireflies(now, cond, lens);
    this.drawMeteors(now, lens);
    this.drawCrossings(now, lens);
    return scene;
  }

  /** Whether something on a channel is due now; it then schedules the next. */
  private due(channel: Channel, now: number, on: boolean, first: [number, number], every: [number, number]): boolean {
    if (!on) {
      delete this.next[channel];
      return false;
    }
    const at = this.next[channel];
    if (at === undefined) {
      this.next[channel] = now + lerp(first[0], first[1], this.rand());
      return false;
    }
    if (now < at) return false;
    this.next[channel] = now + lerp(every[0], every[1], this.rand());
    return true;
  }

  /** One of a list, by weight, never the one to avoid unless there is nothing else. */
  private pick<T>(options: [T, number][], avoid?: T): T | undefined {
    const list = options.filter(([v, w]) => v !== avoid && w > 0);
    const from = list.length ? list : options;
    const total = from.reduce((sum, [, w]) => sum + w, 0);
    let x = this.rand() * total;
    for (const [v, w] of from) {
      x -= w;
      if (x <= 0) return v;
    }
    return from.at(-1)?.[0];
  }

  // ─── Birds ─────────────────────────────────────────────────────────────────

  private kindFor(now: number, cond: Conditions): Kind | undefined {
    // The season as it is in the north.
    const m = cond.southern ? (cond.month + 6) % 12 : cond.month;
    const warm = m >= 3 && m <= 8;
    const migrating = m === 2 || m === 3 || (m >= 8 && m <= 10);
    const options: [Kind, number][] = [];
    if (cond.sun > 2) {
      options.push(['songbird', 3], ['crow', 1.4], ['gull', 1]);
      if (warm) options.push(['swallow', 1.6]);
      if (migrating) options.push(['goose', 1.3]);
      if (now - this.lastHawk > 240) options.push(['hawk', 0.9]);
    } else {
      if (warm && cond.sun < 1) options.push(['bat', 4]);
      options.push(['crow', 1.2], ['songbird', 1]);
      if (migrating) options.push(['goose', 0.8]);
    }
    return this.pick(options, this.last.kind as Kind);
  }

  private flight(now: number, cond: Conditions, stage: Stage, lens: Lens, want?: Kind): void {
    const kind = want ?? this.kindFor(now, cond);
    if (!kind) return;
    const r = this.rand;
    const species = SPECIES[kind];
    const approach: Approach =
      kind === 'hawk'
        ? 'circle'
        : (this.pick<Approach>(
            kind === 'goose'
              ? [
                  ['across', 3],
                  ['away', 1],
                ]
              : [
                  ['across', 3],
                  ['toward', 1.2],
                  ['away', 1.2],
                ],
            this.last.approach as Approach,
          ) ?? 'across');
    // Mostly from the other side to the last one.
    const side = this.last.side && r() < 0.65 ? -this.last.side : r() < 0.5 ? -1 : 1;
    const route = new Route(overRoofs(this.path(kind, approach, side, stage, lens), stage));
    const birds = this.flock(kind);
    const speed = lerp(species.speed[0], species.speed[1], r());
    const behind = Math.max(...birds.map((b) => b.back));
    this.flights.push({ kind, start: now, speed, route, birds, end: now + (route.length + behind) / speed });
    this.last.kind = kind;
    this.last.approach = approach;
    this.last.side = side;
    if (kind === 'hawk') this.lastHawk = now;
    this.log.push({ kind, approach, side, at: now });
    if (this.log.length > 200) this.log.shift();
  }

  /** The line a flight follows, in plan space: across the view, toward the viewer, away, or circling. */
  private path(kind: Kind, approach: Approach, side: number, stage: Stage, lens: Lens): Point[] {
    const r = this.rand;
    const R = stage.radius;
    const c = stage.center;
    const f = lens.forward;
    const right = [f[1], -f[0]];
    const species = SPECIES[kind];
    const low = species.low(stage.ridge);
    const high = species.high(stage.ridge);
    const between = (a: number, b: number) => lerp(a, b, r());
    /** A point `along` the line of sight (positive beyond the house), `across` it, and `z` up. */
    const at = (along: number, across: number, z: number): Point => [
      c[0] + f[0] * along + right[0] * across,
      c[1] + f[1] * along + right[1] * across,
      z,
    ];
    if (approach === 'circle') {
      // Circling above the garden on rising air, then gliding off.
      const middle = at(between(-0.6, 0.3) * R, between(-0.5, 0.5) * R, 0);
      const radius = between(5, 9);
      const z = between(low, high);
      const turns = between(1.1, 1.7);
      const dir = r() < 0.5 ? 1 : -1;
      const start = r() * TAU;
      const points: Point[] = [];
      const steps = Math.round(turns * 40);
      for (let i = 0; i <= steps; i++) {
        const a = start + dir * (i / steps) * turns * TAU;
        points.push([middle[0] + Math.cos(a) * radius, middle[1] + Math.sin(a) * radius, z + (i / steps) * 2]);
      }
      // In along the tangent, and out along it at the end.
      const tangent = (a: number): [number, number] => [-Math.sin(a) * dir, Math.cos(a) * dir];
      const t0 = tangent(start);
      const t1 = tangent(start + dir * turns * TAU);
      const first = points[0];
      const last = points[points.length - 1];
      const reach = R * 2.6;
      return [
        [first[0] - t0[0] * reach, first[1] - t0[1] * reach, first[2] + 3],
        ...points,
        [last[0] + t1[0] * reach, last[1] + t1[1] * reach, last[2] + 4],
      ];
    }
    const z0 = between(low, high);
    const z1 = clamp(z0 + between(-3, 3), low, high);
    let p0: Point;
    let p3: Point;
    if (approach === 'across') {
      // Small birds and bats keep near the garden; big birds may cross anywhere, far beyond the house too.
      // The picture looks down on the house, so the farther a bird is, the lower it must fly to be seen.
      const near = (SPECIES[kind].span < 0.4 ? between(-0.9, 0.5) : between(-1, 0.8)) * R;
      const far = near + between(-0.8, 0.8) * R;
      const width = R * between(1.9, 2.5);
      p0 = at(near, -side * width, z0);
      p3 = at(far, side * width, z1);
    } else {
      // From well beyond the house to past the viewer's side, or the other way.
      const distant = at(R * between(2.6, 3.6), side * R * between(-0.6, 1.2), between(low, high));
      const close = at(-R * between(0.8, 1.3), -side * R * between(1.7, 2.4), between(low, high) + between(1, 4));
      [p0, p3] = approach === 'toward' ? [distant, close] : [close, distant];
    }
    const bend = () => between(-0.6, 0.6) * R;
    const mid = (t: number): Point => {
      const p: Point = [lerp(p0[0], p3[0], t), lerp(p0[1], p3[1], t), lerp(p0[2], p3[2], t)];
      return [p[0] + f[0] * bend(), p[1] + f[1] * bend(), p[2] + between(-2, 2)];
    };
    return bezier(p0, mid(0.33), mid(0.66), p3);
  }

  /** How many fly together, and how they keep station. */
  private flock(kind: Kind): Bird[] {
    const r = this.rand;
    const span = SPECIES[kind].span;
    const bird = (back: number, across: number, up: number): Bird => ({
      back,
      across,
      up,
      span: span * (0.9 + 0.2 * r()),
      phase: r() * TAU,
      seed: Array.from({ length: 6 }, () => r()),
    });
    const loose = (n: number, spread: number) =>
      Array.from({ length: n }, (_, i) =>
        bird(i ? r() * spread * 1.5 : 0, i ? (r() - 0.5) * spread : 0, i ? (r() - 0.5) * spread * 0.4 : 0),
      );
    switch (kind) {
      case 'goose': {
        // A V, open at the back.
        const n = 5 + Math.floor(r() * 5);
        return Array.from({ length: n }, (_, i) => {
          const rank = Math.ceil(i / 2);
          const side = i % 2 ? 1 : -1;
          return bird(rank * 1.5 + (r() - 0.5) * 0.3, side * rank * 1.3, (r() - 0.5) * 0.3);
        });
      }
      case 'songbird':
        return loose(r() < 0.6 ? 1 : r() < 0.75 ? 2 : 3, 2);
      case 'swallow':
        return loose(2 + Math.floor(r() * 2), 3);
      case 'crow':
        return loose(r() < 0.6 ? 1 : 2, 6);
      case 'gull':
        return loose(1 + Math.floor(r() * 3), 7);
      case 'bat':
        return loose(1 + Math.floor(r() * 3), 4);
      default:
        return [bird(0, 0, 0)];
    }
  }

  private drawBirds(now: number, cond: Conditions, lens: Lens): void {
    const scene = this.scene;
    const light = cond.light ?? DAYLIGHT;
    const drawn: { depth: number; row: Float32Array }[] = [];
    for (const flight of this.flights) {
      const species = SPECIES[flight.kind];
      const small = species.span < 0.4;
      const t = now - flight.start;
      for (const bird of flight.birds) {
        const d = t * flight.speed - bird.back;
        if (d < 0 || d > flight.route.length) continue;
        /** Where it is at a moment: on its flock's line, at its place in the flock, and straying from it. */
        const where = (time: number): Point => {
          const along = clamp(time * flight.speed - bird.back, 0, flight.route.length);
          const a = flight.route.get(along - 0.6);
          const b = flight.route.get(along + 0.6);
          const flat = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const left: Point = [-(b[1] - a[1]) / flat, (b[0] - a[0]) / flat, 0];
          const stray = wander(flight.kind, time, bird);
          const p = add(add(flight.route.get(along), left, bird.across + stray.across), [0, 0, 1], bird.up + stray.up);
          if (small) p[2] = Math.max(0.6, p[2]);
          return p;
        };
        // Which way it is going, from a moment either side, and how hard it turns, to bank into the turn.
        const h = 1 / 30;
        const before = where(t - h);
        const here = where(t);
        const after = where(t + h);
        const ahead = normalize([after[0] - before[0], after[1] - before[1], after[2] - before[2]]);
        const level = Math.hypot(ahead[0], ahead[1]);
        if (level < 1e-3) continue;
        // Its body follows a climb or a dive, but never stands on end.
        const pitch = clamp(Math.atan2(ahead[2], level), -0.5, 0.5);
        const heading: Point = [
          (ahead[0] / level) * Math.cos(pitch),
          (ahead[1] / level) * Math.cos(pitch),
          Math.sin(pitch),
        ];
        const right0: Point = [ahead[1] / level, -ahead[0] / level, 0];
        const up0 = cross(right0, heading) as Point;
        const sideways =
          ((after[0] - 2 * here[0] + before[0]) * right0[0] + (after[1] - 2 * here[1] + before[1]) * right0[1]) /
          (h * h);
        const bank = clamp(Math.atan(sideways / 9.8), -1, 1);
        const right = add(right0.map((v) => v * Math.cos(bank)) as Point, up0, -Math.sin(bank));
        const up = add(up0.map((v) => v * Math.cos(bank)) as Point, right0, Math.sin(bank));
        const pose = posture(flight.kind, t, bird.phase, bird.seed);
        // It spreads its tail to turn.
        pose.tail = Math.max(pose.tail, Math.abs(bank) * 0.7);
        // Small birds are drawn a little larger than life, so they read as birds at the size of a card.
        const s = bird.span * (small ? 1.5 : 1);
        const at = add(here, up, pose.bob * s);
        const middle = lens.point(at);
        if (!middle) continue;
        // Nothing comes so near that it fills the picture.
        if (s * middle.scale > lens.height * 0.25) continue;
        const fade = smooth(0, 3, d) * smooth(0, 3, flight.route.length - d);
        // Far birds fade a little into the haze.
        const haze = 0.5 * (1 - Math.exp(-middle.distance / 300));
        const row = (this.rows[drawn.length] ??= new Float32Array(BIRD_FLOATS));
        if (!layBird(row, flight.kind, s, { at, forward: heading, right, up }, pose, lens, light, fade, haze)) continue;
        drawn.push({ depth: middle.depth, row });
      }
    }
    // The farthest first, so nearer birds pass in front of them.
    drawn.sort((x, y) => y.depth - x.depth);
    scene.birdCount = Math.min(MAX_BIRDS, drawn.length);
    const first = drawn.length - scene.birdCount;
    for (let i = 0; i < scene.birdCount; i++) scene.birds.set(drawn[first + i].row, i * BIRD_FLOATS);
  }

  // ─── Fireflies ─────────────────────────────────────────────────────────────

  /** Fireflies come out on most warm summer nights. */
  private fireflyNight(cond: Conditions): boolean {
    const m = cond.southern ? (cond.month + 6) % 12 : cond.month;
    if (m < 5 || m > 7 || cond.wet || cond.sun > -3) return false;
    if (cond.temperature !== undefined && cond.temperature < 13) return false;
    return hash(cond.day) < 0.8;
  }

  private updateFireflies(now: number, cond: Conditions, stage: Stage): void {
    if (!this.fireflyNight(cond)) {
      this.fireflies = [];
      return;
    }
    if (this.fireflies.length && this.fireflyStage === stage) return;
    const r = this.rand;
    const { plot } = stage;
    const area = (plot.x1 - plot.x0) * (plot.y1 - plot.y0);
    const count = clamp(Math.round(area / 22), 8, 16);
    const inside = (x: number, y: number) =>
      stage.buildings.some((b) => x > b.x0 - 0.6 && x < b.x1 + 0.6 && y > b.y0 - 0.6 && y < b.y1 + 0.6);
    this.fireflies = [];
    for (let tries = 0; this.fireflies.length < count && tries < count * 20; tries++) {
      const x = lerp(plot.x0 + 0.8, plot.x1 - 0.8, r());
      const y = lerp(plot.y0 + 0.8, plot.y1 - 0.8, r());
      if (inside(x, y)) continue;
      this.fireflies.push({
        home: [x, y, lerp(0.35, 1.5, r())],
        seed: Array.from({ length: 8 }, () => r()),
        period: lerp(2.4, 6.5, r()),
        flash: lerp(0.35, 0.7, r()),
      });
    }
    this.fireflyStage = stage;
    this.fireflyStart = now;
  }

  private drawFireflies(now: number, cond: Conditions, lens: Lens): void {
    const scene = this.scene;
    scene.glowCount = 0;
    if (!this.fireflies.length) return;
    // They glow more as the dusk deepens, and come out gradually.
    const dark = smooth(-3, -8, cond.sun) * smooth(0, 15, now - this.fireflyStart);
    for (const fly of this.fireflies) {
      if (scene.glowCount >= MAX_GLOWS) break;
      const s = fly.seed;
      const c = (now + s[0] * fly.period) % fly.period;
      if (c > fly.flash) continue;
      const glow = Math.sin((Math.PI * c) / fly.flash) ** 2 * dark;
      if (glow < 0.02) continue;
      // Drifting slowly about its patch of garden.
      const p: Point = [
        fly.home[0] +
          0.7 * Math.sin(now * (0.4 + s[1] * 0.5) + s[2] * TAU) +
          0.3 * Math.sin(now * (1.1 + s[3]) + s[4] * TAU),
        fly.home[1] + 0.7 * Math.sin(now * (0.35 + s[5] * 0.5) + s[6] * TAU) + 0.3 * Math.sin(now * (0.9 + s[7])),
        fly.home[2] + 0.25 * Math.sin(now * (0.6 + s[2] * 0.6) + s[1] * TAU),
      ];
      const at = lens.point(p);
      if (!at || at.x < -10 || at.x > lens.width + 10 || at.y < -10 || at.y > lens.height + 10) continue;
      const core = Math.max(0.8, 0.03 * at.scale);
      const halo = Math.max(3, 0.28 * at.scale);
      scene.glows.set(
        [at.x, at.y, halo, at.depth, 0.78 * 1.7 * glow, 1.0 * 1.7 * glow, 0.32 * 1.7 * glow, core],
        scene.glowCount * GLOW_FLOATS,
      );
      scene.glowCount++;
    }
  }

  // ─── Smoke ─────────────────────────────────────────────────────────────────

  private smoke(now: number, cond: Conditions, stage: Stage): void {
    const cold = cond.temperature !== undefined && cond.temperature < 8 && stage.chimney !== null && cond.roof > 0.3;
    if (this.due('puff', now, cold, [0, 0.5], [0.55, 0.95])) {
      const r = this.rand;
      const c = stage.chimney!;
      this.puffs.push({
        born: now,
        life: lerp(7, 10, r()),
        from: [c[0] + (r() - 0.5) * 0.25, c[1] + (r() - 0.5) * 0.25, c[2]],
        seed: r(),
      });
    }
    this.puffs = this.puffs.filter((p) => now < p.born + p.life).slice(-MAX_PUFFS);
  }

  private drawPuffs(now: number, cond: Conditions, lens: Lens): void {
    const scene = this.scene;
    scene.puffCount = 0;
    if (!this.puffs.length) return;
    // Downwind, or a gentle drift of its own on a still day.
    const still = hash(cond.day + 0.5) * TAU;
    const wind = cond.wind
      ? { x: cond.wind.x * Math.min(cond.wind.speed, 10) * 0.16, y: cond.wind.y * Math.min(cond.wind.speed, 10) * 0.16 }
      : { x: Math.cos(still) * 0.3, y: Math.sin(still) * 0.3 };
    const light = smooth(-6, 12, cond.sun);
    // Wood smoke is a blue grey: darker than a cloud, paler than the sky.
    const color = [lerp(0.16, 0.66, light), lerp(0.17, 0.68, light), lerp(0.2, 0.74, light)];
    for (const puff of this.puffs) {
      const age = now - puff.born;
      const p: Point = [
        puff.from[0] + wind.x * age + Math.sin(age * 1.3 + puff.seed * TAU) * 0.12 * age,
        puff.from[1] + wind.y * age + Math.cos(age * 1.1 + puff.seed * 9) * 0.12 * age,
        puff.from[2] + 0.55 * age - 0.012 * age * age,
      ];
      const at = lens.point(p);
      if (!at) continue;
      const alpha = 0.7 * smooth(0, 0.6, age) * (1 - age / puff.life) ** 1.4 * cond.roof;
      scene.puffs.set(
        [at.x, at.y, (0.22 + 0.14 * age) * at.scale, at.depth, color[0], color[1], color[2], alpha],
        scene.puffCount * PUFF_FLOATS,
      );
      scene.puffCount++;
    }
  }

  // ─── Meteors ───────────────────────────────────────────────────────────────

  private meteor(now: number, fireball: boolean, follow?: Meteor): void {
    const r = this.rand;
    let from: [number, number];
    let angle: number;
    if (follow) {
      // A second one from the same part of the sky, a moment later.
      angle = Math.atan2(follow.to[0] - follow.from[0], follow.to[1] - follow.from[1]) + (r() - 0.5) * 0.12;
      from = [
        clamp(follow.from[0] + (r() - 0.5) * 0.25, 0.05, 0.95),
        clamp(follow.from[1] + (r() - 0.5) * 0.12, 0.02, 0.45),
      ];
    } else {
      // Anywhere in the upper sky, steep or slanting or grazing, either way: not like the last one.
      let tries = 0;
      do {
        from = [lerp(0.08, 0.92, r()), lerp(0.03, 0.42, r())];
        const style = r();
        const tilt = style < 0.12 ? lerp(70, 86, r()) : style < 0.45 ? lerp(40, 70, r()) : lerp(8, 40, r());
        angle = ((r() < 0.5 ? -1 : 1) * tilt * Math.PI) / 180;
      } while (
        tries++ < 8 &&
        (Math.abs(from[0] - this.last.meteor.x) < 0.25 || Math.abs(angle - this.last.meteor.angle) < 0.5)
      );
    }
    const length = lerp(0.18, 0.5, r());
    const to: [number, number] = [from[0] + Math.sin(angle) * length * 0.75, from[1] + Math.cos(angle) * length];
    const tint = r();
    const color: RGB = fireball
      ? r() < 0.5
        ? [0.7, 1, 0.76]
        : [1, 0.78, 0.55]
      : tint < 0.6
        ? [0.88, 0.93, 1]
        : tint < 0.8
          ? [1, 0.9, 0.74]
          : [0.82, 1, 0.88];
    const meteor: Meteor = {
      start: now,
      duration: fireball ? lerp(1.3, 1.9, r()) : lerp(0.45, 0.8, r()) + length * 1.2,
      from,
      to,
      brightness: fireball ? 3.4 : 1.1 + 1.4 * r() * r(),
      width: fireball ? 2.4 : lerp(0.9, 1.6, r()),
      color,
      fireball,
      train: fireball ? 2.6 : r() < 0.15 ? 0.9 : 0,
    };
    this.meteors.push(meteor);
    if (this.meteors.length > MAX_METEORS) this.meteors.shift();
    if (!follow) {
      this.last.meteor = { x: from[0], angle };
      this.meteorLog.push({ at: now, angle, x: from[0], fireball });
      if (this.meteorLog.length > 200) this.meteorLog.shift();
      // Now and then, two together.
      if (!fireball && r() < 0.14) {
        const delay = lerp(0.3, 1.1, r());
        const first = meteor;
        this.pending.push({ at: now + delay, run: () => this.meteor(now + delay, false, first) });
      }
    }
  }

  private drawMeteors(now: number, lens: Lens): void {
    const scene = this.scene;
    scene.meteorCount = 0;
    for (const m of this.meteors) {
      if (scene.meteorCount >= MAX_METEORS) break;
      const age = (now - m.start) / m.duration;
      if (age < 0) continue;
      const train =
        m.train > 0 ? clamp(1 - (now - m.start - m.duration * 0.7) / m.train, 0, 1) * smooth(0.3, 0.7, age) : 0;
      if (age > 1 && train <= 0) continue;
      const w = lens.width;
      const h = lens.height;
      scene.meteors.set(
        [
          m.from[0] * w,
          m.from[1] * h,
          m.to[0] * w,
          m.to[1] * h,
          Math.min(age, 1),
          age < 1 ? m.brightness : 0,
          m.width,
          m.fireball ? 1 : 0,
          ...m.color,
          train,
        ],
        scene.meteorCount * METEOR_FLOATS,
      );
      scene.meteorCount++;
    }
  }

  private runPending(now: number): void {
    const due = this.pending.filter((p) => p.at <= now);
    this.pending = this.pending.filter((p) => p.at > now);
    for (const p of due) p.run();
  }

  // ─── Planes and satellites ─────────────────────────────────────────────────

  private plane(now: number, cond: Conditions, lens: Lens): void {
    if (this.crossings.some((c) => !c.satellite)) return;
    const r = this.rand;
    const w = lens.width;
    const h = lens.height;
    const dir = this.last.plane ? -this.last.plane : r() < 0.5 ? -1 : 1;
    const y0 = h * lerp(0.07, 0.36, r());
    const y1 = clamp(y0 + h * lerp(-0.12, 0.12, r()), h * 0.05, h * 0.42);
    const [x0, x1] = dir > 0 ? [-0.12 * w, 1.12 * w] : [1.12 * w, -0.12 * w];
    const night = cond.sun < -4;
    this.crossings.push({
      start: now,
      duration: lerp(38, 68, r()),
      from: lens.ray(x0, y0),
      to: lens.ray(x1, y1),
      trail: !night && r() < 0.7,
      lit: cond.sun < 2,
      satellite: false,
      brightness: 1,
    });
    this.last.plane = dir;
  }

  private satellite(now: number, lens: Lens): void {
    const r = this.rand;
    const w = lens.width;
    const h = lens.height;
    const forward = r() < 0.5;
    const a: [number, number] = [w * lerp(-0.1, 0.3, r()), h * lerp(0, 0.3, r())];
    const b: [number, number] = [w * lerp(0.7, 1.1, r()), h * lerp(0.08, 0.45, r())];
    const [from, to] = forward ? [a, b] : [b, a];
    this.crossings.push({
      start: now,
      duration: lerp(55, 90, r()),
      from: lens.ray(from[0], from[1]),
      to: lens.ray(to[0], to[1]),
      trail: false,
      lit: false,
      satellite: true,
      brightness: lerp(0.6, 1, r()),
    });
  }

  private drawCrossings(now: number, lens: Lens): void {
    const scene = this.scene;
    scene.lightCount = 0;
    scene.trail[7] = 0;
    const light = (x: number, y: number, size: number, color: number[]) => {
      if (scene.lightCount >= MAX_SKY_LIGHTS) return;
      scene.lights.set([x, y, size, 0, color[0], color[1], color[2], 0], scene.lightCount * LIGHT_FLOATS);
      scene.lightCount++;
    };
    for (const c of this.crossings) {
      const t = now - c.start;
      const u = t / c.duration;
      const dir = (k: number) => {
        const v = clamp(k, 0, 1);
        return normalize([lerp(c.from[0], c.to[0], v), lerp(c.from[1], c.to[1], v), lerp(c.from[2], c.to[2], v)]);
      };
      const head = lens.sky(dir(u));
      if (!head) continue;
      const fade = smooth(0, 6, t) * smooth(0, 6, c.duration - t);
      if (c.satellite) {
        light(head[0], head[1], 0.8, [0.9 * c.brightness * fade, 0.92 * c.brightness * fade, c.brightness * fade]);
        continue;
      }
      const before = lens.sky(dir(u - 1 / c.duration)) ?? head;
      const along = [head[0] - before[0], head[1] - before[1]];
      const l = Math.hypot(along[0], along[1]) || 1;
      const wing = [(-along[1] / l) * 1.6, (along[0] / l) * 1.6];
      if (c.lit) {
        // Steady red and green at the wingtips, a white strobe that flashes twice, a red beacon.
        light(head[0] + wing[0], head[1] + wing[1], 0.7, [1.4 * fade, 0.12 * fade, 0.1 * fade]);
        light(head[0] - wing[0], head[1] - wing[1], 0.7, [0.12 * fade, 1.3 * fade, 0.3 * fade]);
        const s = t % 1.25;
        if (s < 0.06 || (s > 0.16 && s < 0.22)) {
          light(head[0] + wing[0], head[1] + wing[1], 0.9, [6 * fade, 6 * fade, 6.4 * fade]);
          light(head[0] - wing[0], head[1] - wing[1], 0.9, [6 * fade, 6 * fade, 6.4 * fade]);
        }
        if (t % 1.6 < 0.14) light(head[0], head[1], 0.8, [3 * fade, 0.25 * fade, 0.2 * fade]);
      } else {
        // A glint of sun on the fuselage.
        light(head[0], head[1], 0.75, [1.2 * fade, 1.2 * fade, 1.25 * fade]);
      }
      if (c.trail) {
        const tail = lens.sky(dir(u - 26 / c.duration)) ?? head;
        scene.trail.set([head[0], head[1], tail[0], tail[1], 0.9, 4, 0.6 * fade, 1]);
      }
    }
  }
}
