// Minimal slice of the Home Assistant frontend types this card relies on.
// Mirrors home-assistant/frontend src/types.ts and src/data/*_registry.ts.

export interface HassEntityAttributes {
  friendly_name?: string;
  icon?: string;
  device_class?: string;
  unit_of_measurement?: string;
  restored?: boolean;
  [key: string]: unknown;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: HassEntityAttributes;
  last_changed: string;
  last_updated: string;
}

export type HassEntities = Record<string, HassEntity>;

export interface EntityRegistryDisplayEntry {
  entity_id: string;
  name?: string | null;
  icon?: string | null;
  device_id?: string | null;
  area_id?: string | null;
  labels?: string[];
  hidden?: boolean;
  entity_category?: 'config' | 'diagnostic' | null;
  translation_key?: string;
  platform?: string;
  has_entity_name?: boolean;
}

export interface DeviceRegistryEntry {
  id: string;
  area_id: string | null;
  name: string | null;
  name_by_user: string | null;
  manufacturer?: string | null;
  model?: string | null;
  model_id?: string | null;
  entry_type?: string | null;
}

export interface AreaRegistryEntry {
  area_id: string;
  name: string;
  floor_id?: string | null;
  icon?: string | null;
  picture?: string | null;
  aliases?: string[];
  labels?: string[];
}

export interface FloorRegistryEntry {
  floor_id: string;
  name: string;
  level: number | null;
  icon?: string | null;
  aliases?: string[];
}

export interface HassConfig {
  country?: string | null;
  language?: string;
  unit_system?: Record<string, string>;
}

export interface HomeAssistant {
  states: HassEntities;
  entities: Record<string, EntityRegistryDisplayEntry>;
  devices: Record<string, DeviceRegistryEntry>;
  areas: Record<string, AreaRegistryEntry>;
  floors?: Record<string, FloorRegistryEntry>;
  config?: HassConfig;
  themes?: { darkMode?: boolean; [key: string]: unknown };
  language?: string;
  locale?: { language: string; [key: string]: unknown };
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown>;
  callWS?<T>(msg: Record<string, unknown>): Promise<T>;
  formatEntityState?(stateObj: HassEntity, state?: string): string;
}

/** Light color modes, see homeassistant/components/light/const.py */
export type ColorMode =
  'onoff' | 'brightness' | 'color_temp' | 'hs' | 'xy' | 'rgb' | 'rgbw' | 'rgbww' | 'white' | 'unknown';

/** LightEntityFeature.EFFECT */
export const LIGHT_SUPPORT_EFFECT = 4;
