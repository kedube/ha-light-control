import { hsToRgb, kelvinToRgb, miredToKelvin, WARM_GLOW, type RGB } from './color.ts';
import { LIGHT_SUPPORT_EFFECT, type HassEntity } from './ha-types.ts';

export type EntityKind = 'light' | 'outlet' | 'switch';

/** Optimistic state shown between a user action and Home Assistant confirming it. */
export interface Override {
  on?: boolean;
  brightness?: number;
  hs?: [number, number];
  kelvin?: number;
  expires: number;
}

export interface EntityView {
  entityId: string;
  kind: EntityKind;
  on: boolean;
  unavailable: boolean;
  /** 0–100. 0 when off; 100 when on for entities without dimming. */
  brightness: number;
  dimmable: boolean;
  supportsColor: boolean;
  supportsTemp: boolean;
  supportsWhite: boolean;
  effects: string[];
  effect?: string;
  colorMode?: string;
  /** Color of the light when on (neutral warm glow when it has no color). */
  rgb: RGB;
  hs?: [number, number];
  kelvin?: number;
  minKelvin: number;
  maxKelvin: number;
  isGroup: boolean;
}

const DIMMABLE_MODES = ['brightness', 'color_temp', 'hs', 'xy', 'rgb', 'rgbw', 'rgbww', 'white'];
const COLOR_MODES = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];

export const computeDomain = (entityId: string): string => entityId.slice(0, entityId.indexOf('.'));

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asPair = (value: unknown): [number, number] | undefined =>
  Array.isArray(value) && value.length >= 2 && value.every((v) => typeof v === 'number')
    ? [value[0], value[1]]
    : undefined;

export function isLightGroup(stateObj: HassEntity): boolean {
  const attrs = stateObj.attributes;
  return (Array.isArray(attrs.entity_id) && attrs.entity_id.length > 0) || attrs.is_hue_group === true;
}

export function isOn(stateObj: HassEntity | undefined): boolean {
  return stateObj?.state === 'on';
}

export function isUnavailable(stateObj: HassEntity | undefined): boolean {
  return !stateObj || stateObj.state === 'unavailable';
}

export function entityView(stateObj: HassEntity, kind: EntityKind, override?: Override): EntityView {
  const attrs = stateObj.attributes;
  const unavailable = isUnavailable(stateObj);
  let on = override?.on ?? stateObj.state === 'on';
  if (unavailable) on = false;

  const base: EntityView = {
    entityId: stateObj.entity_id,
    kind,
    on,
    unavailable,
    brightness: on ? 100 : 0,
    dimmable: false,
    supportsColor: false,
    supportsTemp: false,
    supportsWhite: false,
    effects: [],
    rgb: WARM_GLOW,
    minKelvin: 2000,
    maxKelvin: 6500,
    isGroup: false,
  };
  if (kind !== 'light') return base;

  const modes = Array.isArray(attrs.supported_color_modes)
    ? (attrs.supported_color_modes as string[])
    : attrs.brightness !== undefined
      ? ['brightness']
      : ['onoff'];
  const dimmable = modes.some((m) => DIMMABLE_MODES.includes(m));
  const supportsColor = modes.some((m) => COLOR_MODES.includes(m));
  const supportsTemp = modes.includes('color_temp');
  const features = asNumber(attrs.supported_features) ?? 0;
  const effects =
    features & LIGHT_SUPPORT_EFFECT && Array.isArray(attrs.effect_list)
      ? (attrs.effect_list as unknown[]).filter((e): e is string => typeof e === 'string')
      : [];

  const minMireds = asNumber(attrs.min_mireds);
  const maxMireds = asNumber(attrs.max_mireds);
  const minKelvin = asNumber(attrs.min_color_temp_kelvin) ?? (maxMireds ? miredToKelvin(maxMireds) : 2000);
  const maxKelvin = asNumber(attrs.max_color_temp_kelvin) ?? (minMireds ? miredToKelvin(minMireds) : 6500);

  const rawBrightness = asNumber(attrs.brightness);
  let brightness = on
    ? dimmable && rawBrightness !== undefined
      ? Math.max(1, Math.round((rawBrightness / 255) * 100))
      : 100
    : 0;
  if (override?.brightness !== undefined) brightness = override.brightness;

  const colorTempMireds = asNumber(attrs.color_temp);
  let kelvin = asNumber(attrs.color_temp_kelvin) ?? (colorTempMireds ? miredToKelvin(colorTempMireds) : undefined);
  let hs = asPair(attrs.hs_color);
  let colorMode = typeof attrs.color_mode === 'string' ? attrs.color_mode : undefined;
  const stateRgb = attrs.rgb_color;
  let rgb: RGB =
    Array.isArray(stateRgb) && stateRgb.length === 3
      ? (stateRgb as RGB)
      : kelvin
        ? kelvinToRgb(kelvin)
        : hs
          ? hsToRgb(hs[0], hs[1])
          : WARM_GLOW;

  if (override?.hs) {
    hs = override.hs;
    rgb = hsToRgb(hs[0], hs[1]);
    colorMode = 'hs';
  } else if (override?.kelvin) {
    kelvin = override.kelvin;
    rgb = kelvinToRgb(kelvin);
    colorMode = 'color_temp';
  }
  if (!supportsColor && !supportsTemp) rgb = WARM_GLOW;

  return {
    ...base,
    brightness,
    dimmable,
    supportsColor,
    supportsTemp,
    supportsWhite: modes.includes('white'),
    effects,
    effect: typeof attrs.effect === 'string' ? attrs.effect : undefined,
    colorMode,
    rgb,
    hs,
    kelvin,
    minKelvin: Math.min(minKelvin, maxKelvin),
    maxKelvin: Math.max(minKelvin, maxKelvin),
    isGroup: isLightGroup(stateObj),
  };
}

/**
 * True once Home Assistant's state agrees with an optimistic override (or it has expired).
 * `view` must be built from the raw state, without the override applied.
 */
export function overrideSettled(override: Override, view: EntityView, now: number): boolean {
  if (now > override.expires) return true;
  if (override.on !== undefined && override.on !== view.on) return false;
  if (
    override.brightness !== undefined &&
    override.brightness > 0 &&
    Math.abs(override.brightness - view.brightness) > 2
  ) {
    return false;
  }
  if (override.kelvin !== undefined && (!view.kelvin || Math.abs(override.kelvin - view.kelvin) > 60)) return false;
  if (override.hs !== undefined) {
    if (!view.hs) return false;
    const hueDelta = Math.abs(((override.hs[0] - view.hs[0] + 540) % 360) - 180);
    if (hueDelta > 4 || Math.abs(override.hs[1] - view.hs[1]) > 4) return false;
  }
  return true;
}
