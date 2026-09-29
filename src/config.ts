export type OutletDetection = 'smart' | 'device_class' | 'all_switches';
export type TapAction = 'toggle' | 'controls' | 'more-info';
export type IconStyle = 'auto' | 'graphic' | 'entity';

export interface LightControlCardConfig {
  type: string;
  title?: string;
  show_house?: boolean;
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

export type ResolvedConfig = Required<Omit<LightControlCardConfig, 'title' | 'unassigned_name'>> & {
  title: string;
  unassigned_name?: string;
};

export const DEFAULTS: Omit<ResolvedConfig, 'type'> = {
  title: 'Lights',
  show_house: true,
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
};

const LISTS = ['areas', 'floors', 'exclude_areas', 'include', 'exclude', 'exclude_patterns'] as const;

const BOOLEANS = [
  'show_house',
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

  return {
    ...DEFAULTS,
    ...raw,
    ...lists,
    title: typeof raw.title === 'string' ? raw.title : DEFAULTS.title,
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
