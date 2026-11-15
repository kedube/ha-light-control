// Birds as small 3D models: whole and lit, each side showing its own colors, and flying as their
// kinds do: beating, bounding, gliding and soaring.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BIRD_FLOATS,
  BIRD_TRIS,
  DAYLIGHT,
  KINDS,
  layBird,
  posture,
  type Frame,
  type Kind,
  type Light,
  type Point,
  type Pose,
} from '../../src/house/birds.ts';
import { FOV, skyFrame } from '../../src/house/camera.ts';
import { lensFor, type Lens } from '../../src/house/life.ts';
import { lookAt, multiply, perspective, toWorld } from '../../src/house/math.ts';
import { computeSky } from '../../src/house/sky.ts';

const SPANS: Record<Kind, number> = {
  songbird: 0.25,
  swallow: 0.32,
  crow: 0.95,
  gull: 1.25,
  goose: 1.6,
  hawk: 1.25,
  bat: 0.3,
};

/** The card's own lens, looking from one point in plan space at another. */
function lens(eye: Point, target: Point, size = 400, up: Point = [0, 1, 0]): Lens {
  const e = toWorld(...eye);
  const t = toWorld(...target);
  const view = lookAt(e, t, up);
  const proj = perspective(FOV, 1, 0.1, 1000);
  return lensFor({ view, proj, viewProj: multiply(proj, view), eye: e }, skyFrame(0, size, size), t, size, size);
}

/** A bird at the origin, flying north (+y), level. */
const LEVEL: Frame = { at: [0, 0, 0], forward: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1] };
const SPREAD: Pose = { lift: 0.05, hand: 0, fold: 0, sweep: 0, spread: 0, tail: 0, bob: 0 };
/** Light the same from every side, so the colors seen are the birds' own. */
const EVEN: Light = { dir: [0, 1, 0], color: [0, 0, 0], ambient: Array.from({ length: 6 }, () => [0.6, 0.6, 0.6]) };

interface Drawn {
  reach: number;
  count: number;
  tris: { at: [number, number][]; colors: [number, number, number][] }[];
}

function draw(kind: Kind, from: Point, pose: Pose = SPREAD, light: Light = DAYLIGHT, frame = LEVEL): Drawn | null {
  const row = new Float32Array(BIRD_FLOATS);
  const span = SPANS[kind];
  const eye: Point = [from[0] * span * 3, from[1] * span * 3, from[2] * span * 3];
  const up: Point = Math.abs(from[2]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  if (!layBird(row, kind, span, frame, pose, lens(eye, frame.at, 400, up), light, 1, 0)) return null;
  const count = row[3];
  const unpack = (v: number): [number, number, number] => [Math.floor(v / 65536), Math.floor(v / 256) % 256, v % 256];
  const tris = Array.from({ length: count }, (_, t) => {
    const o = (2 + t * 3) * 4;
    return {
      at: [
        [row[o], row[o + 1]],
        [row[o + 2], row[o + 3]],
        [row[o + 4], row[o + 5]],
      ] as [number, number][],
      colors: [unpack(row[o + 9]), unpack(row[o + 10]), unpack(row[o + 11])],
    };
  });
  return { reach: row[2], count, tris };
}

const area = (t: Drawn['tris'][number]) => {
  const [a, b, c] = t.at;
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
};
const luma = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** How light a bird looks, all over: its colors weighted by how much of the screen each covers. */
function lightness(d: Drawn): number {
  let sum = 0;
  let total = 0;
  for (const t of d.tris) {
    const a = area(t);
    sum += (a * (luma(t.colors[0]) + luma(t.colors[1]) + luma(t.colors[2]))) / 3;
    total += a;
  }
  return sum / total;
}

const BELOW: Point = [0.1, 0.3, -1];
const ABOVE: Point = [-0.1, -0.3, 1];

describe('birds', () => {
  it('are drawn whole, in lit triangles, from every side and in every pose', () => {
    for (const kind of KINDS) {
      for (let t = 0; t < 6; t += 0.37) {
        const pose = posture(kind, t, 1, [0.2, 0.4, 0.6, 0.8, 0.3, 0.5]);
        for (const from of [BELOW, ABOVE, [1, 0.1, 0.1], [0.1, 1, 0.1], [0.1, -1, 0.2]] as Point[]) {
          const d = draw(kind, from, pose);
          assert.ok(d, `${kind} can be seen`);
          assert.ok(d.count >= 16 && d.count <= BIRD_TRIS, `${kind}: ${d.count} triangles`);
          assert.ok(d.reach > 10 && d.reach < 400, `${kind} reaches ${d.reach.toFixed(0)} px`);
          for (const tri of d.tris) {
            assert.ok(tri.at.flat().every(Number.isFinite), `${kind}: a corner is somewhere`);
            assert.ok(
              tri.colors.flat().every((v) => Number.isInteger(v) && v >= 0 && v <= 255),
              `${kind}: colors`,
            );
          }
        }
      }
    }
  });

  it('show their undersides from below and their backs from above', () => {
    const pale = (kind: Kind, from: Point) => lightness(draw(kind, from, SPREAD, EVEN)!);
    // A hawk is pale beneath and brown above; a swallow cream beneath and blue-black above.
    assert.ok(pale('hawk', BELOW) > pale('hawk', ABOVE) + 60, 'a hawk, pale beneath');
    assert.ok(pale('swallow', BELOW) > pale('swallow', ABOVE) + 60, 'a swallow, cream beneath');
    // A crow is black all over, a gull white with black wingtips.
    assert.ok(pale('crow', BELOW) < 60 && pale('crow', ABOVE) < 60, 'a crow, black');
    assert.ok(pale('gull', BELOW) > 160, 'a gull, white beneath');
    assert.ok(
      draw('gull', ABOVE, SPREAD, EVEN)!.tris.some((t) => t.colors.every((c) => luma(c) < 50)),
      'with black wingtips',
    );
  });

  it('are lit by the sky they fly in', () => {
    const dusk = computeSky({ elevation: -3, azimuth: 280, viewAzimuth: 180 });
    const at = (light: Light) => lightness(draw('gull', ABOVE, SPREAD, light)!);
    const evening: Light = { dir: dusk.keyDir, color: dusk.keyColor, ambient: dusk.ambient };
    assert.ok(at(DAYLIGHT) > at(evening) + 40, 'brighter in the sun than after sunset');
  });

  it('are as wide on one side as the other, seen from straight below', () => {
    const d = draw('crow', [0, 0, -1], SPREAD, DAYLIGHT)!;
    const xs = d.tris.flatMap((t) => t.at.map(([x]) => x));
    const left = 200 - Math.min(...xs);
    const right = Math.max(...xs) - 200;
    assert.ok(Math.abs(left - right) < 0.02 * (left + right), `${left.toFixed(1)} and ${right.toFixed(1)} px`);
  });

  it('beat their wings up and down, folding them on the way up', () => {
    for (const kind of ['crow', 'goose', 'gull', 'songbird', 'bat'] as Kind[]) {
      let high = -Infinity;
      let low = Infinity;
      let fold = 0;
      for (let t = 0; t < 2; t += 0.01) {
        const pose = posture(kind, t, 0, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
        high = Math.max(high, pose.lift);
        low = Math.min(low, pose.lift);
        fold = Math.max(fold, pose.fold);
      }
      assert.ok(high > 0.35 && low < -0.35, `${kind} beats: ${low.toFixed(2)} to ${high.toFixed(2)}`);
      assert.ok(fold > 0.25, `${kind} bends its wrists`);
    }
    // Seen from the side, the wingtips rise well above the body and sink well below it.
    const reachAbove = (pose: Pose) => {
      const d = draw('crow', [1, 0, 0], pose, DAYLIGHT)!;
      return 200 - Math.min(...d.tris.flatMap((t) => t.at.map(([, y]) => y)));
    };
    const up = posture('crow', 0, 0, [0, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const down = posture('crow', 0.55 / 3.6, 0, [0, 0.5, 0.5, 0.5, 0.5, 0.5]);
    assert.ok(up.lift > down.lift);
    assert.ok(reachAbove(up) > reachAbove(down) * 2, 'the wings rise above the body');
  });

  it('bound, glide and soar as their kinds do', () => {
    const over = (kind: Kind, seconds: number, test: (p: Pose) => boolean) => {
      let n = 0;
      let all = 0;
      for (let t = 0; t < seconds; t += 0.01, all++) if (test(posture(kind, t, 0, [0.1, 0.5, 0.5, 0.5, 0.5, 0.5]))) n++;
      return n / all;
    };
    // A songbird shuts its wings between bursts of beats.
    const shut = over('songbird', 10, (p) => p.fold > 0.95);
    assert.ok(shut > 0.25 && shut < 0.7, `a songbird's wings shut ${(shut * 100).toFixed(0)}% of the time`);
    // A gull glides on bent wings, the hands lower than the arms.
    const gliding = over('gull', 30, (p) => p.hand < -0.3 && Math.abs(p.lift - 0.17) < 0.01);
    assert.ok(gliding > 0.4, `a gull glides ${(gliding * 100).toFixed(0)}% of the time`);
    // A hawk soars, with its tail fanned and its primaries spread like fingers.
    const soaring = over('hawk', 30, (p) => p.spread > 0.95 && p.tail > 0.95);
    assert.ok(soaring > 0.6, `a hawk soars ${(soaring * 100).toFixed(0)}% of the time`);
    // A goose never stops beating.
    assert.equal(
      over('goose', 10, (p) => p.fold === 0 && p.lift === 0),
      0,
    );
  });
});
