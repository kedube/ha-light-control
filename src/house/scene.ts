// Builds the 3D house as a list of SVG shapes in paint order: the platform the house stands on,
// the house seen from outside (with a window glowing for every lit room), or one story cut open
// like a dollhouse (with furniture, and a pool of light under every lamp).

import type { RGB } from '../color.ts';
import type { RoomType } from '../room-types.ts';
import { furnish, type Spots } from './furniture.ts';
import {
  box,
  floorEllipse,
  ISO_X,
  leftFace,
  paintOrder,
  polygon,
  polyline,
  project,
  rightFace,
  screenBounds,
  silhouette,
  topFace,
  unionBounds,
  type Box,
  type ScreenBounds,
  type Vec3,
} from './iso.ts';
import { css, glowColor, lit, MATERIAL, type Environment, type Lamp, type Material } from './palette.ts';
import { facadesOf, type HousePlan, type PlanCell, type PlanStory } from './plan.ts';

export type FixtureKind = 'ceiling' | 'pendant' | 'lamp' | 'strip';

export interface FixtureInput {
  id: string;
  name: string;
  on: boolean;
  rgb: RGB;
  /** Brightness 0–1. */
  level: number;
}

export interface RoomLights {
  id: string;
  type: RoomType;
  lights: FixtureInput[];
}

export type SceneView = { kind: 'exterior'; focus: 'house' | 'outside' } | { kind: 'cutaway'; story: number };

export interface SceneInput {
  plan: HousePlan;
  rooms: ReadonlyMap<string, RoomLights>;
  /** Outdoor areas, in Home Assistant order. */
  outdoor: RoomLights[];
  env: Environment;
  view: SceneView;
  /** Makes gradient and clip ids unique when two scenes share a picture (while one fades out). */
  prefix?: string;
}

export interface Shape {
  d: string;
  fill?: string;
  opacity?: number;
  stroke?: string;
  width?: number;
  /** 'glow' shapes add light (screen blending); 'line' strokes keep their width when zoomed. */
  kind?: 'glow' | 'line' | 'glass';
  clip?: string;
}

export interface Gradient {
  id: string;
  rgb: RGB;
  /** [offset, opacity] pairs. */
  stops: [number, number][];
  /** Linear gradients run between two points in picture coordinates. */
  line?: [number, number, number, number];
}

export interface Hit {
  roomId: string;
  d: string;
}

export interface Anchor {
  roomId: string;
  x: number;
  y: number;
}

export interface Scene {
  shapes: Shape[];
  gradients: Gradient[];
  clips: { id: string; d: string }[];
  hits: Hit[];
  anchors: Anchor[];
  /** A room's volume, for the selection outline. */
  volumes: Map<string, Box>;
  /** What the camera frames. */
  bounds: ScreenBounds;
}

const WALL_H = 2.7;
const CUT_H = 1.1;
const EXT_T = 0.2;
const INT_T = 0.1;
const OPEN_PLAN: ReadonlySet<RoomType> = new Set(['living', 'dining', 'kitchen']);

const STRIP =
  /strip|led|backlight|bias|cove|cabinet|ambilight|gradient|band|streifen|striscia|tira|taśma|fita|ruban|kast/i;
const PENDANT =
  /pendant|chandelier|island|pendel|hänge|kroonluchter|lustre|suspension|araña|lampadario|sospensione|żyrandol|pendente|luminaire/i;
const LAMP =
  /lamp|lampe|lámpara|lampada|lampa|luminária|candeeiro|abajur|bedside|nightstand|night ?light|reading|desk|table|floor|stehlampe|nachttisch|schreibtisch|leuchte|vloer|bureau|lampadaire|chevet|piantana|comodino|nocna|podłogowa|lantern|laterne|lanterna|latarnia|sconce/i;

export function fixtureKind(name: string): FixtureKind {
  if (STRIP.test(name)) return 'strip';
  if (PENDANT.test(name)) return 'pendant';
  if (LAMP.test(name)) return 'lamp';
  return 'ceiling';
}

/** How much light a room's lamps throw on its surfaces, and in what color. */
export function roomLamp(lights: FixtureInput[], scale = 1): Lamp | null {
  let weight = 0;
  let intensity = 0;
  const sum = [0, 0, 0];
  for (const light of lights) {
    if (!light.on) continue;
    // Accent strips color their own wall more than the whole room.
    const reach = { ceiling: 1, pendant: 0.9, lamp: 0.75, strip: 0.35 }[fixtureKind(light.name)];
    const w = (0.15 + 0.85 * light.level) * reach;
    intensity += w * 0.7;
    weight += w;
    for (let i = 0; i < 3; i++) sum[i] += light.rgb[i] * w;
  }
  if (!weight) return null;
  // Walls bounce a softer version of colored light: keep the hue, lose some of the saturation.
  const rgb = sum.map((v, i) => (v / weight) * 0.68 + WARM_WHITE[i] * 0.32) as RGB;
  return { rgb, intensity: Math.min(1, intensity) * scale };
}

const WARM_WHITE: RGB = [255, 222, 186];

const ellipsePath = (cx: number, cy: number, rx: number, ry: number) =>
  `M${(cx - rx).toFixed(2)} ${cy.toFixed(2)}a${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(2 * rx).toFixed(2)} 0a${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(-2 * rx).toFixed(2)} 0Z`;

interface Item {
  box: Box;
  shapes: Shape[];
}

class Builder {
  readonly shapes: Shape[] = [];
  readonly gradients: Gradient[] = [];
  readonly clips: { id: string; d: string }[] = [];
  readonly hits: Hit[] = [];
  readonly anchors: Anchor[] = [];
  readonly volumes = new Map<string, Box>();
  private gradientCount = 0;
  readonly input: SceneInput;
  readonly env: Environment;
  readonly plan: HousePlan;
  readonly lamps = new Map<string, Lamp | null>();

  constructor(input: SceneInput) {
    this.input = input;
    this.env = input.env;
    this.plan = input.plan;
    for (const [id, room] of input.rooms) this.lamps.set(id, roomLamp(room.lights));
    for (const room of input.outdoor) this.lamps.set(room.id, roomLamp(room.lights, 0.35));
  }

  lampOf(roomId: string | null): Lamp | null {
    return roomId ? (this.lamps.get(roomId) ?? null) : null;
  }

  /** A face with a material, lit by the ambient light and the lamps of `roomId`. */
  face(points: Vec3[], material: Material, k: number, roomId: string | null = null, extra: Partial<Shape> = {}): Shape {
    return { d: polygon(points), fill: lit(MATERIAL[material], k, this.env, this.lampOf(roomId)), ...extra };
  }

  /** The three visible faces of a solid box. */
  solid(b: Box, material: Material, roomId: string | null = null, top: Material = material): Shape[] {
    const out: Shape[] = [];
    if (b.z1 > b.z0 + 0.001) {
      out.push(this.face(leftFace(b), material, this.env.left, roomId));
      out.push(this.face(rightFace(b), material, this.env.right, roomId));
    }
    out.push(this.face(topFace(b), top, this.env.top, roomId));
    return out;
  }

  gradient(rgb: RGB, stops: [number, number][], line?: [number, number, number, number]): string {
    const id = `${this.input.prefix ?? ''}g${this.gradientCount++}`;
    this.gradients.push({ id, rgb, stops, line });
    return id;
  }

  /** A soft pool of light on the floor. */
  pool(x: number, y: number, z: number, r: number, rgb: RGB, strength: number, clip?: string): Shape {
    const e = floorEllipse(x, y, z, r);
    const id = this.gradient(rgb, [
      [0, 0.9],
      [0.35, 0.55],
      [1, 0],
    ]);
    return { d: ellipsePath(e.cx, e.cy, e.rx, e.ry), fill: `url(#${id})`, opacity: strength, kind: 'glow', clip };
  }

  /** A glowing point: a lamp's bulb or shade seen from a distance. */
  orb(x: number, y: number, z: number, r: number, rgb: RGB, strength: number): Shape {
    const [cx, cy] = project(x, y, z);
    const id = this.gradient(rgb, [
      [0, 1],
      [0.2, 0.85],
      [0.5, 0.28],
      [1, 0],
    ]);
    return { d: ellipsePath(cx, cy, r, r), fill: `url(#${id})`, opacity: strength, kind: 'glow' };
  }

  finish(bounds: ScreenBounds): Scene {
    return {
      shapes: this.shapes,
      gradients: this.gradients,
      clips: this.clips,
      hits: this.hits,
      anchors: this.anchors,
      volumes: this.volumes,
      bounds,
    };
  }
}

// ─── The ground ──────────────────────────────────────────────────────────────

interface Site {
  box: Box;
  door: { x: number; cellId: string | null } | null;
  zones: Zone[];
}

type ZoneKind = 'porch' | 'garden' | 'yard' | 'driveway' | 'pool' | 'patio' | 'lawn';

interface Zone {
  roomId: string;
  kind: ZoneKind;
  rect: { x0: number; y0: number; x1: number; y1: number };
}

/** Where the front door is: in a hallway on the front wall, else near the middle of it. */
function frontDoor(plan: HousePlan): Site['door'] {
  const ground = plan.stories.find((s) => s.ground);
  if (!ground) return null;
  const front = ground.cells.filter((c) => facadesOf(c, plan).includes('front') && c.type !== 'garage');
  if (!front.length) return null;
  const mid = plan.width * 0.45;
  const nearest = (cells: PlanCell[]) =>
    cells.reduce((best, c) => {
      const d = Math.abs((c.rect.x0 + c.rect.x1) / 2 - mid);
      const bd = Math.abs((best.rect.x0 + best.rect.x1) / 2 - mid);
      return d < bd ? c : best;
    });
  // An entrance hall if there is one, else the living room, else whatever is in the middle.
  const preferred = ['hallway', 'living', 'dining']
    .map((type) => front.filter((c) => c.type === type && c.id))
    .find((list) => list.length);
  const cell = nearest(preferred ?? front);
  const w = cell.rect.x1 - cell.rect.x0;
  // Off-center in wide rooms, so a window fits beside the door.
  const x = w > 3.2 ? cell.rect.x0 + Math.min(1.3, w * 0.3) : (cell.rect.x0 + cell.rect.x1) / 2;
  return { x, cellId: cell.id };
}

function garageCell(plan: HousePlan): PlanCell | undefined {
  return plan.stories.find((s) => s.ground)?.cells.find((c) => c.type === 'garage');
}

function site(plan: HousePlan, outdoor: RoomLights[]): Site {
  const W = plan.width;
  const D = plan.depth;
  const door = frontDoor(plan);
  const garage = garageCell(plan);
  const garageFront = garage ? facadesOf(garage, plan).includes('front') : false;
  const zones: Zone[] = [];
  const doorX = door?.x ?? W / 2;
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
    const kind = [...(want[room.type] ?? []), ...any].find((k) => !taken.has(k));
    const zone: Zone = { roomId: room.id, kind: kind ?? 'lawn', rect: { x0: 0, y0: 0, x1: 0, y1: 0 } };
    if (kind) taken.add(kind);
    else extras.push(zone);
    zones.push(zone);
  }
  const right = taken.has('garden') || taken.has('pool') || extras.length ? 6 : 3.5;
  const front = 5.5;
  // Along the right side: a driveway to a garage there stays put; the garden and pool share the rest.
  const sideDrive = taken.has('driveway') && garage && !garageFront ? garage.rect : null;
  const sideFree: [number, number][] = sideDrive
    ? [
        [0.4, sideDrive.y0 - 0.3],
        [sideDrive.y1 + 0.3, D - 0.4],
      ]
    : [[0.4, D - 0.4]];
  const side = sideFree.filter(([a, c]) => c - a > 1.5).sort((a, c) => c[1] - c[0] - (a[1] - a[0]));
  const bothSide = taken.has('garden') && taken.has('pool');
  const sideSpan = (which: 'garden' | 'pool'): [number, number] => {
    const [a, c] = side[bothSide && which === 'pool' && side.length > 1 ? 1 : 0] ?? [0.4, D - 0.4];
    if (!bothSide || side.length > 1) return [a, c];
    const mid = a + (c - a) * 0.48;
    return which === 'garden' ? [a, mid - 0.2] : [mid + 0.2, c];
  };
  // In front: the porch and path around the door and the driveway are fixed; a patio and a yard
  // take the widest stretches of lawn left over.
  const blocked: [number, number][] = [
    [doorX - (taken.has('porch') ? 2.5 : 0.9), doorX + (taken.has('porch') ? 2.5 : 0.9)],
  ];
  if (taken.has('driveway') && garage && garageFront) blocked.push([garage.rect.x0, garage.rect.x1]);
  else if (taken.has('driveway') && !garage) blocked.push([W - 3.5, W - 0.1]);
  if (extras.length) blocked.push([W + 0.3, W + right]);
  const stretches: [number, number][] = [];
  let from = -3;
  for (const [a, c] of [...blocked].sort((p, q) => p[0] - q[0])) {
    if (a - from > 0.5) stretches.push([from, a]);
    from = Math.max(from, c);
  }
  if (W + right - 0.4 - from > 0.5) stretches.push([from, W + right - 0.4]);
  stretches.sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
  const bothFront = taken.has('patio') && taken.has('yard');
  const frontSpan = (which: 'patio' | 'yard'): [number, number] => {
    const pad = (span: [number, number]): [number, number] => [span[0] + 0.3, span[1] - 0.3];
    const [a, c] = stretches[bothFront && which === 'patio' && stretches.length > 1 ? 1 : 0] ?? [-3, -0.5];
    if (!bothFront || stretches.length > 1) return pad([a, c]);
    const mid = (a + c) / 2;
    return which === 'yard' ? pad([a, mid]) : pad([mid, c]);
  };
  for (const zone of zones) {
    switch (zone.kind) {
      case 'porch':
        zone.rect = { x0: Math.max(0.2, doorX - 2.2), y0: D, x1: Math.min(W - 0.2, doorX + 2.2), y1: D + 2.2 };
        break;
      case 'patio':
      case 'yard': {
        const [x0, x1] = frontSpan(zone.kind);
        zone.rect = { x0, y0: D + 0.7, x1, y1: zone.kind === 'patio' ? D + 3.4 : D + front - 0.4 };
        break;
      }
      case 'garden': {
        const [y0, y1] = sideSpan('garden');
        zone.rect = { x0: W + 0.6, y0, x1: W + right - 0.5, y1 };
        break;
      }
      case 'pool': {
        const [y0, y1] = sideSpan('pool');
        zone.rect = { x0: W + 0.9, y0: y0 + 0.3, x1: W + right - 0.7, y1: y1 - 0.2 };
        break;
      }
      case 'driveway':
        zone.rect =
          garage && garageFront
            ? { x0: garage.rect.x0 + 0.3, y0: D, x1: garage.rect.x1 - 0.3, y1: D + front }
            : garage
              ? { x0: W, y0: garage.rect.y0 + 0.3, x1: W + right, y1: garage.rect.y1 - 0.3 }
              : { x0: W - 3.2, y0: D + 0.2, x1: W - 0.4, y1: D + front };
        break;
    }
  }
  // Any more outdoor areas share a lawn at the front corner, side by side.
  extras.forEach((zone, i) => {
    const x0 = W + 0.6;
    const span = (right - 1) / extras.length;
    zone.rect = { x0: x0 + span * i, y0: D + 0.6, x1: x0 + span * (i + 1) - 0.15, y1: D + front - 0.4 };
  });
  return { box: box(-3.5, -3, -0.7, W + right, D + front, 0), door, zones };
}

function drawPlatform(b: Builder, s: Site, opts: { grid: boolean }): void {
  const env = b.env;
  const p = s.box;
  // A holographic glow the platform floats on.
  const [gx, gy] = project((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, p.z0 - 1.2);
  const glowId = b.gradient(env.holo, [
    [0, 0.55],
    [0.5, 0.18],
    [1, 0],
  ]);
  const span = ((p.x1 - p.x0 + p.y1 - p.y0) * ISO_X) / 2;
  b.shapes.push({
    d: ellipsePath(gx, gy, span * 0.95, span * 0.32),
    fill: `url(#${glowId})`,
    opacity: env.mode === 'day' ? 0.35 : 0.8,
    kind: 'glow',
  });
  const top = topFace(p);
  b.shapes.push(b.face(top, 'grass', env.top));
  if (opts.grid) b.shapes.push({ d: polygon(top), fill: 'url(#lc-grid)' });
  const side = env.platformSide;
  b.shapes.push({ d: polygon(leftFace(p)), fill: css(side.map((v) => v * env.left)) });
  b.shapes.push({ d: polygon(rightFace(p)), fill: css(side.map((v) => v * env.right)) });
  // The holographic rim: a bright edge along the platform's visible top and a fainter base line.
  const rim = polyline([
    [p.x0, p.y1, p.z1],
    [p.x1, p.y1, p.z1],
    [p.x1, p.y0, p.z1],
  ]);
  b.shapes.push({ d: rim, stroke: css(env.holo), width: 5, opacity: 0.35 * env.holoAlpha, kind: 'line' });
  b.shapes.push({
    d: rim,
    stroke: css(env.holo.map((v) => v + (255 - v) * 0.5)),
    width: 1.5,
    opacity: 0.95 * env.holoAlpha,
    kind: 'line',
  });
  b.shapes.push({
    d: polyline([
      [p.x0, p.y1, p.z0],
      [p.x1, p.y1, p.z0],
      [p.x1, p.y0, p.z0],
    ]),
    stroke: css(env.holo),
    width: 1,
    opacity: 0.4 * env.holoAlpha,
    kind: 'line',
  });
}

function drawGroundZones(b: Builder, s: Site): void {
  const plan = b.plan;
  const D = plan.depth;
  if (s.door) {
    const x = s.door.x;
    b.shapes.push(b.face(topFace(box(x - 0.55, D, 0.005, x + 0.55, s.box.y1, 0.01)), 'path', b.env.top));
  }
  for (const zone of s.zones) {
    const r = zone.rect;
    const flat = (m: Material, inset = 0) =>
      b.shapes.push(
        b.face(
          topFace(box(r.x0 + inset, r.y0 + inset, 0.005, r.x1 - inset, r.y1 - inset, 0.012)),
          m,
          b.env.top,
          zone.roomId,
        ),
      );
    if (zone.kind === 'driveway') flat('asphalt');
    else if (zone.kind === 'patio') flat('path');
    else if (zone.kind === 'pool') {
      flat('path');
      b.shapes.push(
        b.face(
          topFace(box(r.x0 + 0.35, r.y0 + 0.35, 0.013, r.x1 - 0.35, r.y1 - 0.35, 0.014)),
          'water',
          b.env.top,
          zone.roomId,
        ),
      );
    }
  }
}

// ─── Outside the house ───────────────────────────────────────────────────────

interface WindowSpec {
  /** Along the wall: x on the front, y on the right. */
  a: number;
  b: number;
  z0: number;
  z1: number;
  cellId: string | null;
}

/** Windows along a wall segment, evenly spaced, leaving out the door. */
function windowsFor(
  from: number,
  to: number,
  z: number,
  cellId: string | null,
  avoid: [number, number][],
): WindowSpec[] {
  const length = to - from;
  if (length < 0.9) return [];
  const width = length >= 2.6 ? 1.15 : Math.min(0.85, length - 0.3);
  const count = Math.max(1, Math.floor((length - 0.4) / 2));
  const out: WindowSpec[] = [];
  for (let i = 0; i < count; i++) {
    const c = from + (length * (i + 0.5)) / count;
    const a = c - width / 2;
    const b = c + width / 2;
    if (avoid.some(([l, r]) => b > l - 0.25 && a < r + 0.25)) continue;
    out.push({ a, b, z0: z + 0.95, z1: z + 2.3, cellId });
  }
  return out;
}

type Side = 'front' | 'right';

/** A point on the outside of a wall: `u` along it, at height z. */
function onWall(plan: HousePlan, side: Side, u: number, z: number, out = 0): Vec3 {
  return side === 'front' ? [u, plan.depth + out, z] : [plan.width + out, u, z];
}

function wallQuad(plan: HousePlan, side: Side, a: number, b: number, z0: number, z1: number, out = 0): Vec3[] {
  return [
    onWall(plan, side, a, z1, out),
    onWall(plan, side, b, z1, out),
    onWall(plan, side, b, z0, out),
    onWall(plan, side, a, z0, out),
  ];
}

function drawWindow(b: Builder, side: Side, w: WindowSpec, halo: boolean, roomId: string | null): Shape[] {
  const plan = b.plan;
  const env = b.env;
  const k = side === 'front' ? env.left : env.right;
  const out: Shape[] = [];
  const lamp = b.lampOf(roomId);
  out.push(b.face(wallQuad(plan, side, w.a - 0.08, w.b + 0.08, w.z0 - 0.08, w.z1 + 0.08, 0.01), 'trim', k));
  const glass = wallQuad(plan, side, w.a, w.b, w.z0, w.z1, 0.02);
  const level = lamp ? Math.min(1, lamp.intensity) : 0;
  out.push({
    d: polygon(glass),
    fill: lamp ? glowColor(lamp.rgb, 0.25 + 0.3 * level) : 'url(#lc-glass)',
    kind: 'glass',
  });
  out.push({ d: polygon(glass), fill: 'url(#lc-hot)', opacity: lamp ? 0.35 + 0.5 * level : 0 });
  const mid = (w.a + w.b) / 2;
  const bar = w.z0 + (w.z1 - w.z0) * 0.58;
  const trim = lit(MATERIAL.trim, k, env);
  out.push({
    d:
      polyline([onWall(plan, side, mid, w.z0, 0.03), onWall(plan, side, mid, w.z1, 0.03)]) +
      polyline([onWall(plan, side, w.a, bar, 0.03), onWall(plan, side, w.b, bar, 0.03)]),
    stroke: trim,
    width: 0.07,
  });
  out.push(b.face(wallQuad(plan, side, w.a - 0.14, w.b + 0.14, w.z0 - 0.14, w.z0 - 0.06, 0.06), 'trim', k));
  if (halo) {
    const [cx, cy] = project(...onWall(plan, side, mid, (w.z0 + w.z1) / 2, 0.05));
    const rgb = lamp?.rgb ?? [255, 196, 116];
    const id = b.gradient(rgb, [
      [0, 0.75],
      [0.4, 0.3],
      [1, 0],
    ]);
    const strength = lamp ? Math.min(1, lamp.intensity) * env.lamp : 0;
    out.push({ d: ellipsePath(cx, cy, 1.5, 1.35), fill: `url(#${id})`, opacity: strength * 0.8, kind: 'glow' });
  }
  return out;
}

/** The walls of one story seen from outside, with windows (or a door) for each room. */
function drawStoryOutside(b: Builder, story: PlanStory, site: Site, label = true): Item {
  const plan = b.plan;
  const env = b.env;
  const W = plan.width;
  const D = plan.depth;
  const z0 = story.z;
  const z1 = story.z + plan.storyHeight;
  const shapes: Shape[] = [];
  const faces: [Side, Vec3[], number][] = [
    ['front', wallQuad(plan, 'front', 0, W, z0, z1), env.left],
    ['right', wallQuad(plan, 'right', 0, D, z0, z1), env.right],
  ];
  for (const [side, quad, k] of faces) {
    shapes.push(b.face(quad, 'siding', k));
    shapes.push({ d: polygon(quad), fill: `url(#lc-siding-${side})` });
  }
  // Trim between stories and at the corner.
  shapes.push(b.face(wallQuad(plan, 'front', -0.02, W, z0 - 0.06, z0 + 0.12, 0.02), 'trim', env.left));
  shapes.push(b.face(wallQuad(plan, 'right', 0, D + 0.02, z0 - 0.06, z0 + 0.12, 0.02), 'trim', env.right));
  shapes.push(b.face(wallQuad(plan, 'front', W - 0.14, W, z0, z1, 0.02), 'trim', env.left));

  const garage = story.ground ? story.cells.find((c) => c.type === 'garage') : undefined;
  const door = story.ground ? site.door : null;
  for (const cell of story.cells) {
    for (const side of facadesOf(cell, plan)) {
      const from = side === 'front' ? cell.rect.x0 : cell.rect.y0;
      const to = side === 'front' ? cell.rect.x1 : cell.rect.y1;
      const avoid: [number, number][] = [];
      if (door && side === 'front' && door.x > from && door.x < to) {
        avoid.push([door.x - 0.55, door.x + 0.55]);
        shapes.push(...drawDoor(b, door.x, z0, cell.id));
      }
      if (garage === cell && (side === 'front' || !facadesOf(cell, plan).includes('front'))) {
        const c = (from + to) / 2;
        const half = Math.min(1.3, (to - from) / 2 - 0.3);
        avoid.push([c - half, c + half]);
        shapes.push(...drawGarageDoor(b, side, c - half, c + half, z0));
      }
      for (const w of windowsFor(from + 0.15, to - 0.15, z0, cell.id, avoid)) {
        shapes.push(...drawWindow(b, side, w, Boolean(cell.id), cell.id));
      }
      if (cell.id) b.hits.push({ roomId: cell.id, d: polygon(wallQuad(plan, side, from, to, z0, z1, 0.05)) });
      if (cell.id && label) {
        const [x, y] = project(...onWall(plan, side, (from + to) / 2, z1 - 0.3, 0.05));
        b.anchors.push({ roomId: cell.id, x, y });
      }
    }
  }
  return { box: box(0, 0, z0, W, D, z1), shapes };
}

function drawDoor(b: Builder, x: number, z: number, roomId: string | null): Shape[] {
  const plan = b.plan;
  const env = b.env;
  const out: Shape[] = [];
  out.push(b.face(wallQuad(plan, 'front', x - 0.62, x + 0.62, z, z + 2.42, 0.01), 'trim', env.left));
  out.push(b.face(wallQuad(plan, 'front', x - 0.5, x + 0.5, z, z + 2.2, 0.02), 'door', env.left));
  const lamp = b.lampOf(roomId);
  const glass = wallQuad(plan, 'front', x - 0.32, x + 0.32, z + 1.35, z + 1.95, 0.03);
  out.push(
    lamp
      ? { d: polygon(glass), fill: glowColor(lamp.rgb, 0.4), kind: 'glass' }
      : { d: polygon(glass), fill: 'url(#lc-glass)', kind: 'glass' },
  );
  const [hx, hy] = project(...onWall(plan, 'front', x + 0.36, z + 1.05, 0.04));
  out.push({ d: ellipsePath(hx, hy, 0.05, 0.05), fill: '#d9b35b' });
  // Canopy and steps.
  const canopy = box(x - 0.85, plan.depth, z + 2.45, x + 0.85, plan.depth + 0.95, z + 2.6);
  out.push(...b.solid(canopy, 'roofEdge', null, 'roof'));
  if (z > 0.05) out.push(...b.solid(box(x - 0.8, plan.depth, 0, x + 0.8, plan.depth + 0.7, z - 0.02), 'plinth'));
  return out;
}

function drawGarageDoor(b: Builder, side: Side, a: number, c: number, z: number): Shape[] {
  const plan = b.plan;
  const k = side === 'front' ? b.env.left : b.env.right;
  const out: Shape[] = [b.face(wallQuad(plan, side, a - 0.1, c + 0.1, z, z + 2.3, 0.01), 'trim', k)];
  out.push(b.face(wallQuad(plan, side, a, c, z, z + 2.15, 0.02), 'garageDoor', k));
  let lines = '';
  for (let i = 1; i < 5; i++) {
    const h = z + (2.15 * i) / 5;
    lines += polyline([onWall(plan, side, a, h, 0.03), onWall(plan, side, c, h, 0.03)]);
  }
  out.push({ d: lines, stroke: lit(MATERIAL.plinth, k, b.env), width: 0.04 });
  return out;
}

function drawPlinth(b: Builder, basement: PlanStory | undefined, label = true): Item {
  const plan = b.plan;
  const env = b.env;
  const W = plan.width;
  const D = plan.depth;
  const h = plan.base;
  const shapes: Shape[] = [];
  const pb = box(-0.06, -0.06, 0, W + 0.06, D + 0.06, h);
  shapes.push(b.face(leftFace(pb), 'plinth', env.left), b.face(rightFace(pb), 'plinth', env.right));
  if (basement) {
    for (const cell of basement.cells) {
      for (const side of facadesOf(cell, plan)) {
        const from = side === 'front' ? cell.rect.x0 : cell.rect.y0;
        const to = side === 'front' ? cell.rect.x1 : cell.rect.y1;
        if (to - from < 1.2) continue;
        const count = Math.max(1, Math.floor((to - from) / 2.4));
        for (let i = 0; i < count; i++) {
          const c = from + ((to - from) * (i + 0.5)) / count;
          const w: WindowSpec = { a: c - 0.45, b: c + 0.45, z0: 0.12, z1: h - 0.1, cellId: cell.id };
          const lamp = b.lampOf(cell.id);
          const glass = wallQuad(plan, side, w.a, w.b, w.z0, w.z1, 0.08);
          shapes.push(
            b.face(
              wallQuad(plan, side, w.a - 0.06, w.b + 0.06, w.z0 - 0.05, w.z1 + 0.05, 0.07),
              'trim',
              side === 'front' ? env.left : env.right,
            ),
          );
          shapes.push(
            lamp
              ? { d: polygon(glass), fill: glowColor(lamp.rgb, 0.3), kind: 'glass' }
              : { d: polygon(glass), fill: 'url(#lc-glass)', kind: 'glass' },
          );
          const [cx, cy] = project(...onWall(plan, side, c, h / 2, 0.1));
          const id = b.gradient(lamp?.rgb ?? [255, 196, 116], [
            [0, 0.7],
            [0.45, 0.25],
            [1, 0],
          ]);
          shapes.push({
            d: ellipsePath(cx, cy, 1.1, 0.7),
            fill: `url(#${id})`,
            opacity: lamp ? Math.min(1, lamp.intensity) * env.lamp * 0.8 : 0,
            kind: 'glow',
          });
        }
        if (cell.id) b.hits.push({ roomId: cell.id, d: polygon(wallQuad(plan, side, from, to, 0, h, 0.1)) });
        if (cell.id && label) {
          const [x, y] = project(...onWall(plan, side, (from + to) / 2, h, 0.1));
          b.anchors.push({ roomId: cell.id, x, y });
        }
      }
    }
  }
  return { box: box(-0.06, -0.06, 0, W + 0.06, D + 0.06, h), shapes };
}

const roofRise = (plan: HousePlan) => Math.min(2.8, (plan.depth / 2) * 0.58);

/** Rise per meter of the roof, for the shingle texture. */
export const roofSlope = (plan: HousePlan): number => roofRise(plan) / (plan.depth / 2);

function drawRoof(b: Builder, top: number): Item {
  const plan = b.plan;
  const env = b.env;
  const W = plan.width;
  const D = plan.depth;
  const oh = 0.45;
  const half = D / 2;
  const rise = roofRise(plan);
  const slope = rise / half;
  const eave = top - oh * slope;
  const ridge = top + rise;
  const shapes: Shape[] = [];
  const back: Vec3[] = [
    [-oh, -oh, eave],
    [W + oh, -oh, eave],
    [W + oh, half, ridge],
    [-oh, half, ridge],
  ];
  shapes.push(b.face(back, 'roof', 0.72));
  shapes.push({ d: polygon(back), fill: 'url(#lc-shingles-back)' });
  // Chimney on the back slope, its sides following the roof.
  const cx0 = W * 0.68;
  const cx1 = cx0 + 0.75;
  const cy0 = half - 1.7;
  const cy1 = half - 0.95;
  const at = (y: number) => ridge - (half - y) * slope;
  const ctop = ridge + 0.85;
  shapes.push(
    b.face(
      [
        [cx0, cy1, ctop],
        [cx1, cy1, ctop],
        [cx1, cy1, at(cy1)],
        [cx0, cy1, at(cy1)],
      ],
      'brick',
      env.left,
    ),
    b.face(
      [
        [cx1, cy0, ctop],
        [cx1, cy1, ctop],
        [cx1, cy1, at(cy1)],
        [cx1, cy0, at(cy0)],
      ],
      'brick',
      env.right,
    ),
    b.face(topFace(box(cx0 - 0.06, cy0 - 0.06, ctop, cx1 + 0.06, cy1 + 0.06, ctop + 0.08)), 'plinth', env.top),
  );
  // Gable end on the right, with an attic vent.
  const gable: Vec3[] = [
    [W, 0, top],
    [W, D, top],
    [W, half, ridge],
  ];
  shapes.push(b.face(gable, 'siding', env.right));
  shapes.push({ d: polygon(gable), fill: 'url(#lc-siding-right)' });
  const vz = top + rise * 0.42;
  shapes.push(
    b.face(
      [
        [W + 0.02, half - 0.35, vz],
        [W + 0.02, half + 0.35, vz],
        [W + 0.02, half, vz + 0.55],
      ],
      'roofEdge',
      env.right,
    ),
  );
  const front: Vec3[] = [
    [-oh, half, ridge],
    [W + oh, half, ridge],
    [W + oh, D + oh, eave],
    [-oh, D + oh, eave],
  ];
  shapes.push(b.face(front, 'roof', env.mode === 'day' ? 0.93 : 0.95));
  shapes.push({ d: polygon(front), fill: 'url(#lc-shingles-front)' });
  // Fascia boards along the eave and the rake.
  shapes.push(
    b.face(
      [
        [-oh, D + oh, eave],
        [W + oh, D + oh, eave],
        [W + oh, D + oh, eave - 0.16],
        [-oh, D + oh, eave - 0.16],
      ],
      'roofEdge',
      env.left,
    ),
    b.face(
      [
        [W + oh, -oh, eave],
        [W + oh, half, ridge],
        [W + oh, D + oh, eave],
        [W + oh, D + oh, eave - 0.16],
        [W + oh, half, ridge - 0.16],
        [W + oh, -oh, eave - 0.16],
      ],
      'roofEdge',
      env.right,
    ),
  );
  if (env.mode !== 'day') {
    shapes.push({
      d: polyline([
        [-oh, D + oh, eave],
        [W + oh, D + oh, eave],
        [W + oh, half, ridge],
        [-oh, half, ridge],
      ]),
      stroke: css(env.holo),
      width: 1,
      opacity: 0.35 * env.holoAlpha,
      kind: 'line',
    });
  }
  return { box: box(-oh, -oh, top, W + oh, D + oh, ridge + 0.9), shapes };
}

// ─── Outdoor areas ───────────────────────────────────────────────────────────

function tree(b: Builder, x: number, y: number, size: number, roomId: string | null): Item {
  const shapes: Shape[] = [];
  shapes.push(...b.solid(box(x - 0.12, y - 0.12, 0, x + 0.12, y + 0.12, 1.1 * size), 'bark', roomId));
  const lamp = b.lampOf(roomId);
  const leaf = MATERIAL.leaf;
  const dark = MATERIAL.leafDark;
  const blobs: [number, number, number, number][] = [
    [0, 0, 1.55, 0.95],
    [-0.35, 0.25, 1.25, 0.7],
    [0.35, 0.3, 1.3, 0.72],
    [0.05, -0.1, 2.15, 0.7],
  ];
  for (const [dx, dy, dz, r] of blobs) {
    const [cx, cy] = project(x + dx, y + dy, dz * size);
    const rr = r * size;
    shapes.push({ d: ellipsePath(cx, cy, rr * 1.05, rr), fill: lit(dark, 0.8, b.env, lamp) });
    shapes.push({
      d: ellipsePath(cx - rr * 0.18, cy - rr * 0.2, rr * 0.8, rr * 0.72),
      fill: lit(leaf, 1, b.env, lamp),
    });
  }
  return { box: box(x - 1, y - 1, 0, x + 1, y + 1, 2.9 * size), shapes };
}

function bush(b: Builder, x: number, y: number, roomId: string | null): Item {
  const [cx, cy] = project(x, y, 0.35);
  const lamp = b.lampOf(roomId);
  return {
    box: box(x - 0.45, y - 0.45, 0, x + 0.45, y + 0.45, 0.7),
    shapes: [
      { d: ellipsePath(cx, cy, 0.62, 0.45), fill: lit(MATERIAL.leafDark, 0.85, b.env, lamp) },
      { d: ellipsePath(cx - 0.1, cy - 0.1, 0.45, 0.32), fill: lit(MATERIAL.leaf, 1, b.env, lamp) },
    ],
  };
}

/** A light outside: a post lantern, a path light or, for strips, a string of bulbs. */
function outdoorLight(
  b: Builder,
  light: FixtureInput,
  x: number,
  y: number,
  kind: 'post' | 'bollard' | 'wall',
  roomId: string,
): Item {
  const env = b.env;
  const shapes: Shape[] = [];
  const h = kind === 'post' ? 2.1 : kind === 'bollard' ? 0.65 : b.plan.base + 2.05;
  const strength = light.on ? env.lamp * (0.4 + 0.6 * light.level) : 0;
  if (kind !== 'wall') {
    shapes.push(b.pool(x, y, 0.02, kind === 'post' ? 2.2 : 1.1, light.rgb, strength * 0.85));
    shapes.push(...b.solid(box(x - 0.05, y - 0.05, 0, x + 0.05, y + 0.05, h - 0.25), 'lampPost', roomId));
  }
  const head = box(x - 0.14, y - 0.14, h - 0.28, x + 0.14, y + 0.14, h);
  if (light.on) {
    const glow = glowColor(light.rgb, 0.45);
    shapes.push({ d: polygon(leftFace(head)), fill: glow }, { d: polygon(rightFace(head)), fill: glow });
  } else shapes.push(...b.solid(head, 'shade').slice(0, 2));
  shapes.push(...b.solid(box(x - 0.18, y - 0.18, h, x + 0.18, y + 0.18, h + 0.06), 'lampPost'));
  shapes.push(b.orb(x, y, h - 0.14, 0.9, light.rgb, strength));
  return { box: box(x - 0.2, y - 0.2, 0, x + 0.2, y + 0.2, h + 0.1), shapes };
}

/** Shrubs along the front and the side of the house, clear of the doors, the porch and the drive. */
function plantings(b: Builder, s: Site): Item[] {
  const plan = b.plan;
  const W = plan.width;
  const D = plan.depth;
  const garage = garageCell(plan);
  const garageFront = garage ? facadesOf(garage, plan).includes('front') : false;
  const blockedFront: [number, number][] = [];
  const blockedRight: [number, number][] = [];
  if (s.door) blockedFront.push([s.door.x - 1.3, s.door.x + 1.3]);
  if (garage && garageFront) blockedFront.push([garage.rect.x0 - 0.3, garage.rect.x1 + 0.3]);
  if (garage && !garageFront) blockedRight.push([garage.rect.y0 - 0.3, garage.rect.y1 + 0.3]);
  for (const zone of s.zones) {
    if (zone.rect.y0 <= D + 0.1 && zone.rect.y1 > D) blockedFront.push([zone.rect.x0 - 0.5, zone.rect.x1 + 0.5]);
    if (zone.rect.x0 <= W + 0.1 && zone.rect.x1 > W) blockedRight.push([zone.rect.y0 - 0.5, zone.rect.y1 + 0.5]);
  }
  const free = (u: number, blocked: [number, number][]) => !blocked.some(([a, c]) => u > a && u < c);
  const items: Item[] = [];
  for (let x = 0.7; x < W - 0.5; x += 2.1) if (free(x, blockedFront)) items.push(bush(b, x, D + 0.55, null));
  for (let y = 0.9; y < D - 0.5; y += 2.3) if (free(y, blockedRight)) items.push(bush(b, W + 0.55, y, null));
  return items;
}

function drawZones(b: Builder, s: Site, label = true): Item[] {
  const items: Item[] = [];
  const plan = b.plan;
  const D = plan.depth;
  for (const zone of s.zones) {
    const room = b.input.outdoor.find((r) => r.id === zone.roomId);
    if (!room) continue;
    const r = zone.rect;
    const lights = room.lights;
    b.hits.push({ roomId: zone.roomId, d: polygon(topFace(box(r.x0, r.y0, 0, r.x1, r.y1, 0.05))) });
    if (label) {
      const [ax, ay] = project((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 1.6);
      b.anchors.push({ roomId: zone.roomId, x: ax, y: ay });
    }
    b.volumes.set(zone.roomId, box(r.x0, r.y0, 0, r.x1, r.y1, 1.2));
    if (zone.kind === 'porch') {
      const deck = box(r.x0, r.y0, 0, r.x1, r.y1, Math.max(0.12, plan.base - 0.02));
      items.push({ box: deck, shapes: b.solid(deck, 'deck', zone.roomId) });
      // A glass railing with a glowing top edge, open where the steps come down.
      const doorX = s.door?.x ?? (r.x0 + r.x1) / 2;
      const rail = (x0: number, y0: number, x1: number, y1: number) => {
        const top = deck.z1 + 0.9;
        const pts: Vec3[] = [
          [x0, y0, top],
          [x1, y1, top],
          [x1, y1, deck.z1],
          [x0, y0, deck.z1],
        ];
        return [
          { d: polygon(pts), fill: css(b.env.holo), opacity: 0.1 },
          { d: polyline([pts[0], pts[1]]), stroke: lit(MATERIAL.trim, 1, b.env), width: 0.05 },
        ] as Shape[];
      };
      items.push({
        box: box(r.x0, r.y1 - 0.02, deck.z1, doorX - 0.7, r.y1, deck.z1 + 0.9),
        shapes: rail(r.x0, r.y1, doorX - 0.7, r.y1),
      });
      items.push({
        box: box(doorX + 0.7, r.y1 - 0.02, deck.z1, r.x1, r.y1, deck.z1 + 0.9),
        shapes: rail(doorX + 0.7, r.y1, r.x1, r.y1),
      });
      items.push({
        box: box(r.x1 - 0.02, r.y0, deck.z1, r.x1, r.y1, deck.z1 + 0.9),
        shapes: rail(r.x1, r.y0, r.x1, r.y1),
      });
      lights.forEach((light, i) => {
        const x =
          lights.length === 1
            ? Math.min(r.x1 - 0.4, doorX + 0.95)
            : r.x0 + ((r.x1 - r.x0) * (i + 1)) / (lights.length + 1);
        const it = outdoorLight(b, light, x, D + 0.12, 'wall', zone.roomId);
        it.shapes.unshift(
          b.pool(
            x,
            D + 1.1,
            deck.z1 + 0.01,
            1.8,
            light.rgb,
            light.on ? b.env.lamp * (0.4 + 0.6 * light.level) * 0.9 : 0,
          ),
        );
        items.push({ box: box(x - 0.2, D, deck.z1, x + 0.2, D + 0.3, 2.4), shapes: it.shapes });
      });
      continue;
    }
    if (zone.kind === 'garden' || zone.kind === 'yard' || zone.kind === 'lawn') {
      const cx = (r.x0 + r.x1) / 2;
      const spots: [number, number, number][] =
        zone.kind === 'garden'
          ? [
              [r.x0 + 1.2, r.y0 + 1.2, 1.1],
              [r.x1 - 1.1, (r.y0 + r.y1) / 2, 0.9],
              [r.x0 + 1.3, r.y1 - 1.4, 1],
            ]
          : [[cx, (r.y0 + r.y1) / 2, 1]];
      for (const [x, y, size] of spots)
        if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) items.push(tree(b, x, y, size, zone.roomId));
      items.push(bush(b, r.x1 - 0.6, r.y1 - 0.5, zone.roomId));
    }
    // Lamps along the edge of the area facing the viewer.
    const n = lights.length;
    lights.forEach((light, i) => {
      const t = (i + 1) / (n + 1);
      const along = zone.kind === 'garden' || zone.kind === 'pool';
      const x = along ? r.x0 + 0.35 : r.x0 + (r.x1 - r.x0) * t;
      const y = along ? r.y0 + (r.y1 - r.y0) * t : r.y1 - 0.35;
      const kind = fixtureKind(light.name) === 'strip' || zone.kind === 'driveway' ? 'bollard' : 'post';
      items.push(outdoorLight(b, light, x, y, kind, zone.roomId));
    });
  }
  return items;
}

// ─── Inside: one story cut open ─────────────────────────────────────────────

/** Spreads n points over a room, away from the walls. */
function grid(rect: { x0: number; y0: number; x1: number; y1: number }, n: number): [number, number][] {
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

const FLOOR: Partial<Record<RoomType, Material>> = {
  kitchen: 'tile',
  bathroom: 'tile',
  laundry: 'tile',
  garage: 'concrete',
  storage: 'concrete',
  basement: 'concrete',
  gym: 'slate',
  closet: 'lightOak',
  kids: 'carpet',
  media: 'carpet',
  hallway: 'lightOak',
  stairs: 'lightOak',
  bedroom: 'lightOak',
  guest: 'lightOak',
};

function drawFixtures(
  b: Builder,
  cell: PlanCell,
  room: RoomLights,
  spots: Spots,
  z: number,
  clip: string,
  volumeClip: string,
): { items: Item[]; pools: Shape[] } {
  const env = b.env;
  const items: Item[] = [];
  const pools: Shape[] = [];
  const kinds = room.lights.map((l) => fixtureKind(l.name));
  const lampSpots = [...spots.lamps];
  const ceilingCount = kinds.filter(
    (k) => k === 'ceiling' || (k === 'lamp' && !lampSpots.length) || (k === 'pendant' && !spots.pendant),
  ).length;
  const ceilingSpots = grid(
    {
      x0: cell.rect.x0 + (cell.rect.x1 - cell.rect.x0) * 0.2,
      y0: cell.rect.y0 + (cell.rect.y1 - cell.rect.y0) * 0.22,
      x1: cell.rect.x1 - (cell.rect.x1 - cell.rect.x0) * 0.2,
      y1: cell.rect.y1 - (cell.rect.y1 - cell.rect.y0) * 0.18,
    },
    Math.max(1, ceilingCount),
  );
  let pendantUsed = false;
  let stripUsed = false;
  room.lights.forEach((light, i) => {
    let kind = kinds[i];
    const strength = light.on ? env.lamp * (0.35 + 0.65 * light.level) : 0;
    const rgb = light.rgb;
    if (kind === 'strip') {
      const s = !stripUsed ? spots.strip : undefined;
      stripUsed = true;
      const from: Vec3 = s ? [s.from[0], s.from[1], s.z] : [cell.rect.x0 + 0.3, cell.rect.y0 + EXT_T + 0.05, z + 0.12];
      const to: Vec3 = s ? [s.to[0], s.to[1], s.z] : [cell.rect.x1 - 0.3, cell.rect.y0 + EXT_T + 0.05, z + 0.12];
      const mx = (from[0] + to[0]) / 2;
      const my = (from[1] + to[1]) / 2;
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
      pools.push(b.pool(mx, my + 0.3, z + 0.01, Math.max(0.8, len * 0.55), rgb, strength * 0.9, clip));
      const line = polyline([from, to]);
      items.push({
        box: box(
          Math.min(from[0], to[0]),
          Math.min(from[1], to[1]),
          from[2] - 0.05,
          Math.max(from[0], to[0]) + 0.01,
          Math.max(from[1], to[1]) + 0.01,
          from[2] + 0.05,
        ),
        shapes: [
          { d: line, stroke: css(rgb), width: 0.3, opacity: strength * 0.35, kind: 'glow' },
          {
            d: line,
            stroke: light.on ? glowColor(rgb, 0.5) : lit(MATERIAL.steel, 1, env),
            width: 0.06,
            opacity: light.on ? 1 : 0.6,
          },
        ],
      });
      return;
    }
    let x: number;
    let y: number;
    let h: number;
    if (kind === 'pendant' && spots.pendant && !pendantUsed) {
      pendantUsed = true;
      [x, y] = spots.pendant;
      h = 1.65;
    } else if (kind === 'lamp' && lampSpots.length) {
      const spot = lampSpots.shift()!;
      [x, y] = spot;
      h = spot[2];
    } else {
      kind = kind === 'lamp' ? 'lamp' : 'ceiling';
      [x, y] = ceilingSpots.shift() ?? [(cell.rect.x0 + cell.rect.x1) / 2, (cell.rect.y0 + cell.rect.y1) / 2];
      h = kind === 'lamp' ? 1.4 : 2.35;
      if (kind === 'ceiling' && light.name && PENDANT.test(light.name)) h = 1.65;
    }
    const top = z + h;
    const shapes: Shape[] = [];
    const reach =
      kind === 'ceiling'
        ? 1.25 + 1.2 * light.level
        : kind === 'pendant'
          ? 0.95 + 0.9 * light.level
          : 0.85 + 0.8 * light.level;
    pools.push(b.pool(x, y, z + 0.01, reach, rgb, strength, clip));
    if (kind === 'lamp') {
      shapes.push(...b.solid(box(x - 0.03, y - 0.03, z, x + 0.03, y + 0.03, top - 0.28), 'lampPost', room.id));
      const shade = box(x - 0.17, y - 0.17, top - 0.3, x + 0.17, y + 0.17, top);
      if (light.on) {
        const glow = glowColor(rgb, 0.5);
        shapes.push(
          { d: polygon(leftFace(shade)), fill: glow },
          { d: polygon(rightFace(shade)), fill: glowColor(rgb, 0.35) },
          { d: polygon(topFace(shade)), fill: glowColor(rgb, 0.7) },
        );
      } else shapes.push(...b.solid(shade, 'shade', room.id));
    } else {
      // A cord from the ceiling, a shade, and a cone of light below it when on.
      shapes.push({
        d: polyline([
          [x, y, z + WALL_H],
          [x, y, top + 0.06],
        ]),
        stroke: lit(MATERIAL.lampPost, 1, env),
        width: 0.025,
      });
      const r = kind === 'pendant' ? 0.2 : 0.26;
      const shade = box(x - r, y - r, top - (kind === 'pendant' ? 0.24 : 0.06), x + r, y + r, top + 0.06);
      if (light.on) {
        shapes.push(
          { d: polygon(leftFace(shade)), fill: glowColor(rgb, 0.3) },
          { d: polygon(rightFace(shade)), fill: glowColor(rgb, 0.18) },
          { d: polygon(topFace(shade)), fill: lit(MATERIAL.lampPost, 1, env) },
        );
      } else shapes.push(...b.solid(shade, 'lampPost', room.id));
      const [ox, oy] = project(x, y, shade.z0);
      const floor = floorEllipse(x, y, z, reach * 0.75);
      const id = b.gradient(
        rgb,
        [
          [0, 0.55],
          [1, 0],
        ],
        [ox, oy, ox, floor.cy],
      );
      shapes.push({
        d: `M${(ox - r * 0.9).toFixed(2)} ${oy.toFixed(2)}L${(ox + r * 0.9).toFixed(2)} ${oy.toFixed(2)}L${(floor.cx + floor.rx).toFixed(2)} ${floor.cy.toFixed(2)}L${(floor.cx - floor.rx).toFixed(2)} ${floor.cy.toFixed(2)}Z`,
        fill: `url(#${id})`,
        opacity: strength * 0.55,
        kind: 'glow',
        clip: volumeClip,
      });
    }
    shapes.push(b.orb(x, y, kind === 'lamp' ? top - 0.15 : top - 0.08, kind === 'lamp' ? 0.75 : 0.95, rgb, strength));
    items.push({ box: box(x - 0.3, y - 0.3, z, x + 0.3, y + 0.3, kind === 'lamp' ? top : z + WALL_H - 0.01), shapes });
  });
  return { items, pools };
}

function drawStairs(b: Builder, cell: PlanCell, z: number, up: boolean, roomId: string | null): Item[] {
  const r = cell.rect;
  const items: Item[] = [];
  const x0 = r.x0 + EXT_T + 0.12;
  const x1 = r.x1 - 0.12;
  if (!up) {
    // The top of the stairs from below: an opening with a railing.
    const hole = box(x0, r.y0 + EXT_T + 0.05, z - 0.02, x1, Math.min(r.y1 - 0.2, r.y0 + 3.2), z + 0.004);
    items.push({ box: hole, shapes: [b.face(topFace(hole), 'screen', 1)] });
    const rail = box(x0, hole.y1, z, x1, hole.y1 + 0.05, z + 0.95);
    items.push({ box: rail, shapes: b.solid(rail, 'darkWood', roomId) });
    return items;
  }
  const steps = 12;
  const run = Math.min(0.26, (r.y1 - r.y0 - EXT_T - 0.3) / steps);
  const rise = 3 / steps;
  const start = r.y0 + EXT_T + 0.05 + run * steps;
  const holo = css(b.env.holo);
  for (let i = 0; i < steps; i++) {
    const step = box(x0, start - (i + 1) * run, z, x1, start - i * run, z + (i + 1) * rise);
    if ((i + 1) * rise <= CUT_H + 0.5) {
      items.push({ box: step, shapes: b.solid(step, 'lightOak', roomId) });
    } else {
      // Above the cut the flight carries on as a hologram.
      const tread = box(x0, step.y0, step.z1 - rise, x1, step.y1, step.z1);
      items.push({
        box: tread,
        shapes: [
          { d: polygon(topFace(tread)), fill: holo, opacity: 0.08 * b.env.holoAlpha + 0.04 },
          {
            d: polyline([...topFace(tread), topFace(tread)[0]]),
            stroke: holo,
            width: 1,
            opacity: 0.5 * b.env.holoAlpha + 0.15,
            kind: 'line',
          },
        ],
      });
    }
  }
  return items;
}

function drawCutaway(b: Builder, story: PlanStory): { items: Item[]; floors: Shape[]; pools: Shape[]; front: Shape[] } {
  const plan = b.plan;
  const env = b.env;
  const W = plan.width;
  const D = plan.depth;
  const z = story.z;
  const floors: Shape[] = [];
  const pools: Shape[] = [];
  const items: Item[] = [];
  const front: Shape[] = [];
  const top = plan.stories[plan.stories.length - 1] === story;

  const slab = box(0, 0, z - 0.3, W, D, z);
  floors.push(b.face(leftFace(slab), 'plinth', env.left), b.face(rightFace(slab), 'plinth', env.right));

  for (const cell of story.cells) {
    const r = cell.rect;
    const room = cell.id ? b.input.rooms.get(cell.id) : undefined;
    const roomId = room ? cell.id : null;
    const material = FLOOR[cell.type] ?? 'oak';
    const quad = topFace(box(r.x0, r.y0, z, r.x1, r.y1, z));
    floors.push(b.face(quad, material, env.top, roomId));
    const texture =
      material === 'tile' || material === 'slate'
        ? 'tiles'
        : material === 'concrete'
          ? null
          : material === 'carpet'
            ? null
            : 'planks';
    if (texture) floors.push({ d: polygon(quad), fill: `url(#lc-${texture})` });
    const clip = `${b.input.prefix ?? ''}c${b.clips.length}`;
    b.clips.push({ id: clip, d: polygon(quad) });
    const volume = box(r.x0, r.y0, z, r.x1, r.y1, z + WALL_H);
    const volumeClip = `${b.input.prefix ?? ''}c${b.clips.length}`;
    b.clips.push({ id: volumeClip, d: polygon(silhouette(volume)) });

    if (cell.id) {
      b.volumes.set(cell.id, box(r.x0, r.y0, z, r.x1, r.y1, z + CUT_H));
      b.hits.push({ roomId: cell.id, d: polygon(silhouette(box(r.x0, r.y0, z, r.x1, r.y1, z + CUT_H))) });
      const [ax, ay] = project((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, z + 1.5);
      b.anchors.push({ roomId: cell.id, x: ax, y: ay });
    }

    const toward = facadesOf(cell, plan);
    const furnished = furnish(
      cell.type,
      { x0: r.x0 + (r.x0 < 0.01 ? EXT_T : 0), y0: r.y0 + (r.y0 < 0.01 ? EXT_T : 0), x1: r.x1, y1: r.y1 },
      z,
      toward.includes('front') ? 'front' : toward.includes('right') ? 'right' : null,
    );
    for (const piece of furnished.pieces) {
      const shapes =
        piece.box.z1 - piece.box.z0 < 0.03
          ? [b.face(topFace(piece.box), piece.material, env.top, roomId)]
          : b.solid(piece.box, piece.material, roomId);
      if (piece.screen && roomId && b.lampOf(roomId)) {
        shapes[0] = { ...shapes[0], fill: glowColor([120, 170, 255], 0.2) };
      }
      items.push({ box: piece.box, shapes });
    }
    if (cell.type === 'stairs') items.push(...drawStairs(b, cell, z, !top, roomId));
    if (room) {
      const fixtures = drawFixtures(b, cell, room, furnished.spots, z, clip, volumeClip);
      items.push(...fixtures.items);
      pools.push(...fixtures.pools);
    }
  }

  // Outer walls at the back (full height, with windows) and interior walls cut low.
  for (const cell of story.cells) {
    const r = cell.rect;
    const roomId = cell.id && b.input.rooms.has(cell.id) ? cell.id : null;
    if (r.y0 < 0.01) {
      const wall = box(r.x0, 0, z, r.x1, EXT_T, z + WALL_H);
      items.push({ box: wall, shapes: [...wallShapes(b, wall, 'back', roomId)] });
    }
    if (r.x0 < 0.01) {
      const wall = box(0, r.y0, z, EXT_T, r.y1, z + WALL_H);
      items.push({ box: wall, shapes: [...wallShapes(b, wall, 'left', roomId)] });
    }
  }
  for (let i = 0; i < story.cells.length; i++) {
    for (let j = 0; j < story.cells.length; j++) {
      if (i === j) continue;
      const a = story.cells[i];
      const c = story.cells[j];
      if (OPEN_PLAN.has(a.type) && OPEN_PLAN.has(c.type)) continue;
      // Walls on a's far side: along x = a.x1 (c to the right) or y = a.y1 (c in front).
      if (Math.abs(a.rect.x1 - c.rect.x0) < 0.01) {
        const y0 = Math.max(a.rect.y0, c.rect.y0);
        const y1 = Math.min(a.rect.y1, c.rect.y1);
        if (y1 - y0 > 0.05)
          items.push(...partition(b, 'x', a.rect.x1, y0, y1, z, c.id && b.input.rooms.has(c.id) ? c.id : null));
      }
      if (Math.abs(a.rect.y1 - c.rect.y0) < 0.01) {
        const x0 = Math.max(a.rect.x0, c.rect.x0);
        const x1 = Math.min(a.rect.x1, c.rect.x1);
        if (x1 - x0 > 0.05)
          items.push(...partition(b, 'y', a.rect.y1, x0, x1, z, c.id && b.input.rooms.has(c.id) ? c.id : null));
      }
    }
  }

  // The walls facing the viewer are glass: a low sill, clear panes and a glowing frame.
  const holo = css(env.holo);
  const sill = 0.35;
  const frontSill = box(0, D - EXT_T, z, W, D, z + sill);
  const rightSill = box(W - EXT_T, 0, z, W, D - EXT_T, z + sill);
  front.push(...b.solid(rightSill, 'siding', null, 'wallCut'), ...b.solid(frontSill, 'siding', null, 'wallCut'));
  const pane = (pts: Vec3[]) => front.push({ d: polygon(pts), fill: holo, opacity: 0.045 * env.holoAlpha + 0.02 });
  pane(wallQuad(plan, 'right', 0, D, z + sill, z + WALL_H));
  pane(wallQuad(plan, 'front', 0, W, z + sill, z + WALL_H));
  let mullions = '';
  for (const cell of story.cells) {
    if (facadesOf(cell, plan).includes('front') && cell.rect.x0 > 0.01)
      mullions += polyline([
        [cell.rect.x0, D, z + sill],
        [cell.rect.x0, D, z + WALL_H],
      ]);
    if (facadesOf(cell, plan).includes('right') && cell.rect.y1 < D - 0.01)
      mullions += polyline([
        [W, cell.rect.y1, z + sill],
        [W, cell.rect.y1, z + WALL_H],
      ]);
  }
  const frame = polyline([
    [0, D, z + WALL_H],
    [W, D, z + WALL_H],
    [W, 0, z + WALL_H],
  ]);
  front.push({
    d:
      mullions +
      polyline([
        [W, D, z + sill],
        [W, D, z + WALL_H],
      ]),
    stroke: holo,
    width: 1,
    opacity: 0.45 * env.holoAlpha,
    kind: 'line',
  });
  front.push({ d: frame, stroke: holo, width: 4, opacity: 0.25 * env.holoAlpha, kind: 'line' });
  front.push({
    d: frame,
    stroke: css(env.holo.map((v) => v + (255 - v) * 0.5)),
    width: 1.3,
    opacity: 0.9 * env.holoAlpha,
    kind: 'line',
  });
  return { items, floors, pools, front };
}

/** A wall standing inside the house, cut at waist height, with a doorway in long runs. */
function partition(
  b: Builder,
  axis: 'x' | 'y',
  at: number,
  from: number,
  to: number,
  z: number,
  facing: string | null,
): Item[] {
  const length = to - from;
  const pieces: [number, number][] = [];
  if (length > 1.7) {
    const door = from + Math.min(length / 2, 1.1);
    pieces.push([from, door - 0.45], [door + 0.45, to]);
  } else pieces.push([from, to]);
  const items: Item[] = [];
  for (const [a, c] of pieces) {
    if (c - a < 0.05) continue;
    const wall =
      axis === 'x'
        ? box(at - INT_T / 2, a, z, at + INT_T / 2, c, z + CUT_H)
        : box(a, at - INT_T / 2, z, c, at + INT_T / 2, z + CUT_H);
    items.push({
      box: wall,
      shapes: [
        b.face(leftFace(wall), 'plaster', b.env.left, axis === 'y' ? facing : null),
        b.face(rightFace(wall), 'plaster', b.env.right, axis === 'x' ? facing : null),
        b.face(topFace(wall), 'wallCut', b.env.top),
      ],
    });
  }
  return items;
}

/** A back wall's inside face, lit by its room, with windows that show the sky. */
function wallShapes(b: Builder, wall: Box, side: 'back' | 'left', roomId: string | null): Shape[] {
  const env = b.env;
  const inner = side === 'back' ? leftFace(wall) : rightFace(wall);
  const k = side === 'back' ? env.left : env.right;
  const shapes: Shape[] = [b.face(inner, 'plaster', k, roomId)];
  const length = side === 'back' ? wall.x1 - wall.x0 : wall.y1 - wall.y0;
  const start = side === 'back' ? wall.x0 : wall.y0;
  const count = length > 2.2 ? Math.max(1, Math.floor(length / 2.4)) : 0;
  for (let i = 0; i < count; i++) {
    const c = start + (length * (i + 0.5)) / count;
    const w = Math.min(0.55, length / 4);
    const at = (u: number, h: number): Vec3 => (side === 'back' ? [u, wall.y1 + 0.01, h] : [wall.x1 + 0.01, u, h]);
    const z0 = wall.z0 + 0.95;
    const z1 = wall.z0 + 2.25;
    shapes.push(
      b.face(
        [
          at(c - w - 0.07, z1 + 0.07),
          at(c + w + 0.07, z1 + 0.07),
          at(c + w + 0.07, z0 - 0.07),
          at(c - w - 0.07, z0 - 0.07),
        ],
        'trim',
        k,
        roomId,
      ),
    );
    shapes.push({
      d: polygon([at(c - w, z1), at(c + w, z1), at(c + w, z0), at(c - w, z0)]),
      fill: 'url(#lc-sky-window)',
      kind: 'glass',
    });
  }
  if (side === 'back') shapes.push(b.face(rightFace(wall), 'plaster', env.right, roomId));
  else shapes.push(b.face(leftFace(wall), 'plaster', env.left, roomId));
  shapes.push(b.face(topFace(wall), 'wallCut', env.top));
  return shapes;
}

// ─── Putting it together ─────────────────────────────────────────────────────

function flatten(b: Builder, items: Item[]): void {
  for (const item of paintOrder(items)) b.shapes.push(...item.shapes);
}

export function buildScene(input: SceneInput): Scene {
  const b = new Builder(input);
  const plan = input.plan;
  const s = site(plan, input.outdoor);
  const view = input.view;
  const above = plan.stories.filter((st) => !st.basement);
  const basement = [...plan.stories].reverse().find((st) => st.basement);

  if (view.kind === 'exterior') {
    drawPlatform(b, s, { grid: true });
    drawGroundZones(b, s);
    if (input.env.mode !== 'night') {
      // A soft shadow cast away from the sun.
      const topZ = above.length ? above[above.length - 1].z + plan.storyHeight : plan.base;
      const len = Math.min(4, topZ * 0.45);
      const dir = input.env.left > input.env.right ? 1 : -1;
      const W = plan.width;
      const D = plan.depth;
      const pts: Vec3[] =
        dir > 0
          ? [
              [W, 0, 0.02],
              [W + len, -len * 0.35, 0.02],
              [W + len, D - len * 0.35, 0.02],
              [W, D, 0.02],
            ]
          : [
              [0, D, 0.02],
              [-len * 0.35, D + len, 0.02],
              [W - len * 0.35, D + len, 0.02],
              [W, D, 0.02],
            ];
      b.shapes.push({ d: polygon(pts), fill: '#000', opacity: input.env.mode === 'day' ? 0.12 : 0.08 });
    }
    // Light spilling from ground-floor windows onto the grass.
    const ground = plan.stories.find((st) => st.ground);
    if (ground) {
      for (const cell of ground.cells) {
        if (!cell.id || !input.rooms.has(cell.id)) continue;
        const lamp = b.lampOf(cell.id);
        for (const side of facadesOf(cell, plan)) {
          const mid = side === 'front' ? (cell.rect.x0 + cell.rect.x1) / 2 : (cell.rect.y0 + cell.rect.y1) / 2;
          const [x, y] = side === 'front' ? [mid, plan.depth + 1.1] : [plan.width + 1.1, mid];
          b.shapes.push(
            b.pool(
              x,
              y,
              0.02,
              1.6,
              lamp?.rgb ?? [255, 196, 116],
              lamp ? Math.min(1, lamp.intensity) * input.env.lamp * 0.55 : 0,
            ),
          );
        }
      }
    }
    const items: Item[] = [];
    const roofBase = above.length ? above[above.length - 1].z + plan.storyHeight : plan.base;
    if (plan.stories.length) {
      items.push(drawPlinth(b, basement));
      for (const story of above) items.push(drawStoryOutside(b, story, s));
      if (above.length) items.push(drawRoof(b, roofBase));
    }
    // The house is one block; porches, trees and lamps are sorted around it.
    const house = items.flatMap((i) => i.shapes);
    const outside = [...drawZones(b, s), ...(plan.stories.length ? plantings(b, s) : [])];
    const houseItem: Item = { box: box(0, 0, 0, plan.width, plan.depth, roofBase + 4), shapes: house };
    flatten(b, [houseItem, ...outside]);
    for (const story of above)
      for (const cell of story.cells)
        if (cell.id)
          b.volumes.set(
            cell.id,
            box(cell.rect.x0, cell.rect.y0, story.z, cell.rect.x1, cell.rect.y1, story.z + plan.storyHeight),
          );
    // Frame the house and its garden; the platform may run off the edges.
    const zoneBoxes = s.zones.map((z) => screenBounds(box(z.rect.x0, z.rect.y0, 0, z.rect.x1, z.rect.y1, 2.4)));
    const houseBounds = plan.stories.length
      ? screenBounds(box(-0.6, -0.6, 0, plan.width + 0.6, plan.depth + 0.6, roofBase + roofRise(plan) + 0.9))
      : screenBounds(s.box);
    const framed = unionBounds([houseBounds, ...zoneBoxes]);
    const margin = 1.2;
    return b.finish({
      left: framed.left - margin,
      top: framed.top - margin * 0.5,
      right: framed.right + margin,
      bottom: framed.bottom + margin,
    });
  }

  const story = plan.stories[view.story] ?? plan.stories[0];
  if (!story) return b.finish(screenBounds(s.box));
  if (!story.basement) {
    drawPlatform(b, s, { grid: story.ground });
    drawGroundZones(b, s);
    const below: Item[] = [drawPlinth(b, basement, false)];
    for (const st of above) if (st.z < story.z) below.push(drawStoryOutside(b, st, s, false));
    const zones = story.ground ? [...drawZones(b, s, false), ...plantings(b, s)] : [];
    const cut = drawCutaway(b, story);
    b.shapes.push(...below.flatMap((i) => i.shapes));
    b.shapes.push(...cut.floors, ...cut.pools);
    flatten(b, [...cut.items, ...zones.filter((z) => z.box.y0 < plan.depth && z.box.x0 < plan.width)]);
    b.shapes.push(...cut.front);
    flatten(
      b,
      zones.filter((z) => !(z.box.y0 < plan.depth && z.box.x0 < plan.width)),
    );
  } else {
    // Below ground: the earth is cut away in front, and a holographic outline marks the grass above.
    const W = plan.width;
    const D = plan.depth;
    const m = 1.4;
    const soil = box(-m, -m, story.z - 0.9, W + m, D + m, story.z - 0.3);
    b.shapes.push(b.face(leftFace(soil), 'bark', b.env.left), b.face(rightFace(soil), 'bark', b.env.right));
    b.shapes.push(
      b.face(topFace(box(-m, -m, 0, W + m, 0, 0)), 'grass', b.env.top),
      b.face(topFace(box(-m, 0, 0, 0, D + m, 0)), 'grass', b.env.top),
    );
    b.shapes.push(b.face(rightFace(box(-m, -m, story.z - 0.3, 0, D + m, 0)), 'bark', b.env.right * 0.8));
    b.shapes.push(b.face(leftFace(box(-m, -m, story.z - 0.3, W + m, 0, 0)), 'bark', b.env.left * 0.8));
    const cut = drawCutaway(b, story);
    b.shapes.push(...cut.floors, ...cut.pools);
    flatten(b, cut.items);
    b.shapes.push(...cut.front);
    const holo = css(input.env.holo);
    const ground = polyline([
      [-m, D + m, 0],
      [W + m, D + m, 0],
      [W + m, -m, 0],
    ]);
    b.shapes.push({ d: ground, stroke: holo, width: 4, opacity: 0.2 * input.env.holoAlpha, kind: 'line' });
    b.shapes.push({ d: ground, stroke: holo, width: 1.2, opacity: 0.75 * input.env.holoAlpha, kind: 'line' });
    b.shapes.push({
      d: polyline([
        [-m, D + m, 0],
        [-m, -m, 0],
        [W + m, -m, 0],
      ]),
      stroke: holo,
      width: 1,
      opacity: 0.45 * input.env.holoAlpha,
      kind: 'line',
    });
  }
  const bounds = screenBounds(box(0, 0, story.z - 0.3, plan.width, plan.depth, story.z + WALL_H + 0.4));
  return b.finish(bounds);
}
