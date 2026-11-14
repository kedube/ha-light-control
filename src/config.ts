import type { RGB } from './color.ts';
import { STYLE_NAMES, type StyleName } from './house/materials.ts';

export type OutletDetection = 'smart' | 'device_class' | 'all_switches';
export type TapAction = 'toggle' | 'controls' | 'more-info';
export type IconStyle = 'auto' | 'graphic' | 'entity';
export type HouseStyleOption = 'auto' | StyleName;
export type HouseFacing = 'auto' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
/** A color in the YAML: '#rrggbb', '#rgb' or [r, g, b]. */
export type ColorValue = string | number[];

export const COLOR_KEYS = ['house_color', 'roof_color', 'trim_color', 'door_color'] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

export interface LightControlCardConfig {
  type: string;
  title?: string;
  show_house?: boolean;
  /** How the 3D house is built; 'auto' follows the country Home Assistant is set to. */
  house_style?: HouseStyleOption;
  /** Colors for the house, as '#rrggbb' or [r, g, b]; each defaults to the style's own. */
  house_color?: ColorValue;
  roof_color?: ColorValue;
  trim_color?: ColorValue;
  door_color?: ColorValue;
  /** The compass direction the front of the house faces; 'auto' turns it toward the sun. */
  house_facing?: HouseFacing;
  /** Whether the sky moves: clouds drift, stars twinkle. */
  animate_sky?: boolean;
  /** Whether the clouds over the house follow a weather entity. */
  sky_weather?: boolean;
  /** The weather entity to follow; the first one found when left out. */
  weather_entity?: string;
  show_summary?: boolean;
  show_room_filter?: boolean;
  show_outlets?: boolean;
  outlet_detection?: OutletDetection;
  show_unassigned?: boolean;
  show_unavailable?: boolean;
  show_light_groups?: boolean;
  show_scenes?: boolean;
  strip_area_names?: boolean;
  icon_style?: IconStyle;
  areas?: string[];
  floors?: string[];
  exclude_areas?: string[];
  include?: string[];
  exclude?: string[];
  exclude_patterns?: string[];
  tap_action?: TapAction;
  /**
   * @deprecated Outlets now have their own switches for every room, floor and the whole home, so
   * the lights switches never touch them. Still accepted, so existing dashboards keep loading.
   */
  room_switch_outlets?: boolean;
  live_brightness?: boolean;
  unassigned_name?: string;
}

export type ResolvedConfig = Required<
  Omit<LightControlCardConfig, 'title' | 'unassigned_name' | 'weather_entity' | ColorKey>
> & {
  /** Undefined means the default title, "Lights" in the user's language; '' hides it. */
  title?: string;
  unassigned_name?: string;
  weather_entity?: string;
} & { [K in ColorKey]?: RGB };

export const DEFAULTS: Omit<ResolvedConfig, 'type'> = {
  show_house: true,
  house_style: 'auto',
  house_facing: 'auto',
  sky_weather: true,
  animate_sky: true,
  show_summary: true,
  show_room_filter: true,
  show_outlets: true,
  outlet_detection: 'smart',
  show_unassigned: true,
  show_unavailable: true,
  show_light_groups: true,
  show_scenes: true,
  strip_area_names: true,
  icon_style: 'auto',
  areas: [],
  floors: [],
  exclude_areas: [],
  include: [],
  exclude: [],
  exclude_patterns: [],
  tap_action: 'toggle',
  room_switch_outlets: false,
  live_brightness: false,
};

const ENUMS: Record<string, readonly string[]> = {
  outlet_detection: ['smart', 'device_class', 'all_switches'],
  tap_action: ['toggle', 'controls', 'more-info'],
  icon_style: ['auto', 'graphic', 'entity'],
  house_style: ['auto', ...STYLE_NAMES],
  house_facing: ['auto', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'],
};

const LISTS = ['areas', 'floors', 'exclude_areas', 'include', 'exclude', 'exclude_patterns'] as const;

const BOOLEANS = [
  'show_house',
  'sky_weather',
  'animate_sky',
  'show_summary',
  'show_room_filter',
  'show_outlets',
  'show_unassigned',
  'show_unavailable',
  'show_light_groups',
  'show_scenes',
  'strip_area_names',
  'room_switch_outlets',
  'live_brightness',
] as const;

/** Reads a color from the YAML: '#rrggbb', '#rgb' or [r, g, b]. Undefined when it is neither. */
export function parseColor(value: unknown): RGB | undefined {
  if (Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && v >= 0 && v <= 255)) {
    return value.map((v) => Math.round(v)) as RGB;
  }
  if (typeof value !== 'string') return undefined;
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) return [...hex].map((c) => Number.parseInt(c + c, 16)) as RGB;
  if (/^[0-9a-f]{6}$/i.test(hex)) return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as RGB;
  return undefined;
}

/** Validates a raw card config and fills in defaults. Throws with a readable message on bad input. */
export function resolveConfig(raw: LightControlCardConfig): ResolvedConfig {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid configuration');
  const input = raw as unknown as Record<string, unknown>;

  for (const key of BOOLEANS) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      throw new Error(`"${key}" must be true or false`);
    }
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (input[key] !== undefined && !allowed.includes(input[key] as string)) {
      throw new Error(`"${key}" must be one of: ${allowed.join(', ')}`);
    }
  }
  const lists: Partial<Record<(typeof LISTS)[number], string[]>> = {};
  for (const key of LISTS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    const list = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(list) || list.some((v) => typeof v !== 'string')) {
      throw new Error(`"${key}" must be a list of strings`);
    }
    lists[key] = list.map((v) => v.trim()).filter(Boolean);
  }
  if (input.title !== undefined && input.title !== null && typeof input.title !== 'string') {
    throw new Error('"title" must be text');
  }
  if (input.weather_entity !== undefined && input.weather_entity !== null && typeof input.weather_entity !== 'string') {
    throw new Error('"weather_entity" must be an entity id');
  }
  const colors: Partial<Record<ColorKey, RGB>> = {};
  for (const key of COLOR_KEYS) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    const color = parseColor(value);
    if (!color) throw new Error(`"${key}" must be a color like "#aabbcc" or [170, 187, 204]`);
    colors[key] = color;
  }

  return {
    ...DEFAULTS,
    ...raw,
    ...lists,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    weather_entity: raw.weather_entity || undefined,
    house_color: colors.house_color,
    roof_color: colors.roof_color,
    trim_color: colors.trim_color,
    door_color: colors.door_color,
  } as ResolvedConfig;
}

/** Glob-style pattern: `*` matches any run of characters, `?` a single character. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Builds a predicate for exclude patterns. Patterns with a domain ("switch.*_led") match the
 * full entity id; bare patterns ("*_led") match the object id, so they apply to every domain.
 */
export function makeEntityMatcher(patterns: string[]): (entityId: string) => boolean {
  const compiled = patterns.map((p) => ({ re: globToRegExp(p), bare: !p.includes('.') }));
  if (!compiled.length) return () => false;
  return (entityId) => {
    const objectId = entityId.slice(entityId.indexOf('.') + 1);
    return compiled.some(({ re, bare }) => re.test(bare ? objectId : entityId));
  };
}
