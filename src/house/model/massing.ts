// How the house stands under its roof: which floor, if any, is built into the roof instead of
// under it, where the roof begins and how it rises, and the windows such a floor gets: dormers on
// the slopes, glass in them, and windows in the gable ends.
//
// A story-and-a-half house (a Cape Cod, a bungalow) has its upper floor in the roof; a taller one
// has its attic there. Building that floor as a full story with a roof on top would show the house
// a floor higher than it is.
//
// The windows in a roof are set out as the windows below them are: on the lines of the bays, and
// symmetrical about the middle of the house wherever the roof lets them be. The rooms under the
// roof are fitted in behind them: facadeFor tells the planner where they are.

import { windowWidth, type DormerKind, type HouseStyle, type RoofForm } from '../materials.ts';
import type { Plane, Region } from '../mesh.ts';
import {
  bayMiddles,
  span,
  type Facade,
  type HousePlan,
  type PlanCell,
  type PlanShape,
  type Side,
  type Slot,
  type StoryShape,
} from '../plan.ts';

/** Where the top floor is built: left to the design and the floor's name, in the roof, or as a full story. */
export type TopFloor = 'auto' | 'roof' | 'full';
/**
 * Whether the roof has dormers: as the design has them, on any roof steep enough to carry them
 * (on an attic nobody lives in too), or none, with glass in the slope to light the rooms instead.
 */
export type DormerChoice = 'auto' | 'on' | 'off';

/** The garage floor sits just above the grass. */
export const WING_FLOOR = 0.1;
export const wingHeight = (plan: { base: number }): number => Math.max(2.5, plan.base + 2.35 - WING_FLOOR);

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
  loft: StoryShape | null;
  /** How far the outside walls rise above the loft's floor. */
  knee: number;
  cross: CrossGable | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 1000) / 1000;

/** The floor that is built into the roof: the top one, if the design or its name puts it there. */
export function loftStory(plan: PlanShape, style: HouseStyle, choice: TopFloor = 'auto'): StoryShape | null {
  const above = plan.stories.filter((s) => !s.basement);
  const top = above[above.length - 1];
  // The ground floor has walls of its own, and nothing lives under a roof that is flat.
  if (!style.loft || !top || top.ground || choice === 'full') return null;
  if (choice === 'roof' || top.attic || style.loft.when === 'always') return top;
  return style.loft.when === 'third' && above.length >= 3 ? top : null;
}

export function massingOf(plan: PlanShape, style: HouseStyle, choice: TopFloor = 'auto'): Massing {
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

  // A gable facing the front: over the door in the middle, or over a bay at one end of the house.
  let cross: CrossGable | null = null;
  const want = style.crossGable;
  if (want && form === 'gable' && topStory) {
    const halfWidth = Math.min(want.width / 2, W / 2 - 0.6);
    let at = W / 2;
    if (want.at !== 'door') {
      const wish = want.at === 'left' ? halfWidth + 0.35 : W - halfWidth - 0.35;
      const fits = bayMiddles(plan, 'front').filter((x) => x - halfWidth >= 0.1 && x + halfWidth <= W - 0.1);
      at = fits.length ? fits.reduce((p, q) => (Math.abs(q - wish) < Math.abs(p - wish) ? q : p)) : wish;
    }
    // It is never higher than the main ridge.
    const own = Math.min(loft ? Math.max(want.pitch, pitch) : want.pitch, (rise - 0.05) / halfWidth);
    cross = {
      at: clamp(at, halfWidth + 0.1, W - halfWidth - 0.1),
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
export function wingRoofAt(plan: PlanShape, style: HouseStyle, pitch: number, y: number): number {
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

// ─── The windows in a roof ───────────────────────────────────────────────────

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
  /** Heights above the floor under the roof: the sill and the head of its windows, and its eaves. */
  sill: number;
  head: number;
  eave: number;
  /** The pitch of its own roof. */
  pitch: number;
  /** Each window: its middle, half its width, and the room it looks out of; none in an attic nobody lives in. */
  windows: { x: number; half: number; cell: PlanCell | null }[];
}

/** A window in a wall of the floor under the roof: in a gable end, or under the gable that faces the front. */
export interface LoftWindow {
  side: Side;
  /** Along the wall. */
  a: number;
  b: number;
  /** Above the floor under the roof. */
  z0: number;
  z1: number;
  cell: PlanCell | null;
}

export interface LoftWindows {
  dormers: Dormer[];
  walls: LoftWindow[];
  /** The dormers stand on a roof that no floor is built into: they are the attic's, and light no room. */
  attic: boolean;
}

interface Shape {
  set: number;
  reach: number;
  sill: number;
  head: number;
  eave: number;
  pitch: number;
}

/**
 * How a dormer of a kind stands on a roof, or null when the roof is too low to carry it. An attic's
 * dormers are smaller: nobody has to stand at their windows.
 */
function dormerShape(
  kind: DormerKind,
  knee: number,
  p: number,
  rise: number,
  half: number,
  attic = false,
): Shape | null {
  if (kind === 'skylight') return null;
  if (kind === 'gable') {
    // Under a high wall the dormer stands nearer the eaves, so its sill is not too far up.
    const set = knee > 0.6 ? 0.3 : 0.45;
    const sill = attic ? Math.max(0.35, knee + set * p + 0.12) : Math.max(0.8, knee + set * p + 0.14);
    const head = attic ? sill + 0.8 : Math.max(2, sill + 0.95);
    const eave = head + (attic ? 0.14 : 0.16);
    const pitch = 0.85;
    // Its ridge has to die into the roof below the main ridge.
    if (eave + half * pitch > knee + rise - 0.25) return null;
    return { set, reach: (eave - knee) / p, sill, head, eave, pitch };
  }
  const set = 0.5;
  const sill = attic ? Math.max(0.35, knee + set * p + 0.12) : Math.max(0.9, knee + set * p + 0.14);
  const head = attic ? sill + 0.7 : Math.max(1.95, sill + 0.75);
  const eave = head + 0.16;
  const pitch = kind === 'box' ? 0.04 : Math.min(0.22, p * 0.4);
  const reach = (eave - knee - set * pitch) / (p - pitch);
  if (reach * p > rise - 0.3) return null;
  return { set, reach, sill, head, eave, pitch };
}

/**
 * Places for a row of things along a wall of `bays` bays: each on a line of the bays below (in the
 * middle of a bay, or where two meet), evenly spaced, and symmetrical about the middle of the wall
 * (or `middle`) wherever they fit. As near `want` of them as fit, about `ideal` apart and never
 * closer than `least`. `fits(u)` says whether one fits at u.
 */
function row(
  length: number,
  bays: number,
  want: number,
  fits: (u: number) => boolean,
  ideal: number,
  least: number,
  middle = length / 2,
): number[] {
  const step = length / bays / 2;
  const grid = Array.from({ length: bays * 2 - 1 }, (_, i) => (i + 1) * step);
  const ok = grid.map(fits);
  let best: { score: number; at: number[] } | null = null;
  for (let k = 1; k <= want + 1; k++) {
    for (let s = 1; s <= (k > 1 ? grid.length : 1); s++) {
      if (k > 1 && s * step < least - 1e-6) continue;
      for (let a = 0; a + s * (k - 1) < grid.length; a++) {
        const idx = Array.from({ length: k }, (_, j) => a + s * j);
        if (!idx.every((i) => ok[i])) continue;
        const at = idx.map((i) => grid[i]);
        const centre = at.reduce((p, q) => p + q, 0) / k;
        const score =
          -Math.abs(k - want) * 2 -
          (k > 1 ? Math.abs(s * step - ideal) * 0.6 : 0) -
          Math.abs(centre - middle) * 4 +
          // Over a window below, rather than over the wall between two.
          idx.filter((i) => i % 2 === 0).length * 0.05;
        if (!best || score > best.score + 1e-9) best = { score, at: at.map(round) };
      }
    }
  }
  return best?.at ?? [];
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
 * Where the windows of a roof are, before the rooms behind them are known. The floor under the roof
 * has dormers in a row across the front, or glass in the slopes, as the design and `choice` have it,
 * and windows in the gable ends and under a gable to the front. A roof nobody lives under has dormers
 * only when they are asked for.
 */
function roofOpenings(plan: PlanShape, style: HouseStyle, m: Massing, choice: DormerChoice = 'auto'): LoftWindows {
  const out: LoftWindows = { dormers: [], walls: [], attic: false };
  const loftStyle = style.loft;
  const loft = m.loft;
  if (!loftStyle || (m.form !== 'gable' && m.form !== 'hip') || (!loft && choice !== 'on')) return out;
  const W = m.x1 - m.x0;
  const D = m.y1 - m.y0;
  const half = D / 2;
  const p = m.pitch;
  const rise = half * p;
  const knee = m.knee;
  const hipped = m.form === 'hip';
  const want = Math.max(1, Math.round(W / 3.3));
  const cross = m.cross;
  // Nothing stands on the slope where the gable to the front comes out of it.
  const clear = (x: number, h: number) =>
    !cross || x + h < cross.at - cross.half - 0.2 || x - h > cross.at + cross.half + 0.2;
  // How much a hip has narrowed the front slope, for each meter up it.
  const taper = hipped ? m.inset / half : 0;

  /** Gabled dormers, one window in each, in a row across the front. */
  const gables = (attic: boolean): Dormer[] => {
    const h = attic ? 0.55 : 0.66;
    const shape = dormerShape('gable', knee, p, rise, h, attic);
    if (!shape) return [];
    const ends = Math.max(0.6 + h + 0.25, shape.reach * taper + 0.3 + h);
    const xs = row(W, plan.bays.front, want, (x) => x >= ends && x <= W - ends && clear(x, h), 3, 2 * h + 0.55);
    return xs.map((x) => ({
      kind: 'gable',
      side: 'front',
      x,
      half: h,
      ...shape,
      windows: [{ x, half: attic ? 0.32 : 0.4, cell: null }],
    }));
  };

  /**
   * One wide dormer with a row of windows: in the middle of the front, or of the stretch of roof
   * beside a gable to the front that stands at one end.
   */
  const wide = (kind: 'shed' | 'box', attic: boolean): Dormer[] => {
    const free = freeSpans(0.6, W - 0.6, cross ? [[cross.at - cross.half - 0.2, cross.at + cross.half + 0.2]] : []);
    const widest = free.reduce<[number, number] | null>((p, q) => (!p || q[1] - q[0] > p[1] - p[0] ? q : p), null);
    if (!widest) return [];
    const centred = clear(W / 2, 1);
    const middle = centred ? W / 2 : (widest[0] + widest[1]) / 2;
    const span = Math.min(clamp(W * 0.44, 2, 4.4), centred ? W : widest[1] - widest[0] - 0.2);
    const wh = attic ? 0.32 : 0.4;
    const count = Math.max(1, Math.round((span - 1) / 1.3));
    const fits = (x: number) => Math.abs(x - middle) <= span / 2 - wh - 0.1;
    const xs = row(W, plan.bays.front, count, fits, 1.3, 2 * wh + 0.35, middle);
    if (!xs.length) return [];
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    const dh = (xs[xs.length - 1] - xs[0]) / 2 + wh + 0.45;
    const shape = dormerShape(kind, knee, p, rise, dh, attic);
    if (!shape) return [];
    const ends = Math.max(0.6, shape.reach * taper + 0.3);
    if (x - dh < ends || x + dh > W - ends || !clear(x, dh)) return [];
    return [{ kind, side: 'front', x, half: dh, ...shape, windows: xs.map((u) => ({ x: u, half: wh, cell: null })) }];
  };

  const kind = loftStyle.dormer === 'skylight' ? 'gable' : loftStyle.dormer;
  const standing = (attic: boolean) => (kind === 'gable' ? gables(attic) : wide(kind, attic));
  if (!loft) {
    out.attic = true;
    out.dormers = standing(true);
    return out;
  }

  /** Glass lying in a slope, where the ceiling under it is between waist and head height: at `places`, or in a row. */
  const glass = (side: Side, places: number[] | null): Dormer[] => {
    const across = side === 'front' || side === 'back';
    const depth = across ? half : m.inset;
    const steep = across ? p : m.endPitch;
    const narrow = hipped ? (across ? m.inset / half : half / m.inset) : 0;
    const set = Math.max(0.55, (0.95 - knee) / steep);
    const reach = Math.min(set + 0.95, depth - 0.45);
    if (reach - set < 0.5) return [];
    const length = across ? W : D;
    const ends = hipped ? reach * narrow + 0.3 : 0.6;
    const size = 0.38;
    const fits = (u: number) =>
      u - size >= ends && u + size <= length - ends && (side !== 'front' || clear(u, size + 0.1));
    // Fewer of them than dormers would be: glass in a roof is spaced wider.
    const count = across ? Math.max(1, Math.round(W / 4)) : 1;
    const at =
      places?.filter(fits) ??
      row(length, across ? plan.bays.front : plan.bays.side, count, fits, across ? 3.2 : 2.5, 2 * size + 0.5);
    return at.map((u) => ({
      kind: 'skylight',
      side,
      x: u,
      half: size,
      set,
      reach,
      sill: 0,
      head: 0,
      eave: 0,
      pitch: steep,
      windows: [{ x: u, half: size, cell: null }],
    }));
  };

  // A hipped roof is too low for dormers: it is lit through its slopes, at the front and the ends.
  if (hipped) {
    out.dormers = [...glass('front', null), ...glass('right', null), ...glass('left', null)];
    return out;
  }
  // Dormers across the front, or glass where they would stand.
  const front = choice === 'off' ? [] : standing(false);
  if (front.length) out.dormers = front;
  else {
    const places = choice === 'off' ? standing(false).flatMap((d) => d.windows.map((w) => w.x)) : [];
    out.dormers = glass('front', places.length ? places : null);
  }

  // Windows in the gable ends, in the bays of the walls below, where the roof is high enough.
  const z0 = 0.8;
  const z1 = Math.min(2, knee + rise - 0.75);
  const bay = D / plan.bays.side;
  const width = Math.min(clamp(0.92 * style.window.scale[0], 0.7, 1.15), bay - 0.7);
  if (z1 - z0 >= 0.6 && width >= 0.5) {
    const roofOver = (y: number) => knee + Math.min(y, D - y) * p;
    const fits = (y: number) => roofOver(y - width / 2) >= z1 + 0.25 && roofOver(y + width / 2) >= z1 + 0.25;
    let ys = bayMiddles(plan, 'right').filter(fits);
    // Else one under the ridge.
    if (!ys.length && fits(D / 2)) ys = [D / 2];
    for (const side of ['right', 'left'] as const) {
      for (const y of ys) {
        if (side === 'left') {
          // The garage's roof may stand in the way.
          const cover = Math.max(...[y - width / 2, y, y + width / 2].map((u) => wingRoofAt(plan, style, p, u)));
          if (cover > loft.z + z0 - 0.35) continue;
        }
        out.walls.push({ side, a: round(y - width / 2), b: round(y + width / 2), z0, z1, cell: null });
      }
    }
  }

  // And under the gable that faces the front: one window in its middle, as high as its slopes allow.
  if (cross) {
    const sill = Math.max(0.85, knee + 0.12);
    const wanted = Math.min(1.25, cross.peak - loft.z - sill - 0.8);
    let best: LoftWindow | null = null;
    for (const width of [1.5 * style.window.scale[0], 1.05 * style.window.scale[0]]) {
      const below = knee + (cross.half - width / 2) * cross.pitch - 0.25;
      const head = Math.min(sill + Math.max(wanted, 0), below);
      if (head - sill < 0.55) continue;
      // The bigger window, whether wide and low or narrow and tall.
      if (!best || (head - sill) * width > (best.z1 - best.z0) * (best.b - best.a)) {
        best = { side: 'front', a: cross.at - width / 2, b: cross.at + width / 2, z0: sill, z1: head, cell: null };
      }
    }
    if (best) out.walls.push(best);
  }
  return out;
}

/**
 * What the design asks of the plan: how wide its windows are, so the bays fit them, and where the
 * windows of a floor in its roof are, so the rooms there can be fitted in behind them.
 */
export function facadeFor(style: HouseStyle, topFloor: TopFloor = 'auto', dormers: DormerChoice = 'auto'): Facade {
  return {
    window: windowWidth(style),
    roof: (shape) => {
      const m = massingOf(shape, style, topFloor);
      if (!m.loft) return null;
      const o = roofOpenings(shape, style, m, dormers);
      const along = (side: Side): Slot[] => [
        ...o.dormers
          .filter((d) => d.side === side)
          .flatMap((d) => d.windows.map((w) => ({ a: w.x - w.half, b: w.x + w.half }))),
        ...o.walls.filter((w) => w.side === side).map((w) => ({ a: w.a, b: w.b })),
      ];
      // A wall between rooms never meets a gabled dormer, which is wider than its window.
      const keep = (side: Side): Slot[] =>
        o.dormers
          .filter((d) => d.side === side && d.kind === 'gable')
          .map((d) => ({ a: d.x - d.half - 0.1, b: d.x + d.half + 0.1 }));
      return {
        story: m.loft.index,
        front: along('front'),
        right: along('right'),
        keepFront: keep('front'),
        keepRight: keep('right'),
      };
    },
  };
}

/**
 * The windows of the floor under the roof, each with the room it lights; or the dormers of an
 * attic nobody lives in, when they are asked for. A room none of them lights gets glass in the
 * slope over it.
 */
export function loftWindows(
  plan: HousePlan,
  style: HouseStyle,
  m: Massing,
  choice: DormerChoice = 'auto',
): LoftWindows {
  const out = roofOpenings(plan, style, m, choice);
  if (!m.loft || out.attic) return out;
  const loft = plan.stories[m.loft.index];
  const cellAt = (side: Side, u: number) =>
    loft.cells.find((c) => {
      const range = span(c, plan, side);
      return range !== null && u >= range[0] - 1e-6 && u < range[1] + 1e-6;
    }) ?? null;
  for (const d of out.dormers) for (const w of d.windows) w.cell = cellAt(d.side, w.x);
  for (const w of out.walls) w.cell = cellAt(w.side, (w.a + w.b) / 2);

  const lit = new Set<PlanCell | null>([
    ...out.dormers.flatMap((d) => d.windows.map((w) => w.cell)),
    ...out.walls.map((w) => w.cell),
  ]);
  const D = m.y1 - m.y0;
  const half = D / 2;
  const p = m.pitch;
  const taper = m.form === 'hip' ? m.inset / half : 0;
  const chimney = chimneySpot(m);
  for (const cell of loft.cells) {
    if (!cell.id || cell.type === 'closet' || lit.has(cell)) continue;
    const r = cell.rect;
    // Over the slope the room is under, between waist and head height, and over the room itself.
    const side: Side = (r.y0 + r.y1) / 2 > (m.y0 + m.y1) / 2 ? 'front' : 'back';
    const near = side === 'front' ? m.y1 - r.y1 : r.y0 - m.y0;
    const far = side === 'front' ? m.y1 - r.y0 : r.y1 - m.y0;
    const set = Math.max(0.55, (0.95 - m.knee) / p, near + 0.25);
    const reach = Math.min(set + 0.95, half - 0.45, far - 0.25);
    if (reach - set < 0.5) continue;
    const ends = taper ? reach * taper + 0.3 : 0.6;
    const blocked: [number, number][] = out.dormers
      .filter((d) => d.side === side)
      .map((d): [number, number] => [d.x - d.half - 0.4, d.x + d.half + 0.4]);
    if (side === 'front' && m.cross) blocked.push([m.cross.at - m.cross.half - 0.2, m.cross.at + m.cross.half + 0.2]);
    if (side === 'back') blocked.push([chimney.x0 - 0.45, chimney.x1 + 0.45]);
    const spans = freeSpans(m.x0 + ends, m.x1 - ends, blocked);
    // A smaller one where a full-size one does not fit.
    for (const size of [0.38, 0.27]) {
      const x = fitIn(spans, (r.x0 + r.x1) / 2, size + 0.1, r.x0 + size + 0.1, r.x1 - size - 0.1);
      if (x === null) continue;
      out.dormers.push({
        kind: 'skylight',
        side,
        x,
        half: size,
        set,
        reach,
        sill: 0,
        head: 0,
        eave: 0,
        pitch: p,
        windows: [{ x, half: size, cell }],
      });
      break;
    }
  }
  return out;
}
