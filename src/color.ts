export type RGB = [number, number, number];

/** Glow used for lights that are on but report no color (brightness-only or on/off bulbs). */
export const WARM_GLOW: RGB = [255, 196, 116];

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Approximates the color of a black-body radiator (Tanner Helland), as used by HA's color_util. */
export function kelvinToRgb(kelvin: number): RGB {
  const temp = clamp(kelvin, 1000, 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (temp - 60) ** -0.1332047592;
    g = 288.1221695283 * (temp - 60) ** -0.0755148492;
    b = 255;
  }
  return [r, g, b].map((v) => Math.round(clamp(v, 0, 255))) as RGB;
}

/** Hue 0–360, saturation 0–100, at full value. */
export function hsToRgb(hue: number, saturation: number): RGB {
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = clamp(saturation, 0, 100) / 100;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = 1 - c;
  const [r, g, b] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map((v) => Math.round(v * 255)) as RGB;
}

/** Returns [hue 0–360, saturation 0–100] for an RGB color, ignoring its value. */
export function rgbToHs([r, g, b]: RGB): [number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (max === 0 || delta === 0) return [0, 0];
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return [Math.round(hue), Math.round((delta / max) * 100)];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
}

/** "r, g, b" for use inside rgba(var(--x), alpha). */
export const rgbTriplet = (rgb: RGB): string => rgb.join(', ');

/** Brightness-weighted average of several light colors; null when nothing is lit. */
export function averageRgb(items: { rgb: RGB; weight: number }[]): RGB | null {
  let total = 0;
  const sum = [0, 0, 0];
  for (const { rgb, weight } of items) {
    if (weight <= 0) continue;
    total += weight;
    for (let i = 0; i < 3; i++) sum[i] += rgb[i] * weight;
  }
  if (!total) return null;
  return sum.map((v) => Math.round(v / total)) as RGB;
}

/**
 * Pale colors (white light) vanish on light backgrounds. For icons and text accents on a light
 * theme, shift them toward a warm amber so "on" still reads as on.
 */
export function accentFor(rgb: RGB, dark: boolean): RGB {
  if (dark) return rgb;
  const lum = luminance(rgb);
  if (lum < 0.45) return rgb;
  return mixRgb(rgb, [196, 120, 20], clamp((lum - 0.45) * 1.6, 0, 0.75));
}

export const miredToKelvin = (mired: number): number => Math.round(1_000_000 / mired);

/**
 * Color used to *draw* a white temperature in pickers. Physically, 6500 K is near-neutral white,
 * which is invisible on a light background; a touch of blue makes the warm-to-cool scale readable.
 */
export function kelvinToDisplayRgb(kelvin: number): RGB {
  const rgb = kelvinToRgb(kelvin);
  const cool = clamp((kelvin - 4200) / 2300, 0, 1);
  return cool ? mixRgb(rgb, [178, 205, 255], cool * 0.55) : rgb;
}

export interface KelvinPreset {
  kelvin: number;
  key: 'candle' | 'warm' | 'soft' | 'neutral' | 'daylight' | 'cool';
}

export const KELVIN_PRESETS: KelvinPreset[] = [
  { kelvin: 2200, key: 'candle' },
  { kelvin: 2700, key: 'warm' },
  { kelvin: 3000, key: 'soft' },
  { kelvin: 4000, key: 'neutral' },
  { kelvin: 5000, key: 'daylight' },
  { kelvin: 6500, key: 'cool' },
];

export interface HuePreset {
  hs: [number, number];
  key: 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink';
}

export const HUE_PRESETS: HuePreset[] = [
  { hs: [0, 90], key: 'red' },
  { hs: [26, 95], key: 'orange' },
  { hs: [48, 90], key: 'yellow' },
  { hs: [120, 75], key: 'green' },
  { hs: [175, 80], key: 'teal' },
  { hs: [225, 85], key: 'blue' },
  { hs: [275, 75], key: 'purple' },
  { hs: [325, 65], key: 'pink' },
];

/** Nearest named white for a color temperature. */
export function kelvinPresetKey(kelvin: number): KelvinPreset['key'] {
  let best = KELVIN_PRESETS[0];
  for (const preset of KELVIN_PRESETS) {
    if (Math.abs(preset.kelvin - kelvin) < Math.abs(best.kelvin - kelvin)) best = preset;
  }
  return best.key;
}
