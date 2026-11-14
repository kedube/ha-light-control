// Roofs: gabled, hipped, flat or a single slope, with the gables, dormers and chimneys that give
// each design of house its outline.

import { MAT, PAINT, type HouseStyle } from '../materials.ts';
import { SKIP, type Paint, type Region } from '../mesh.ts';
import type { StoryShape } from '../plan.ts';
import { EXT_T, type Context, type Point } from './context.ts';
import { chimneySpot, FASCIA, type Dormer } from './massing.ts';
import { wallRun, windowUnit, type Frame, type Opening } from './walls.ts';

/** The walls a roof sits on: their outline, the height of their top, and which ends stand free. */
export interface RoofSpan {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  top: number;
  /** Rise over run. */
  pitch: number;
  group: number;
  /** A gable end that meets a taller wall has no overhang and no wall of its own. */
  ends: { left: boolean; right: boolean };
  /**
   * The roof of the house itself, with its gable to the front, its dormers and the floor that may
   * be built into it. The garage's roof is plain.
   */
  main: boolean;
}

const RAKE = 0.32;

const trimOf = (style: HouseStyle): Paint => ({ material: MAT.plain, color: style.trim });

/**
 * A louvered vent high in a gable. It airs the space under a roof that nobody lives in; a window
 * there would promise a floor that the house does not have.
 */
function vent(
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
    box(mid - half - 0.05, mid + half + 0.05, -0.01, 0.03, z0 - 0.05, z0 + height + 0.05),
  );
  m.with({ group, room: 0, material: MAT.plain, color: [54, 54, 58] }, () =>
    box(mid - half, mid + half, -0.01, 0.036, z0, z0 + height),
  );
  m.with({ group, room: 0, ...trimOf(style) }, () => {
    const slats = Math.max(3, Math.round(height / 0.09));
    for (let i = 0; i < slats; i++) {
      const z = z0 + (height * (i + 0.5)) / slats;
      box(mid - half, mid + half, -0.01, 0.05, z - 0.017, z + 0.017);
    }
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

/**
 * A dormer: a window of the floor under the roof, standing out of the slope under a roof of its
 * own. A gabled one holds a single window; a shed or a box dormer holds a row of them. Its face is
 * a real wall, and the slope is open behind it, so it looks into the room. On an attic nobody lives
 * in (`story` null) it stands on the slope, and its glass is dark.
 */
function dormer(c: Context, r: RoofSpan, d: Dormer, story: StoryShape | null): void {
  const m = c.mesh;
  const style = c.style;
  const p = r.pitch;
  const group = r.group;
  const n = d.side === 'front' ? 1 : -1;
  const wall = d.side === 'front' ? r.y1 : r.y0;
  /** A distance in from the wall below, as y. */
  const y = (t: number) => wall - n * t;
  const face = y(d.set);
  const base = r.top + d.set * p;
  // Its heights are given above the floor under the roof: the attic's floor is where the roof begins.
  const floor = story ? story.z : r.top;
  const eave = floor + d.eave;
  // A box dormer is clad in lead, as flat roofs are.
  const cladding: Paint = d.kind === 'box' ? { material: MAT.plain, color: [96, 98, 104] } : style.gable;
  const f: Frame = { ox: d.x - d.half, oy: face, ax: 1, ay: 0, nx: 0, ny: n, length: d.half * 2 };
  // The face, a stretch for each window, lit inside by the room that window belongs to.
  const windows = [...d.windows].sort((a, b) => a.x - b.x);
  windows.forEach((w, i) => {
    const from = i === 0 ? 0 : (windows[i - 1].x + w.x) / 2 - f.ox;
    const to = i === windows.length - 1 ? f.length : (w.x + windows[i + 1].x) / 2 - f.ox;
    const room = w.cell && story ? c.roomOf(w.cell, story) : 0;
    const opening: Opening = {
      a: w.x - w.half - f.ox,
      b: w.x + w.half - f.ox,
      z0: floor + d.sill - base,
      z1: floor + d.head - base,
      kind: 'window',
    };
    wallRun(
      c,
      f,
      from,
      to,
      base,
      eave - base,
      EXT_T,
      [opening],
      { outer: cladding, outerRoom: 0, inner: PAINT.plaster, room },
      { lower: group, upper: group },
      null,
    );
    windowUnit(c, f, opening, base, room, group, { shutters: null, arched: false, box: false, dark: !story });
  });

  m.with({ group, room: 0 }, () => {
    // The cheeks: a triangle of wall each side, down to the roof.
    m.with(cladding, () => {
      for (const s of [-1, 1]) {
        const x = d.x + s * d.half;
        m.poly(
          [
            [x, face, base],
            [x, face, eave],
            [x, y(d.reach), r.top + d.reach * p],
          ],
          [s, 0, 0],
        );
      }
    });
    if (d.kind === 'gable') {
      const own = d.pitch;
      const ridge = eave + d.half * own;
      const over = 0.13;
      const len = Math.hypot(1, own);
      const front = face + n * 0.16;
      // Where a height on the dormer runs back into the main roof.
      const back = (z: number) => y((z - r.top) / p);
      m.with(cladding, () =>
        m.poly(
          [
            [d.x - d.half, face, eave],
            [d.x + d.half, face, eave],
            [d.x, face, ridge],
          ],
          [0, n, 0],
        ),
      );
      for (const s of [-1, 1]) {
        const low = eave - over * own;
        const edge = d.x + s * (d.half + over);
        m.with(style.roof, () =>
          m.quad(
            [edge, front, low],
            [d.x, front, ridge],
            [d.x, back(ridge), ridge],
            [edge, back(low), low],
            [s * own, 0, 1],
            [
              [front, 0],
              [front, (d.half + over) * len],
              [back(ridge), (d.half + over) * len],
              [back(low), 0],
            ],
          ),
        );
        // Barge boards up the little gable.
        m.with(trimOf(style), () =>
          m.quad(
            [edge, front, low - 0.09],
            [edge, front, low + 0.01],
            [d.x, front, ridge + 0.01],
            [d.x, front, ridge - 0.09],
            [0, n, 0],
          ),
        );
      }
      return;
    }
    // One slope, falling toward the eaves from where it leaves the main roof.
    const q = d.pitch;
    const thick = 0.07;
    const over = 0.16;
    const len = Math.hypot(1, q);
    const at = (t: number) => eave + thick + (t - d.set) * q;
    const meet = (shift: number) => (eave + thick + shift - r.top - d.set * q) / (p - q);
    const t0 = d.set - 0.24;
    const xa = d.x - d.half - over;
    const xb = d.x + d.half + over;
    m.with(style.roof, () =>
      m.quad(
        [xa, y(t0), at(t0)],
        [xb, y(t0), at(t0)],
        [xb, y(meet(0)), at(meet(0))],
        [xa, y(meet(0)), at(meet(0))],
        [0, n * q, 1],
        [
          [xa, 0],
          [xb, 0],
          [xb, (meet(0) - t0) * len],
          [xa, (meet(0) - t0) * len],
        ],
      ),
    );
    m.with(trimOf(style), () => {
      const deep = 0.13;
      m.quad(
        [xa, y(t0), at(t0) - deep],
        [xb, y(t0), at(t0) - deep],
        [xb, y(t0), at(t0) + 0.005],
        [xa, y(t0), at(t0) + 0.005],
        [0, n, 0],
      );
      // Under the overhang, and a fascia down each side to where it meets the roof.
      m.quad(
        [xa, y(t0), at(t0) - deep],
        [xb, y(t0), at(t0) - deep],
        [xb, face, at(d.set) - deep],
        [xa, face, at(d.set) - deep],
        [0, 0, -1],
      );
      for (const [x, s] of [
        [xa, -1],
        [xb, 1],
      ]) {
        const end = meet(-deep);
        m.quad(
          [x, y(t0), at(t0) - deep],
          [x, y(t0), at(t0) + 0.005],
          [x, y(meet(0)), at(meet(0)) + 0.005],
          [x, y(end), at(end) - deep],
          [s, 0, 0],
        );
      }
    });
  });
}

/**
 * A window lying in a slope of the roof: glass in a slim frame, lit by the room under it. `pitch`
 * is that of the slope it lies in.
 */
function skylight(c: Context, r: RoofSpan, d: Dormer, story: StoryShape, pitch: number): void {
  const m = c.mesh;
  const len = Math.hypot(1, pitch);
  // The wall the slope rises from: u runs along it, t in from it.
  const f: Frame =
    d.side === 'front'
      ? { ox: 0, oy: r.y1, ax: 1, ay: 0, nx: 0, ny: 1, length: 0 }
      : d.side === 'back'
        ? { ox: 0, oy: r.y0, ax: 1, ay: 0, nx: 0, ny: -1, length: 0 }
        : d.side === 'right'
          ? { ox: r.x1, oy: 0, ax: 0, ay: 1, nx: 1, ny: 0, length: 0 }
          : { ox: r.x0, oy: 0, ax: 0, ay: 1, nx: -1, ny: 0, length: 0 };
  const normal: Point = [(f.nx * pitch) / len, (f.ny * pitch) / len, 1 / len];
  const on = (u: number, t: number, up: number): Point => [
    f.ox + f.ax * u - f.nx * t,
    f.oy + f.ay * u - f.ny * t,
    r.top + t * pitch + up,
  ];
  /** A rectangle lying on the slope, lifted off it by `up`. */
  const pane = (a: number, b: number, t0: number, t1: number, up: number) =>
    m.quad(on(a, t0, up), on(b, t0, up), on(b, t1, up), on(a, t1, up), normal);
  const cell = d.windows[0].cell;
  const room = cell ? c.roomOf(cell, story) : 0;
  const a = d.x - d.half;
  const b = d.x + d.half;
  const rim = 0.07;
  m.with({ group: r.group, room: 0, material: MAT.plain, color: [62, 64, 70] }, () =>
    pane(a - rim, b + rim, d.set - rim / len, d.reach + rim / len, 0.03),
  );
  // Dark and matte under the glass: a glossy pane would catch the sun all over at once.
  m.with({ group: r.group, room: 0, material: MAT.plain, color: [30, 36, 46] }, () => pane(a, b, d.set, d.reach, 0.05));
  m.with({ group: r.group, room, blend: true, ...PAINT.white, material: MAT.glass }, () =>
    pane(a, b, d.set, d.reach, 0.07),
  );
}

/**
 * A gable roof with its ridge along x. The eaves overhang the long walls and the gable ends. On
 * the house itself a second gable may face the front, and when a floor is built into the roof its
 * dormers stand on the slopes and its own walls close the gable ends.
 */
function gable(c: Context, r: RoofSpan): number {
  const m = c.mesh;
  const style = c.style;
  const { x0, x1, y0, y1, top, group } = r;
  const pitch = r.pitch;
  const cross = r.main ? c.roof.cross : null;
  const loft = r.main ? c.roof.loft : null;
  // The dormers of the floor under the roof, or of an attic nobody lives in.
  const dormers = r.main ? c.loftWindows.dormers : [];
  const attic = c.loftWindows.attic;
  const half = (y1 - y0) / 2;
  const mid = (y0 + y1) / 2;
  const rise = half * pitch;
  const eave = style.eave;
  const ridge = top + rise;
  const low = top - eave * pitch;
  const xa = x0 - (r.ends.left ? RAKE : 0);
  const xb = x1 + (r.ends.right ? RAKE : 0);
  const len = Math.hypot(1, pitch);
  const gablePitch = cross?.pitch ?? 0;
  const peak = cross?.peak ?? 0;
  const dies = cross?.dies ?? 0;
  // A gable to the front reaches out as far as the eaves, and its slopes come down to meet them:
  // they spread wider than its walls. The main slope runs on behind it, to the valleys between them.
  const front = y1 + eave;
  const spread = cross ? cross.half + (eave * pitch) / gablePitch : 0;
  const valleys: Region[] | null = cross
    ? [
        [
          { n: [1, 0, 0], d: cross.at },
          { n: [gablePitch, 0, -1], d: gablePitch * cross.at - peak },
        ],
        [
          { n: [-1, 0, 0], d: -cross.at },
          { n: [-gablePitch, 0, -1], d: -peak - gablePitch * cross.at },
        ],
      ]
    : null;

  /** One slope from a to b, open where a dormer stands on it. `n` is 1 at the front, -1 at the back. */
  const slope = (n: number, a: number, b: number) => {
    if (b - a < 0.02) return;
    const wall = n > 0 ? y1 : y0;
    const shift = n > 0 ? 0 : 11;
    // A piece between two distances in from the wall; the eave hangs out at -eave.
    const piece = (pa: number, pb: number, t0: number, t1: number) => {
      if (pb - pa < 0.01 || t1 - t0 < 0.01) return;
      m.quad(
        [pa, wall - n * t0, top + t0 * pitch],
        [pb, wall - n * t0, top + t0 * pitch],
        [pb, wall - n * t1, top + t1 * pitch],
        [pa, wall - n * t1, top + t1 * pitch],
        [0, (n * pitch) / len, 1 / len],
        [
          [pa + shift, (t0 + eave) * len],
          [pb + shift, (t0 + eave) * len],
          [pb + shift, (t1 + eave) * len],
          [pa + shift, (t1 + eave) * len],
        ],
      );
    };
    const side = n > 0 ? 'front' : 'back';
    // An attic's dormers stand on the slope; a floor's look into it.
    const standing = dormers
      .filter((d) => !attic && d.kind !== 'skylight' && d.side === side && d.x + d.half > a && d.x - d.half < b)
      .sort((p, q) => p.x - q.x);
    let from = a;
    for (const d of standing) {
      const ha = Math.max(a, d.x - d.half + 0.02);
      const hb = Math.min(b, d.x + d.half - 0.02);
      piece(from, ha, -eave, half);
      piece(ha, hb, -eave, d.set);
      piece(ha, hb, d.reach, half);
      from = hb;
    }
    piece(from, b, -eave, half);
  };

  m.with({ group, room: 0 }, () => {
    m.with(style.roof, () => {
      if (cross) {
        m.with({ clip: valleys }, () => slope(1, xa, xb));
        for (const s of [-1, 1]) {
          // The gable's own slope, from its ridge down to the corner of the eaves.
          const corner = cross.at + s * spread;
          const run = spread * Math.hypot(1, gablePitch);
          m.poly(
            [
              [cross.at, front, peak],
              [cross.at, dies, peak],
              [corner, front, low],
            ],
            [s * gablePitch, 0, 1],
            [
              [front + 7, run],
              [dies + 7, run],
              [front + 7, 0],
            ],
          );
        }
      } else slope(1, xa, xb);
      slope(-1, xa, xb);
      // A cap along the ridge.
      m.box(xa, mid - 0.11, ridge - 0.03, xb, mid + 0.11, ridge + 0.035);
      if (cross) m.box(cross.at - 0.1, dies, peak - 0.03, cross.at + 0.1, front, peak + 0.035);
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
          const corner = cross.at + s * spread;
          // Barge boards down the front of the gable to the corners of the eaves.
          m.quad(
            [corner, front, low - FASCIA],
            [corner, front, low + 0.01],
            [cross.at, front, peak + 0.01],
            [cross.at, front, peak - FASCIA],
            [0, 1, 0],
          );
          // Under its overhang, in front of the gable wall.
          m.quad(
            [cross.at, y1, peak - FASCIA],
            [edge, y1, top - FASCIA],
            [corner, front, low - FASCIA],
            [cross.at, front, peak - FASCIA],
            [-s * gablePitch, 0, -1],
          );
          // And under the eaves beside it, where they run in under the gable's slope.
          m.poly(
            [
              [corner, y1, low - FASCIA],
              [edge, y1, low - FASCIA],
              [corner, front, low - FASCIA],
            ],
            [0, 0, -1],
          );
        }
      }
    });
    // With a floor under the roof, that floor's own walls stand in the gables.
    if (loft) return;
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
    eaveTrim(c, xa, cross.at - spread, y1, front, low, 1, group);
    eaveTrim(c, cross.at + spread, xb, y1, front, low, 1, group);
  } else eaveTrim(c, xa, xb, y1, front, low, 1, group);
  eaveTrim(c, xa, xb, y0, y0 - eave, low, -1, group);
  for (const d of dormers) {
    if (d.kind !== 'skylight') dormer(c, r, d, loft);
    else if (loft) skylight(c, r, d, loft, pitch);
  }
  if (loft) {
    // A gable to the front that no room has a window in still has its vent.
    if (cross && !c.loftWindows.walls.some((w) => w.side === 'front') && peak - top > 1.2) {
      const size = Math.min(0.2, (peak - top) * 0.1);
      vent(c, 'y', y1, 1, cross.at, top + (peak - top) * 0.46, size, size * 2, group);
    }
  } else if (r.main) {
    // Nobody lives under this roof: its gables have vents, not windows.
    if (rise > 1.3) {
      const size = Math.min(0.24, rise * 0.1);
      if (r.ends.right) vent(c, 'x', x1, 1, mid, top + rise * 0.5, size, size * 2, group);
      if (r.ends.left) vent(c, 'x', x0, -1, mid, top + rise * 0.5, size, size * 2, group);
    }
    if (cross && peak - top > 1.2) {
      const size = Math.min(0.2, (peak - top) * 0.1);
      vent(c, 'y', y1, 1, cross.at, top + (peak - top) * 0.46, size, size * 2, group);
    }
  }
  return ridge;
}

/** A hipped roof: it slopes down to the eaves on all four sides. */
function hip(c: Context, r: RoofSpan): number {
  const m = c.mesh;
  const style = c.style;
  const { x0, x1, y0, y1, top, group } = r;
  const pitch = r.pitch;
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
  // A floor under a hipped roof is lit through the slopes, at the ends as well as front and back; an
  // attic nobody lives in may have dormers standing on them.
  const loft = r.main ? c.roof.loft : null;
  if (r.main) {
    for (const d of c.loftWindows.dormers) {
      if (d.kind !== 'skylight') dormer(c, r, d, loft);
      else if (loft) skylight(c, r, d, loft, d.side === 'front' || d.side === 'back' ? pitch : endPitch);
    }
  }
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
  const pitch = Math.max(0.06, r.pitch);
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
  const { x0, x1, y0, y1 } = chimneySpot(c.roof);
  const head = low ? ridge + 0.5 : ridge + 0.75;
  m.with({ group: r.group, room: 0 }, () => {
    const stack = () => m.with(style.chimney, () => m.box(x0, y0, r.top, x1, y1, head, SKIP.bottom));
    // It stands on the roof: nothing of it shows in the rooms a sloping roof may have under it.
    if (low) stack();
    else m.with({ clip: [[{ n: [0, r.pitch, -1], d: r.pitch * r.y0 - r.top + 0.12, open: true }]] }, stack);
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
 * Builds a roof of the style's form over a set of walls, and returns its highest point. The roof
 * of the house itself takes its gable to the front and its dormers from the model.
 */
export function buildRoof(c: Context, r: RoofSpan): number {
  switch (c.style.roofForm) {
    case 'hip':
      // A hip needs four free sides; against a taller wall it is built as a gable.
      return r.ends.left && r.ends.right ? hip(c, r) : gable(c, { ...r, main: false });
    case 'flat':
      return flat(c, r);
    case 'shed':
      return shed(c, r);
    default:
      return gable(c, r);
  }
}

/**
 * Where bulbs hang along the front of a roof, as at Christmas: lines just under the edge of its
 * eaves, and up the edges of a gable that faces the front.
 */
export function frontEaves(c: Context, r: RoofSpan): Point[][] {
  const style = c.style;
  const eave = style.eave;
  // A hip against a taller wall is built as a gable.
  const form = style.roofForm === 'hip' && !(r.ends.left && r.ends.right) ? 'gable' : style.roofForm;
  if (form === 'flat') {
    // Along the coping of the parapet.
    const z = r.top + 0.47;
    return [
      [
        [r.x0 - 0.03, r.y1 + 0.05, z],
        [r.x1 + 0.03, r.y1 + 0.05, z],
      ],
    ];
  }
  if (form === 'shed') {
    const y = r.y1 + eave;
    const z = r.top + 0.12 + (y - r.y0) * Math.max(0.06, r.pitch) - 0.04;
    const xa = r.x0 - (r.ends.left ? eave * 0.7 : 0);
    const xb = r.x1 + (r.ends.right ? eave * 0.7 : 0);
    return [
      [
        [xa, y + 0.03, z],
        [xb, y + 0.03, z],
      ],
    ];
  }
  const low = r.top - eave * r.pitch - FASCIA - 0.04;
  const y = r.y1 + eave + 0.03;
  const xa = r.x0 - (form === 'hip' ? eave : r.ends.left ? RAKE : 0);
  const xb = r.x1 + (form === 'hip' ? eave : r.ends.right ? RAKE : 0);
  const cross = r.main && form === 'gable' ? c.roof.cross : null;
  if (!cross) {
    return [
      [
        [xa, y, low],
        [xb, y, low],
      ],
    ];
  }
  const spread = cross.half + (eave * r.pitch) / cross.pitch;
  return [
    [
      [xa, y, low],
      [cross.at - spread, y, low],
    ],
    [
      [cross.at - spread, y, low],
      [cross.at, y, cross.peak - FASCIA - 0.04],
      [cross.at + spread, y, low],
    ],
    [
      [cross.at + spread, y, low],
      [xb, y, low],
    ],
  ];
}
