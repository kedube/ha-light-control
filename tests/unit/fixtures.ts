import { resolveConfig, type LightControlCardConfig, type ResolvedConfig } from '../../src/config.ts';
import type {
  AreaRegistryEntry,
  DeviceRegistryEntry,
  EntityRegistryDisplayEntry,
  FloorRegistryEntry,
  HassEntity,
  HomeAssistant,
} from '../../src/ha-types.ts';

export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

export function state(entityId: string, value: string, attributes: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id: entityId,
    state: value,
    attributes,
    last_changed: '2026-09-24T12:00:00Z',
    last_updated: '2026-09-24T12:00:00Z',
  };
}

export function config(overrides: Partial<LightControlCardConfig> = {}): ResolvedConfig {
  return resolveConfig({ type: 'custom:light-control-card', ...overrides });
}

interface HomeOptions {
  states?: HassEntity[];
  entities?: EntityRegistryDisplayEntry[];
  devices?: DeviceRegistryEntry[];
  areas?: AreaRegistryEntry[];
  floors?: FloorRegistryEntry[];
  calls?: ServiceCall[];
  failServices?: boolean;
}

const area = (
  area_id: string,
  name: string,
  floor_id: string | null = null,
  icon: string | null = null,
): AreaRegistryEntry => ({
  area_id,
  name,
  floor_id,
  icon,
});

const device = (
  id: string,
  name: string,
  area_id: string | null,
  model: string | null = null,
): DeviceRegistryEntry => ({
  id,
  name,
  name_by_user: null,
  area_id,
  model,
});

const entity = (entity_id: string, extra: Partial<EntityRegistryDisplayEntry> = {}): EntityRegistryDisplayEntry => ({
  entity_id,
  labels: [],
  ...extra,
});

/** A small home that exercises every discovery rule. */
export function home(options: HomeOptions = {}): HomeAssistant {
  const floors = options.floors ?? [
    { floor_id: 'ground', name: 'Ground Floor', level: 0 },
    { floor_id: 'upstairs', name: 'Upstairs', level: 1 },
  ];
  const areas = options.areas ?? [
    area('living_room', 'Living Room', 'ground', 'mdi:sofa'),
    area('kitchen', 'Kitchen', 'ground'),
    area('bedroom', 'Bedroom', 'upstairs'),
    area('garden', 'Garden'),
    area('empty', 'Empty Room', 'upstairs'),
  ];
  const devices = options.devices ?? [
    device('tv_plug', 'TV Plug', 'living_room', 'Smart Plug'),
    device('coffee', 'Coffee Maker', 'kitchen', 'Mini Smart Plug'),
    device('pc', 'Desktop PC', 'bedroom', 'Wake on LAN'),
    device('strip', 'Power Strip', 'bedroom', 'Power Strip'),
    device('kitchen_switch', 'Kitchen Switch', 'kitchen', 'Dimmer'),
  ];
  const entities = options.entities ?? [
    entity('light.living_room_lamp', { area_id: 'living_room' }),
    entity('light.living_room_ceiling', { area_id: 'living_room' }),
    entity('light.kitchen', { area_id: 'kitchen' }),
    entity('light.kitchen_led', { device_id: 'kitchen_switch', entity_category: 'config' }),
    entity('light.bedroom', { area_id: 'bedroom' }),
    entity('light.bedroom_hidden', { area_id: 'bedroom', hidden: true }),
    entity('light.bedroom_group', { area_id: 'bedroom' }),
    entity('light.garden', { area_id: 'garden' }),
    entity('light.orphan', { area_id: 'kitchen' }),
    entity('light.no_area'),
    entity('switch.tv_plug', { device_id: 'tv_plug' }),
    entity('sensor.tv_plug_power', { device_id: 'tv_plug' }),
    entity('sensor.tv_plug_energy', { device_id: 'tv_plug' }),
    entity('switch.coffee_maker', { device_id: 'coffee' }),
    entity('switch.coffee_maker_child_lock', { device_id: 'coffee' }),
    entity('switch.desktop_pc', { device_id: 'pc' }),
    entity('switch.strip_outlet_1', { device_id: 'strip' }),
    entity('switch.strip_outlet_2', { device_id: 'strip' }),
    entity('sensor.strip_power', { device_id: 'strip' }),
    entity('scene.living_room_movie', { area_id: 'living_room' }),
  ];
  const states = options.states ?? [
    state('light.living_room_lamp', 'on', {
      friendly_name: 'Living Room Lamp',
      supported_color_modes: ['hs', 'color_temp'],
      color_mode: 'hs',
      brightness: 128,
      hs_color: [30, 80],
      rgb_color: [255, 160, 51],
      min_color_temp_kelvin: 2200,
      max_color_temp_kelvin: 6500,
    }),
    state('light.living_room_ceiling', 'off', {
      friendly_name: 'Living Room Ceiling',
      supported_color_modes: ['brightness'],
    }),
    state('light.kitchen', 'on', { friendly_name: 'Kitchen', supported_color_modes: ['onoff'], color_mode: 'onoff' }),
    state('light.kitchen_led', 'on', { friendly_name: 'Kitchen Switch LED', supported_color_modes: ['onoff'] }),
    state('light.bedroom', 'on', {
      friendly_name: 'Bedroom Light',
      supported_color_modes: ['color_temp'],
      color_mode: 'color_temp',
      brightness: 51,
      color_temp_kelvin: 2700,
    }),
    state('light.bedroom_hidden', 'off', { friendly_name: 'Bedroom Hidden' }),
    state('light.bedroom_group', 'on', {
      friendly_name: 'Bedroom Lights',
      supported_color_modes: ['brightness'],
      brightness: 51,
      entity_id: ['light.bedroom'],
    }),
    state('light.garden', 'unavailable', { friendly_name: 'Garden Path', supported_color_modes: ['brightness'] }),
    state('light.orphan', 'unavailable', { friendly_name: 'Old Bulb', restored: true }),
    state('light.no_area', 'off', { friendly_name: 'Christmas Tree', supported_color_modes: ['onoff'] }),
    state('switch.tv_plug', 'on', { friendly_name: 'TV Plug', device_class: 'outlet' }),
    state('sensor.tv_plug_power', '86.4', { device_class: 'power', unit_of_measurement: 'W' }),
    state('sensor.tv_plug_energy', '12.8', { device_class: 'energy', unit_of_measurement: 'kWh' }),
    state('switch.coffee_maker', 'off', { friendly_name: 'Coffee Maker' }),
    state('switch.coffee_maker_child_lock', 'off', { friendly_name: 'Coffee Maker Child lock' }),
    state('switch.desktop_pc', 'off', { friendly_name: 'Desktop PC' }),
    state('switch.strip_outlet_1', 'on', { friendly_name: 'Power Strip Outlet 1' }),
    state('switch.strip_outlet_2', 'off', { friendly_name: 'Power Strip Outlet 2' }),
    state('sensor.strip_power', '40', { device_class: 'power', unit_of_measurement: 'W' }),
    state('scene.living_room_movie', '2026-09-24T12:00:00Z', { friendly_name: 'Living Room Movie' }),
    state('input_boolean.guest_mode', 'off', { friendly_name: 'Guest Mode' }),
    state('sun.sun', 'below_horizon', { elevation: -10, azimuth: 300 }),
  ];
  const calls = options.calls ?? [];
  const byId = <T, K extends keyof T>(list: T[], key: K) =>
    Object.fromEntries(list.map((item) => [item[key] as unknown as string, item]));
  return {
    states: byId(states, 'entity_id'),
    entities: byId(entities, 'entity_id'),
    devices: byId(devices, 'id'),
    areas: byId(areas, 'area_id'),
    floors: byId(floors, 'floor_id'),
    config: { country: 'US' },
    themes: { darkMode: true },
    language: 'en',
    locale: { language: 'en' },
    callService: async (domain, service, data = {}) => {
      calls.push({ domain, service, data });
      if (options.failServices) throw new Error('Service failed');
    },
  };
}
