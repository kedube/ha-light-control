// Materials and lighting for the 3D house. Surfaces have a daylight color (albedo); the time of
// day and the lights in each room decide how bright they look.

import { clamp, type RGB } from '../color.ts';

export type SkyMode = 'day' | 'dusk' | 'night';

export const MATERIAL = {
  // Floors
  oak: [185, 139, 96],
  lightOak: [214, 182, 140],
  walnut: [128, 88, 60],
  tile: [220, 224, 227],
  slate: [128, 136, 145],
  carpet: [176, 166, 153],
  concrete: [168, 170, 172],
  // Walls
  plaster: [240, 237, 231],
  wallCut: [250, 249, 246],
  siding: [236, 233, 226],
  trim: [252, 252, 250],
  plinth: [150, 146, 139],
  roof: [78, 84, 94],
  roofEdge: [58, 63, 71],
  brick: [150, 86, 70],
  door: [70, 86, 110],
  garageDoor: [228, 229, 226],
  // Furniture
  fabric: [109, 124, 145],
  fabricWarm: [199, 184, 163],
  linen: [244, 243, 240],
  blanket: [132, 160, 196],
  blanketWarm: [196, 132, 120],
  wood: [140, 96, 62],
  darkWood: [92, 62, 41],
  white: [245, 245, 244],
  counter: [60, 64, 70],
  steel: [196, 200, 205],
  screen: [26, 29, 34],
  rugBlue: [112, 134, 160],
  rugSand: [196, 176, 146],
  rugRose: [196, 150, 150],
  leaf: [84, 140, 78],
  leafDark: [58, 108, 64],
  pot: [192, 122, 84],
  car: [178, 52, 46],
  tire: [34, 36, 40],
  water: [120, 196, 226],
  grass: [126, 178, 92],
  path: [206, 200, 190],
  asphalt: [96, 100, 106],
  deck: [170, 124, 84],
  bark: [110, 82, 60],
  lampPost: [70, 76, 86],
  shade: [240, 230, 210],
} satisfies Record<string, RGB>;

export type Material = keyof typeof MATERIAL;

export interface Environment {
  mode: SkyMode;
  /** Light that falls everywhere (sky, moon), per channel 0–1. */
  ambient: [number, number, number];
  /** How strongly a room's lamps light its surfaces. Lamps barely show in daylight. */
  lamp: number;
  /** Brightness of faces by orientation. */
  top: number;
  left: number;
  right: number;
  sky: [string, string];
  horizon: string;
  /** The holographic accent: platform rim, grid, selection. */
  holo: RGB;
  holoAlpha: number;
  glassDay: [string, string];
  platformSide: RGB;
  stars: boolean;
}

export function environment(mode: SkyMode, sunLeft: boolean): Environment {
  const lit = 0.97;
  const shaded = 0.74;
  switch (mode) {
    case 'day':
      return {
        mode,
        ambient: [1, 1, 1],
        lamp: 0.22,
        top: 1,
        left: sunLeft ? lit : shaded,
        right: sunLeft ? shaded : lit,
        sky: ['#9fcbf5', '#e9f3fc'],
        horizon: '#f4f8fc',
        holo: [40, 130, 230],
        holoAlpha: 0.55,
        glassDay: ['#b9d7f1', '#6f98c2'],
        platformSide: [214, 221, 229],
        stars: false,
      };
    case 'dusk':
      return {
        mode,
        ambient: [0.62, 0.52, 0.58],
        lamp: 0.62,
        top: 1,
        left: sunLeft ? 0.95 : 0.7,
        right: sunLeft ? 0.7 : 0.95,
        sky: ['#2b2a5c', '#f0a174'],
        horizon: '#f6b88c',
        holo: [120, 200, 255],
        holoAlpha: 0.7,
        glassDay: ['#8d7fa6', '#45406c'],
        platformSide: [96, 88, 112],
        stars: false,
      };
    default:
      return {
        mode,
        ambient: [0.2, 0.235, 0.33],
        lamp: 1,
        top: 1,
        left: 0.9,
        right: 0.76,
        sky: ['#030712', '#0d1b36'],
        horizon: '#12264a',
        holo: [86, 204, 255],
        holoAlpha: 1,
        glassDay: ['#1d2a40', '#0c1422'],
        platformSide: [22, 32, 50],
        stars: true,
      };
  }
}

export interface Lamp {
  /** 0–255 color of the light. */
  rgb: RGB;
  /** 0–1 how much light it casts on the room. */
  intensity: number;
}

const hex2 = (v: number) =>
  Math.round(clamp(v, 0, 255))
    .toString(16)
    .padStart(2, '0');
export const css = (rgb: readonly number[]): string => `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;

/** The color a surface shows under the ambient light plus, inside a room, its lamps. */
export function lit(albedo: RGB, k: number, env: Environment, lamp?: Lamp | null): string {
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let light = env.ambient[i] * k;
    if (lamp && lamp.intensity > 0) light += (lamp.rgb[i] / 255) * lamp.intensity * env.lamp * (0.55 + 0.45 * k);
    // Soft shoulder, so strong light saturates instead of clipping.
    const value = albedo[i] * (light > 1 ? 1 + (light - 1) * 0.35 : light);
    out[i] = value;
  }
  return css(out);
}

/** A light source's own color, lifted toward white at its hot center. */
export function glowColor(rgb: RGB, whiten = 0.35): string {
  return css(rgb.map((v) => v + (255 - v) * whiten));
}
