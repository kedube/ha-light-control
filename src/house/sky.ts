// The sky over the house, worked out from where the sun really is.
//
// Sunlight is followed through a model of the atmosphere (air scatters blue light, haze scatters
// all colors forward, ozone absorbs orange), which is what makes the sky blue at noon, red at the
// horizon at sunset and deep blue at dusk. The same sky lights the house: the sun or the moon as
// one light that casts shadows, and the glow of the whole sky from every side.
//
// World directions: x is east, y is up and z is south. The house's front wall faces south (+z),
// toward the sun, like most houses in the northern hemisphere; `facing` turns it.

import { clamp01, dot, lerp, normalize, scale, smoothstep, type Vec3 } from './math.ts';

export interface SunInfo {
  elevation?: number;
  azimuth?: number;
  aboveHorizon?: boolean;
}

export type SkyMode = 'day' | 'dusk' | 'night';

/** Day, dusk or night from the sun's elevation, falling back to the clock without a sun entity. */
export function skyMode(sun?: SunInfo, now = new Date()): SkyMode {
  const { elevation } = sunPosition(sun, now);
  if (elevation > 6) return 'day';
  if (elevation > -6) return 'dusk';
  return 'night';
}

/** Where the sun is, in degrees. Without a sun entity, a plausible path for the time of day. */
export function sunPosition(sun?: SunInfo, now = new Date()): { elevation: number; azimuth: number } {
  const hour = now.getHours() + now.getMinutes() / 60;
  const clock = {
    elevation: 5 + 45 * Math.sin(((hour - 7) / 24) * 2 * Math.PI),
    azimuth: (((180 + 15 * (hour - 13)) % 360) + 360) % 360,
  };
  if (sun?.elevation !== undefined) return { elevation: sun.elevation, azimuth: sun.azimuth ?? clock.azimuth };
  if (sun?.aboveHorizon !== undefined) {
    return {
      elevation: sun.aboveHorizon ? Math.max(12, clock.elevation) : Math.min(-14, clock.elevation),
      azimuth: sun.azimuth ?? clock.azimuth,
    };
  }
  return clock;
}

/** How much of the sky each Home Assistant weather condition clouds over. */
const CONDITIONS: Record<string, number> = {
  sunny: 0.12,
  'clear-night': 0.1,
  windy: 0.28,
  partlycloudy: 0.42,
  'windy-variant': 0.55,
  exceptional: 0.5,
  cloudy: 0.82,
  fog: 0.92,
  rainy: 0.9,
  pouring: 0.97,
  snowy: 0.92,
  'snowy-rainy': 0.93,
  hail: 0.95,
  lightning: 0.93,
  'lightning-rainy': 0.96,
};

/** Cloud cover, 0–1, from a weather entity's state and its cloud_coverage attribute (a percentage). */
export function cloudCover(condition: string, coverage?: unknown): number | undefined {
  if (typeof coverage === 'number' && Number.isFinite(coverage)) return clamp01(coverage / 100);
  return CONDITIONS[condition];
}

const RAD = Math.PI / 180;

/** The unit vector toward a point in the sky; azimuth is clockwise from north. */
export function skyDirection(elevation: number, azimuth: number): Vec3 {
  const el = elevation * RAD;
  const az = azimuth * RAD;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

// ─── The atmosphere ──────────────────────────────────────────────────────────

const EARTH = 6360e3;
const TOP = 6460e3;
/** Height of the viewer, in meters: a little above the ground, which keeps the horizon soft. */
const EYE = 300;
const RAYLEIGH: Vec3 = [5.802e-6, 13.558e-6, 33.1e-6];
const RAYLEIGH_HEIGHT = 8000;
const MIE_SCATTER = 3.996e-6;
const MIE_EXTINCT = 8.396e-6;
const MIE_HEIGHT = 1200;
const OZONE: Vec3 = [0.65e-6, 1.881e-6, 0.085e-6];
/** How much light the haze throws forward (0 = evenly, 1 = straight on). */
export const MIE_G = 0.78;

/** Sunlight above the atmosphere, in units where a sunlit white wall comes out near white. */
const SUN_POWER = 5.6;
/** Dust and light bounced off the ground brighten a real sky beyond what this model follows. */
const SKY_GAIN = 1.5;
/** How much of the light that has already been scattered once is scattered toward the viewer again. */
const SECOND_BOUNCE = 1.25;
/** Below this the sun's light reaches the sky only by paths the model does not follow. */
const LOWEST_SUN = -4;

function sphereExit(ox: number, oy: number, oz: number, d: Vec3, radius: number): [number, number] | null {
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

const ozoneAt = (h: number) => Math.max(0, 1 - Math.abs(h - 25000) / 15000);

/** Optical depth from a point to the top of the atmosphere, or null when the ground is in the way. */
function depthToSpace(px: number, py: number, pz: number, d: Vec3, steps: number): Vec3 | null {
  const ground = sphereExit(px, py, pz, d, EARTH);
  if (ground && ground[1] > 0 && ground[0] > 0) return null;
  const exit = sphereExit(px, py, pz, d, TOP);
  if (!exit) return [0, 0, 0];
  const ds = exit[1] / steps;
  let r = 0;
  let m = 0;
  let o = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    const x = px + d[0] * t;
    const y = py + d[1] * t;
    const z = pz + d[2] * t;
    const h = Math.max(0, Math.sqrt(x * x + y * y + z * z) - EARTH);
    r += Math.exp(-h / RAYLEIGH_HEIGHT) * ds;
    m += Math.exp(-h / MIE_HEIGHT) * ds;
    o += ozoneAt(h) * ds;
  }
  return [r, m, o];
}

const transmit = (depth: Vec3): Vec3 =>
  [0, 1, 2].map((c) => Math.exp(-(RAYLEIGH[c] * depth[0] + MIE_EXTINCT * depth[1] + OZONE[c] * depth[2]))) as Vec3;

/** How much of the sun's light reaches the ground, per color. */
export function sunTransmittance(sun: Vec3): Vec3 {
  const depth = depthToSpace(0, EARTH + EYE, 0, sun, 24);
  return depth ? transmit(depth) : [0, 0, 0];
}

/**
 * Sunlight scattered toward the viewer from one direction: by air (`air`, with its phase function
 * applied) and by haze (`haze`, without it: the renderer applies that per pixel, as it peaks
 * sharply around the sun). `path` is how much of any light along the way is scattered toward the
 * viewer, which is what light that has bounced around the sky already does.
 */
function scatter(dir: Vec3, sun: Vec3): { air: Vec3; haze: Vec3; path: Vec3 } {
  const oy = EARTH + EYE;
  const exit = sphereExit(0, oy, 0, dir, TOP);
  const ground = sphereExit(0, oy, 0, dir, EARTH);
  let far = exit ? exit[1] : 0;
  if (ground && ground[0] > 0) far = ground[0];
  const STEPS = 16;
  const air: Vec3 = [0, 0, 0];
  const haze: Vec3 = [0, 0, 0];
  const path: Vec3 = [0, 0, 0];
  let dr = 0;
  let dm = 0;
  let dz = 0;
  let previous = 0;
  for (let i = 0; i < STEPS; i++) {
    // Steps grow with distance: most of the air is close by.
    const next = far * ((i + 1) / STEPS) ** 2;
    const ds = next - previous;
    const t = previous + ds * 0.5;
    previous = next;
    const x = dir[0] * t;
    const y = oy + dir[1] * t;
    const z = dir[2] * t;
    const h = Math.max(0, Math.sqrt(x * x + y * y + z * z) - EARTH);
    const r = Math.exp(-h / RAYLEIGH_HEIGHT) * ds;
    const m = Math.exp(-h / MIE_HEIGHT) * ds;
    const o = ozoneAt(h) * ds;
    dr += r * 0.5;
    dm += m * 0.5;
    dz += o * 0.5;
    const toSun = depthToSpace(x, y, z, sun, 6);
    for (let c = 0; c < 3; c++) {
      const here = RAYLEIGH[c] * dr + MIE_EXTINCT * dm + OZONE[c] * dz;
      path[c] += Math.exp(-here) * (RAYLEIGH[c] * r + MIE_SCATTER * m);
      if (!toSun) continue;
      const through = Math.exp(-(here + RAYLEIGH[c] * toSun[0] + MIE_EXTINCT * toSun[1] + OZONE[c] * toSun[2]));
      air[c] += through * r;
      haze[c] += through * m;
    }
    dr += r * 0.5;
    dm += m * 0.5;
    dz += o * 0.5;
  }
  const mu = dot(dir, sun);
  const phase = (3 / (16 * Math.PI)) * (1 + mu * mu);
  return {
    air: [air[0] * RAYLEIGH[0] * phase, air[1] * RAYLEIGH[1] * phase, air[2] * RAYLEIGH[2] * phase],
    haze: scale(haze, MIE_SCATTER),
    path,
  };
}

/** The haze's phase function (Cornette-Shanks), as the shader computes it. */
export function hazePhase(mu: number, g = MIE_G): number {
  const g2 = g * g;
  return ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) / ((2 + g2) * (1 + g2 - 2 * g * mu) ** 1.5);
}

// ─── The sky as the renderer needs it ────────────────────────────────────────

export const ENV_WIDTH = 64;
export const ENV_HEIGHT = 24;

/** Row v (0–1) of the sky texture is this elevation, in radians; rows crowd toward the horizon. */
export const envElevation = (v: number): number => v * v * (Math.PI / 2);

export interface Sky {
  mode: SkyMode;
  /** Sun elevation in degrees. */
  elevation: number;
  sunDir: Vec3;
  /** What the sun's disc looks like; black once it has set. */
  sunDisc: Vec3;
  moonDir: Vec3;
  /** 0 new, 0.5 full, 1 new again. */
  moonPhase: number;
  moonDisc: Vec3;
  /** The one light that casts shadows: the sun by day, the moon at night, nothing in between. */
  keyDir: Vec3;
  keyColor: Vec3;
  /** Angular radius of the key light, in radians: larger makes softer shadows. */
  keySize: number;
  /** Light from the whole sky and the ground on a surface facing +x, −x, +y, −y, +z, −z. */
  ambient: [Vec3, Vec3, Vec3, Vec3, Vec3, Vec3];
  /** What the ground looks like from afar, for reflections and the haze below the horizon. */
  ground: Vec3;
  /** Sky brightness by direction, ENV_WIDTH × ENV_HEIGHT RGBA: light scattered by air, and by haze. */
  air: Float32Array;
  haze: Float32Array;
  /** Added to the whole sky at night: starlight and the glow of the air. */
  nightGlow: [Vec3, Vec3];
  /** How visible the stars are, 0–1. */
  stars: number;
  /** How strongly lamps show against the daylight: faint at noon, full at night. */
  lamp: number;
  /** How much of the sky clouds cover, 0–1. */
  clouds: number;
  /** A drift for the clouds, so they are not in the same place all day. */
  cloudShift: number;
  /** The sky at the top and the bottom of the picture, for when it cannot be drawn in 3D. */
  css: [string, string];
}

export interface SkyInput {
  /** Sun elevation and azimuth, in degrees. */
  elevation: number;
  azimuth: number;
  /** Compass direction the picture looks toward, in degrees. */
  viewAzimuth: number;
  /** Where the moon hangs: degrees right of the view direction, and above the horizon. */
  moonOffset?: [number, number];
  date?: Date;
  clouds?: number;
}

const SYNODIC_MONTH = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/** The moon's phase for a date: 0 at new moon, 0.5 at full moon. */
export function moonPhase(date: Date): number {
  const days = (date.getTime() - NEW_MOON) / 86400000;
  return (((days / SYNODIC_MONTH) % 1) + 1) % 1;
}

const toCss = (rgb: Vec3): string => {
  // The renderer's tone curve, roughly, so the fallback sky matches.
  const map = (v: number) => Math.round(255 * clamp01(1 - Math.exp(-1.6 * v)) ** (1 / 2.2));
  return `rgb(${map(rgb[0])}, ${map(rgb[1])}, ${map(rgb[2])})`;
};

const luma = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Everything the renderer needs to draw the sky and light the house under it. All brightnesses
 * are already exposed for the time of day, as a camera would: the picture is as bright at dusk as
 * at noon, until night falls.
 */
export function computeSky(input: SkyInput): Sky {
  const elevation = Math.max(-90, Math.min(90, input.elevation));
  const sunDir = skyDirection(elevation, input.azimuth);
  const date = input.date ?? new Date();
  const phase = moonPhase(date);
  const moonLit = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const [moonRight, moonUp] = input.moonOffset ?? [28, 30];
  const moonDir = skyDirection(moonUp, input.viewAzimuth + moonRight);

  // How dark it is: 0 while the sun is up, 1 once the last twilight has gone.
  const night = smoothstep(-3, -13, elevation);
  const twilight = smoothstep(8, -4, elevation);
  // Deep twilight keeps the colors of early twilight and fades, instead of following the sun down.
  const afterglow = 1 - smoothstep(LOWEST_SUN, -13, elevation);
  const simSun = skyDirection(Math.max(elevation, LOWEST_SUN), input.azimuth);

  const count = ENV_WIDTH * ENV_HEIGHT;
  const air = new Float32Array(count * 4);
  const haze = new Float32Array(count * 4);
  const dirs: Vec3[] = [];
  const solid: number[] = [];
  for (let j = 0; j < ENV_HEIGHT; j++) {
    const el = envElevation((j + 0.5) / ENV_HEIGHT);
    const omega =
      ((2 * Math.PI) / ENV_WIDTH) *
      (Math.sin(envElevation((j + 1) / ENV_HEIGHT)) - Math.sin(envElevation(j / ENV_HEIGHT)));
    for (let i = 0; i < ENV_WIDTH; i++) {
      const az = ((i + 0.5) / ENV_WIDTH) * 2 * Math.PI - Math.PI;
      dirs.push([Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]);
      solid.push(omega);
    }
  }

  if (afterglow > 0) {
    // Sunlight scattered once, in every direction above the horizon...
    const paths: Vec3[] = [];
    const once: Vec3 = [0, 0, 0];
    let total = 0;
    for (let index = 0; index < count; index++) {
      const s = scatter(dirs[index], simSun);
      paths.push(s.path);
      const mie = Math.min(hazePhase(dot(dirs[index], simSun)), 1.2);
      for (let c = 0; c < 3; c++) {
        air[index * 4 + c] = s.air[c];
        haze[index * 4 + c] = s.haze[c];
        once[c] += (s.air[c] + s.haze[c] * mie) * solid[index];
      }
      total += solid[index];
    }
    // ...and scattered again: the whole sky's light, picked up along each line of sight. This is
    // what keeps the horizon pale instead of deep orange, and the dusk sky from going purple.
    const grade = smoothstep(2, LOWEST_SUN, elevation);
    for (let index = 0; index < count; index++) {
      const high = smoothstep(0.02, 0.55, dirs[index][1]) * grade;
      const tone: Vec3 = [lerp(1, 0.44, high), lerp(1, 0.8, high), lerp(1, 1.26, high)];
      for (let c = 0; c < 3; c++) {
        const again = paths[index][c] * (once[c] / total) * SECOND_BOUNCE;
        const k = SUN_POWER * SKY_GAIN * afterglow;
        air[index * 4 + c] = (air[index * 4 + c] + again) * k * tone[c];
        haze[index * 4 + c] *= k;
      }
    }
  }

  // The night sky's own faint light: bluer and a little brighter toward the horizon, more so
  // under a full moon.
  const moonGlow = 0.62 + 0.38 * moonLit;
  const nightZenith = scale([0.006, 0.012, 0.034], night * moonGlow);
  const nightHorizon = scale([0.022, 0.04, 0.086], night * moonGlow);

  /** Light scattered by the sun's light alone, before exposure. */
  const sunlit = (index: number): Vec3 => {
    const mie = Math.min(hazePhase(dot(dirs[index], simSun)), 1.2);
    return [0, 1, 2].map((c) => air[index * 4 + c] + haze[index * 4 + c] * mie) as Vec3;
  };
  const glow = (dir: Vec3): Vec3 => {
    const up = Math.sqrt(Math.max(0, dir[1]));
    return [0, 1, 2].map((c) => lerp(nightHorizon[c], nightZenith[c], up)) as Vec3;
  };

  // Exposure: by day the sunlit walls set it. As the sun sinks the sky takes over, and the picture
  // is allowed to grow darker, as dusk does.
  let mean = 0;
  let total = 0;
  for (let index = 0; index < count; index++) {
    mean += luma(sunlit(index)) * solid[index];
    total += solid[index];
  }
  mean /= total;
  const target = lerp(0.3, 0.2, smoothstep(0, -6, elevation)) * (afterglow > 0 ? 1 : 0);
  const bySky = mean > 1e-9 ? target / (mean / Math.max(afterglow, 1e-6)) : 1;
  const exposure = lerp(1, Math.min(bySky, 1e6), twilight);
  for (let i = 0; i < air.length; i++) {
    air[i] *= exposure;
    haze[i] *= exposure;
  }
  const radiance = (index: number): Vec3 => {
    const s = sunlit(index);
    const g = glow(dirs[index]);
    return [s[0] + g[0], s[1] + g[1], s[2] + g[2]];
  };

  // The sun itself, dimmed and reddened by the air it shines through. Under an overcast sky most
  // of its light arrives scattered by the clouds instead, from everywhere at once.
  const clouds = clamp01(input.clouds ?? 0.32);
  const overcast = smoothstep(0.5, 0.95, clouds);
  const through = sunTransmittance(sunDir);
  const clear = scale(through, SUN_POWER * exposure * smoothstep(-0.9, 0.4, elevation));
  const sun = scale(clear, 1 - 0.86 * overcast);
  const diffused = luma(clear) * Math.max(0, sunDir[1]) * 0.42 * overcast;
  const moon: Vec3 = scale([0.6, 0.74, 1], night * (0.16 + 0.4 * moonLit));
  const keyIsSun = elevation > -1.2 && luma(sun) > luma(moon);
  const keyColor = keyIsSun ? sun : moon;
  const keyDir = normalize(keyIsSun ? sunDir : moonDir);
  // Near the horizon the sun shines through so much air that its shadows blur.
  const keySize = keyIsSun ? lerp(0.05, 0.02, smoothstep(0, 18, elevation)) : 0.05;

  // Light from the whole sky on surfaces facing the six main directions. The moonlit scene gets
  // more of it than the dark sky alone would give, as the eye does at night.
  const fill = lerp(1.3, 3.4, night);
  let skyDown: Vec3 = [0, 0, 0];
  for (let index = 0; index < count; index++) {
    const l = radiance(index);
    const k = dirs[index][1] * solid[index];
    skyDown = [skyDown[0] + l[0] * k, skyDown[1] + l[1] * k, skyDown[2] + l[2] * k];
  }
  const lawn: Vec3 = [0.2, 0.22, 0.14];
  const ground = [0, 1, 2].map(
    (c) => (lawn[c] / Math.PI) * (keyColor[c] * Math.max(0, keyDir[1]) + skyDown[c] * fill),
  ) as Vec3;
  const axes: Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const ambient = axes.map((n) => {
    const sum: Vec3 = [0, 0, 0];
    for (let index = 0; index < count; index++) {
      const cos = dot(n, dirs[index]);
      if (cos <= 0) continue;
      const l = radiance(index);
      const k = cos * solid[index];
      sum[0] += l[0] * k;
      sum[1] += l[1] * k;
      sum[2] += l[2] * k;
    }
    // The half of the view below the horizon sees the ground.
    const below = n[1] < -0.5 ? Math.PI : n[1] > 0.5 ? 0 : Math.PI / 2;
    // Under cloud the sky's own blue gives way to grey light from all round.
    const grey = diffused * (n[1] > 0.5 ? 1 : n[1] < -0.5 ? 0.2 : 0.55);
    return [0, 1, 2].map(
      (c) => (sum[c] * fill * (1 - 0.5 * overcast) + ground[c] * below) / Math.PI + grey / Math.PI,
    ) as Vec3;
  }) as Sky['ambient'];

  // The sun's disc: very bright, but kept within what the bloom can take.
  const sunDisc = scale(through, Math.min(70, 2600 * exposure) * smoothstep(-1.2, -0.2, elevation) * (1 - overcast));
  const moonDisc: Vec3 = scale([0.94, 0.95, 1], night * 2.2);

  // For when the sky cannot be drawn in 3D: its colors toward the top and bottom of the picture.
  const view = ((((input.viewAzimuth * RAD + Math.PI) / (2 * Math.PI)) % 1) + 1) % 1;
  const sample = (el: number): Vec3 => {
    const j = Math.min(ENV_HEIGHT - 1, Math.floor(Math.sqrt(clamp01(el / 90)) * ENV_HEIGHT));
    const i = Math.min(ENV_WIDTH - 1, Math.floor(view * ENV_WIDTH));
    return radiance(j * ENV_WIDTH + i);
  };

  return {
    mode: elevation > 6 ? 'day' : elevation > -6 ? 'dusk' : 'night',
    elevation,
    sunDir,
    sunDisc,
    moonDir,
    moonPhase: phase,
    moonDisc,
    keyDir,
    keyColor,
    keySize,
    ambient,
    ground,
    air,
    haze,
    nightGlow: [nightHorizon, nightZenith],
    stars: night,
    // Lamps: easy to miss at noon, the main event at night.
    lamp: lerp(0.3, 1, smoothstep(14, -6, elevation)),
    clouds,
    cloudShift: (date.getTime() / 3600000) % 1000,
    css: [toCss(sample(42)), toCss(sample(3))],
  };
}
