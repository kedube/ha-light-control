import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { discover, isOutdoorName, roomIcon, stripAreaName, UNASSIGNED } from '../../src/discovery.ts';
import { config, home, state } from './fixtures.ts';

const ids = (hass = home(), overrides = {}) =>
  discover(hass, config(overrides)).rooms.flatMap((room) => room.entities.map((e) => e.entityId));

describe('discover', () => {
  it('groups lights and plugs into rooms in floor order, then unassigned', () => {
    const { rooms } = discover(home(), config());
    assert.deepEqual(
      rooms.map((r) => r.id),
      ['living_room', 'kitchen', 'bedroom', 'garden', UNASSIGNED],
    );
    assert.equal(rooms.at(-1)!.name, 'Other');
  });

  it('skips hidden, config-category and orphaned (restored) entities', () => {
    const found = ids();
    assert.ok(!found.includes('light.bedroom_hidden'));
    assert.ok(!found.includes('light.kitchen_led'));
    assert.ok(!found.includes('light.orphan'));
  });

  it('finds entities through their device area', () => {
    const { rooms } = discover(home(), config());
    const living = rooms.find((r) => r.id === 'living_room')!;
    assert.ok(living.entities.some((e) => e.entityId === 'switch.tv_plug'));
  });

  it('never shows rooms that have nothing to control', () => {
    assert.ok(!discover(home(), config()).rooms.some((r) => r.id === 'empty'));
  });

  it('detects plugs by device class and by plug-like device names (smart mode)', () => {
    const found = ids();
    assert.ok(found.includes('switch.tv_plug'), 'device_class outlet');
    assert.ok(found.includes('switch.coffee_maker'), 'model "Mini Smart Plug"');
    assert.ok(found.includes('switch.strip_outlet_1'), 'model "Power Strip"');
    assert.ok(!found.includes('switch.coffee_maker_child_lock'), 'plug settings are not plugs');
    assert.ok(!found.includes('switch.desktop_pc'), 'ordinary switches stay out');
  });

  it('honors the other outlet detection modes', () => {
    const strict = ids(home(), { outlet_detection: 'device_class' });
    assert.ok(strict.includes('switch.tv_plug'));
    assert.ok(!strict.includes('switch.coffee_maker'));

    const all = discover(home(), config({ outlet_detection: 'all_switches' }));
    const pc = all.rooms.flatMap((r) => r.entities).find((e) => e.entityId === 'switch.desktop_pc');
    assert.equal(pc?.kind, 'switch');

    assert.ok(!ids(home(), { show_outlets: false }).some((id) => id.startsWith('switch.')));
  });

  it('strips the room name from entity names', () => {
    const living = discover(home(), config()).rooms.find((r) => r.id === 'living_room')!;
    assert.deepEqual(
      living.entities.filter((e) => e.kind === 'light').map((e) => e.name),
      ['Ceiling', 'Lamp'],
    );
    const unstripped = discover(home(), config({ strip_area_names: false })).rooms[0];
    assert.ok(unstripped.entities.some((e) => e.name === 'Living Room Lamp'));
  });

  it('puts light groups first and can hide them', () => {
    const bedroom = discover(home(), config()).rooms.find((r) => r.id === 'bedroom')!;
    assert.equal(bedroom.entities[0].entityId, 'light.bedroom_group');
    assert.equal(bedroom.entities[0].isGroup, true);
    assert.ok(!ids(home(), { show_light_groups: false }).includes('light.bedroom_group'));
  });

  it('attaches power and energy sensors to plugs', () => {
    const plug = discover(home(), config())
      .rooms.flatMap((r) => r.entities)
      .find((e) => e.entityId === 'switch.tv_plug')!;
    assert.equal(plug.sensors.power, 'sensor.tv_plug_power');
    assert.equal(plug.sensors.energy, 'sensor.tv_plug_energy');
  });

  it('does not pin a shared power-strip sensor on individual outlets', () => {
    const outlet = discover(home(), config())
      .rooms.flatMap((r) => r.entities)
      .find((e) => e.entityId === 'switch.strip_outlet_1')!;
    assert.equal(outlet.sensors.power, undefined);
  });

  it('matches per-outlet sensors on power strips by name', () => {
    const hass = home();
    hass.entities['sensor.strip_outlet_1_power'] = {
      entity_id: 'sensor.strip_outlet_1_power',
      device_id: 'strip',
      labels: [],
    };
    hass.states['sensor.strip_outlet_1_power'] = state('sensor.strip_outlet_1_power', '12', { device_class: 'power' });
    const outlet = discover(hass, config())
      .rooms.flatMap((r) => r.entities)
      .find((e) => e.entityId === 'switch.strip_outlet_1')!;
    assert.equal(outlet.sensors.power, 'sensor.strip_outlet_1_power');
  });

  it('applies include, exclude and wildcard patterns', () => {
    assert.ok(ids(home(), { include: ['input_boolean.guest_mode'] }).includes('input_boolean.guest_mode'));
    assert.ok(ids(home(), { include: ['light.bedroom_hidden'] }).includes('light.bedroom_hidden'));
    assert.ok(!ids(home(), { exclude: ['light.kitchen'] }).includes('light.kitchen'));
    const patterned = ids(home(), { exclude_patterns: ['switch.strip_*', '*_lamp'] });
    assert.ok(!patterned.includes('switch.strip_outlet_1'));
    assert.ok(!patterned.includes('light.living_room_lamp'));
    assert.ok(patterned.includes('light.living_room_ceiling'));
  });

  it('filters and orders by areas and floors', () => {
    const { rooms } = discover(home(), config({ areas: ['bedroom', 'kitchen'] }));
    assert.deepEqual(
      rooms.map((r) => r.id),
      ['bedroom', 'kitchen'],
    );
    const upstairs = discover(home(), config({ floors: ['upstairs'] })).rooms;
    assert.deepEqual(
      upstairs.map((r) => r.id),
      ['bedroom'],
    );
    const withoutKitchen = discover(home(), config({ exclude_areas: ['kitchen'] })).rooms;
    assert.ok(!withoutKitchen.some((r) => r.id === 'kitchen'));
  });

  it('keeps watching lights hidden because of their state', () => {
    const { rooms, stateGated, watched } = discover(home(), config({ show_unavailable: false }));
    assert.ok(!rooms.flatMap((r) => r.entities).some((e) => e.entityId === 'light.garden'));
    assert.ok(stateGated.includes('light.garden'), 'unavailable');
    assert.ok(stateGated.includes('light.orphan'), 'orphaned');
    assert.ok(watched.includes('light.garden'));
  });

  it('can hide unassigned and unavailable entities', () => {
    assert.ok(!discover(home(), config({ show_unassigned: false })).rooms.some((r) => r.id === UNASSIGNED));
    assert.ok(!ids(home(), { show_unavailable: false }).includes('light.garden'));
    assert.equal(discover(home(), config({ unassigned_name: 'Elsewhere' })).rooms.at(-1)!.name, 'Elsewhere');
  });

  it('marks outdoor areas and collects area scenes', () => {
    const { rooms, watched } = discover(home(), config());
    assert.equal(rooms.find((r) => r.id === 'garden')!.outdoor, true);
    assert.deepEqual(rooms.find((r) => r.id === 'living_room')!.scenes, ['scene.living_room_movie']);
    assert.ok(watched.includes('sun.sun'));
    assert.ok(watched.includes('sensor.tv_plug_power'));
    assert.equal(discover(home(), config({ show_scenes: false })).rooms[0].scenes.length, 0);
  });

  it('picks up new devices and forgets removed ones without config changes', () => {
    const hass = home();
    hass.entities['light.kitchen_island'] = { entity_id: 'light.kitchen_island', area_id: 'kitchen', labels: [] };
    hass.states['light.kitchen_island'] = state('light.kitchen_island', 'on', { friendly_name: 'Kitchen Island' });
    assert.ok(ids(hass).includes('light.kitchen_island'));
    delete hass.states['light.kitchen_island'];
    assert.ok(!ids(hass).includes('light.kitchen_island'));
  });

  it('copes with a bare install that has no floors or areas', () => {
    const hass = home({ areas: [], floors: [], devices: [], entities: [] });
    const { rooms } = discover(hass, config());
    assert.deepEqual(
      rooms.map((r) => r.id),
      [UNASSIGNED],
    );
  });
});

describe('stripAreaName', () => {
  it('removes a leading room name at a word boundary', () => {
    assert.equal(stripAreaName('Living Room Floor Lamp', 'Living Room'), 'Floor Lamp');
    assert.equal(stripAreaName('living room - lamp', 'Living Room'), 'Lamp');
    assert.equal(stripAreaName('Denmark Lamp', 'Den'), 'Denmark Lamp');
    assert.equal(stripAreaName('Kitchen', 'Kitchen'), 'Kitchen');
    assert.equal(stripAreaName('Lamp', undefined), 'Lamp');
  });
});

describe('roomIcon and isOutdoorName', () => {
  it('prefers the area icon, then recognizes room names in several languages', () => {
    assert.equal(roomIcon('Living Room', 'mdi:rocket'), 'mdi:rocket');
    assert.equal(roomIcon('Kitchen'), 'mdi:stove');
    assert.equal(roomIcon('Küche'), 'mdi:stove');
    assert.equal(roomIcon('Sala de jantar'), 'mdi:silverware-fork-knife');
    assert.equal(roomIcon('Kinderzimmer'), 'mdi:teddy-bear');
    assert.equal(roomIcon('Sypialnia'), 'mdi:bed');
    assert.equal(roomIcon('Zzz'), 'mdi:texture-box');
  });

  it('recognizes outdoor spaces by whole words', () => {
    assert.equal(isOutdoorName('Garten'), true);
    assert.equal(isOutdoorName('Front Porch'), true);
    assert.equal(isOutdoorName('Außenbereich'), true);
    assert.equal(isOutdoorName('Kitchen'), false);
    assert.equal(isOutdoorName('Finished Basement'), false, 'not a shed');
    assert.equal(isOutdoorName('Kindergarten'), false, 'not a garden');
    assert.equal(isOutdoorName('Pool Room'), false, 'a room is indoors');
    assert.equal(isOutdoorName('Garden Room'), false);
  });
});
