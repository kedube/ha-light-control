import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { discover, UNASSIGNED } from '../../src/discovery.ts';
import { floorGroups, floorIcon, GROUND_ID, groupOf, OUTSIDE, roomsIn, validScope } from '../../src/scope.ts';
import { config, home } from './fixtures.ts';

const names = { inside: 'Inside', outside: 'Outside' };

describe('floorGroups', () => {
  it('groups rooms by floor, then the outdoors, then entities without an area', () => {
    const groups = floorGroups(discover(home(), config()), names);
    assert.deepEqual(
      groups.map((g) => [g.id, g.kind, g.rooms.map((r) => r.id)]),
      [
        ['ground', 'floor', ['living_room', 'kitchen']],
        ['upstairs', 'floor', ['bedroom']],
        [OUTSIDE, 'outside', ['garden']],
        [UNASSIGNED, 'other', [UNASSIGNED]],
      ],
    );
  });

  it('lists floors from the lowest up, whatever order Home Assistant keeps them in', () => {
    const hass = home({
      floors: [
        { floor_id: 'upstairs', name: 'Upstairs', level: 1 },
        { floor_id: 'ground', name: 'Ground Floor', level: 0 },
      ],
    });
    const discovery = discover(hass, config());
    assert.deepEqual(
      discovery.floors.map((f) => f.id),
      ['ground', 'upstairs'],
    );
    assert.deepEqual(
      floorGroups(discovery, names).map((g) => g.id),
      ['ground', 'upstairs', OUTSIDE, UNASSIGNED],
    );
    assert.deepEqual(
      discovery.rooms.map((r) => r.id),
      ['living_room', 'kitchen', 'bedroom', 'garden', UNASSIGNED],
    );
  });

  it('puts every room in one group when the home has no floors', () => {
    const hass = home({ floors: [] });
    const groups = floorGroups(discover(hass, config()), names);
    assert.equal(groups[0].id, GROUND_ID);
    assert.equal(groups[0].name, 'Inside');
    assert.deepEqual(
      groups[0].rooms.map((r) => r.id),
      ['living_room', 'kitchen', 'bedroom'],
    );
  });

  it('moves rooms without a floor onto the ground floor', () => {
    const hass = home();
    hass.areas.study = { area_id: 'study', name: 'Study', floor_id: null };
    hass.entities['light.study'] = { entity_id: 'light.study', area_id: 'study', labels: [] };
    hass.states['light.study'] = { ...hass.states['light.kitchen'], entity_id: 'light.study' };
    const groups = floorGroups(discover(hass, config()), names);
    assert.ok(groups.find((g) => g.id === 'ground')!.rooms.some((r) => r.id === 'study'));
  });

  it('uses the floor icon, or one for its level', () => {
    assert.equal(floorIcon(0), 'mdi:home-floor-0');
    assert.equal(floorIcon(-1), 'mdi:home-floor-negative-1');
    assert.equal(floorIcon(7), 'mdi:home-floor-l');
  });
});

describe('scopes', () => {
  const groups = floorGroups(discover(home(), config()), names);

  it('covers the rooms of the home, a floor or one room', () => {
    assert.equal(roomsIn(groups, { kind: 'home' }).length, 5);
    assert.deepEqual(
      roomsIn(groups, { kind: 'floor', id: 'ground' }).map((r) => r.id),
      ['living_room', 'kitchen'],
    );
    assert.deepEqual(
      roomsIn(groups, { kind: 'room', id: 'bedroom' }).map((r) => r.id),
      ['bedroom'],
    );
    assert.equal(groupOf(groups, 'garden')!.id, OUTSIDE);
  });

  it('falls back to the whole home when a floor or room disappears', () => {
    assert.deepEqual(validScope(groups, { kind: 'floor', id: 'gone' }), { kind: 'home' });
    assert.deepEqual(validScope(groups, { kind: 'room', id: 'gone' }), { kind: 'home' });
    assert.deepEqual(validScope(groups, { kind: 'floor', id: UNASSIGNED }), { kind: 'home' });
    assert.deepEqual(validScope(groups, { kind: 'room', id: 'kitchen' }), { kind: 'room', id: 'kitchen' });
  });
});
