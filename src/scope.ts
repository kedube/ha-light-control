// The card shows the whole home, one floor, the outdoors or a single room. This module decides
// which rooms belong to each of those: floors from the lowest up, rooms in Home Assistant's order.

import { UNASSIGNED, type Discovery, type Room } from './discovery.ts';
import { floorLevels, GROUND_ID, groundLevel } from './house/plan.ts';

export const OUTSIDE = '__outside__';
export { GROUND_ID } from './house/plan.ts';

export interface FloorGroup {
  /** A Home Assistant floor id, GROUND_ID when the home has no floors, OUTSIDE, or UNASSIGNED. */
  id: string;
  kind: 'floor' | 'outside' | 'other';
  name: string;
  icon: string;
  /** Home Assistant floor level, for the icon and the 3D house. */
  level: number | null;
  rooms: Room[];
}

export type Scope = { kind: 'home' } | { kind: 'floor'; id: string } | { kind: 'room'; id: string };

const FLOOR_ICONS: Record<string, string> = {
  '-1': 'mdi:home-floor-negative-1',
  '0': 'mdi:home-floor-0',
  '1': 'mdi:home-floor-1',
  '2': 'mdi:home-floor-2',
  '3': 'mdi:home-floor-3',
};

export function floorIcon(level: number | null): string {
  if (level === null) return 'mdi:home-floor-g';
  return FLOOR_ICONS[String(level)] ?? (level < 0 ? 'mdi:home-floor-b' : 'mdi:home-floor-l');
}

/** The floor that rooms without one belong to, chosen the same way as the 3D house's ground floor. */
function groundFloor(floors: Discovery['floors']): string | undefined {
  if (!floors.length) return undefined;
  const levels = floorLevels(floors);
  const ground = groundLevel([...levels.values()]);
  return floors.find((f) => levels.get(f.id) === ground)?.id;
}

/**
 * Floors with their indoor rooms, from the lowest floor up, then the outdoors, then entities
 * without an area. Rooms without a floor join the ground floor, as they do in the 3D house.
 */
export function floorGroups(discovery: Discovery, names: { inside: string; outside: string }): FloorGroup[] {
  const indoor = discovery.rooms.filter((r) => !r.outdoor && r.id !== UNASSIGNED);
  const groups: FloorGroup[] = [];
  const floors = discovery.floors.filter((f) => indoor.some((r) => r.floorId === f.id));
  if (floors.length) {
    const ground = groundFloor(floors);
    const known = new Set(floors.map((f) => f.id));
    for (const floor of floors) {
      const rooms = indoor.filter(
        (r) => r.floorId === floor.id || (floor.id === ground && (!r.floorId || !known.has(r.floorId))),
      );
      groups.push({
        id: floor.id,
        kind: 'floor',
        name: floor.name,
        icon: floor.icon ?? floorIcon(floor.level),
        level: floor.level,
        rooms,
      });
    }
  } else if (indoor.length) {
    groups.push({ id: GROUND_ID, kind: 'floor', name: names.inside, icon: 'mdi:home', level: 0, rooms: indoor });
  }
  const outdoor = discovery.rooms.filter((r) => r.outdoor);
  if (outdoor.length) {
    groups.push({ id: OUTSIDE, kind: 'outside', name: names.outside, icon: 'mdi:tree', level: null, rooms: outdoor });
  }
  const other = discovery.rooms.find((r) => r.id === UNASSIGNED);
  if (other)
    groups.push({ id: UNASSIGNED, kind: 'other', name: other.name, icon: other.icon, level: null, rooms: [other] });
  return groups;
}

/** The group a room is shown in. */
export function groupOf(groups: FloorGroup[], roomId: string): FloorGroup | undefined {
  return groups.find((g) => g.rooms.some((r) => r.id === roomId));
}

/** The rooms a scope covers. An unknown floor or room (it was just removed) falls back to the home. */
export function roomsIn(groups: FloorGroup[], scope: Scope): Room[] {
  if (scope.kind === 'floor') {
    const group = groups.find((g) => g.id === scope.id);
    if (group) return group.rooms;
  }
  if (scope.kind === 'room') {
    const room = groups.flatMap((g) => g.rooms).find((r) => r.id === scope.id);
    if (room) return [room];
  }
  return groups.flatMap((g) => g.rooms);
}

/** A scope that still exists, or the home. */
export function validScope(groups: FloorGroup[], scope: Scope): Scope {
  if (scope.kind === 'floor' && groups.some((g) => g.id === scope.id && g.kind !== 'other')) return scope;
  if (scope.kind === 'room' && groupOf(groups, scope.id)) return scope;
  return { kind: 'home' };
}
