// Collects the triangles of the 3D house. Shapes are described in plan space (x along the front
// wall, y from the back to the front, z up) and stored in world space, ready for the renderer.
//
// Every vertex carries what the shader needs to draw its surface: a material and a base color, the
// room it belongs to (so only that room's lamps light it), the light it glows with, if any, and the
// group that decides when it is lifted away to open a floor.

import { cross, dot, normalize, sub, toWorld, type Vec3 } from './math.ts';
import type { RGB } from '../color.ts';

/** Bytes per vertex: position (12), uv (8), normal + group (4), color + material (4), room + emit + flags + side (4). */
export const VERTEX_BYTES = 32;

/** A vertex flag: this surface casts no shadow. */
export const FLAG_NO_SHADOW = 1;

export interface Mesh {
  vertices: ArrayBuffer;
  vertexCount: number;
  indices: Uint32Array;
  /** Index ranges: solid surfaces first, then see-through ones (glass), which are drawn last. */
  opaque: { start: number; count: number };
  blended: { start: number; count: number };
}

export interface Paint {
  material: number;
  color: RGB;
}

type P = readonly [number, number, number];
type UV = readonly [number, number];

/** Which faces of a box to leave out: they are hidden against something else. */
export const SKIP = { bottom: 1, top: 2, left: 4, right: 8, back: 16, front: 32 } as const;

/** A cut through space, in plan space: what lies where n·p ≤ d is kept. */
export interface Plane {
  n: P;
  d: number;
  /** Leave the cut open instead of closing it with a face: for a cut that something else covers. */
  open?: boolean;
}

/** A convex space: everything inside all of its planes. */
export type Region = readonly Plane[];

type Settings = Partial<
  Pick<MeshBuilder, 'material' | 'color' | 'room' | 'emit' | 'group' | 'flags' | 'side' | 'blend' | 'clip'>
>;

/** One face of a convex solid. `paint` are the settings it is drawn with, if not the current ones. */
export interface SolidFace {
  points: readonly P[];
  normal: P;
  uvs?: readonly UV[];
  paint?: Settings;
  /** Left out, though it still bounds the solid: it is hidden against something else. */
  skip?: boolean;
}

/** A corner of a polygon being cut: where it is, its texture coordinates and, on a rounded shape, its normal. */
interface Corner {
  p: P;
  uv: UV;
  n?: P;
}

interface Face {
  ring: Corner[];
  normal: P;
  paint?: Settings;
  hidden?: boolean;
  /** A face that closes a cut. */
  cap?: boolean;
}

const EPS = 1e-7;

/** How far a point is beyond a plane: positive is cut away. */
const beyond = (plane: Plane, p: P): number => plane.n[0] * p[0] + plane.n[1] * p[1] + plane.n[2] * p[2] - plane.d;

function between(a: Corner, b: Corner, t: number): Corner {
  const mix = (u: number, v: number) => u + (v - u) * t;
  return {
    p: [mix(a.p[0], b.p[0]), mix(a.p[1], b.p[1]), mix(a.p[2], b.p[2])],
    uv: [mix(a.uv[0], b.uv[0]), mix(a.uv[1], b.uv[1])],
    n: a.n && b.n ? [mix(a.n[0], b.n[0]), mix(a.n[1], b.n[1]), mix(a.n[2], b.n[2])] : undefined,
  };
}

/** What a plane leaves of a convex polygon. The points where its outline meets the plane are added to `cut`. */
function slice(ring: Corner[], plane: Plane, cut?: P[]): Corner[] {
  const side = ring.map((c) => beyond(plane, c.p));
  if (side.every((v) => v <= EPS)) return ring;
  const out: Corner[] = [];
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const a = side[i];
    const b = side[j];
    if (a <= EPS) {
      out.push(ring[i]);
      if (a >= -EPS) cut?.push(ring[i].p);
    }
    if ((a < -EPS && b > EPS) || (a > EPS && b < -EPS)) {
      const corner = between(ring[i], ring[j], a / (a - b));
      out.push(corner);
      cut?.push(corner.p);
    }
  }
  return out;
}

/** The points of a cut, put in order around it. */
function capRing(points: P[], normal: P): P[] {
  // Points a few millimeters apart are one corner: the faces of a solid need not meet exactly.
  const unique: P[] = [];
  for (const p of points) {
    if (!unique.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.0045)) unique.push(p);
  }
  if (unique.length < 3) return [];
  const center: Vec3 = [0, 0, 0];
  for (const p of unique) for (let i = 0; i < 3; i++) center[i] += p[i] / unique.length;
  const n: Vec3 = [normal[0], normal[1], normal[2]];
  const u = normalize(cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const v = cross(n, u);
  const angle = (p: P) => {
    const d = sub([p[0], p[1], p[2]], center);
    return Math.atan2(dot(d, v), dot(d, u));
  };
  return unique.sort((a, b) => angle(a) - angle(b));
}

/** What a region leaves of a convex solid: its faces cut back, and a new face over every cut. */
function cutSolid(faces: Face[], region: Region): Face[] {
  let current = faces;
  for (const plane of region) {
    const cut: P[] = [];
    let cuts = false;
    const next: Face[] = [];
    for (const face of current) {
      const ring = slice(face.ring, plane, cut);
      if (ring !== face.ring) cuts = true;
      if (ring.length >= 3) next.push(ring === face.ring ? face : { ...face, ring });
    }
    if (cuts) {
      const ring = capRing(cut, plane.n);
      if (ring.length >= 3) {
        next.push({
          ring: ring.map((p) => ({ p, uv: surfaceUv(p, plane.n) })),
          normal: plane.n,
          cap: true,
          hidden: plane.open,
        });
      }
    }
    current = next;
    if (!current.length) break;
  }
  return current;
}

export class MeshBuilder {
  private buffer = new ArrayBuffer(VERTEX_BYTES * 4096);
  private f32 = new Float32Array(this.buffer);
  private u8 = new Uint8Array(this.buffer);
  private i8 = new Int8Array(this.buffer);
  private count = 0;
  private readonly opaque: number[] = [];
  private readonly clear: number[] = [];

  material = 0;
  color: RGB = [255, 255, 255];
  room = 0;
  emit = 0;
  group = 0;
  flags = 0;
  /**
   * The outside wall this belongs to, above its sill: 1 front, 2 right, 3 back, 4 left. When a
   * floor is opened, the walls between it and the viewer are the ones that lift away.
   */
  side = 0;
  /** Draw into the see-through layer. */
  blend = false;
  /**
   * Only what lies inside one of these regions is drawn, as under the slopes of a roof; shapes
   * that reach beyond them are cut off there. The regions must not overlap.
   */
  clip: readonly Region[] | null = null;

  get vertexCount(): number {
    return this.count;
  }

  paint(material: number, color: RGB): this {
    this.material = material;
    this.color = color;
    return this;
  }

  /** Runs `draw` with some settings changed, then puts them back. */
  with(settings: Settings, draw: () => void): void {
    const saved = {
      material: this.material,
      color: this.color,
      room: this.room,
      emit: this.emit,
      group: this.group,
      flags: this.flags,
      side: this.side,
      blend: this.blend,
      clip: this.clip,
    };
    Object.assign(this, settings);
    draw();
    Object.assign(this, saved);
  }

  private grow(): void {
    const next = new ArrayBuffer(this.buffer.byteLength * 2);
    new Uint8Array(next).set(this.u8);
    this.buffer = next;
    this.f32 = new Float32Array(next);
    this.u8 = new Uint8Array(next);
    this.i8 = new Int8Array(next);
  }

  /** Adds a vertex given in world space; returns its index. */
  private vertex(p: Vec3, n: Vec3, uv: UV): number {
    if ((this.count + 1) * VERTEX_BYTES > this.buffer.byteLength) this.grow();
    const i = this.count++;
    const f = i * 8;
    const b = i * VERTEX_BYTES;
    this.f32[f] = p[0];
    this.f32[f + 1] = p[1];
    this.f32[f + 2] = p[2];
    this.f32[f + 3] = uv[0];
    this.f32[f + 4] = uv[1];
    this.i8[b + 20] = Math.round(n[0] * 127);
    this.i8[b + 21] = Math.round(n[1] * 127);
    this.i8[b + 22] = Math.round(n[2] * 127);
    this.i8[b + 23] = this.group;
    this.u8[b + 24] = this.color[0];
    this.u8[b + 25] = this.color[1];
    this.u8[b + 26] = this.color[2];
    this.u8[b + 27] = this.material;
    this.u8[b + 28] = this.room;
    this.u8[b + 29] = this.emit;
    this.u8[b + 30] = this.flags;
    this.u8[b + 31] = this.side;
    return i;
  }

  private triangle(a: number, b: number, c: number): void {
    (this.blend ? this.clear : this.opaque).push(a, b, c);
  }

  /**
   * A flat polygon through plan-space points, facing `normal` (plan space). The points may wind
   * either way; `uvs` default to the surface's own coordinates in meters.
   */
  poly(points: readonly P[], normal: P, uvs?: readonly UV[]): void {
    if (!this.clip) {
      this.face(points, normal, uvs);
      return;
    }
    const start: Corner[] = points.map((p, i) => ({ p, uv: uvs?.[i] ?? surfaceUv(p, normal) }));
    for (const region of this.clip) {
      let ring = start;
      for (const plane of region) {
        ring = slice(ring, plane);
        if (ring.length < 3) break;
      }
      if (ring.length >= 3) {
        this.face(
          ring.map((c) => c.p),
          normal,
          ring.map((c) => c.uv),
        );
      }
    }
  }

  /** Whether a box lies wholly inside one of the regions drawing is clipped to, so nothing of it is cut. */
  private contained(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    if (!this.clip) return true;
    return this.clip.some((region) =>
      region.every((plane) => {
        for (const x of [x0, x1])
          for (const y of [y0, y1]) for (const z of [z0, z1]) if (beyond(plane, [x, y, z]) > EPS) return false;
        return true;
      }),
    );
  }

  /**
   * A convex solid, given by its faces. Where drawing is clipped, the solid is cut off and closed
   * with a new face over the cut, drawn with `cap` (or the current settings).
   */
  solid(faces: readonly SolidFace[], cap?: Settings): void {
    const draw = (settings: Settings | undefined, fn: () => void) => (settings ? this.with(settings, fn) : fn());
    if (!this.clip) {
      for (const f of faces) if (!f.skip) draw(f.paint, () => this.face(f.points, f.normal, f.uvs));
      return;
    }
    const start: Face[] = faces.map((f) => ({
      ring: f.points.map((p, i) => ({ p, uv: f.uvs?.[i] ?? surfaceUv(p, f.normal) })),
      normal: f.normal,
      paint: f.paint,
      hidden: f.skip,
    }));
    for (const region of this.clip) {
      for (const f of cutSolid(start, region)) {
        if (f.hidden) continue;
        draw(f.cap ? cap : f.paint, () =>
          this.face(
            f.ring.map((c) => c.p),
            f.normal,
            f.ring.map((c) => c.uv),
          ),
        );
      }
    }
  }

  private face(points: readonly P[], normal: P, uvs?: readonly UV[]): void {
    const n = normalize(toWorld(normal[0], normal[1], normal[2]));
    const world = points.map((p) => toWorld(p[0], p[1], p[2]));
    const coords = uvs ?? points.map((p) => surfaceUv(p, normal));
    const ids = world.map((p, i) => this.vertex(p, n, coords[i]));
    // Wind the triangles so they face along the normal. The whole outline decides which way it
    // turns: its first corners may lie almost in a line.
    const turn: Vec3 = [0, 0, 0];
    for (let i = 1; i < world.length - 1; i++) {
      const part = cross(sub(world[i], world[0]), sub(world[i + 1], world[0]));
      for (let k = 0; k < 3; k++) turn[k] += part[k];
    }
    const facing = dot(turn, n) >= 0;
    for (let i = 1; i < ids.length - 1; i++) {
      if (facing) this.triangle(ids[0], ids[i], ids[i + 1]);
      else this.triangle(ids[0], ids[i + 1], ids[i]);
    }
  }

  quad(a: P, b: P, c: P, d: P, normal: P, uvs?: readonly UV[]): void {
    this.poly([a, b, c, d], normal, uvs);
  }

  /** A quad with its own normal at each corner, for rounded shapes. */
  smoothQuad(points: readonly [P, P, P, P], normals: readonly [P, P, P, P], uvs: readonly [UV, UV, UV, UV]): void {
    this.smoothPoly(points, normals, uvs);
  }

  /** A convex polygon with its own normal at each corner. */
  private smoothPoly(points: readonly P[], normals: readonly P[], uvs: readonly UV[]): void {
    if (!this.clip) {
      this.smoothFace(points, normals, uvs);
      return;
    }
    const start: Corner[] = points.map((p, i) => ({ p, uv: uvs[i], n: normals[i] }));
    for (const region of this.clip) {
      let ring = start;
      for (const plane of region) {
        ring = slice(ring, plane);
        if (ring.length < 3) break;
      }
      if (ring.length >= 3) {
        this.smoothFace(
          ring.map((c) => c.p),
          ring.map((c) => c.n!),
          ring.map((c) => c.uv),
        );
      }
    }
  }

  private smoothFace(points: readonly P[], normals: readonly P[], uvs: readonly UV[]): void {
    const world = points.map((p) => toWorld(p[0], p[1], p[2]));
    const ns = normals.map((n) => normalize(toWorld(n[0], n[1], n[2])));
    const ids = world.map((p, i) => this.vertex(p, ns[i], uvs[i]));
    const sum: Vec3 = [0, 0, 0];
    for (const n of ns) for (let i = 0; i < 3; i++) sum[i] += n[i];
    const mean = normalize(sum);
    const turn: Vec3 = [0, 0, 0];
    for (let i = 1; i < world.length - 1; i++) {
      const part = cross(sub(world[i], world[0]), sub(world[i + 1], world[0]));
      for (let k = 0; k < 3; k++) turn[k] += part[k];
    }
    const facing = dot(turn, mean) >= 0;
    for (let i = 1; i < ids.length - 1; i++) {
      if (facing) this.triangle(ids[0], ids[i], ids[i + 1]);
      else this.triangle(ids[0], ids[i + 1], ids[i]);
    }
  }

  /**
   * An axis-aligned box. `skip` leaves out faces (see SKIP); `grainY` runs wood grain and floor
   * boards along y instead of x.
   */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip = 0, grainY = false): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const flat = (x: number, y: number): UV => (grainY ? [y, x] : [x, y]);
    if (this.clip && !this.contained(x0, y0, z0, x1, y1, z1)) {
      // Cut off by a clip plane: the box is closed again over the cut.
      const level = (z: number, up: number, hidden: number): SolidFace => ({
        points: [
          [x0, y0, z],
          [x1, y0, z],
          [x1, y1, z],
          [x0, y1, z],
        ],
        normal: [0, 0, up],
        uvs: [flat(x0, y0), flat(x1, y0), flat(x1, y1), flat(x0, y1)],
        skip: Boolean(skip & hidden),
      });
      const wall = (a: P, b: P, c: P, d: P, normal: P, hidden: number): SolidFace => ({
        points: [a, b, c, d],
        normal,
        skip: Boolean(skip & hidden),
      });
      this.solid([
        level(z1, 1, SKIP.top),
        level(z0, -1, SKIP.bottom),
        wall([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], SKIP.front),
        wall([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], SKIP.back),
        wall([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], SKIP.right),
        wall([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0], SKIP.left),
      ]);
      return;
    }
    if (!(skip & SKIP.top))
      this.quad(
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
        [0, 0, 1],
        [flat(x0, y0), flat(x1, y0), flat(x1, y1), flat(x0, y1)],
      );
    if (!(skip & SKIP.bottom))
      this.quad(
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [0, 0, -1],
        [flat(x0, y0), flat(x1, y0), flat(x1, y1), flat(x0, y1)],
      );
    if (!(skip & SKIP.front)) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0]);
    if (!(skip & SKIP.back)) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    if (!(skip & SKIP.right)) this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
    if (!(skip & SKIP.left)) this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0]);
  }

  /**
   * A box with rounded edges, for cushions, mattresses and anything soft. The corners are cut by
   * `r` and the normals blend across them, so the edges catch the light like real ones.
   */
  softBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 0.05): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    r = Math.max(0.005, Math.min(r, (x1 - x0) / 2 - 0.001, (y1 - y0) / 2 - 0.001, (z1 - z0) / 2 - 0.001));
    // A soft box that is cut off is drawn square, so the cut can be closed.
    if (!(r > 0.004) || !this.contained(x0, y0, z0, x1, y1, z1)) {
      this.box(x0, y0, z0, x1, y1, z1);
      return;
    }
    // A 4×4×4 lattice of positions: outer planes and planes inset by r. Each of the 26 outer cells
    // of the 3×3×3 arrangement is a face, an edge strip or a corner.
    const xs = [x0, x0 + r, x1 - r, x1];
    const ys = [y0, y0 + r, y1 - r, y1];
    const zs = [z0, z0 + r, z1 - r, z1];
    // The surface point for lattice index (i, j, k): inner indices sit on the face they belong to.
    const corner = (i: number, j: number, k: number): { p: P; n: P } => {
      // Direction from the nearest inner corner; components are -1, 0 or 1.
      const dx = i === 0 ? -1 : i === 3 ? 1 : 0;
      const dy = j === 0 ? -1 : j === 3 ? 1 : 0;
      const dz = k === 0 ? -1 : k === 3 ? 1 : 0;
      const len = Math.hypot(dx, dy, dz) || 1;
      const cx = xs[i === 0 ? 1 : i === 3 ? 2 : i];
      const cy = ys[j === 0 ? 1 : j === 3 ? 2 : j];
      const cz = zs[k === 0 ? 1 : k === 3 ? 2 : k];
      return { p: [cx + (dx / len) * r, cy + (dy / len) * r, cz + (dz / len) * r], n: [dx / len, dy / len, dz / len] };
    };
    const face = (axis: 0 | 1 | 2, side: 0 | 3): void => {
      // The 3×3 patches of one side of the lattice.
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          const at = (u: number, v: number) =>
            axis === 0 ? corner(side, u, v) : axis === 1 ? corner(u, side, v) : corner(u, v, side);
          const c = [at(a, b), at(a + 1, b), at(a + 1, b + 1), at(a, b + 1)];
          const uv = (q: { p: P }): UV =>
            axis === 2 ? [q.p[0], q.p[1]] : axis === 1 ? [q.p[0], q.p[2]] : [q.p[1], q.p[2]];
          this.smoothQuad(
            [c[0].p, c[1].p, c[2].p, c[3].p],
            [c[0].n, c[1].n, c[2].n, c[3].n],
            [uv(c[0]), uv(c[1]), uv(c[2]), uv(c[3])],
          );
        }
      }
    };
    face(0, 0);
    face(0, 3);
    face(1, 0);
    face(1, 3);
    face(2, 0);
    face(2, 3);
  }

  /**
   * A round shape between two heights: a cylinder, or a cone when the radii differ. `caps` closes
   * the bottom (1), the top (2) or both (3). With `axis` 'x' or 'y' it lies on its side: (cx, cy)
   * is then its center across the axis, as (y, z) or (x, z), and z0–z1 its extent along it.
   */
  cylinder(
    cx: number,
    cy: number,
    z0: number,
    z1: number,
    r0: number,
    r1 = r0,
    segments = 12,
    caps = 2,
    axis: 'x' | 'y' | 'z' = 'z',
  ): void {
    // (a, b) across the axis and c along it, turned to plan space.
    const turn = (a: number, b: number, c: number): P =>
      axis === 'z' ? [a, b, c] : axis === 'x' ? [c, a, b] : [a, c, b];
    const slope = (r0 - r1) / Math.max(1e-6, z1 - z0);
    const ring = (i: number) => {
      const a = (i / segments) * Math.PI * 2;
      return [Math.cos(a), Math.sin(a)] as const;
    };
    const around = 2 * Math.PI * Math.max(r0, r1);
    for (let i = 0; i < segments; i++) {
      const [ax, ay] = ring(i);
      const [bx, by] = ring(i + 1);
      const na = turn(ax, ay, slope);
      const nb = turn(bx, by, slope);
      const u0 = (i / segments) * around;
      const u1 = ((i + 1) / segments) * around;
      this.smoothQuad(
        [
          turn(cx + ax * r0, cy + ay * r0, z0),
          turn(cx + bx * r0, cy + by * r0, z0),
          turn(cx + bx * r1, cy + by * r1, z1),
          turn(cx + ax * r1, cy + ay * r1, z1),
        ],
        [na, nb, nb, na],
        [
          [u0, z0],
          [u1, z0],
          [u1, z1],
          [u0, z1],
        ],
      );
    }
    const cap = (z: number, r: number, up: boolean) => {
      if (r < 1e-4) return;
      const points: P[] = [];
      const uvs: UV[] = [];
      for (let i = 0; i < segments; i++) {
        const [ax, ay] = ring(i);
        points.push(turn(cx + ax * r, cy + ay * r, z));
        uvs.push([cx + ax * r, cy + ay * r]);
      }
      this.poly(points, turn(0, 0, up ? 1 : -1), uvs);
    };
    if (caps & 1) cap(z0, r0, false);
    if (caps & 2) cap(z1, r1, true);
  }

  /**
   * A cone of foliage, for a tier of a fir tree: its edge is ragged, and its uv is what the leaf
   * shader expects (height within the tier, and a shade of its own).
   */
  leafCone(cx: number, cy: number, z0: number, z1: number, r0: number, r1: number, rand: () => number): void {
    const segments = 14;
    const shade = rand();
    const phase = rand() * 6.28;
    const slope = (r0 - r1) / Math.max(1e-6, z1 - z0);
    const world: Vec3[] = [];
    const ids: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      // Boughs reach out unevenly.
      const reach = 1 + 0.14 * Math.sin(a * 5 + phase) + 0.08 * Math.sin(a * 9 + phase * 2);
      const n = normalize(toWorld(Math.cos(a), Math.sin(a), slope * 0.7));
      for (const [z, r, t] of [
        [z0 + 0.1 * (z1 - z0) * Math.sin(a * 5 + phase), r0 * reach, 0.15],
        [z1, r1, 1],
      ] as [number, number, number][]) {
        const p = toWorld(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
        world.push(p);
        ids.push(this.vertex(p, n, [t, shade]));
      }
    }
    const center = toWorld(cx, cy, (z0 + z1) / 2);
    for (let i = 0; i < segments; i++) {
      const [a, b, c2, d] = [i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2];
      for (const [p, q, r] of [
        [a, d, c2],
        [a, c2, b],
      ]) {
        const out = dot(cross(sub(world[q], world[p]), sub(world[r], world[p])), sub(world[p], center)) >= 0;
        if (out) this.triangle(ids[p], ids[q], ids[r]);
        else this.triangle(ids[p], ids[r], ids[q]);
      }
    }
  }

  /**
   * A rounded lump: a sphere stretched to the given radii, its surface pushed in and out a little
   * by `bumpy` so foliage and bushes don't look like balls. The uv carries the height within the
   * lump (0 at the bottom, 1 at the top) and a per-lump shade, which the leaf shader uses.
   */
  blob(
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
    rand: () => number,
    bumpy = 0.12,
    detail = 2,
  ): void {
    const { points, faces } = icosphere(detail);
    const shade = rand();
    const phase = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
    const push = (p: Vec3) =>
      1 +
      bumpy *
        (Math.sin(p[0] * 4.1 + phase[0]) * Math.sin(p[1] * 3.7 + phase[1]) +
          0.6 * Math.sin(p[2] * 5.3 + phase[2]) * Math.sin(p[0] * 2.9 + phase[1]));
    if (
      this.clip &&
      !this.contained(cx - rx * 1.3, cy - ry * 1.3, cz - rz * 1.3, cx + rx * 1.3, cy + ry * 1.3, cz + rz * 1.3)
    ) {
      // Cut off by a clip plane: triangle by triangle.
      const at = points.map((p): P => {
        const k = push(p);
        return [cx + p[0] * rx * k, cy + p[1] * ry * k, cz + p[2] * rz * k];
      });
      const out = points.map((p): P => [p[0] / rx, p[1] / ry, p[2] / rz]);
      const uv = points.map((p): UV => [p[2] * 0.5 + 0.5, shade]);
      for (const [a, b, c] of faces)
        this.smoothPoly([at[a], at[b], at[c]], [out[a], out[b], out[c]], [uv[a], uv[b], uv[c]]);
      return;
    }
    const center = toWorld(cx, cy, cz);
    const world = points.map((p) => {
      const k = push(p);
      return toWorld(cx + p[0] * rx * k, cy + p[1] * ry * k, cz + p[2] * rz * k);
    });
    const ids = points.map((p, i) => {
      // The normal of an ellipsoid: the direction scaled by the inverse radii.
      const n = normalize(toWorld(p[0] / rx, p[1] / ry, p[2] / rz));
      return this.vertex(world[i], n, [p[2] * 0.5 + 0.5, shade]);
    });
    for (const [a, b, c] of faces) {
      const outward = dot(cross(sub(world[b], world[a]), sub(world[c], world[a])), sub(world[a], center)) >= 0;
      if (outward) this.triangle(ids[a], ids[b], ids[c]);
      else this.triangle(ids[a], ids[c], ids[b]);
    }
  }

  finish(): Mesh {
    const indices = new Uint32Array(this.opaque.length + this.clear.length);
    indices.set(this.opaque, 0);
    indices.set(this.clear, this.opaque.length);
    return {
      vertices: this.buffer.slice(0, this.count * VERTEX_BYTES),
      vertexCount: this.count,
      indices,
      opaque: { start: 0, count: this.opaque.length },
      blended: { start: this.opaque.length, count: this.clear.length },
    };
  }
}

/** One flat side of a solid. `cut` marks a side that a clip plane made. */
export interface Side3 {
  points: [number, number, number][];
  normal: [number, number, number];
  cut: boolean;
}

/** The sides of a box, cut back to a region if one is given: a room under the slopes of a roof. */
export function boxSides(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  region?: Region,
): Side3[] {
  const side = (normal: P, ...points: P[]): Face => ({ ring: points.map((p) => ({ p, uv: [0, 0] })), normal });
  let faces: Face[] = [
    side([0, 0, -1], [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]),
    side([0, 0, 1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    side([0, 1, 0], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]),
    side([0, -1, 0], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]),
    side([1, 0, 0], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
    side([-1, 0, 0], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]),
  ];
  if (region) faces = cutSolid(faces, region);
  return faces.map((f) => ({
    points: f.ring.map((c): [number, number, number] => [c.p[0], c.p[1], c.p[2]]),
    normal: [f.normal[0], f.normal[1], f.normal[2]],
    cut: Boolean(f.cap),
  }));
}

/** The outline of a solid: its corners, and the edges between them. */
export interface Wire {
  points: [number, number, number][];
  edges: [number, number][];
}

export function wireOf(sides: readonly Side3[]): Wire {
  const points: [number, number, number][] = [];
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  const index = (p: [number, number, number]) => {
    let i = points.findIndex((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-4);
    if (i < 0) i = points.push(p) - 1;
    return i;
  };
  for (const side of sides) {
    const ids = side.points.map(index);
    ids.forEach((a, k) => {
      const b = ids[(k + 1) % ids.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (a === b || seen.has(key)) return;
      seen.add(key);
      edges.push([a, b]);
    });
  }
  return { points, edges };
}

/** Surface coordinates in meters: across the face and up it (or x and y for a floor). */
function surfaceUv(p: P, normal: P): UV {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  if (az >= ax && az >= ay) return [p[0], p[1]];
  return ax > ay ? [p[1], p[2]] : [p[0], p[2]];
}

const SPHERES = new Map<number, { points: Vec3[]; faces: [number, number, number][] }>();

/** A sphere made of near-equal triangles; each level of detail splits every triangle in four. */
function icosphere(detail: number): { points: Vec3[]; faces: [number, number, number][] } {
  const cached = SPHERES.get(detail);
  if (cached) return cached;
  const t = (1 + Math.sqrt(5)) / 2;
  let points: Vec3[] = (
    [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ] as Vec3[]
  ).map(normalize);
  let faces: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let level = 0; level < detail; level++) {
    const middle = new Map<string, number>();
    const next: [number, number, number][] = [];
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      let id = middle.get(key);
      if (id === undefined) {
        id = points.length;
        points = [
          ...points,
          normalize([points[a][0] + points[b][0], points[a][1] + points[b][1], points[a][2] + points[b][2]]),
        ];
        middle.set(key, id);
      }
      return id;
    };
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const sphere = { points, faces };
  SPHERES.set(detail, sphere);
  return sphere;
}
