// What stands at the front door: steps alone, a little roof on columns, a porch to sit on, an
// arcade, or a flat canopy. Each design of house has its own.

import { MAT, PAINT, type HouseStyle } from '../materials.ts';
import { SKIP, type Paint } from '../mesh.ts';
import type { HousePlan, Rect } from '../plan.ts';
import type { Context } from './context.ts';
import { frontDoor } from './shell.ts';

export interface Entry {
  /** The floor in front of the door, at the height of the ground floor. */
  deck: Rect;
  /** The part of a porch that wraps round the right side of the house. */
  side: Rect | null;
  /** Where the steps come down to the path. */
  door: number;
  /** How far the steps reach in front of the deck. */
  steps: number;
}

/** Where the entry stands, which the garden is laid out around. */
export function planEntry(plan: HousePlan, style: HouseStyle): Entry | null {
  const door = frontDoor(plan);
  if (!door) return null;
  const W = plan.width;
  const D = plan.depth;
  const x = door.x;
  const steps = Math.max(0, Math.round(plan.base / 0.18) - 1) * 0.3;
  switch (style.entry) {
    case 'porch':
      return {
        deck: { x0: Math.max(0.15, x - 4.6), y0: D, x1: Math.min(W - 0.15, x + 4.6), y1: D + 2.2 },
        side: null,
        door: x,
        steps,
      };
    case 'wrap':
      return {
        deck: { x0: Math.max(0.15, x - 4.6), y0: D, x1: W + 2, y1: D + 2.2 },
        side: { x0: W, y0: D * 0.42, x1: W + 2, y1: D },
        door: x,
        steps,
      };
    case 'loggia':
      return {
        deck: { x0: Math.max(0.2, x - 3.3), y0: D, x1: Math.min(W - 0.2, x + 3.3), y1: D + 2.4 },
        side: null,
        door: x,
        steps,
      };
    default:
      return { deck: { x0: x - 0.95, y0: D, x1: x + 0.95, y1: D + 1.15 }, side: null, door: x, steps };
  }
}

const trimOf = (style: HouseStyle): Paint => ({ material: MAT.plain, color: style.trim });

/** A column of the style's kind, from the deck up to the beam it carries. */
function column(c: Context, x: number, y: number, z0: number, z1: number, group: number, lower: number): void {
  const m = c.mesh;
  const style = c.style;
  const trim = trimOf(style);
  switch (style.column) {
    case 'round':
      m.with({ group, room: 0, ...trim }, () => {
        m.box(x - 0.13, y - 0.13, z0, x + 0.13, y + 0.13, z0 + 0.1);
        m.cylinder(x, y, z0 + 0.1, z1 - 0.1, 0.105, 0.09, 14, 0);
        m.box(x - 0.13, y - 0.13, z1 - 0.1, x + 0.13, y + 0.13, z1);
      });
      break;
    case 'pier': {
      // A stout pier of stone, and a tapered wooden column standing on it.
      const top = z0 + 0.95;
      m.with({ group: lower, room: 0, ...style.foundation }, () =>
        m.box(x - 0.24, y - 0.24, z0 - 0.02, x + 0.24, y + 0.24, top),
      );
      m.with({ group: lower, room: 0, ...PAINT.concrete }, () =>
        m.box(x - 0.27, y - 0.27, top, x + 0.27, y + 0.27, top + 0.06),
      );
      m.with({ group, room: 0, ...trim }, () => {
        const steps = 5;
        for (let i = 0; i < steps; i++) {
          const w = 0.16 - i * 0.012;
          const a = top + 0.06 + ((z1 - top - 0.06) * i) / steps;
          m.box(x - w, y - w, a, x + w, y + w, top + 0.06 + ((z1 - top - 0.06) * (i + 1)) / steps);
        }
      });
      break;
    }
    case 'turned':
      m.with({ group, room: 0, ...trim }, () => {
        m.box(x - 0.07, y - 0.07, z0, x + 0.07, y + 0.07, z0 + 0.75);
        m.cylinder(x, y, z0 + 0.75, z0 + 0.85, 0.045, 0.075, 10, 0);
        m.cylinder(x, y, z0 + 0.85, z1 - 0.5, 0.075, 0.05, 10, 0);
        m.cylinder(x, y, z1 - 0.5, z1 - 0.42, 0.05, 0.075, 10, 0);
        m.box(x - 0.07, y - 0.07, z1 - 0.42, x + 0.07, y + 0.07, z1);
        // Fretwork brackets either side of the post, under the beam.
        for (const s of [-1, 1]) {
          m.poly(
            [
              [x + s * 0.07, y, z1],
              [x + s * 0.5, y, z1],
              [x + s * 0.07, y, z1 - 0.42],
            ],
            [0, 1, 0],
          );
        }
      });
      break;
    case 'steel':
      m.with({ group, room: 0, ...PAINT.ironwork }, () => m.box(x - 0.035, y - 0.035, z0, x + 0.035, y + 0.035, z1));
      break;
    default:
      m.with({ group, room: 0, ...trim }, () => {
        m.box(x - 0.075, y - 0.075, z0, x + 0.075, y + 0.075, z1);
        m.box(x - 0.1, y - 0.1, z0, x + 0.1, y + 0.1, z0 + 0.12);
        m.box(x - 0.1, y - 0.1, z1 - 0.1, x + 0.1, y + 0.1, z1);
      });
  }
}

/** A railing between two points on the deck: balusters, or a solid low wall on a bungalow. */
function railing(c: Context, xa: number, ya: number, xb: number, yb: number, z: number, group: number): void {
  const m = c.mesh;
  const style = c.style;
  const length = Math.hypot(xb - xa, yb - ya);
  if (length < 0.5 || style.column === 'steel') return;
  const alongX = Math.abs(xb - xa) > Math.abs(yb - ya);
  const [a, b] = alongX ? [Math.min(xa, xb), Math.max(xa, xb)] : [Math.min(ya, yb), Math.max(ya, yb)];
  const bar = (u0: number, u1: number, t: number, h0: number, h1: number) =>
    alongX ? m.box(u0, ya - t, z + h0, u1, ya + t, z + h1) : m.box(xa - t, u0, z + h0, xa + t, u1, z + h1);
  if (style.column === 'pier') {
    m.with({ group, room: 0, ...style.wall }, () => bar(a, b, 0.07, 0, 0.72));
    m.with({ group, room: 0, ...trimOf(style) }, () => bar(a, b, 0.1, 0.72, 0.78));
    return;
  }
  m.with({ group, room: 0, ...trimOf(style) }, () => {
    bar(a, b, 0.03, 0.82, 0.88);
    bar(a, b, 0.025, 0.08, 0.12);
    for (let u = a + 0.1; u < b - 0.05; u += 0.13) bar(u - 0.012, u + 0.012, 0.012, 0.12, 0.82);
  });
}

/** An arcade: a wall along the front of a porch, pierced by round arches between piers. */
function arcade(c: Context, x0: number, x1: number, y: number, z0: number, z1: number, group: number): void {
  const m = c.mesh;
  const style = c.style;
  const thick = 0.32;
  const count = Math.max(2, Math.round((x1 - x0) / 2.1));
  const bay = (x1 - x0) / count;
  const pier = 0.42;
  const spring = z0 + 1.55;
  const face = (yf: number, n: number) => {
    for (let i = 0; i < count; i++) {
      const a = x0 + i * bay + pier / 2;
      const b = x0 + (i + 1) * bay - pier / 2;
      const r = (b - a) / 2;
      const mid = (a + b) / 2;
      // The wall above each arch, in upright strips from the curve to the top.
      const segments = 12;
      for (let k = 0; k < segments; k++) {
        const t0 = Math.PI - (k / segments) * Math.PI;
        const t1 = Math.PI - ((k + 1) / segments) * Math.PI;
        m.quad(
          [mid + Math.cos(t0) * r, yf, spring + Math.sin(t0) * r],
          [mid + Math.cos(t1) * r, yf, spring + Math.sin(t1) * r],
          [mid + Math.cos(t1) * r, yf, z1],
          [mid + Math.cos(t0) * r, yf, z1],
          [0, n, 0],
        );
      }
    }
    // The piers between them.
    for (let i = 0; i <= count; i++) {
      const cx = x0 + i * bay;
      const a = Math.max(x0, cx - pier / 2);
      const b = Math.min(x1, cx + pier / 2);
      m.quad([a, yf, z0], [b, yf, z0], [b, yf, z1], [a, yf, z1], [0, n, 0]);
    }
  };
  m.with({ group, room: 0, ...style.wall }, () => {
    face(y, 1);
    face(y - thick, -1);
    // The sides of the piers and the undersides of the arches.
    for (let i = 0; i < count; i++) {
      const a = x0 + i * bay + pier / 2;
      const b = x0 + (i + 1) * bay - pier / 2;
      const r = (b - a) / 2;
      const mid = (a + b) / 2;
      m.quad([a, y - thick, z0], [a, y, z0], [a, y, spring], [a, y - thick, spring], [1, 0, 0]);
      m.quad([b, y - thick, z0], [b, y, z0], [b, y, spring], [b, y - thick, spring], [-1, 0, 0]);
      const segments = 12;
      for (let k = 0; k < segments; k++) {
        const t0 = Math.PI - (k / segments) * Math.PI;
        const t1 = Math.PI - ((k + 1) / segments) * Math.PI;
        const tm = (t0 + t1) / 2;
        m.quad(
          [mid + Math.cos(t0) * r, y - thick, spring + Math.sin(t0) * r],
          [mid + Math.cos(t0) * r, y, spring + Math.sin(t0) * r],
          [mid + Math.cos(t1) * r, y, spring + Math.sin(t1) * r],
          [mid + Math.cos(t1) * r, y - thick, spring + Math.sin(t1) * r],
          [-Math.cos(tm), 0, -Math.sin(tm)],
        );
      }
    }
    m.quad([x0, y - thick, z0], [x0, y, z0], [x0, y, z1], [x0, y - thick, z1], [-1, 0, 0]);
    m.quad([x1, y - thick, z0], [x1, y, z0], [x1, y, z1], [x1, y - thick, z1], [1, 0, 0]);
  });
}

/** A roof of one slope over a porch, falling away from the wall. `toward` is the side it falls to. */
function porchRoof(c: Context, r: Rect, top: number, toward: 'front' | 'right', group: number): void {
  const m = c.mesh;
  const style = c.style;
  const flat = style.roofForm === 'flat' || style.roofForm === 'shed';
  const high = top + (flat ? 0.3 : 0.78);
  const low = top + 0.2;
  const over = 0.3;
  const trim = trimOf(style);
  if (toward === 'front') {
    const out = r.y1 + over;
    const length = Math.hypot(out - r.y0, high - low);
    m.with({ group, room: 0, ...style.roof }, () =>
      m.quad(
        [r.x0 - 0.25, r.y0, high],
        [r.x1 + 0.25, r.y0, high],
        [r.x1 + 0.25, out, low],
        [r.x0 - 0.25, out, low],
        [0, high - low, out - r.y0],
        [
          [r.x0, length],
          [r.x1, length],
          [r.x1, 0],
          [r.x0, 0],
        ],
      ),
    );
    m.with({ group, room: 0, ...trim }, () => {
      m.quad(
        [r.x0 - 0.25, out, low - 0.14],
        [r.x1 + 0.25, out, low - 0.14],
        [r.x1 + 0.25, out, low],
        [r.x0 - 0.25, out, low],
        [0, 1, 0],
      );
      m.quad(
        [r.x0 - 0.25, r.y0, top + 0.2],
        [r.x1 + 0.25, r.y0, top + 0.2],
        [r.x1 + 0.25, out, low - 0.14],
        [r.x0 - 0.25, out, low - 0.14],
        [0, 0, -1],
      );
      for (const [x, n] of [
        [r.x0 - 0.25, -1],
        [r.x1 + 0.25, 1],
      ]) {
        m.poly(
          [
            [x, r.y0, top + 0.2],
            [x, out, low - 0.14],
            [x, out, low],
            [x, r.y0, high],
          ],
          [n, 0, 0],
        );
      }
    });
  } else {
    const out = r.x1 + over;
    const length = Math.hypot(out - r.x0, high - low);
    m.with({ group, room: 0, ...style.roof }, () =>
      m.quad(
        [r.x0, r.y0 - 0.25, high],
        [r.x0, r.y1, high],
        [out, r.y1, low],
        [out, r.y0 - 0.25, low],
        [out - r.x0, 0, high - low],
        [
          [r.y0, length],
          [r.y1, length],
          [r.y1, 0],
          [r.y0, 0],
        ],
      ),
    );
    m.with({ group, room: 0, ...trim }, () => {
      m.quad(
        [out, r.y0 - 0.25, low - 0.14],
        [out, r.y1, low - 0.14],
        [out, r.y1, low],
        [out, r.y0 - 0.25, low],
        [1, 0, 0],
      );
      m.quad(
        [r.x0, r.y0 - 0.25, top + 0.2],
        [r.x0, r.y1, top + 0.2],
        [out, r.y1, low - 0.14],
        [out, r.y0 - 0.25, low - 0.14],
        [0, 0, -1],
      );
      m.poly(
        [
          [r.x0, r.y0 - 0.25, top + 0.2],
          [out, r.y0 - 0.25, low - 0.14],
          [out, r.y0 - 0.25, low],
          [r.x0, r.y0 - 0.25, high],
        ],
        [0, -1, 0],
      );
    });
  }
}

/** Builds the entry of the style: its deck and steps, what holds its roof up, and the roof. */
export function buildEntry(c: Context, entry: Entry | null): void {
  const plan = c.plan;
  const ground = c.ground;
  if (!entry || !ground) return;
  const m = c.mesh;
  const style = c.style;
  const lower = c.groups.ground;
  const upper = c.groups.upper[ground.index];
  const base = plan.base;
  const D = plan.depth;
  const r = entry.deck;
  const x = entry.door;
  const trim = trimOf(style);
  const wide = style.entry === 'porch' || style.entry === 'wrap' || style.entry === 'loggia';
  const masonry = style.entry === 'loggia' || style.entry === 'canopy' || !wide;
  const floor =
    style.entry === 'loggia' ? PAINT.terracotta : masonry ? { ...PAINT.stone, material: MAT.concrete } : PAINT.deck;

  // The deck, the skirt under it, and steps down to the path.
  const deck = (d: Rect) => {
    m.with({ group: lower, room: 0, ...floor }, () =>
      m.box(d.x0, d.y0, base - 0.08, d.x1, d.y1, base - 0.02, SKIP.bottom),
    );
    m.with({ group: lower, room: 0, ...(masonry ? style.foundation : trim) }, () =>
      m.box(d.x0 + 0.03, d.y0, 0, d.x1 - 0.03, d.y1 - 0.03, base - 0.08, SKIP.bottom | SKIP.top),
    );
  };
  deck(r);
  if (entry.side) deck(entry.side);
  const count = Math.max(1, Math.round(base / 0.18));
  const rise = base / count;
  const stepHalf = wide ? 0.8 : 0.95;
  m.with({ group: lower, room: 0, ...floor }, () => {
    for (let i = 1; i < count; i++) {
      m.box(x - stepHalf, r.y1 + (i - 1) * 0.3, 0, x + stepHalf, r.y1 + i * 0.3, base - 0.02 - i * rise, SKIP.bottom);
    }
  });

  const top = base + 2.45;
  const edge = r.y1 - 0.14;
  if (wide) {
    // Posts along the front, either side of the steps and at the corners.
    const posts = [r.x0 + 0.12, x - 0.9, x + 0.9, r.x1 - 0.12].filter(
      (v, i, all) => v > r.x0 && v < r.x1 && (i === 0 || v - all[i - 1] > 0.6),
    );
    // Long stretches get a post in the middle.
    const all: number[] = [];
    posts.forEach((v, i) => {
      if (i && v - posts[i - 1] > 3.4) all.push((v + posts[i - 1]) / 2);
      all.push(v);
    });
    if (style.entry === 'loggia') {
      arcade(c, r.x0, r.x1, r.y1, base - 0.02, top + 0.2, upper);
    } else {
      for (const v of all) column(c, v, edge, base - 0.02, top, upper, lower);
      m.with({ group: upper, room: 0, ...trim }, () => {
        m.box(r.x0 - 0.05, edge - 0.1, top, r.x1 + 0.05, edge + 0.1, top + 0.2);
        m.box(r.x0 - 0.05, r.y0, top, r.x0 + 0.12, edge, top + 0.2);
        if (!entry.side) m.box(r.x1 - 0.12, r.y0, top, r.x1 + 0.05, edge, top + 0.2);
      });
      for (let i = 1; i < all.length; i++) {
        // No railing across the steps.
        if (all[i - 1] < x && all[i] > x) continue;
        railing(c, all[i - 1], edge, all[i], edge, base - 0.02, lower);
      }
      railing(c, r.x0 + 0.12, r.y0 + 0.05, r.x0 + 0.12, edge, base - 0.02, lower);
      if (!entry.side) railing(c, r.x1 - 0.12, r.y0 + 0.05, r.x1 - 0.12, edge, base - 0.02, lower);
    }
    porchRoof(c, r, top, 'front', upper);
    if (entry.side) {
      // Round the corner: posts and a railing down the side, under a roof of its own.
      const s = entry.side;
      const sideEdge = s.x1 - 0.14;
      const ys = [s.y0 + 0.12, (s.y0 + s.y1) / 2, s.y1 - 0.1];
      for (const y of ys) column(c, sideEdge, y, base - 0.02, top, upper, lower);
      m.with({ group: upper, room: 0, ...trim }, () =>
        m.box(sideEdge - 0.1, s.y0, top, sideEdge + 0.1, r.y1, top + 0.2),
      );
      railing(c, sideEdge, ys[0], sideEdge, r.y1 - 0.14, base - 0.02, lower);
      railing(c, s.x0 + 0.05, s.y0 + 0.12, sideEdge, s.y0 + 0.12, base - 0.02, lower);
      porchRoof(c, s, top, 'right', upper);
    }
    // Somewhere to sit.
    const seat = (sx: number) =>
      m.with({ group: lower, room: 0, ...PAINT.paleWood }, () => {
        m.box(sx - 0.26, r.y0 + 0.32, base + 0.36, sx + 0.26, r.y0 + 0.86, base + 0.42);
        m.box(sx - 0.26, r.y0 + 0.28, base + 0.42, sx + 0.26, r.y0 + 0.34, base + 0.98);
        for (const dx of [-0.24, 0.2]) {
          m.box(sx + dx, r.y0 + 0.32, base - 0.02, sx + dx + 0.04, r.y0 + 0.36, base + 0.36);
          m.box(sx + dx, r.y0 + 0.8, base - 0.02, sx + dx + 0.04, r.y0 + 0.84, base + 0.36);
        }
      });
    if (r.x1 - x > 2) seat(Math.min(r.x1 - 0.7, x + 1.6));
    if (x - r.x0 > 2) seat(Math.max(r.x0 + 0.7, x - 1.6));
    return;
  }

  if (style.entry === 'portico') {
    // Two columns carry a little pediment over the door.
    for (const s of [-0.8, 0.8]) column(c, x + s, D + 1.0, base - 0.02, top, upper, lower);
    const peak = top + 0.2 + 0.5;
    m.with({ group: upper, room: 0, ...trim }, () => {
      m.box(x - 1.0, D, top, x + 1.0, D + 1.14, top + 0.2);
      m.poly(
        [
          [x - 1.05, D + 1.16, top + 0.2],
          [x + 1.05, D + 1.16, top + 0.2],
          [x, D + 1.16, peak],
        ],
        [0, 1, 0],
      );
    });
    m.with({ group: upper, room: 0, ...style.roof }, () => {
      for (const s of [-1, 1]) {
        m.quad(
          [x + s * 1.14, D, top + 0.17],
          [x, D, peak + 0.04],
          [x, D + 1.26, peak + 0.04],
          [x + s * 1.14, D + 1.26, top + 0.17],
          [s * 0.5, 0, 1],
          [
            [D, 0],
            [D, 1.2],
            [D + 1.26, 1.2],
            [D + 1.26, 0],
          ],
        );
      }
    });
  } else if (style.entry === 'canopy') {
    // A thin slab reaching out over the door.
    m.with({ group: upper, room: 0, ...trim }, () => m.box(x - 1.5, D, top, x + 1.5, D + 1.6, top + 0.14));
    if (style.roofForm !== 'flat') {
      for (const s of [-1.3, 1.3]) column(c, x + s, D + 1.45, base - 0.02, top, upper, lower);
    }
  } else if (!style.crossGable || style.crossGable.at !== 'door') {
    // A small hood on brackets.
    m.with({ group: upper, room: 0, ...style.roof }, () =>
      m.quad(
        [x - 0.95, D, top + 0.42],
        [x + 0.95, D, top + 0.42],
        [x + 0.95, D + 0.95, top + 0.08],
        [x - 0.95, D + 0.95, top + 0.08],
        [0, 0.34, 0.95],
      ),
    );
    m.with({ group: upper, room: 0, ...trim }, () => {
      m.quad(
        [x - 0.95, D + 0.95, top],
        [x + 0.95, D + 0.95, top],
        [x + 0.95, D + 0.95, top + 0.08],
        [x - 0.95, D + 0.95, top + 0.08],
        [0, 1, 0],
      );
      m.quad([x - 0.95, D, top], [x + 0.95, D, top], [x + 0.95, D + 0.95, top], [x - 0.95, D + 0.95, top], [0, 0, -1]);
      for (const s of [-0.85, 0.79]) {
        m.box(x + s, D, top - 0.5, x + s + 0.06, D + 0.06, top);
        m.box(x + s, D, top - 0.06, x + s + 0.06, D + 0.7, top);
      }
    });
    if (style.column === 'steel') column(c, x + 0.85, D + 0.85, base - 0.02, top, upper, lower);
  }
  if (base > 0.5) {
    // Handrails either side of the steps.
    m.with({ group: lower, room: 0, ...PAINT.ironwork }, () => {
      const foot = r.y1 + (count - 1) * 0.3 - 0.1;
      for (const s of [-0.9, 0.86]) {
        m.box(x + s, r.y1 - 0.13, base, x + s + 0.04, r.y1 - 0.09, base + 0.9);
        m.box(x + s, foot, rise, x + s + 0.04, foot + 0.04, rise + 0.9);
        m.quad(
          [x + s, r.y1 - 0.11, base + 0.86],
          [x + s + 0.04, r.y1 - 0.11, base + 0.86],
          [x + s + 0.04, foot + 0.02, rise + 0.86],
          [x + s, foot + 0.02, rise + 0.86],
          [0, 0.3, 1],
        );
      }
    });
  }
}
