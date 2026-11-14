// How the house stands under its roof: which floor, if any, is built into the roof instead of
// under it, where the roof begins and how it rises, and the windows such a floor gets: dormers on
// the slopes, and windows in the gable ends.
//
// A story-and-a-half house (a Cape Cod, a bungalow) has its upper floor in the roof; a taller one
// has its attic there. Building that floor as a full story with a roof on top would show the house
// a floor higher than it is.

import type { DormerKind, HouseStyle, RoofForm } from '../materials.ts';
import type { Plane, Region } from '../mesh.ts';
import { frontDoor, span, type HousePlan, type PlanCell, type PlanStory, type Side } from '../plan.ts';

/** Where the top floor is built: left to the design and the floor's name, in the roof, or as a full story. */
export type TopFloor = 'auto' | 'roof' | 'full';

/** The garage floor sits just above the grass. */
export const WING_FLOOR = 0.1;
export const wingHeight = (plan: HousePlan): number => Math.max(2.5, plan.base + 2.35 - WING_FLOOR);

/** How far the ceiling under a slope hangs below the top of the roof: the thickness of the roof. */
export const LINING = 0.16;
/** The depth of the board along the edge of the eaves. */
export const FASCIA = 0.14;

/** A gable facing the front: where its ridge is, half its width and its pitch. */
export interface CrossGable {
  at: number;
  half: number;
  pitch: number;
  /** The height of its ridge. */
  peak: number;
  /** Where its ridge runs into the main roof (y). */
  dies: number;
}

/** The main roof: the walls it sits on, where it begins and how it rises. */
export interface Massing {
  form: RoofForm;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** The height of the top of the outside walls, where the roof begins. */
  top: number;
  pitch: number;
  /** A hipped roof: how steeply its ends rise, and how far in from them its ridge begins. */
  endPitch: number;
  inset: number;
  /** The highest point of the roof. */
  ridge: number;
  /** The story built into the roof, if there is one. */
  loft: PlanStory | null;
  /** How far the outside walls rise above the loft's floor. */
  knee: number;
  cross: CrossGable | null;
}

/** The floor that is built into the roof: the top one, if the design or its name puts it there. */
export function loftStory(plan: HousePlan, style: HouseStyle, choice: TopFloor = 'auto'): PlanStory | null {
  const above = plan.stories.filter((s) => !s.basement);
  const top = above[above.length - 1];
  // The ground floor has walls of its own, and nothing lives under a roof that is flat.
  if (!style.loft || !top || top.ground || choice === 'full') return null;
  if (choice === 'roof' || top.attic || style.loft.when === 'always') return top;
  return style.loft.when === 'third' && above.length >= 3 ? top : null;
}

export function massingOf(plan: HousePlan, style: HouseStyle, choice: TopFloor = 'auto'): Massing {
  const above = plan.stories.filter((s) => !s.basement);
  const topStory = above[above.length - 1];
  const loft = loftStory(plan, style, choice);
  const W = plan.width;
  const D = plan.depth;
  const half = D / 2;
  const form = style.roofForm;
  const knee = loft ? style.loft!.knee : 0;
  const pitch = loft ? Math.max(style.pitch, style.loft!.pitch) : style.pitch;
  const top = loft ? loft.z + knee : topStory ? topStory.z + plan.storyHeight : plan.base;
  const inset = Math.min(half, W / 2 - 0.05);
  const rise = half * pitch;
  let ridge = top + rise;
  if (form === 'flat') ridge = top + 0.5;
  else if (form === 'shed') ridge = top + 0.4 + (D + style.eave) * Math.max(0.06, pitch);

  // A gable facing the front: over the door, or at one end of the house.
  let cross: CrossGable | null = null;
  const want = style.crossGable;
  if (want && form === 'gable' && topStory) {
    const halfWidth = Math.min(want.width / 2, W / 2 - 0.6);
    const door = frontDoor(plan)?.x ?? W / 2;
    const at = want.at === 'left' ? halfWidth + 0.35 : want.at === 'right' ? W - halfWidth - 0.35 : door;
    // It is never higher than the main ridge.
    const own = Math.min(loft ? Math.max(want.pitch, pitch) : want.pitch, (rise - 0.05) / halfWidth);
    cross = {
      at: Math.max(halfWidth + 0.1, Math.min(W - halfWidth - 0.1, at)),
      half: halfWidth,
      pitch: own,
      peak: top + halfWidth * own,
      dies: D - (halfWidth * own) / pitch,
    };
  }
  return {
    form,
    x0: 0,
    x1: W,
    y0: 0,
    y1: D,
    top,
    pitch,
    endPitch: (half * pitch) / inset,
    inset,
    ridge,
    loft,
    knee,
    cross,
  };
}

/** The height of the roof over a point of the house. */
export function roofAt(m: Massing, x: number, y: number): number {
  if (m.form === 'flat') return m.top + 0.05;
  if (m.form === 'shed') return m.top + 0.36 + (y - m.y0) * Math.max(0.06, m.pitch);
  const main = m.top + Math.min(m.y1 - y, y - m.y0) * m.pitch;
  if (m.form === 'hip') return Math.min(main, m.top + Math.min(x - m.x0, m.x1 - x) * m.endPitch);
  const cross = m.cross;
  if (cross && y > (m.y0 + m.y1) / 2 && Math.abs(x - cross.at) < cross.half) {
    return Math.max(main, m.top + (cross.half - Math.abs(x - cross.at)) * cross.pitch);
  }
  return main;
}

/**
 * The space under the roof, as regions that drawing can be clipped to: the first is under the main
 * slopes, a second under a gable that faces the front. `drop` lowers the roof, to stay clear of
 * its thickness. Null for a roof nothing is built into.
 */
export function under(m: Massing, drop = 0): Region[] | null {
  if (m.form !== 'gable' && m.form !== 'hip') return null;
  const p = m.pitch;
  const front: Plane = { n: [0, p, 1], d: m.top + p * m.y1 - drop };
  const back: Plane = { n: [0, -p, 1], d: m.top - p * m.y0 - drop };
  if (m.form === 'hip') {
    const e = m.endPitch;
    return [[front, back, { n: [-e, 0, 1], d: m.top - e * m.x0 - drop }, { n: [e, 0, 1], d: m.top + e * m.x1 - drop }]];
  }
  const cross = m.cross;
  if (!cross) return [[front, back]];
  const g = cross.pitch;
  return [
    [front, back],
    // What the front gable adds: above the main slope and under its own two.
    [
      { n: [0, -p, -1], d: -front.d, open: true },
      { n: [-g, 0, 1], d: m.top - g * (cross.at - cross.half) - drop },
      { n: [g, 0, 1], d: m.top + g * (cross.at + cross.half) - drop },
    ],
  ];
}

/** How high the garage's roof stands against the left wall of the house at y; 0 clear of it. */
export function wingRoofAt(plan: HousePlan, style: HouseStyle, pitch: number, y: number): number {
  const wing = plan.wing;
  if (!wing) return 0;
  const { y0, y1 } = wing.rect;
  if (y < y0 - style.eave || y > y1 + style.eave) return 0;
  const top = WING_FLOOR + wingHeight(plan);
  if (style.roofForm === 'flat') return top + 0.5;
  if (style.roofForm === 'shed') return top + 0.36 + (y - y0) * Math.max(0.06, pitch);
  return top + Math.min(y1 - y, y - y0) * pitch;
}

/** Where the chimney stands on the roof: on the back slope near the ridge, or wide and low on a flat roof. */
export function chimneySpot(m: Massing): { x0: number; x1: number; y0: number; y1: number } {
  const low = m.form === 'flat' || m.form === 'shed';
  const mid = (m.y0 + m.y1) / 2;
  const x0 = m.x0 + (m.x1 - m.x0) * (low ? 0.16 : 0.66);
  const y0 = low ? mid - 0.4 : mid - 1.75;
  return { x0, x1: x0 + (low ? 1.5 : 0.85), y0, y1: y0 + 0.75 };
}

// ─── The windows of a floor under the roof ───────────────────────────────────

/** A window standing out of a slope of the roof under a roof of its own, or lying in the slope. */
export interface Dormer {
  kind: DormerKind;
  /** The slope it is on. Only glass in the slope goes on the ends of a hipped roof. */
  side: Side;
  /** Its middle along the wall, and half its width. */
  x: number;
  half: number;
  /** How far in from the wall below its face stands; for a skylight, where its lower edge is. */
  set: number;
  /** How far in from the wall its sides run before they die into the roof; a skylight's upper edge. */
  reach: number;
  /** Heights above the loft's floor: the sill and the head of its windows, and its eaves. */
  sill: number;
  head: number;
  eave: number;
  /** The pitch of its own roof. */
  pitch: number;
  /** Each window: its middle, half its width, and the room it looks out of. */
  windows: { x: number; half: number; cell: PlanCell }[];
}

/** A window in a wall of the loft: in a gable end, or under the gable that faces the front. */
export interface LoftWindow {
  side: Side;
  /** Along the wall. */
  a: number;
  b: number;
  /** Above the loft's floor. */
  z0: number;
  z1: number;
  cell: PlanCell;
}

export interface LoftWindows {
  dormers: Dormer[];
  walls: LoftWindow[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A closet has no window, under the roof or anywhere else. */
const windowed = (cell: PlanCell) => cell.type !== 'closet';

interface Shape {
  set: number;
  reach: number;
  sill: number;
  head: number;
  eave: number;
  pitch: number;
}

/** How a dormer of a kind stands on a roof, or null when the roof is too low to carry it. */
function dormerShape(kind: DormerKind, knee: number, p: number, rise: number, half: number): Shape | null {
  if (kind === 'skylight') return null;
  if (kind === 'gable') {
    // Under a high wall the dormer stands nearer the eaves, so its sill is not too far up.
    const set = knee > 0.6 ? 0.3 : 0.45;
    const sill = Math.max(0.8, knee + set * p + 0.14);
    const head = Math.max(2, sill + 0.95);
    const eave = head + 0.16;
    const pitch = 0.85;
    // Its ridge has to die into the roof below the main ridge.
    if (eave + half * pitch > knee + rise - 0.25) return null;
    return { set, reach: (eave - knee) / p, sill, head, eave, pitch };
  }
  const set = 0.5;
  const sill = Math.max(0.9, knee + set * p + 0.14);
  const head = Math.max(1.95, sill + 0.75);
  const eave = head + 0.16;
  const pitch = kind === 'box' ? 0.04 : Math.min(0.22, p * 0.4);
  const reach = (eave - knee - set * pitch) / (p - pitch);
  if (reach * p > rise - 0.3) return null;
  return { set, reach, sill, head, eave, pitch };
}

/**
 * A row of windows between two points along a wall, each inside a room: as many as fit in each
 * room, spread evenly, and kept clear of the walls between rooms.
 */
function windowRow(cells: PlanCell[], from: number, to: number): Dormer['windows'] {
  const out: Dormer['windows'] = [];
  for (const cell of [...cells].sort((a, b) => a.rect.x0 - b.rect.x0)) {
    const lo = Math.max(cell.rect.x0 + 0.5, from);
    const hi = Math.min(cell.rect.x1 - 0.5, to);
    if (lo > hi) continue;
    const n = 1 + Math.floor((hi - lo) / 1.15);
    for (let i = 0; i < n; i++)
      out.push({ x: n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (n - 1), half: 0.4, cell });
  }
  return out;
}

/** The stretches of [from, to] left free by what is in the way. */
function freeSpans(from: number, to: number, blocked: [number, number][]): [number, number][] {
  let spans: [number, number][] = [[from, to]];
  for (const [a, b] of blocked) {
    spans = spans.flatMap(([s, e]): [number, number][] => {
      if (b <= s || a >= e) return [[s, e]];
      const out: [number, number][] = [];
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
      return out;
    });
  }
  return spans;
}

/** The place nearest `x` where something of half-width `half` fits in a free span, or null. */
function fitIn(spans: [number, number][], x: number, half: number, lo: number, hi: number): number | null {
  let best: number | null = null;
  for (const [s, e] of spans) {
    const a = Math.max(s + half, lo);
    const b = Math.min(e - half, hi);
    if (a > b) continue;
    const at = clamp(x, a, b);
    if (best === null || Math.abs(at - x) < Math.abs(best - x)) best = at;
  }
  return best;
}

/**
 * The windows of the floor under the roof: dormers or skylights on the slopes, one room at a time,
 * and windows in the gable ends, set as a gable's windows are: one in the middle, or a pair.
 */
export function loftWindows(plan: HousePlan, style: HouseStyle, m: Massing): LoftWindows {
  const out: LoftWindows = { dormers: [], walls: [] };
  const loft = m.loft;
  if (!loft || !style.loft || (m.form !== 'gable' && m.form !== 'hip')) return out;
  const W = m.x1 - m.x0;
  const half = (m.y1 - m.y0) / 2;
  const mid = (m.y0 + m.y1) / 2;
  const p = m.pitch;
  const rise = half * p;
  const knee = m.knee;
  const cellAt = (side: Side, u: number) =>
    loft.cells.find((c) => {
      const range = span(c, plan, side);
      return range !== null && u >= range[0] - 1e-6 && u < range[1] + 1e-6;
    });

  // Windows in the slopes: dormers at the front and the back of a gabled roof, and glass in every
  // slope of a hipped one.
  const hipped = m.form === 'hip';
  for (const side of (hipped ? ['front', 'right', 'back', 'left'] : ['front', 'back']) as Side[]) {
    const alongX = side === 'front' || side === 'back';
    const from = alongX ? m.x0 : m.y0;
    const to = alongX ? m.x1 : m.y1;
    // How far in the slope runs, how steep it is, and how fast a hip narrows it on the way up.
    const depth = alongX ? half : m.inset;
    const steep = alongX ? p : m.endPitch;
    const taper = hipped ? (alongX ? m.inset / half : half / m.inset) : 0;
    const blocked: [number, number][] = [];
    if (side === 'front' && m.cross) blocked.push([m.cross.at - m.cross.half - 0.2, m.cross.at + m.cross.half + 0.2]);
    if (side === 'back') {
      const chimney = chimneySpot(m);
      blocked.push([chimney.x0 - 0.45, chimney.x1 + 0.45]);
    }
    const free = freeSpans(from + 0.6, to - 0.6, blocked);
    const skylight = (cell: PlanCell, taken: [number, number][]): Dormer | null => {
      // It lies where the ceiling under it is between waist and head height.
      const set = Math.max(0.55, (0.95 - knee) / steep);
      const reach = Math.min(set + 0.95, depth - 0.45);
      if (reach - set < 0.5) return null;
      const ends = hipped ? reach * taper + 0.3 : 0.6;
      const range = span(cell, plan, side)!;
      const spans = freeSpans(from + ends, to - ends, [...blocked, ...taken]);
      // A smaller roof window where a full-size one does not fit.
      for (const size of [0.38, 0.27]) {
        const x = fitIn(spans, (range[0] + range[1]) / 2, size + 0.1, range[0] + size + 0.1, range[1] - size - 0.1);
        if (x === null) continue;
        return {
          kind: 'skylight',
          side,
          x,
          half: size,
          set,
          reach,
          sill: 0,
          head: 0,
          eave: 0,
          pitch: steep,
          windows: [{ x, half: size, cell }],
        };
      }
      return null;
    };
    const kind = hipped ? 'skylight' : style.loft.dormer;
    // The front of the roof has its dormers whatever is behind them, as the walls below have their
    // windows; on the other sides they stand only where there is a room to light.
    const cells = loft.cells.filter((c) => span(c, plan, side) && windowed(c) && (side === 'front' || c.id !== null));
    const placed: Dormer[] = [];
    if (kind === 'gable') {
      const dormerHalf = 0.66;
      const shape = dormerShape(kind, knee, p, rise, dormerHalf);
      // Dormers keep an even rhythm along the roof; each lights the room it stands over.
      const count = Math.max(2, Math.round(W / 3.3));
      for (let i = 0; shape && i < count; i++) {
        const want = m.x0 + (W * (i + 0.5)) / count;
        const cell = cellAt(side, want);
        if (!cell || !cells.includes(cell)) continue;
        const x = fitIn(
          free,
          want,
          dormerHalf + 0.25,
          cell.rect.x0 + dormerHalf + 0.2,
          cell.rect.x1 - dormerHalf - 0.2,
        );
        if (x === null || placed.some((d) => Math.abs(d.x - x) < d.half + dormerHalf + 0.5)) continue;
        placed.push({ kind, side, x, half: dormerHalf, ...shape, windows: [{ x, half: 0.4, cell }] });
      }
    } else if (kind !== 'skylight' && cells.length) {
      // One wide dormer with a row of windows, where it lights the most rooms, and as near the
      // middle of the roof as that allows.
      const width = clamp(W * 0.44, 2, 4.4);
      let best: { score: number; dormer: Dormer } | null = null;
      for (const [s, e] of free) {
        const w = Math.min(width, e - s - 0.2);
        const shape = w >= 1.9 ? dormerShape(kind, knee, p, rise, w / 2) : null;
        if (!shape) continue;
        for (let x = s + 0.1 + w / 2; x <= e - 0.1 - w / 2 + 1e-6; x += 0.05) {
          const windows = windowRow(cells, x - w / 2 + 0.5, x + w / 2 - 0.5);
          if (!windows.length) continue;
          const rooms = new Set(windows.map((v) => v.cell)).size;
          const score = rooms * 10 - Math.abs(x - (m.x0 + W / 2)) + windows.length * 0.1;
          if (!best || score > best.score + 1e-6) {
            best = { score, dormer: { kind, side, x, half: w / 2, ...shape, windows } };
          }
        }
      }
      if (best) placed.push(best.dormer);
    }
    // Rooms the dormers missed, and every room under a roof too low for dormers, get glass in the slope.
    for (const cell of cells) {
      if (!cell.id || placed.some((d) => d.windows.some((w) => w.cell === cell))) continue;
      const light = skylight(
        cell,
        placed.map((d): [number, number] => [d.x - d.half - 0.4, d.x + d.half + 0.4]),
      );
      if (light) placed.push(light);
    }
    out.dormers.push(...placed);
  }

  if (m.form !== 'gable') return out;

  // Windows in the gable ends, where the roof is high enough to clear them.
  const z0 = 0.8;
  const z1 = Math.min(2, knee + rise - 0.75);
  const width = clamp(0.92 * style.window.scale[0], 0.7, 1.15);
  if (z1 - z0 >= 0.6) {
    const inset = (z1 + 0.3 - knee) / p;
    const reach = half - inset - width / 2;
    for (const side of ['right', 'left'] as const) {
      if (reach < 0) continue;
      // A pair where there is room for one, else a single window under the ridge.
      const offset = reach >= width / 2 + 0.45 ? Math.min(reach, 1.15) : 0;
      for (const at of offset ? [mid - offset, mid + offset] : [mid]) {
        const cell = cellAt(side, at);
        if (!cell || cell.type === 'closet') continue;
        const lo = Math.max(cell.rect.y0 + width / 2 + 0.22, mid - reach);
        const hi = Math.min(cell.rect.y1 - width / 2 - 0.22, mid + reach);
        if (lo > hi) continue;
        const y = clamp(at, lo, hi);
        if (out.walls.some((w) => w.side === side && y - width / 2 < w.b + 0.3 && y + width / 2 > w.a - 0.3)) continue;
        // The garage's roof may stand in the way.
        if (side === 'left') {
          const cover = Math.max(
            wingRoofAt(plan, style, p, y - width / 2),
            wingRoofAt(plan, style, p, y),
            wingRoofAt(plan, style, p, y + width / 2),
          );
          if (cover > loft.z + z0 - 0.35) continue;
        }
        out.walls.push({ side, a: y - width / 2, b: y + width / 2, z0, z1, cell });
      }
    }
  }

  // And under the gable that faces the front: a window as near its peak as each room allows.
  const cross = m.cross;
  if (cross) {
    const sill = Math.max(0.85, knee + 0.12);
    const w = 1.5 * style.window.scale[0];
    const wanted = Math.min(1.25, cross.peak - loft.z - sill - 0.8);
    const gabled: LoftWindow[] = [];
    for (const cell of loft.cells) {
      const range = span(cell, plan, 'front');
      if (!range || cell.type === 'closet') continue;
      let best: LoftWindow | null = null;
      for (const width of [w, w * 0.7]) {
        const lo = Math.max(range[0] + width / 2 + 0.22, cross.at - cross.half + width / 2 + 0.25);
        const hi = Math.min(range[1] - width / 2 - 0.22, cross.at + cross.half - width / 2 - 0.25);
        if (lo > hi) continue;
        const x = clamp(cross.at, lo, hi);
        // The slopes of the gable come down toward its sides: the window keeps below them.
        const under = knee + (cross.half - Math.abs(x - cross.at) - width / 2) * cross.pitch - 0.25;
        const head = Math.min(sill + Math.max(wanted, 0), under);
        if (head - sill < 0.55) continue;
        // The bigger window, whether wide and low or narrow and tall.
        if (!best || (head - sill) * width > (best.z1 - best.z0) * (best.b - best.a)) {
          best = { side: 'front', a: x - width / 2, b: x + width / 2, z0: sill, z1: head, cell };
        }
      }
      if (best) gabled.push(best);
    }
    // Windows side by side in one gable line up at the top.
    const head = Math.min(...gabled.map((g) => g.z1));
    for (const g of gabled) out.walls.push({ ...g, z1: head });
  }
  return out;
}
