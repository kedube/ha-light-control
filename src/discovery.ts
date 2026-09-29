import { makeEntityMatcher, type ResolvedConfig } from './config.ts';
import { computeDomain, isLightGroup, type EntityKind } from './entity-model.ts';
import type { EntityRegistryDisplayEntry, HassEntity, HomeAssistant } from './ha-types.ts';
import { isOutdoorName, roomIcon, roomType, type RoomType } from './room-types.ts';

export { isOutdoorName, roomIcon } from './room-types.ts';

export const UNASSIGNED = '__unassigned__';

export interface RelatedSensors {
  power?: string;
  energy?: string;
  voltage?: string;
  current?: string;
}

export interface DiscoveredEntity {
  entityId: string;
  kind: EntityKind;
  /** Name shown on the tile, with the room name stripped ("Living Room Lamp" → "Lamp"). */
  name: string;
  /** Full friendly name, for dialogs and screen readers. */
  fullName: string;
  areaId: string | null;
  deviceId: string | null;
  isGroup: boolean;
  /** The user or integration picked an icon; show it instead of the card's own artwork. */
  customIcon: boolean;
  sensors: RelatedSensors;
}

export interface Room {
  id: string;
  name: string;
  icon: string;
  /** What kind of room it is, for its size and furniture in the 3D house. */
  type: RoomType;
  floorId: string | null;
  outdoor: boolean;
  entities: DiscoveredEntity[];
  scenes: string[];
}

export interface Floor {
  id: string;
  name: string;
  level: number | null;
  icon: string | null;
  rooms: string[];
}

export interface Discovery {
  rooms: Room[];
  /** Floors holding at least one discovered room, in Home Assistant's order. */
  floors: Floor[];
  /** Every entity whose state the card displays (for cheap change detection). */
  watched: string[];
  /**
   * Candidates whose visibility depends on their current state (unavailable, or no longer
   * provided by an integration). The card re-runs discovery when any of them changes.
   */
  stateGated: string[];
}

// "plug" and friends in English plus the card's other languages (de, nl, fr, es, it, pl, pt).
const PLUG_WORDS =
  /(?:^|[^\p{L}])(?:smart ?plug|plug|outlet|socket|power ?strip|power ?bar|receptacle|steckdose|zwischenstecker|steckdosenleiste|stopcontact|stekker|prise|multiprise|enchufe|regleta|presa|ciabatta|gniazdko|gniazdo|wtyczka|listwa|tomada|régua|uttag|stikkontakt|pistorasia|zásuvka)s?(?:$|[^\p{L}])/iu;

/** Switches on plug devices that are settings, not the relay itself. */
const PLUG_SETTING_WORDS =
  /child ?lock|\block\b|\bled\b|indicator|buzzer|beep|power[ -]?on|auto[ -]?off|restore|overload|protection|backlight|night ?light/i;

/**
 * Removes a leading room name: "Living Room Floor Lamp" in "Living Room" → "Floor Lamp".
 * Returns the original name when stripping would leave nothing meaningful.
 */
export function stripAreaName(name: string, areaName: string | undefined): string {
  if (!areaName) return name;
  const prefix = areaName.trim().toLowerCase();
  if (!prefix || !name.toLowerCase().startsWith(prefix)) return name;
  const next = name.charAt(prefix.length);
  if (next && /[\p{L}\p{N}]/u.test(next)) return name; // "Den" must not strip "Denmark Lamp"
  const rest = name.slice(prefix.length).replace(/^[\s\-_:·|,.–—]+/, '');
  if (!rest) return name;
  return rest.charAt(0).toLocaleUpperCase() + rest.slice(1);
}

function resolveArea(hass: HomeAssistant, entry: EntityRegistryDisplayEntry | undefined): string | null {
  if (!entry) return null;
  const areaId = entry.area_id || (entry.device_id ? hass.devices?.[entry.device_id]?.area_id : null) || null;
  return areaId && hass.areas?.[areaId] ? areaId : null;
}

function looksLikePlug(hass: HomeAssistant, stateObj: HassEntity, entry?: EntityRegistryDisplayEntry): boolean {
  const device = entry?.device_id ? hass.devices?.[entry.device_id] : undefined;
  const friendly = stateObj.attributes.friendly_name ?? '';
  const deviceName = device?.name_by_user || device?.name || '';
  // The part of the name that belongs to the entity rather than the device ("Child lock").
  const ownName =
    entry?.name || (deviceName && friendly.startsWith(deviceName) ? friendly.slice(deviceName.length) : '');
  if (ownName && PLUG_SETTING_WORDS.test(ownName)) return false;
  const haystack = [device?.model, device?.model_id, device?.name, device?.name_by_user, friendly]
    .filter(Boolean)
    .join(' | ');
  return PLUG_WORDS.test(haystack);
}

function classify(
  hass: HomeAssistant,
  config: ResolvedConfig,
  stateObj: HassEntity,
  entry: EntityRegistryDisplayEntry | undefined,
  explicit: boolean,
): EntityKind | null {
  const domain = computeDomain(stateObj.entity_id);
  if (domain === 'light') return 'light';
  if (domain === 'switch') {
    const outlet = stateObj.attributes.device_class === 'outlet';
    if (explicit) return outlet || looksLikePlug(hass, stateObj, entry) ? 'outlet' : 'switch';
    if (!config.show_outlets) return null;
    if (outlet) return 'outlet';
    if (config.outlet_detection === 'device_class') return null;
    if (looksLikePlug(hass, stateObj, entry)) return 'outlet';
    return config.outlet_detection === 'all_switches' ? 'switch' : null;
  }
  // Anything else (fan, input_boolean, …) only appears when explicitly included.
  return explicit ? 'switch' : null;
}

const SENSOR_CLASSES = ['power', 'energy', 'voltage', 'current'] as const;

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function findSensors(
  hass: HomeAssistant,
  entityId: string,
  deviceEntities: string[],
  sharedDevice: boolean,
): RelatedSensors {
  const objectId = entityId.slice(entityId.indexOf('.') + 1);
  const result: RelatedSensors = {};
  for (const deviceClass of SENSOR_CLASSES) {
    const candidates = deviceEntities.filter(
      (id) => id.startsWith('sensor.') && hass.states[id]?.attributes.device_class === deviceClass,
    );
    if (!candidates.length) continue;
    if (sharedDevice) {
      // Power strips: only trust sensors that are clearly named after this outlet.
      const own = candidates.find((id) => id.slice(7).startsWith(objectId));
      if (own) result[deviceClass] = own;
      continue;
    }
    let best = candidates[0];
    for (const id of candidates) {
      if (commonPrefix(id.slice(7), objectId) > commonPrefix(best.slice(7), objectId)) best = id;
    }
    result[deviceClass] = best;
  }
  return result;
}

/** Finds every light and plug to show, grouped into rooms in Home Assistant's area order. */
export function discover(hass: HomeAssistant, config: ResolvedConfig): Discovery {
  const matchesPattern = makeEntityMatcher(config.exclude_patterns);
  const excluded = new Set(config.exclude);
  const included = new Set(config.include);
  const onlyAreas = config.areas.length ? new Set(config.areas) : null;
  const onlyFloors = config.floors.length ? new Set(config.floors) : null;
  const skipAreas = new Set(config.exclude_areas);
  const areas = hass.areas ?? {};
  const floors = hass.floors ?? {};

  const deviceEntities = new Map<string, string[]>();
  for (const entry of Object.values(hass.entities ?? {})) {
    if (!entry.device_id) continue;
    const list = deviceEntities.get(entry.device_id);
    if (list) list.push(entry.entity_id);
    else deviceEntities.set(entry.device_id, [entry.entity_id]);
  }

  const roomEntities = new Map<string, DiscoveredEntity[]>();
  const stateGated: string[] = [];
  const roomScenes = new Map<string, string[]>();
  const plugsPerDevice = new Map<string, number>();

  for (const stateObj of Object.values(hass.states)) {
    const entityId = stateObj.entity_id;
    const entry = hass.entities?.[entityId];
    const explicit = included.has(entityId);
    if (excluded.has(entityId) || (!explicit && matchesPattern(entityId))) continue;

    if (computeDomain(entityId) === 'scene') {
      if (!config.show_scenes || entry?.hidden) continue;
      const areaId = resolveArea(hass, entry);
      if (areaId) roomScenes.set(areaId, [...(roomScenes.get(areaId) ?? []), entityId]);
      continue;
    }

    if (!explicit && (entry?.hidden || entry?.entity_category)) continue;
    const kind = classify(hass, config, stateObj, entry, explicit);
    if (!kind) continue;
    if (!explicit) {
      // Orphans: the integration no longer provides this entity; HA only restored its last state.
      const orphaned = stateObj.attributes.restored === true;
      const unavailable = stateObj.state === 'unavailable';
      if (orphaned || unavailable) stateGated.push(entityId);
      if (orphaned || (!config.show_unavailable && unavailable)) continue;
    }
    const isGroup = kind === 'light' && isLightGroup(stateObj);
    if (isGroup && !config.show_light_groups && !explicit) continue;

    const areaId = resolveArea(hass, entry);
    if (!explicit) {
      if (areaId && skipAreas.has(areaId)) continue;
      if (onlyAreas && !(areaId && onlyAreas.has(areaId))) continue;
      if (onlyFloors && !(areaId && onlyFloors.has(areas[areaId]?.floor_id ?? ''))) continue;
      if (!areaId && !config.show_unassigned) continue;
    }

    const fullName = stateObj.attributes.friendly_name || entityId.slice(entityId.indexOf('.') + 1).replace(/_/g, ' ');
    const roomKey = areaId ?? UNASSIGNED;
    const discovered: DiscoveredEntity = {
      entityId,
      kind,
      name: config.strip_area_names && areaId ? stripAreaName(fullName, areas[areaId]?.name) : fullName,
      fullName,
      areaId,
      deviceId: entry?.device_id ?? null,
      isGroup,
      customIcon: Boolean(entry?.icon || stateObj.attributes.icon),
      sensors: {},
    };
    if (discovered.deviceId && kind !== 'light') {
      plugsPerDevice.set(discovered.deviceId, (plugsPerDevice.get(discovered.deviceId) ?? 0) + 1);
    }
    const list = roomEntities.get(roomKey);
    if (list) list.push(discovered);
    else roomEntities.set(roomKey, [discovered]);
  }

  // Attach power/energy sensors once we know how many outlets share each device.
  for (const list of roomEntities.values()) {
    for (const entity of list) {
      if (entity.kind === 'light' || !entity.deviceId) continue;
      entity.sensors = findSensors(
        hass,
        entity.entityId,
        deviceEntities.get(entity.deviceId) ?? [],
        (plugsPerDevice.get(entity.deviceId) ?? 0) > 1,
      );
    }
  }

  const kindRank = (e: DiscoveredEntity) => (e.isGroup ? 0 : e.kind === 'light' ? 1 : e.kind === 'outlet' ? 2 : 3);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  // Room order: an explicit `areas` list wins; otherwise follow HA's floor order, then its area order.
  let areaOrder: string[];
  if (config.areas.length) {
    areaOrder = config.areas.filter((id) => areas[id]);
  } else {
    const all = Object.keys(areas);
    const floorIds = Object.keys(floors);
    areaOrder = [
      ...floorIds.flatMap((floorId) => all.filter((id) => areas[id].floor_id === floorId)),
      ...all.filter((id) => !areas[id].floor_id || !floors[areas[id].floor_id!]),
    ];
  }
  // Explicitly included entities can live in areas outside the configured list.
  for (const key of roomEntities.keys()) {
    if (key !== UNASSIGNED && !areaOrder.includes(key)) areaOrder.push(key);
  }
  if (roomEntities.has(UNASSIGNED)) areaOrder.push(UNASSIGNED);

  const rooms: Room[] = [];
  for (const id of areaOrder) {
    const entities = roomEntities.get(id);
    if (!entities?.length) continue;
    entities.sort((a, b) => kindRank(a) - kindRank(b) || collator.compare(a.name, b.name));
    if (id === UNASSIGNED) {
      rooms.push({
        id,
        name: config.unassigned_name || 'Other',
        icon: 'mdi:home-lightbulb-outline',
        type: 'room',
        floorId: null,
        outdoor: false,
        entities,
        scenes: [],
      });
      continue;
    }
    const area = areas[id];
    const floor = area.floor_id ? floors[area.floor_id] : undefined;
    const outdoor = isOutdoorName(area.name) || (floor ? isOutdoorName(floor.name) : false);
    rooms.push({
      id,
      name: area.name,
      icon: roomIcon(area.name, area.icon),
      type: roomType(area.name, area.icon, outdoor),
      floorId: floor ? floor.floor_id : null,
      outdoor,
      entities,
      scenes: (roomScenes.get(id) ?? []).sort((a, b) =>
        collator.compare(hass.states[a]?.attributes.friendly_name ?? a, hass.states[b]?.attributes.friendly_name ?? b),
      ),
    });
  }

  const floorList: Floor[] = [];
  for (const floor of Object.values(floors)) {
    const floorRooms = rooms.filter((r) => r.floorId === floor.floor_id).map((r) => r.id);
    if (floorRooms.length) {
      floorList.push({
        id: floor.floor_id,
        name: floor.name,
        level: floor.level ?? null,
        icon: floor.icon ?? null,
        rooms: floorRooms,
      });
    }
  }

  const watched = new Set<string>(['sun.sun', ...stateGated]);
  for (const room of rooms) {
    room.scenes.forEach((id) => watched.add(id));
    for (const entity of room.entities) {
      watched.add(entity.entityId);
      Object.values(entity.sensors).forEach((id) => id && watched.add(id));
    }
  }

  return { rooms, floors: floorList, watched: [...watched], stateGated };
}
