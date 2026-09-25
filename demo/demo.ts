// A simulated Home Assistant for the demo page, screenshots and end-to-end tests.
// Nothing here ships in dist/; it only feeds the real card a believable `hass` object.
import {
  mdiBed,
  mdiBedOutline,
  mdiChandelier,
  mdiDesk,
  mdiDeskLamp,
  mdiDoor,
  mdiFan,
  mdiFloorLamp,
  mdiGarage,
  mdiHomeLightbulbOutline,
  mdiHomeRoof,
  mdiLightbulb,
  mdiOutdoorLamp,
  mdiPineTree,
  mdiShower,
  mdiSilverwareForkKnife,
  mdiSofa,
  mdiStairs,
  mdiStairsDown,
  mdiStove,
  mdiStringLights,
  mdiTeddyBear,
  mdiTelevision,
  mdiTextureBox,
  mdiToggleSwitch,
  mdiToggleSwitchOff,
  mdiTree,
  mdiWashingMachine,
} from '@mdi/js';
import { hsToRgb, kelvinToRgb, rgbToHs } from '../src/color.ts';
import type {
  AreaRegistryEntry,
  DeviceRegistryEntry,
  EntityRegistryDisplayEntry,
  FloorRegistryEntry,
  HassEntity,
  HomeAssistant,
} from '../src/ha-types.ts';

// ─── Stand-ins for Home Assistant's own elements ──────────────────────────────

// Only the icons this simulated home uses; the real card gets every icon from Home Assistant.
const ICONS: Record<string, string> = {
  'mdi:bed': mdiBed,
  'mdi:bed-outline': mdiBedOutline,
  'mdi:chandelier': mdiChandelier,
  'mdi:desk': mdiDesk,
  'mdi:desk-lamp': mdiDeskLamp,
  'mdi:door': mdiDoor,
  'mdi:fan': mdiFan,
  'mdi:floor-lamp': mdiFloorLamp,
  'mdi:garage': mdiGarage,
  'mdi:home-lightbulb-outline': mdiHomeLightbulbOutline,
  'mdi:home-roof': mdiHomeRoof,
  'mdi:lightbulb': mdiLightbulb,
  'mdi:outdoor-lamp': mdiOutdoorLamp,
  'mdi:pine-tree': mdiPineTree,
  'mdi:shower': mdiShower,
  'mdi:silverware-fork-knife': mdiSilverwareForkKnife,
  'mdi:sofa': mdiSofa,
  'mdi:stairs': mdiStairs,
  'mdi:stairs-down': mdiStairsDown,
  'mdi:stove': mdiStove,
  'mdi:string-lights': mdiStringLights,
  'mdi:teddy-bear': mdiTeddyBear,
  'mdi:television': mdiTelevision,
  'mdi:texture-box': mdiTextureBox,
  'mdi:toggle-switch': mdiToggleSwitch,
  'mdi:toggle-switch-off': mdiToggleSwitchOff,
  'mdi:tree': mdiTree,
  'mdi:washing-machine': mdiWashingMachine,
};

function iconPath(name: string | undefined): string {
  return (name && ICONS[name]) || mdiLightbulb;
}

class DemoHaIcon extends HTMLElement {
  static observedAttributes = ['icon'];
  private _icon?: string;
  set icon(value: string | undefined) {
    this._icon = value;
    this.draw();
  }
  get icon() {
    return this._icon;
  }
  connectedCallback() {
    this.draw();
  }
  attributeChangedCallback() {
    this._icon = this.getAttribute('icon') ?? undefined;
    this.draw();
  }
  private draw() {
    this.style.display = 'inline-flex';
    this.innerHTML = `<svg viewBox="0 0 24 24" style="width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);fill:currentColor"><path d="${iconPath(this._icon)}"></path></svg>`;
  }
}

class DemoStateIcon extends HTMLElement {
  hass?: HomeAssistant;
  private _stateObj?: HassEntity;
  set stateObj(value: HassEntity | undefined) {
    this._stateObj = value;
    this.draw();
  }
  get stateObj() {
    return this._stateObj;
  }
  connectedCallback() {
    this.draw();
  }
  private draw() {
    const s = this._stateObj;
    if (!s) return;
    const domain = s.entity_id.split('.')[0];
    const on = s.state === 'on';
    const fallback =
      domain === 'switch' || domain === 'input_boolean'
        ? on
          ? 'mdi:toggle-switch'
          : 'mdi:toggle-switch-off'
        : domain === 'fan'
          ? 'mdi:fan'
          : 'mdi:lightbulb';
    const name = this.hass?.entities[s.entity_id]?.icon ?? (s.attributes.icon as string | undefined) ?? fallback;
    this.style.display = 'inline-flex';
    this.innerHTML = `<svg viewBox="0 0 24 24" style="width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);fill:currentColor"><path d="${iconPath(name)}"></path></svg>`;
  }
}

class DemoCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `<style>
      :host{display:block;background:var(--ha-card-background,var(--card-background-color));color:var(--primary-text-color);
        border-radius:var(--ha-card-border-radius,12px);border:1px solid var(--divider-color);box-shadow:var(--ha-card-box-shadow,none)}
    </style><slot></slot>`;
  }
}

customElements.define('ha-icon', DemoHaIcon);
customElements.define('ha-state-icon', DemoStateIcon);
customElements.define('ha-card', DemoCard);

// ─── The simulated home ───────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const E2E = params.has('e2e');
const LATENCY = E2E ? 0 : 140;

const floors: Record<string, FloorRegistryEntry> = {
  ground: { floor_id: 'ground', name: 'Ground Floor', level: 0, icon: 'mdi:home-floor-0' },
  upstairs: { floor_id: 'upstairs', name: 'Upstairs', level: 1, icon: 'mdi:home-floor-1' },
  basement: { floor_id: 'basement', name: 'Basement', level: -1, icon: 'mdi:home-floor-negative-1' },
};

const area = (
  area_id: string,
  name: string,
  floor_id: string | null,
  icon: string | null = null,
): AreaRegistryEntry => ({
  area_id,
  name,
  floor_id,
  icon,
  picture: null,
  aliases: [],
  labels: [],
});

const areas: Record<string, AreaRegistryEntry> = {
  living_room: area('living_room', 'Living Room', 'ground', 'mdi:sofa'),
  kitchen: area('kitchen', 'Kitchen', 'ground'),
  dining_room: area('dining_room', 'Dining Room', 'ground'),
  hallway: area('hallway', 'Hallway', 'ground'),
  bedroom: area('bedroom', 'Bedroom', 'upstairs'),
  kids_room: area('kids_room', 'Kids Room', 'upstairs'),
  office: area('office', 'Office', 'upstairs'),
  bathroom: area('bathroom', 'Bathroom', 'upstairs'),
  media_room: area('media_room', 'Media Room', 'basement'),
  laundry: area('laundry', 'Laundry', 'basement'),
  garden: area('garden', 'Garden', null),
  porch: area('porch', 'Front Porch', null),
  garage: area('garage', 'Garage', 'ground'),
};

const device = (
  id: string,
  name: string,
  area_id: string | null,
  model: string,
  manufacturer = 'Acme',
): DeviceRegistryEntry => ({
  id,
  name,
  name_by_user: null,
  area_id,
  model,
  manufacturer,
});

const devices: Record<string, DeviceRegistryEntry> = {
  tv_plug: device('tv_plug', 'TV Plug', 'living_room', 'Smart Plug with Energy Monitoring', 'TP-Link'),
  coffee_plug: device('coffee_plug', 'Coffee Maker', 'kitchen', 'Mini Smart Plug', 'Shelly'),
  kitchen_switch: device('kitchen_switch', 'Kitchen Switch', 'kitchen', 'Dimmer Switch', 'Lutron'),
  monitor_plug: device('monitor_plug', 'Monitor Plug', 'office', 'Smart Plug', 'Eve'),
  desktop_pc: device('desktop_pc', 'Desktop PC', 'office', 'Wake on LAN'),
  dehumidifier_plug: device('dehumidifier_plug', 'Dehumidifier', 'laundry', 'Outdoor Smart Plug', 'Meross'),
  fan_plug: device('fan_plug', 'Bedroom Fan Plug', 'bedroom', 'Zigbee Outlet', 'IKEA'),
  garage_opener: device('garage_opener', 'Garage Door', 'garage', 'Opener', 'Chamberlain'),
};

interface LightSpec {
  id: string;
  name: string;
  area?: string;
  device?: string;
  modes: string[];
  on?: boolean;
  brightness?: number;
  hs?: [number, number];
  kelvin?: number;
  effects?: string[];
  effect?: string;
  icon?: string;
  hidden?: boolean;
  category?: 'config' | 'diagnostic';
  restored?: boolean;
  unavailable?: boolean;
  members?: string[];
  minK?: number;
  maxK?: number;
}

const COLOR = ['color_temp', 'hs'];
const WHITE = ['color_temp'];
const DIM = ['brightness'];
const ONOFF = ['onoff'];

const lightSpecs: LightSpec[] = [
  {
    id: 'living_room_ceiling',
    name: 'Living Room Ceiling',
    area: 'living_room',
    modes: COLOR,
    on: true,
    brightness: 78,
    kelvin: 2700,
  },
  {
    id: 'living_room_floor_lamp',
    name: 'Living Room Floor Lamp',
    area: 'living_room',
    modes: COLOR,
    on: true,
    brightness: 55,
    hs: [28, 78],
    icon: 'mdi:floor-lamp',
  },
  {
    id: 'living_room_tv_backlight',
    name: 'Living Room TV Backlight',
    area: 'living_room',
    modes: ['hs'],
    on: true,
    brightness: 42,
    hs: [268, 80],
    effects: ['Solid', 'Rainbow', 'Colorloop', 'Candle', 'Fireplace', 'Aurora'],
    effect: 'Solid',
  },
  { id: 'kitchen_pendants', name: 'Kitchen Pendants', area: 'kitchen', modes: DIM, on: true, brightness: 100 },
  {
    id: 'kitchen_under_cabinet',
    name: 'Kitchen Under Cabinet',
    area: 'kitchen',
    modes: WHITE,
    on: false,
    kelvin: 3000,
  },
  {
    id: 'kitchen_switch_led',
    name: 'Kitchen Switch LED',
    device: 'kitchen_switch',
    modes: ONOFF,
    on: true,
    category: 'config',
  },
  {
    id: 'dining_chandelier',
    name: 'Dining Room Chandelier',
    area: 'dining_room',
    modes: WHITE,
    on: false,
    kelvin: 2400,
    icon: 'mdi:chandelier',
  },
  { id: 'hallway', name: 'Hallway', area: 'hallway', modes: ONOFF, on: false },
  { id: 'hallway_old_bulb', name: 'Hallway Old Bulb', area: 'hallway', modes: DIM, restored: true, unavailable: true },
  { id: 'bedroom_ceiling', name: 'Bedroom Ceiling', area: 'bedroom', modes: COLOR, on: false, kelvin: 3000 },
  {
    id: 'bedside_left',
    name: 'Bedroom Bedside Left',
    area: 'bedroom',
    modes: WHITE,
    on: true,
    brightness: 22,
    kelvin: 2200,
    minK: 2200,
    maxK: 4000,
  },
  {
    id: 'bedside_right',
    name: 'Bedroom Bedside Right',
    area: 'bedroom',
    modes: WHITE,
    on: false,
    kelvin: 2200,
    minK: 2200,
    maxK: 4000,
  },
  {
    id: 'kids_room_night_light',
    name: 'Kids Room Night Light',
    area: 'kids_room',
    modes: ['hs'],
    on: true,
    brightness: 18,
    hs: [196, 70],
  },
  { id: 'kids_room_ceiling', name: 'Kids Room Ceiling', area: 'kids_room', modes: DIM, unavailable: true },
  {
    id: 'office_desk_lamp',
    name: 'Office Desk Lamp',
    area: 'office',
    modes: WHITE,
    on: true,
    brightness: 100,
    kelvin: 5000,
    icon: 'mdi:desk-lamp',
  },
  { id: 'office_ceiling', name: 'Office Ceiling', area: 'office', modes: DIM, on: false },
  { id: 'bathroom_mirror', name: 'Bathroom Mirror', area: 'bathroom', modes: WHITE, on: false, kelvin: 4000 },
  {
    id: 'media_room_bias',
    name: 'Media Room Bias Lighting',
    area: 'media_room',
    modes: ['hs'],
    on: true,
    brightness: 60,
    hs: [222, 88],
    effects: ['Solid', 'Ambilight', 'Breathe', 'Rainbow'],
    effect: 'Ambilight',
  },
  { id: 'media_room_sconces', name: 'Media Room Sconces', area: 'media_room', modes: DIM, on: false },
  {
    id: 'media_room',
    name: 'Media Room Lights',
    area: 'media_room',
    modes: DIM,
    members: ['light.media_room_bias', 'light.media_room_sconces'],
  },
  { id: 'laundry', name: 'Laundry', area: 'laundry', modes: ONOFF, on: false },
  { id: 'garage', name: 'Garage', area: 'garage', modes: DIM, on: false },
  { id: 'garden_path', name: 'Garden Path', area: 'garden', modes: COLOR, on: true, brightness: 70, hs: [40, 85] },
  {
    id: 'garden_string_lights',
    name: 'Garden String Lights',
    area: 'garden',
    modes: DIM,
    on: true,
    brightness: 45,
    icon: 'mdi:string-lights',
  },
  { id: 'porch', name: 'Front Porch Lantern', area: 'porch', modes: WHITE, on: true, brightness: 90, kelvin: 2700 },
  { id: 'porch_spare', name: 'Front Porch Spare', area: 'porch', modes: DIM, on: false, hidden: true },
  { id: 'christmas_tree', name: 'Christmas Tree', modes: ONOFF, on: true, icon: 'mdi:pine-tree' },
];

interface PlugSpec {
  id: string;
  name: string;
  device?: string;
  area?: string;
  outletClass: boolean;
  on: boolean;
  watts?: number;
  sensors?: ('power' | 'energy' | 'voltage' | 'current')[];
}

const plugSpecs: PlugSpec[] = [
  {
    id: 'tv_plug',
    name: 'TV Plug',
    device: 'tv_plug',
    outletClass: true,
    on: true,
    watts: 86.4,
    sensors: ['power', 'energy', 'voltage', 'current'],
  },
  {
    id: 'coffee_maker',
    name: 'Coffee Maker',
    device: 'coffee_plug',
    outletClass: false,
    on: false,
    watts: 1150,
    sensors: ['power', 'energy'],
  },
  {
    id: 'monitor_plug',
    name: 'Monitor Plug',
    device: 'monitor_plug',
    outletClass: true,
    on: true,
    watts: 34.2,
    sensors: ['power'],
  },
  {
    id: 'dehumidifier',
    name: 'Dehumidifier',
    device: 'dehumidifier_plug',
    outletClass: false,
    on: true,
    watts: 241,
    sensors: ['power', 'energy'],
  },
  { id: 'bedroom_fan_plug', name: 'Bedroom Fan Plug', device: 'fan_plug', outletClass: true, on: false },
];

// Switches that are not plugs and must stay out of the card in smart mode.
const otherSwitches = [
  { id: 'desktop_pc', name: 'Desktop PC', device: 'desktop_pc' },
  { id: 'garage_door_light', name: 'Garage Door Light Sync', device: 'garage_opener' },
];

const scenes: Record<string, { name: string; area: string; apply: Record<string, Partial<LightState>> }> = {
  'scene.living_room_movie_night': {
    name: 'Living Room Movie Night',
    area: 'living_room',
    apply: {
      'light.living_room_ceiling': { on: false },
      'light.living_room_floor_lamp': { on: true, brightness: 64, hs: [26, 88], mode: 'hs' },
      'light.living_room_tv_backlight': { on: true, brightness: 110, hs: [232, 92], mode: 'hs' },
    },
  },
  'scene.living_room_relax': {
    name: 'Living Room Relax',
    area: 'living_room',
    apply: {
      'light.living_room_ceiling': { on: true, brightness: 115, kelvin: 2400, mode: 'color_temp' },
      'light.living_room_floor_lamp': { on: true, brightness: 150, hs: [34, 70], mode: 'hs' },
      'light.living_room_tv_backlight': { on: false },
    },
  },
  'scene.media_room_cinema': {
    name: 'Media Room Cinema',
    area: 'media_room',
    apply: {
      'light.media_room_bias': { on: true, brightness: 70, hs: [240, 95], mode: 'hs' },
      'light.media_room_sconces': { on: false },
    },
  },
};

interface LightState {
  on: boolean;
  brightness: number;
  hs?: [number, number];
  kelvin?: number;
  mode: string;
  effect?: string;
}

// ─── State machine ────────────────────────────────────────────────────────────

const specsById = new Map<string, LightSpec>();
const lightStates = new Map<string, LightState>();
const plugState = new Map<string, boolean>();
let states: Record<string, HassEntity> = {};
let entities: Record<string, EntityRegistryDisplayEntry> = {};
const now = () => new Date().toISOString();

function registerLight(spec: LightSpec) {
  const entityId = `light.${spec.id}`;
  specsById.set(entityId, spec);
  lightStates.set(entityId, {
    on: Boolean(spec.on),
    brightness: Math.round(((spec.brightness ?? 100) / 100) * 255),
    hs: spec.hs,
    kelvin: spec.kelvin,
    mode: spec.hs
      ? 'hs'
      : spec.kelvin && spec.modes.includes('color_temp')
        ? 'color_temp'
        : spec.modes.includes('brightness')
          ? 'brightness'
          : spec.modes[0],
    effect: spec.effect,
  });
  entities[entityId] = {
    entity_id: entityId,
    area_id: spec.area ?? null,
    device_id: spec.device ?? null,
    icon: spec.icon ?? null,
    hidden: spec.hidden,
    entity_category: spec.category ?? null,
    labels: [],
    platform: 'demo',
  };
}

function renderLight(entityId: string): HassEntity {
  const spec = specsById.get(entityId)!;
  const s = lightStates.get(entityId)!;
  const members = spec.members;
  const on = members ? members.some((m) => lightStates.get(m)?.on) : s.on;
  const attributes: Record<string, unknown> = {
    friendly_name: spec.name,
    supported_color_modes: spec.modes,
    supported_features: spec.effects ? 4 : 0,
  };
  if (spec.effects) attributes.effect_list = spec.effects;
  if (spec.modes.includes('color_temp')) {
    attributes.min_color_temp_kelvin = spec.minK ?? 2000;
    attributes.max_color_temp_kelvin = spec.maxK ?? 6500;
  }
  if (members) {
    attributes.entity_id = members;
    const lit = members.map((m) => lightStates.get(m)!).filter((m) => m.on);
    attributes.brightness = lit.length ? Math.round(lit.reduce((sum, m) => sum + m.brightness, 0) / lit.length) : null;
    attributes.color_mode = lit.length ? 'brightness' : null;
  } else if (on) {
    const dimmable = !spec.modes.includes('onoff');
    attributes.color_mode = s.mode;
    attributes.brightness = dimmable ? s.brightness : null;
    if (s.mode === 'hs' && s.hs) {
      attributes.hs_color = s.hs;
      attributes.rgb_color = hsToRgb(s.hs[0], s.hs[1]);
    } else if (s.mode === 'color_temp' && s.kelvin) {
      attributes.color_temp_kelvin = s.kelvin;
      const rgb = kelvinToRgb(s.kelvin);
      attributes.rgb_color = rgb;
      attributes.hs_color = rgbToHs(rgb);
    }
    if (spec.effects) attributes.effect = s.effect ?? null;
  } else {
    Object.assign(attributes, {
      color_mode: null,
      brightness: null,
      hs_color: null,
      rgb_color: null,
      color_temp_kelvin: null,
      effect: null,
    });
  }
  if (spec.restored) attributes.restored = true;
  const state = spec.unavailable ? 'unavailable' : on ? 'on' : 'off';
  return {
    entity_id: entityId,
    state,
    attributes: attributes as HassEntity['attributes'],
    last_changed: now(),
    last_updated: now(),
  };
}

const sensorUnits = { power: 'W', energy: 'kWh', voltage: 'V', current: 'A' } as const;
const energyTotals: Record<string, number> = { tv_plug: 12.84, coffee_maker: 3.42, dehumidifier: 48.9 };

function jitter(value: number, spread: number) {
  return E2E ? value : value * (1 + (Math.random() - 0.5) * spread);
}

function renderPlugSensors(spec: PlugSpec) {
  const on = plugState.get(spec.id)!;
  for (const kind of spec.sensors ?? []) {
    const id = `sensor.${spec.id}_${kind}`;
    const watts = on ? jitter(spec.watts ?? 0, 0.06) : 0;
    const value =
      kind === 'power'
        ? watts.toFixed(1)
        : kind === 'energy'
          ? (energyTotals[spec.id] ?? 1).toFixed(2)
          : kind === 'voltage'
            ? jitter(121.2, 0.01).toFixed(1)
            : (watts / 121).toFixed(2);
    states[id] = {
      entity_id: id,
      state: value,
      attributes: {
        friendly_name: `${spec.name} ${kind}`,
        device_class: kind,
        unit_of_measurement: sensorUnits[kind],
        state_class: 'measurement',
      },
      last_changed: now(),
      last_updated: now(),
    };
  }
}

function renderPlug(spec: PlugSpec): HassEntity {
  return {
    entity_id: `switch.${spec.id}`,
    state: plugState.get(spec.id) ? 'on' : 'off',
    attributes: { friendly_name: spec.name, ...(spec.outletClass ? { device_class: 'outlet' } : {}) },
    last_changed: now(),
    last_updated: now(),
  };
}

function sunState(mode: 'day' | 'dusk' | 'night'): HassEntity {
  const table = {
    day: { state: 'above_horizon', elevation: 38, azimuth: 150 },
    dusk: { state: 'above_horizon', elevation: 2.5, azimuth: 262 },
    night: { state: 'below_horizon', elevation: -24, azimuth: 318 },
  }[mode];
  return {
    entity_id: 'sun.sun',
    state: table.state,
    attributes: { friendly_name: 'Sun', elevation: table.elevation, azimuth: table.azimuth },
    last_changed: now(),
    last_updated: now(),
  };
}

function boot() {
  states = {};
  entities = {};
  lightStates.clear();
  specsById.clear();
  lightSpecs.forEach(registerLight);
  for (const id of specsById.keys()) states[id] = renderLight(id);
  for (const spec of plugSpecs) {
    plugState.set(spec.id, spec.on);
    const entityId = `switch.${spec.id}`;
    entities[entityId] = {
      entity_id: entityId,
      device_id: spec.device ?? null,
      area_id: spec.area ?? null,
      labels: [],
    };
    states[entityId] = renderPlug(spec);
    for (const kind of spec.sensors ?? []) {
      const id = `sensor.${spec.id}_${kind}`;
      entities[id] = {
        entity_id: id,
        device_id: spec.device ?? null,
        labels: [],
        entity_category: kind === 'voltage' || kind === 'current' ? 'diagnostic' : null,
      };
    }
    renderPlugSensors(spec);
  }
  for (const other of otherSwitches) {
    const id = `switch.${other.id}`;
    entities[id] = { entity_id: id, device_id: other.device, labels: [] };
    states[id] = {
      entity_id: id,
      state: 'off',
      attributes: { friendly_name: other.name },
      last_changed: now(),
      last_updated: now(),
    };
  }
  for (const [id, scene] of Object.entries(scenes)) {
    entities[id] = { entity_id: id, area_id: scene.area, labels: [] };
    states[id] = {
      entity_id: id,
      state: '2026-09-24T19:30:00+00:00',
      attributes: { friendly_name: scene.name },
      last_changed: now(),
      last_updated: now(),
    };
  }
  states['sun.sun'] = sunState(initialSky());
  // Clutter a real install has that the card must ignore.
  states['sensor.outdoor_temperature'] = {
    entity_id: 'sensor.outdoor_temperature',
    state: '14.2',
    attributes: { unit_of_measurement: '°C', device_class: 'temperature' },
    last_changed: now(),
    last_updated: now(),
  };
}

function initialSky(): 'day' | 'dusk' | 'night' {
  const requested = params.get('sky');
  return requested === 'day' || requested === 'dusk' || requested === 'night' ? requested : 'night';
}

// ─── Services ─────────────────────────────────────────────────────────────────

const serviceLog: { domain: string; service: string; data: Record<string, unknown> }[] = [];

function toList(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : typeof value === 'string' ? [value] : [];
}

function applyLight(entityId: string, service: string, data: Record<string, unknown>) {
  const spec = specsById.get(entityId);
  if (!spec || spec.unavailable) return;
  if (spec.members) {
    spec.members.forEach((m) => applyLight(m, service, data));
    return;
  }
  const s = lightStates.get(entityId)!;
  const turnOn = service === 'turn_on' || (service === 'toggle' && !s.on);
  if (!turnOn) {
    s.on = false;
    return;
  }
  s.on = true;
  if (typeof data.brightness_pct === 'number')
    s.brightness = Math.max(1, Math.round((data.brightness_pct / 100) * 255));
  if (typeof data.brightness === 'number') s.brightness = data.brightness;
  if (Array.isArray(data.hs_color) && spec.modes.some((m) => m === 'hs')) {
    s.hs = data.hs_color as [number, number];
    s.mode = 'hs';
  }
  if (typeof data.color_temp_kelvin === 'number' && spec.modes.includes('color_temp')) {
    const min = spec.minK ?? 2000;
    const max = spec.maxK ?? 6500;
    s.kelvin = Math.min(max, Math.max(min, data.color_temp_kelvin));
    s.mode = 'color_temp';
  }
  if (typeof data.effect === 'string') s.effect = data.effect;
}

function callService(
  domain: string,
  service: string,
  data: Record<string, unknown> = {},
  target: Record<string, unknown> = {},
) {
  serviceLog.push({ domain, service, data: { ...data, ...target } });
  const ids = toList(data.entity_id ?? target.entity_id);
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      for (const entityId of ids) {
        const entityDomain = entityId.split('.')[0];
        if (entityDomain === 'light') applyLight(entityId, service, data);
        else if (entityDomain === 'switch') {
          const id = entityId.slice(7);
          if (!plugState.has(id)) continue;
          const next = service === 'turn_on' ? true : service === 'turn_off' ? false : !plugState.get(id);
          plugState.set(id, next);
        } else if (entityDomain === 'scene' && scenes[entityId]) {
          for (const [lightId, patch] of Object.entries(scenes[entityId].apply))
            Object.assign(lightStates.get(lightId)!, patch);
        }
      }
      refreshStates();
      resolve();
    }, LATENCY);
  });
}

function refreshStates() {
  const next: Record<string, HassEntity> = { ...states };
  for (const id of specsById.keys()) next[id] = sameOr(states[id], renderLight(id));
  for (const spec of plugSpecs) {
    next[`switch.${spec.id}`] = sameOr(states[`switch.${spec.id}`], renderPlug(spec));
  }
  const previous = states;
  states = next;
  for (const spec of plugSpecs) {
    renderPlugSensors(spec);
    for (const kind of spec.sensors ?? []) {
      const id = `sensor.${spec.id}_${kind}`;
      if (kind !== 'power' && previous[id]) states[id] = sameOr(previous[id], states[id]);
      if (kind === 'power' && previous[id] && plugState.get(spec.id) === Number(previous[id].state) > 0) {
        states[id] = previous[id];
      }
    }
  }
  publish();
}

/** Like Home Assistant, only hand out a new state object when something changed. */
function sameOr(previous: HassEntity | undefined, next: HassEntity): HassEntity {
  if (
    previous &&
    previous.state === next.state &&
    JSON.stringify(previous.attributes) === JSON.stringify(next.attributes)
  )
    return previous;
  return next;
}

// ─── History for the plug sparkline ───────────────────────────────────────────

function history(entityId: string): { s: string; lu: number }[] {
  const end = Date.now();
  const points: { s: string; lu: number }[] = [];
  let seed = entityId.length * 97;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let t = end - 24 * 3600_000; t <= end; t += 10 * 60_000) {
    const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    let watts = 0;
    if (entityId.includes('tv_plug')) watts = hour >= 18 || hour < 0.5 ? 78 + rand() * 18 : 0.6;
    else if (entityId.includes('monitor')) watts = hour >= 8.5 && hour < 18 ? 28 + rand() * 10 : 0.3;
    else if (entityId.includes('dehumidifier'))
      watts = Math.floor(t / (45 * 60_000)) % 2 === 0 ? 232 + rand() * 18 : 1.2;
    else if (entityId.includes('coffee'))
      watts = (hour >= 7 && hour < 7.25) || (hour >= 13 && hour < 13.2) ? 1100 + rand() * 90 : 0;
    points.push({ s: watts.toFixed(1), lu: t / 1000 });
  }
  return points;
}

async function callWS<T>(msg: Record<string, unknown>): Promise<T> {
  if (msg.type === 'history/history_during_period') {
    const result: Record<string, unknown> = {};
    for (const id of toList(msg.entity_ids)) result[id] = history(id);
    return result as T;
  }
  throw new Error(`Demo does not support ${String(msg.type)}`);
}

// ─── The hass object and the page ─────────────────────────────────────────────

const pageTheme = params.get('theme') ?? document.documentElement.dataset.theme;
let darkMode = pageTheme === 'dark' || (pageTheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
let language = params.get('lang') ?? 'en';
let locale = { language };
let hass: HomeAssistant;

function buildHass(): HomeAssistant {
  return {
    states,
    entities,
    devices,
    areas,
    floors,
    config: { country: params.get('country') ?? 'US', language: 'en' },
    themes: { darkMode },
    language,
    locale,
    callService,
    callWS,
    formatEntityState: (stateObj: HassEntity) => stateObj.state.charAt(0).toUpperCase() + stateObj.state.slice(1),
  };
}

const cards: (HTMLElement & { hass?: HomeAssistant; setConfig(c: Record<string, unknown>): void })[] = [];

function publish() {
  hass = buildHass();
  for (const card of cards) card.hass = hass;
}

boot();
hass = buildHass();

let cardConfig: Record<string, unknown> = { type: 'custom:light-control-card' };

async function mount() {
  await customElements.whenDefined('light-control-card');
  const slot = document.getElementById('card-slot')!;
  const card = document.createElement('light-control-card') as (typeof cards)[number];
  card.setConfig(cardConfig);
  card.hass = hass;
  slot.replaceChildren(card);
  cards.splice(0, cards.length, card);
}

function setConfig(patch: Record<string, unknown>) {
  cardConfig = { ...cardConfig, ...patch };
  for (const key of Object.keys(cardConfig)) if (cardConfig[key] === undefined) delete cardConfig[key];
  for (const card of cards) card.setConfig(cardConfig);
}

function setSky(mode: 'day' | 'dusk' | 'night') {
  states = { ...states, 'sun.sun': sunState(mode) };
  publish();
  document.documentElement.dataset.sky = mode;
}

function setTheme(dark: boolean) {
  darkMode = dark;
  document.getElementById('stage')?.classList.toggle('ha-dark', dark);
  publish();
}

function setLanguage(next: string) {
  language = next;
  locale = { language: next };
  document.documentElement.lang = next;
  publish();
}

const NEW_BULB = 'light.kitchen_island';

function addLight() {
  if (specsById.has(NEW_BULB)) return;
  registerLight({
    id: 'kitchen_island',
    name: 'Kitchen Island',
    area: 'kitchen',
    modes: COLOR,
    on: true,
    brightness: 85,
    hs: [150, 70],
  });
  entities = { ...entities };
  states = { ...states, [NEW_BULB]: renderLight(NEW_BULB) };
  publish();
}

/** Simulates a bulb dropping off the network (or coming back). */
function setUnavailable(entityId: string, unavailable: boolean) {
  const spec = specsById.get(entityId);
  if (!spec) return;
  spec.unavailable = unavailable;
  refreshStates();
}

function removeLight() {
  if (!specsById.has(NEW_BULB)) return;
  specsById.delete(NEW_BULB);
  lightStates.delete(NEW_BULB);
  const { [NEW_BULB]: _gone, ...restEntities } = entities;
  const { [NEW_BULB]: _goneState, ...restStates } = states;
  entities = restEntities;
  states = restStates;
  publish();
}

// Plugs hum along: nudge power readings now and then so the numbers feel live.
if (!E2E) {
  setInterval(() => {
    for (const spec of plugSpecs) if (plugState.get(spec.id)) renderPlugSensors(spec);
    states = { ...states };
    publish();
  }, 4000);
}

// ─── Page wiring ──────────────────────────────────────────────────────────────

function toast(message: string, action?: { text: string; action: () => void }, duration = 4000) {
  const host = document.getElementById('toasts')!;
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.text;
    button.addEventListener('click', () => {
      action.action();
      el.remove();
    });
    el.append(button);
  }
  host.replaceChildren(el);
  setTimeout(() => el.remove(), duration);
}

window.addEventListener('hass-notification', (ev) => {
  const detail = (ev as CustomEvent).detail as {
    message: string;
    action?: { text: string; action: () => void };
    duration?: number;
  };
  toast(detail.message, detail.action, detail.duration ?? 4000);
});

window.addEventListener('hass-more-info', (ev) => {
  const { entityId } = (ev as CustomEvent).detail as { entityId: string };
  const name = states[entityId]?.attributes.friendly_name ?? entityId;
  toast(`Home Assistant would open ${name}'s history and settings here.`);
});

function bindSegmented(name: string, onChange: (value: string) => void) {
  const group = document.querySelector<HTMLElement>(`[data-control="${name}"]`);
  if (!group) return;
  group.addEventListener('click', (ev) => {
    const button = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
    if (!button) return;
    group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    onChange(button.dataset.value!);
  });
}

function pressed(name: string, value: string) {
  document
    .querySelectorAll<HTMLButtonElement>(`[data-control="${name}"] button`)
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
}

function wirePage() {
  const stage = document.getElementById('stage')!;
  stage.classList.toggle('ha-dark', darkMode);
  pressed('theme', darkMode ? 'dark' : 'light');
  pressed('sky', initialSky());
  document.documentElement.dataset.sky = initialSky();
  bindSegmented('theme', (v) => setTheme(v === 'dark'));
  bindSegmented('sky', (v) => setSky(v as 'day' | 'dusk' | 'night'));
  bindSegmented('width', (v) => (stage.dataset.width = v));
  if (matchMedia('(max-width: 560px)').matches) {
    stage.dataset.width = 'phone';
    pressed('width', 'phone');
  }

  const languageSelect = document.getElementById('language') as HTMLSelectElement | null;
  if (languageSelect) {
    languageSelect.value = language;
    languageSelect.addEventListener('change', () => setLanguage(languageSelect.value));
  }

  const discover = document.getElementById('discover') as HTMLButtonElement | null;
  discover?.addEventListener('click', () => {
    const adding = !specsById.has(NEW_BULB);
    if (adding) addLight();
    else removeLight();
    discover.textContent = adding ? 'Remove the Kitchen Island bulb' : 'Add a Kitchen Island bulb';
    toast(adding ? 'A new bulb joined the Kitchen. No card edits needed.' : 'The bulb is gone, and so is its tile.');
  });

  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-option]')) {
    input.addEventListener('change', () => setConfig({ [input.dataset.option!]: input.checked ? undefined : false }));
  }
}

declare global {
  interface Window {
    __demo: Record<string, unknown>;
  }
}

window.__demo = {
  get hass() {
    return hass;
  },
  serviceLog,
  setConfig,
  setSky,
  setTheme,
  setLanguage,
  addLight,
  removeLight,
  setUnavailable,
  remount: mount,
};

wirePage();
mount();
