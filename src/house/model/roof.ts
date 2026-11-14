// Roofs: gabled, hipped, flat or a single slope, with the gables, dormers and chimneys that give
// each design of house its outline.

import { MAT, PAINT, type HouseStyle } from '../materials.ts';
import { SKIP, type Paint } from '../mesh.ts';
import type { Context } from './context.ts';

/** The walls a roof sits on: their outline, the height of their top, and which ends stand free. */
export interface RoofSpan {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  top: number;
  group: number;
  /** A gable end that meets a taller wall has no overhang and no wall of its own. */
  ends: { left: boolean; right: boolean };
}

/** A gable facing the front: where its ridge is, half its width, and its pitch. */
export interface CrossGable {
  at: number;
  half: number;
  pitch: number;
}

const RAKE = 0.32;
const FASCIA = 0.14;

const trimOf = (style: HouseStyle): Paint => ({ material: MAT.plain, color: style.trim });

/** A window in a gable or a dormer: glass over a dark panel, in a frame. It does not look into a room. */
function blindWindow(
  c: Context,
  plane: 'x' | 'y',
  at: number,
  out: number,
  mid: number,
  z0: number,
  half: number,
  height: number,
  group: number,
): void {
  const m = c.mesh;
  const style = c.style;
  const box = (a0: number, a1: number, d0: number, d1: number, h0: number, h1: number) =>
    plane === 'x'
      ? m.box(at + d0 * out, a0, h0, at + d1 * out, a1, h1)
      : m.box(a0, at + d0 * out, h0, a1, at + d1 * out, h1);
  m.with({ group, room: 0, ...trimOf(style) }, () =>
    box(mid - half - 0.07, mid + half + 0.07, -0.01, 0.03, z0 - 0.07, z0 + height + 0.07),
  );
  m.with({ group, room: 0, material: MAT.gloss, color: [40, 48, 60] }, () =>
    box(mid - half, mid + half, -0.01, 0.036, z0, z0 + height),
  );
  m.with({ group, room: 0, material: MAT.plain, color: style.window.frame }, () => {
    box(mid - 0.018, mid + 0.018, -0.01, 0.045, z0, z0 + height);
    box(mid - half, mid + half, -0.01, 0.045, z0 + height / 2 - 0.018, z0 + height / 2 + 0.018);
  });
}

/** Fascia, soffit and gutter along one eave, from xa to xb. `n` is 1 at the front, -1 at the back. */
function eaveTrim(
  c: Context,
  xa: number,
  xb: number,
  wall: number,
  edge: number,
  low: number,
  n: number,
  group: number,
): void {
  const m = c.mesh;
  if (xb - xa < 0.05) return;
  m.with({ group, room: 0, ...trimOf(c.style) }, () => {
    m.quad(
      [xa, edge, low - FASCIA],
      [xb, edge, low - FASCIA],
      [xb, edge, low + 0.01],
      [xa, edge, low + 0.01],
      [0, n, 0],
    );
    m.quad(
      [xa, wall, low - FASCIA],
      [xb, wall, low - FASCIA],
      [xb, edge, low - FASCIA],
      [xa, edge, low - FASCIA],
      [0, 0, -1],
    );
    if (c.style.brackets) {
      // Rafter ends showing under the eave.
      const depth = Math.abs(edge - wall);
      for (let x = xa + 0.35; x < xb - 0.2; x += 0.62) {
        m.box(
          x,
          Math.min(wall, wall + n * depth * 0.9),
          low - FASCIA - 0.11,
          x + 0.07,
          Math.max(wall, wall + n * depth * 0.9),
          low - FASCIA,
        );
      }
    }
  });
  m.with({ group, room: 0, material: MAT.gloss, color: c.style.trim }, () => {
    const y = n > 0 ? edge : edge - 0.1;
    m.box(xa, y, low - 0.12, xb, y + 0.1, low - 0.03);
  });
}

/** A dormer: a little gabled window standing out of the front slope of the roof. */
function dormer(c: Context, r: RoofSpan, x: number, pitch: number): void {
  const m = c.mesh;
  const style = c.style;
  const half = 0.62;
  const height = 1.2;
  const own = 0.85;
  const front = r.y1 - 0.5;
  const base = r.top + (r.y1 - front) * pitch;
  const eave = base + height;
  const ridge = eave + half * own;
  // Where a height on the dormer runs back into the main roof.
  const back = (z: number) => r.y1 - (z - r.top) / pitch;
  const over = 0.13;
  const len = Math.hypot(1, own);
  m.with({ group: r.group, room: 0 }, () => {
    m.with(style.gable, () => {
      m.poly(
        [
          [x - half, front, base],
          [x + half, front, base],
          [x + half, front, eave],
          [x, front, ridge],
          [x - half, front, eave],
        ],
        [0, 1, 0],
      );
      // The cheeks: a triangle of wall each side, down to the roof.
      for (const s of [-1, 1]) {
        m.poly(
          [
            [x + s * half, front, base],
            [x + s * half, front, eave],
            [x + s * half, back(eave), eave],
          ],
          [s, 0, 0],
        );
      }
    });
    m.with(style.roof, () => {
      for (const s of [-1, 1]) {
        const low = eave - over * own;
        const edge = x + s * (half + over);
        m.quad(
          [edge, front + 0.16, low],
          [x, front + 0.16, ridge],
          [x, back(ridge), ridge],
          [edge, back(low), low],
          [s * own, 0, 1],
          [
            [front, 0],
            [front, (half + over) * len],
            [back(ridge), (half + over) * len],
            [back(low), 0],
          ],
        );
      }
    });
    m.with(trimOf(style), () => {
      // Barge boards up the little gable.
      for (const s of [-1, 1]) {
        const low = eave - over * own;
        const edge = x + s * (half + over);
        m.quad(
          [edge, front + 0.16, low - 0.09],
          [edge, front + 0.16, low + 0.01],
          [x, front + 0.16, ridge + 0.01],
          [x, front + 0.16, ridge - 0.09],
          [0, 1, 0],
        );
      }
    });
  });
  blindWindow(c, 'y', front, 1, x, base + 0.22, 0.36, 0.82, r.group);
}

/**
 * A gable roof with its ridge along x. The eaves overhang the long walls and the gable ends; a
 * cross gable faces the front, and dormers stand out of the front slope.
 */
function gable(c: Context, r: RoofSpan, cross: CrossGable | null, dormers: number[]): number {
  const m = c.mesh;
  const style = c.style;
  const { x0, x1, y0, y1, top, group } = r;
  const pitch = style.pitch;
  const half = (y1 - y0) / 2;
  const mid = (y0 + y1) / 2;
  const rise = half * pitch;
  const eave = style.eave;
  const ridge = top + rise;
  const low = top - eave * pitch;
  const xa = x0 - (r.ends.left ? RAKE : 0);
  const xb = x1 + (r.ends.right ? RAKE : 0);
  const len = Math.hypot(1, pitch);
  const full = (half + eave) * len;
  // A cross gable is never higher than the main ridge.
  const gablePitch = cross ? Math.min(cross.pitch, (rise - 0.05) / cross.half) : 0;
  const peak = cross ? top + cross.half * gablePitch : 0;
  const dies = cross ? y1 - (cross.half * gablePitch) / pitch : 0;
  // Distance up the front slope from the edge of the eave, for the run of the shingles.
  const up = (y: number) => (y1 + eave - y) * len;

  m.with({ group, room: 0 }, () => {
    m.with(style.roof, () => {
      const front = (a: number, b: number) => {
        if (b - a < 0.02) return;
        m.quad(
          [a, y1 + eave, low],
          [b, y1 + eave, low],
          [b, mid, ridge],
          [a, mid, ridge],
          [0, pitch / len, 1 / len],
          [
            [a, 0],
            [b, 0],
            [b, full],
            [a, full],
          ],
        );
      };
      if (cross) {
        front(xa, cross.at - cross.half);
        front(cross.at + cross.half, xb);
        for (const s of [-1, 1]) {
          const edge = cross.at + s * cross.half;
          // The main slope behind the cross gable, down to the valley between them.
          m.quad(
            [edge, y1, top],
            [cross.at, dies, peak],
            [cross.at, mid, ridge],
            [edge, mid, ridge],
            [0, pitch / len, 1 / len],
            [
              [edge, up(y1)],
              [cross.at, up(dies)],
              [cross.at, full],
              [edge, full],
            ],
          );
          // The cross gable's own slope, from its overhang at the front back to the valley.
          const run = cross.half * Math.hypot(1, gablePitch);
          m.quad(
            [edge, y1 + RAKE, top],
            [cross.at, y1 + RAKE, peak],
            [cross.at, dies, peak],
            [edge, y1, top],
            [s * gablePitch, 0, 1],
            [
              [y1 + RAKE + 7, 0],
              [y1 + RAKE + 7, run],
              [dies + 7, run],
              [y1 + 7, 0],
            ],
          );
        }
      } else front(xa, xb);
      m.quad(
        [xa, y0 - eave, low],
        [xb, y0 - eave, low],
        [xb, mid, ridge],
        [xa, mid, ridge],
        [0, -pitch / len, 1 / len],
        [
          [xa + 11, 0],
          [xb + 11, 0],
          [xb + 11, full],
          [xa + 11, full],
        ],
      );
      // A cap along the ridge.
      m.box(xa, mid - 0.11, ridge - 0.03, xb, mid + 0.11, ridge + 0.035);
      if (cross) m.box(cross.at - 0.1, dies, peak - 0.03, cross.at + 0.1, y1 + RAKE, peak + 0.035);
    });
    m.with(trimOf(style), () => {
      // Barge boards up the gable ends, and the underside of their overhang.
      for (const [x, n, on] of [
        [xa, -1, r.ends.left],
        [xb, 1, r.ends.right],
      ] as [number, number, boolean][]) {
        if (!on) continue;
        for (const y of [y1 + eave, y0 - eave]) {
          m.quad([x, y, low - FASCIA], [x, y, low + 0.01], [x, mid, ridge + 0.01], [x, mid, ridge - FASCIA], [n, 0, 0]);
          const wall = n > 0 ? x1 : x0;
          m.quad(
            [wall, y, low - FASCIA],
            [x, y, low - FASCIA],
            [x, mid, ridge - FASCIA],
            [wall, mid, ridge - FASCIA],
            [0, y > mid ? -pitch / len : pitch / len, -1 / len],
          );
        }
      }
      if (cross) {
        for (const s of [-1, 1]) {
          const edge = cross.at + s * cross.half;
          m.quad(
            [edge, y1 + RAKE, top - FASCIA],
            [edge, y1 + RAKE, top + 0.01],
            [cross.at, y1 + RAKE, peak + 0.01],
            [cross.at, y1 + RAKE, peak - FASCIA],
            [0, 1, 0],
          );
        }
      }
    });
    m.with(style.gable, () => {
      for (const [x, n, on] of [
        [x0, -1, r.ends.left],
        [x1, 1, r.ends.right],
      ] as [number, number, boolean][]) {
        if (!on) continue;
        m.poly(
          [
            [x, y0, top],
            [x, y1, top],
            [x, mid, ridge],
          ],
          [n, 0, 0],
        );
      }
      if (cross) {
        m.poly(
          [
            [cross.at - cross.half, y1, top],
            [cross.at + cross.half, y1, top],
            [cross.at, y1, peak],
          ],
          [0, 1, 0],
        );
      }
    });
  });
  if (cross) {
    eaveTrim(c, xa, cross.at - cross.half, y1, y1 + eave, low, 1, group);
    eaveTrim(c, cross.at + cross.half, xb, y1, y1 + eave, low, 1, group);
    if (peak - top > 1.5)
      blindWindow(c, 'y', y1, 1, cross.at, top + (peak - top) * 0.22, 0.3, Math.min(0.9, (peak - top) * 0.36), group);
  } else eaveTrim(c, xa, xb, y1, y1 + eave, low, 1, group);
  eaveTrim(c, xa, xb, y0, y0 - eave, low, -1, group);
  // An attic window in the gable end the viewer first sees.
  if (r.ends.right && rise > 1.6) {
    const size = Math.min(0.5, rise * 0.16);
    blindWindow(c, 'x', x1, 1, mid, top + rise * 0.3, size, size * 2, group);
  }
  // Dormers need a roof tall enough to stand on.
  if (rise > 0.5 * pitch + 2.1) for (const x of dormers) dormer(c, r, x, pitch);
  return ridge;
}

/** A hipped roof: it slopes down to the eaves on all four sides. */
function hip(c: Context, r: RoofSpan): number {
  const m = c.mesh;
  const style = c.style;
  const { x0, x1, y0, y1, top, group } = r;
  const pitch = style.pitch;
  const eave = style.eave;
  const half = (y1 - y0) / 2;
  const mid = (y0 + y1) / 2;
  // The ridge is shorter than the house by the depth of the hips at each end.
  const inset = Math.min(half, (x1 - x0) / 2 - 0.05);
  const ridge = top + half * pitch;
  const low = top - eave * pitch;
  const len = Math.hypot(1, pitch);
  const full = (half + eave) * len;
  const endPitch = (half * pitch) / inset;
  const endLen = Math.hypot(1, endPitch);
  const xa = x0 - eave;
  const xb = x1 + eave;
  m.with({ group, room: 0 }, () => {
    m.with(style.roof, () => {
      for (const [y, n] of [
        [y1 + eave, 1],
        [y0 - eave, -1],
      ]) {
        m.quad(
          [xa, y, low],
          [xb, y, low],
          [x1 - inset, mid, ridge],
          [x0 + inset, mid, ridge],
          [0, (n * pitch) / len, 1 / len],
          [
            [xa + n * 5, 0],
            [xb + n * 5, 0],
            [x1 - inset + n * 5, full],
            [x0 + inset + n * 5, full],
          ],
        );
      }
      for (const [x, tip, n] of [
        [xa, x0 + inset, -1],
        [xb, x1 - inset, 1],
      ]) {
        const run = (inset + eave) * endLen;
        m.poly(
          [
            [x, y0 - eave, low],
            [x, y1 + eave, low],
            [tip, mid, ridge],
          ],
          [(n * endPitch) / endLen, 0, 1 / endLen],
          [
            [y0 - eave + 23, 0],
            [y1 + eave + 23, 0],
            [mid + 23, run],
          ],
        );
      }
      // Caps along the ridge and down the four hips.
      m.box(x0 + inset, mid - 0.1, ridge - 0.03, x1 - inset, mid + 0.1, ridge + 0.035);
    });
    m.with(trimOf(style), () => {
      for (const [x, n] of [
        [xa, -1],
        [xb, 1],
      ]) {
        m.quad(
          [x, y0 - eave, low - FASCIA],
          [x, y1 + eave, low - FASCIA],
          [x, y1 + eave, low + 0.01],
          [x, y0 - eave, low + 0.01],
          [n, 0, 0],
        );
        const wall = n > 0 ? x1 : x0;
        m.quad(
          [wall, y0 - eave, low - FASCIA],
          [x, y0 - eave, low - FASCIA],
          [x, y1 + eave, low - FASCIA],
          [wall, y1 + eave, low - FASCIA],
          [0, 0, -1],
        );
      }
    });
  });
  eaveTrim(c, xa, xb, y1, y1 + eave, low, 1, group);
  eaveTrim(c, xa, xb, y0, y0 - eave, low, -1, group);
  return ridge;
}

/** A flat roof behind a low parapet. */
function flat(c: Context, r: RoofSpan): number {
  const m = c.mesh;
  const style = c.style;
  const { x0, x1, y0, y1, top, group } = r;
  const rim = 0.45;
  const thick = 0.22;
  const cladding = style.upper ?? style.wall;
  m.with({ group, room: 0 }, () => {
    m.with(style.roof, () =>
      m.quad([x0, y0, top + 0.05], [x1, y0, top + 0.05], [x1, y1, top + 0.05], [x0, y1, top + 0.05], [0, 0, 1]),
    );
    // The parapet: the walls carried up past the roof, with a metal coping on top.
    const wall = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
      m.with(cladding, () =>
        m.quad([ax, ay, top], [bx, by, top], [bx, by, top + rim], [ax, ay, top + rim], [nx, ny, 0]),
      );
      m.with(PAINT.concrete, () =>
        m.quad(
          [ax - nx * thick, ay - ny * thick, top],
          [bx - nx * thick, by - ny * thick, top],
          [bx - nx * thick, by - ny * thick, top + rim],
          [ax - nx * thick, ay - ny * thick, top + rim],
          [-nx, -ny, 0],
        ),
      );
    };
    wall(x0, y1, x1, y1, 0, 1);
    wall(x0, y0, x1, y0, 0, -1);
    if (r.ends.right) wall(x1, y0, x1, y1, 1, 0);
    if (r.ends.left) wall(x0, y0, x0, y1, -1, 0);
    m.with(trimOf(style), () => {
      const o = 0.03;
      m.box(x0 - o, y1 - thick, top + rim, x1 + o, y1 + o, top + rim + 0.05);
      m.box(x0 - o, y0 - o, top + rim, x1 + o, y0 + thick, top + rim + 0.05);
      if (r.ends.right) m.box(x1 - thick, y0, top + rim, x1 + o, y1, top + rim + 0.05);
      if (r.ends.left) m.box(x0 - o, y0, top + rim, x0 + thick, y1, top + rim + 0.05);
    });
  });
  return top + rim + 0.05;
}

/**
 * A single slope rising from the back of the house to the front, floating on deep eaves. The wall
 * under its high side is a band of glass.
 */
function shed(c: Context, r: RoofSpan): number {
  const m = c.mesh;
  const style = c.style;
  const { x0, x1, y0, y1, top, group } = r;
  const pitch = Math.max(0.06, style.pitch);
  const eave = style.eave;
  const thick = 0.24;
  const at = (y: number) => top + 0.12 + (y - y0) * pitch;
  const xa = x0 - (r.ends.left ? eave * 0.7 : 0);
  const xb = x1 + (r.ends.right ? eave * 0.7 : 0);
  const ya = y0 - eave * 0.6;
  const yb = y1 + eave;
  const len = Math.hypot(1, pitch);
  const high = at(y1);
  m.with({ group, room: 0 }, () => {
    m.with(style.roof, () =>
      m.quad(
        [xa, ya, at(ya) + thick],
        [xb, ya, at(ya) + thick],
        [xb, yb, at(yb) + thick],
        [xa, yb, at(yb) + thick],
        [0, -pitch / len, 1 / len],
      ),
    );
    m.with(trimOf(style), () => {
      // A deep fascia all round, and the underside of the eaves.
      m.quad([xa, yb, at(yb)], [xb, yb, at(yb)], [xb, yb, at(yb) + thick], [xa, yb, at(yb) + thick], [0, 1, 0]);
      m.quad([xa, ya, at(ya)], [xb, ya, at(ya)], [xb, ya, at(ya) + thick], [xa, ya, at(ya) + thick], [0, -1, 0]);
      for (const [x, n] of [
        [xa, -1],
        [xb, 1],
      ]) {
        m.quad([x, ya, at(ya)], [x, yb, at(yb)], [x, yb, at(yb) + thick], [x, ya, at(ya) + thick], [n, 0, 0]);
      }
      m.quad([xa, ya, at(ya)], [xb, ya, at(ya)], [xb, yb, at(yb)], [xa, yb, at(yb)], [0, pitch / len, -1 / len]);
    });
    // The walls carried up to the slope: a triangle at each end.
    m.with(style.upper ?? style.wall, () => {
      for (const [x, n, on] of [
        [x0, -1, r.ends.left],
        [x1, 1, r.ends.right],
      ] as [number, number, boolean][]) {
        if (!on) continue;
        m.poly(
          [
            [x, y0, top],
            [x, y1, top],
            [x, y1, high],
            [x, y0, at(y0)],
          ],
          [n, 0, 0],
        );
      }
      m.quad([x0, y0, top], [x1, y0, top], [x1, y0, at(y0)], [x0, y0, at(y0)], [0, -1, 0]);
    });
    // Under the high side: a band of glass between slim posts.
    m.with({ material: MAT.gloss, color: [44, 54, 66] }, () =>
      m.quad([x0, y1, top], [x1, y1, top], [x1, y1, high], [x0, y1, high], [0, 1, 0]),
    );
    m.with({ material: MAT.plain, color: style.window.frame }, () => {
      for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / Math.max(2, Math.round((x1 - x0) / 1.4))) {
        m.box(x - 0.035, y1 - 0.02, top, x + 0.035, y1 + 0.03, high);
      }
      m.box(x0, y1 - 0.02, top, x1, y1 + 0.03, top + 0.06);
    });
  });
  return at(yb) + thick;
}

/** A chimney: on the back slope near the ridge, or standing wide and low on a flat roof. */
export function chimney(c: Context, r: RoofSpan, ridge: number): void {
  const m = c.mesh;
  const style = c.style;
  const low = style.roofForm === 'flat' || style.roofForm === 'shed';
  const mid = (r.y0 + r.y1) / 2;
  const wide = low ? 1.5 : 0.85;
  const x0 = r.x0 + (r.x1 - r.x0) * (low ? 0.16 : 0.66);
  const x1 = x0 + wide;
  const y0 = low ? mid - 0.4 : mid - 1.75;
  const y1 = y0 + 0.75;
  const head = low ? ridge + 0.5 : ridge + 0.75;
  m.with({ group: r.group, room: 0 }, () => {
    m.with(style.chimney, () => m.box(x0, y0, r.top, x1, y1, head, SKIP.bottom));
    m.with(PAINT.concrete, () => m.box(x0 - 0.07, y0 - 0.07, head, x1 + 0.07, y1 + 0.07, head + 0.09));
    const flues = style.chimneyPots ? [x0 + 0.22, (x0 + x1) / 2, x1 - 0.22] : [x0 + 0.24, x1 - 0.24];
    flues.forEach((x, i) => {
      const tall = style.chimneyPots ? 0.55 - (i % 2) * 0.12 : 0.36 - i * 0.06;
      m.with(PAINT.pot, () => m.cylinder(x, (y0 + y1) / 2, head + 0.09, head + 0.09 + tall, 0.12, 0.09, 10, 0));
      m.with(PAINT.black, () => m.cylinder(x, (y0 + y1) / 2, head + tall, head + 0.07 + tall, 0.08, 0.08, 10, 2));
    });
  });
}

/**
 * Builds a roof of the style's form over a set of walls. Returns its highest point. A cross gable
 * and dormers go on the main roof only.
 */
export function buildRoof(c: Context, r: RoofSpan, cross: CrossGable | null = null, dormers: number[] = []): number {
  switch (c.style.roofForm) {
    case 'hip':
      // A hip needs four free sides; against a taller wall it is built as a gable.
      return r.ends.left && r.ends.right ? hip(c, r) : gable(c, r, null, []);
    case 'flat':
      return flat(c, r);
    case 'shed':
      return shed(c, r);
    default:
      return gable(c, r, cross, dormers);
  }
}

/** How high a roof of this style rises over walls of a given depth, for framing the picture. */
export function roofHeight(style: HouseStyle, depth: number): number {
  if (style.roofForm === 'flat') return 0.5;
  if (style.roofForm === 'shed') return 0.4 + (depth + style.eave) * Math.max(0.06, style.pitch);
  return (depth / 2) * style.pitch;
}
