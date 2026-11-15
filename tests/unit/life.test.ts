// Life around the house: what comes when, how often, from where, and that none of it repeats.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cameraFor, OUTSIDE, skyFrame } from '../../src/house/camera.ts';
import {
  BIRD_FLOATS,
  GLOW_FLOATS,
  Life,
  lensFor,
  PUFF_FLOATS,
  type Conditions,
  type Lens,
  type Stage,
} from '../../src/house/life.ts';
import { seeded, toWorld } from '../../src/house/math.ts';

const stage: Stage = {
  center: [5, 4, 0],
  radius: 7.4,
  ridge: 9.5,
  plot: { x0: -6, y0: -4, x1: 15, y1: 14 },
  buildings: [
    { x0: 0, y0: 0, x1: 10, y1: 8 },
    { x0: -4, y0: 1, x1: 0, y1: 7 },
  ],
  chimney: [7, 2, 11],
};

/** A camera in front of the house and to its right, as the card starts. */
function realLens(width = 900, height = 600): Lens {
  const target = toWorld(5, 4, 3);
  const pose = { yaw: OUTSIDE.yaw, pitch: OUTSIDE.pitch, distance: 62, target };
  const camera = cameraFor(pose, width / height, 30);
  return lensFor(camera, skyFrame(pose.yaw, width, height, pose.pitch), target, width, height);
}

const lens = realLens();

const day = (extra: Partial<Conditions> = {}): Conditions => ({
  sun: 40,
  stars: 0,
  clouds: 0.2,
  month: 4,
  southern: false,
  day: 20000,
  roof: 1,
  ...extra,
});
const night = (extra: Partial<Conditions> = {}): Conditions => day({ sun: -30, stars: 1, ...extra });

/** Runs a life for a while, a frame every `step` seconds, and calls back with each scene. */
function run(life: Life, cond: Conditions, seconds: number, each?: (now: number) => void, step = 0.1): void {
  for (let t = 0; t <= seconds; t += step) {
    life.frame(t * 1000, cond, stage, lens);
    each?.(t);
  }
}

describe('life around the house', () => {
  it('flies birds by day and shooting stars at night, and nothing out of place', () => {
    const sunny = new Life(seeded(1));
    run(sunny, day(), 1800);
    assert.ok(sunny.log.length >= 18 && sunny.log.length <= 70, `${sunny.log.length} flights in half an hour`);
    assert.equal(sunny.meteorLog.length, 0, 'no shooting stars by day');
    const dark = new Life(seeded(2));
    run(dark, night(), 1800);
    assert.equal(dark.log.length, 0, 'no birds at night');
    assert.ok(dark.meteorLog.length >= 18 && dark.meteorLog.length <= 80, `${dark.meteorLog.length} shooting stars`);
    assert.ok(dark.meteorLog.some((m) => m.fireball) || dark.meteorLog.length < 25, 'now and then a fireball');
  });

  it('comes at no set times, and never the same way twice in a row', () => {
    const life = new Life(seeded(3));
    run(life, day(), 7200, undefined, 0.25);
    const log = life.log;
    for (let i = 1; i < log.length; i++) assert.notEqual(log[i].kind, log[i - 1].kind, 'a different bird each time');
    const gaps = log.slice(1).map((f, i) => f.at - log[i].at);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const spread = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    assert.ok(spread > 8, `the gaps vary: ${mean.toFixed(0)} ± ${spread.toFixed(0)} s`);
    assert.ok(Math.min(...gaps) >= 27, 'never two in quick succession');
    assert.ok(
      new Set(log.map((f) => f.kind)).size >= 4,
      `birds of many kinds: ${[...new Set(log.map((f) => f.kind))]}`,
    );
    assert.deepEqual(
      new Set(log.map((f) => f.approach)),
      new Set(['across', 'toward', 'away', 'circle']),
      'from every direction',
    );
    assert.ok(log.some((f) => f.side < 0) && log.some((f) => f.side > 0), 'from both sides');
    const stars = new Life(seeded(4));
    run(stars, night(), 3600, undefined, 0.25);
    const m = stars.meteorLog;
    const alike = m.slice(1).filter((x, i) => Math.abs(x.x - m[i].x) < 0.25 && Math.abs(x.angle - m[i].angle) < 0.5);
    assert.ok(alike.length <= m.length * 0.1, `shooting stars differ: ${alike.length} of ${m.length} alike`);
    assert.ok(m.some((x) => x.angle < 0) && m.some((x) => x.angle > 0), 'falling either way');
  });

  it('keeps to the seasons and the hour', () => {
    const kinds = (cond: Conditions) => {
      const life = new Life(seeded(5));
      run(life, cond, 7200, undefined, 0.5);
      return new Set(life.log.map((f) => f.kind));
    };
    const winter = kinds(day({ month: 0 }));
    assert.ok(!winter.has('swallow') && !winter.has('bat') && !winter.has('goose'), `in January: ${[...winter]}`);
    assert.ok(kinds(day({ month: 9 })).has('goose'), 'geese in autumn');
    assert.ok(kinds(day({ month: 0, southern: true })).has('swallow'), 'swallows in a southern January');
    const dusk = kinds(day({ month: 6, sun: -3, stars: 0.2 }));
    assert.ok(dusk.has('bat') && !dusk.has('gull') && !dusk.has('hawk'), `at a summer dusk: ${[...dusk]}`);
    const rain = new Life(seeded(6));
    run(rain, day({ wet: true }), 7200, undefined, 0.5);
    const dry = new Life(seeded(6));
    run(dry, day(), 7200, undefined, 0.5);
    assert.ok(rain.log.length < dry.log.length * 0.5, 'birds mostly shelter from the rain');
  });

  it('shows birds where they can be seen, small, and never inside the house', () => {
    for (const kind of ['songbird', 'swallow', 'crow', 'gull', 'goose', 'hawk', 'bat'] as const) {
      const life = new Life(seeded(7));
      life.request(kind);
      let seen = 0;
      let biggest = 0;
      run(life, day({ month: 6 }), 40, () => {
        const scene = life.scene;
        for (let i = 0; i < scene.birdCount; i++) {
          // Where it is and how far it reaches, then its triangles' corners.
          const b = scene.birds.subarray(i * BIRD_FLOATS, (i + 1) * BIRD_FLOATS);
          const xs: number[] = [];
          const ys: number[] = [];
          for (let t = 0; t < b[3]; t++) {
            const o = (2 + t * 3) * 4;
            xs.push(b[o], b[o + 2], b[o + 4]);
            ys.push(b[o + 1], b[o + 3], b[o + 5]);
          }
          assert.ok(b[3] > 10, `${kind}: drawn in triangles`);
          assert.ok([...b.slice(0, 8), ...xs, ...ys].every(Number.isFinite), `${kind}: a bird is somewhere`);
          if (xs.some((x) => x > 0 && x < lens.width) && ys.some((y) => y > 0 && y < lens.height)) seen++;
          biggest = Math.max(biggest, Math.max(...xs) - Math.min(...xs));
        }
      });
      assert.ok(seen > 10, `${kind} is seen for a while: ${seen} frames`);
      assert.ok(biggest < lens.height * 0.25, `${kind} stays small: ${biggest.toFixed(0)} px`);
    }
    // Every path over the house clears its roof.
    const life = new Life(seeded(8));
    let checked = 0;
    for (let i = 0; i < 40; i++) life.request(i % 2 ? 'songbird' : 'swallow');
    run(life, day({ month: 6 }), 0.2);
    for (const flight of (life as unknown as { flights: { route: { points: number[][] } }[] }).flights) {
      for (const [x, y, z] of flight.route.points) {
        if (stage.buildings.some((b) => x > b.x0 - 0.3 && x < b.x1 + 0.3 && y > b.y0 - 0.3 && y < b.y1 + 0.3)) {
          assert.ok(z > stage.ridge + 1, `a bird over the house at ${z.toFixed(1)} m`);
          checked++;
        }
      }
    }
    assert.ok(checked > 0, 'some paths do cross the house');
  });

  it('draws only every frame while something flies or falls', () => {
    const life = new Life(seeded(9));
    life.frame(0, day(), stage, lens);
    assert.equal(life.busy, false);
    life.request('gull');
    life.frame(100, day(), stage, lens);
    assert.equal(life.busy, true);
    run(life, day(), 60);
    life.request('meteor');
    life.frame(70_000, night(), stage, lens);
    assert.equal(life.busy, true, 'a shooting star moves fast');
  });

  it('lights fireflies on summer nights, in the garden', () => {
    const glows = (cond: Conditions) => {
      const life = new Life(seeded(10));
      let lit = 0;
      run(life, cond, 60, () => {
        const scene = life.scene;
        lit += scene.glowCount;
        for (let i = 0; i < scene.glowCount; i++) {
          const g = scene.glows.subarray(i * GLOW_FLOATS, (i + 1) * GLOW_FLOATS);
          assert.ok(g[4] > 0 && g[5] > g[6], 'a warm yellow-green glow');
        }
      });
      return lit;
    };
    // A night the fireflies are out: most nights are.
    const out = [20000, 20001, 20002, 20003].find((d) => glows(night({ month: 6, day: d })) > 0);
    assert.ok(out !== undefined, 'fireflies on a July night');
    assert.equal(glows(night({ month: 0, day: out })), 0, 'none in January');
    assert.ok(glows(night({ month: 0, southern: true, day: out })) > 0, 'but a southern January is summer');
    assert.equal(glows(night({ month: 6, day: out, wet: true })), 0, 'nor in the rain');
    assert.equal(glows(day({ month: 6, day: out })), 0, 'nor by day');
  });

  it('sends smoke up the chimney when it is cold, downwind', () => {
    const smoke = (cond: Conditions) => {
      const life = new Life(seeded(11));
      run(life, cond, 12);
      return life.scene;
    };
    assert.equal(smoke(day({ temperature: 15 })).puffCount, 0, 'not on a mild day');
    assert.equal(smoke(day()).puffCount, 0, 'nor when nobody says how cold it is');
    // The wind blows one way, then the other: the smoke leans with it.
    const lean = (x: number) => {
      const scene = smoke(day({ temperature: 2, wind: { x, y: 0, speed: 6 } }));
      assert.ok(scene.puffCount > 5, 'a stream of puffs');
      const oldest = scene.puffs.subarray(0, PUFF_FLOATS);
      const newest = scene.puffs.subarray((scene.puffCount - 1) * PUFF_FLOATS, scene.puffCount * PUFF_FLOATS);
      assert.ok(oldest[1] < newest[1], 'smoke rises');
      assert.ok(oldest[2] > newest[2], 'and spreads as it goes');
      return oldest[0] - newest[0];
    };
    const east = lean(1);
    const west = lean(-1);
    assert.ok(Math.sign(east) !== Math.sign(west) && Math.abs(east - west) > 20, `downwind: ${east} vs ${west}`);
    assert.equal(smoke(day({ temperature: 2, roof: 0 })).puffCount, 0, 'no smoke while the roof is lifted off');
  });

  it('sends a plane or a satellite across the sky now and then', () => {
    const life = new Life(seeded(12));
    let trail = 0;
    let lights = 0;
    run(life, day(), 1800, () => {
      if (life.scene.trail[7]) trail++;
      lights += life.scene.lightCount;
    });
    assert.ok(lights > 0, 'a plane by day');
    assert.ok(trail > 0, 'leaving a trail');
    const dark = new Life(seeded(13));
    let colors = 0;
    run(dark, night(), 1800, () => {
      for (let i = 0; i < dark.scene.lightCount; i++) {
        const [r, g] = dark.scene.lights.subarray(i * 8 + 4, i * 8 + 6);
        if (r > g * 3 || g > r * 3) colors++;
      }
    });
    assert.ok(colors > 0, 'red and green lights at night');
  });
});
