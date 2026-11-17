import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatWatts, readWatts, summarize, summarizeRooms } from '../../src/aggregate.ts';
import {
  accentFor,
  averageRgb,
  hsToRgb,
  kelvinPresetKey,
  kelvinToDisplayRgb,
  kelvinToRgb,
  luminance,
  rgbToHs,
  WARM_GLOW,
} from '../../src/color.ts';
import { globToRegExp, makeEntityMatcher, resolveConfig } from '../../src/config.ts';
import { discover } from '../../src/discovery.ts';
import { computeDomain, entityView, overrideSettled } from '../../src/entity-model.ts';
import { config, home, state } from './fixtures.ts';

describe('config', () => {
  it('fills defaults and keeps user values', () => {
    const c = resolveConfig({ type: 'custom:light-control-card', show_house: false, title: '' });
    assert.equal(c.show_house, false);
    assert.equal(c.show_outlets, true);
    assert.equal(c.outlet_detection, 'smart');
    assert.equal(c.title, '');
    assert.equal(resolveConfig({ type: 'x' }).title, undefined, 'the card translates the default title');
  });

  it('rejects bad values with a readable message', () => {
    assert.throws(() => resolveConfig({ type: 'x', show_house: 'yes' as unknown as boolean }), /show_house/);
    assert.throws(() => resolveConfig({ type: 'x', tap_action: 'launch' as never }), /tap_action/);
    assert.throws(() => resolveConfig({ type: 'x', exclude: [1] as unknown as string[] }), /exclude/);
  });

  it('reads the house options: style, colors, facing and the sky', () => {
    const defaults = resolveConfig({ type: 'x' });
    assert.deepEqual(
      [defaults.house_style, defaults.house_facing, defaults.sky_weather, defaults.animate_sky],
      ['auto', 'auto', true, true],
    );
    assert.equal(defaults.house_color, undefined, 'the style picks the colors until the user does');
    const c = resolveConfig({
      type: 'x',
      house_style: 'brick',
      house_facing: 'sw',
      house_color: '#A0b4C8',
      roof_color: [70, 60, 50],
      trim_color: '#fff',
      weather_entity: 'weather.home',
    });
    assert.deepEqual(c.house_color, [160, 180, 200]);
    assert.deepEqual(c.roof_color, [70, 60, 50]);
    assert.deepEqual(c.trim_color, [255, 255, 255]);
    assert.equal(c.door_color, undefined);
    assert.equal(c.weather_entity, 'weather.home');
    assert.throws(() => resolveConfig({ type: 'x', house_color: 'blueish' }), /house_color/);
    assert.throws(() => resolveConfig({ type: 'x', door_color: [300, 0, 0] }), /door_color/);
    assert.throws(() => resolveConfig({ type: 'x', house_style: 'castle' as never }), /house_style/);
    assert.throws(() => resolveConfig({ type: 'x', house_facing: 'up' as never }), /house_facing/);
  });

  it('accepts a single string where a list is expected', () => {
    assert.deepEqual(resolveConfig({ type: 'x', areas: 'kitchen' as unknown as string[] }).areas, ['kitchen']);
  });

  it('matches wildcard patterns against ids or object ids', () => {
    assert.equal(globToRegExp('switch.*_led').test('switch.desk_led'), true);
    const match = makeEntityMatcher(['switch.*_led', '*_child_lock']);
    assert.equal(match('switch.desk_led'), true);
    assert.equal(match('light.desk_led'), false);
    assert.equal(match('switch.plug_child_lock'), true);
    assert.equal(makeEntityMatcher([])('light.x'), false);
  });
});

describe('color', () => {
  it('converts hue and saturation', () => {
    assert.deepEqual(hsToRgb(0, 100), [255, 0, 0]);
    assert.deepEqual(hsToRgb(120, 100), [0, 255, 0]);
    assert.deepEqual(hsToRgb(240, 100), [0, 0, 255]);
    assert.deepEqual(hsToRgb(77, 0), [255, 255, 255]);
    assert.deepEqual(rgbToHs(hsToRgb(200, 60)), [200, 60]);
  });

  it('approximates black-body colors', () => {
    const warm = kelvinToRgb(2700);
    assert.equal(warm[0], 255);
    assert.ok(warm[2] < 120, 'warm light has little blue');
    const cool = kelvinToRgb(6500);
    assert.ok(cool[2] > 240, 'daylight is nearly white');
    const display = kelvinToDisplayRgb(6500);
    assert.ok(display[2] > display[0], 'pickers draw cool white slightly blue');
  });

  it('averages colors by weight and keeps pale accents readable', () => {
    assert.deepEqual(
      averageRgb([
        { rgb: [255, 0, 0], weight: 1 },
        { rgb: [0, 0, 255], weight: 3 },
      ]),
      [64, 0, 191],
    );
    assert.equal(averageRgb([]), null);
    assert.deepEqual(accentFor([255, 255, 255], true), [255, 255, 255]);
    assert.ok(luminance(accentFor([255, 255, 255], false)) < 0.75);
    assert.equal(kelvinPresetKey(2650), 'warm');
  });
});

describe('entityView', () => {
  const lamp = state('light.lamp', 'on', {
    supported_color_modes: ['hs', 'color_temp'],
    color_mode: 'hs',
    brightness: 128,
    hs_color: [30, 80],
    rgb_color: [255, 160, 51],
    supported_features: 4,
    effect_list: ['Rainbow'],
    min_mireds: 153,
    max_mireds: 500,
  });

  it('maps brightness and capabilities', () => {
    const view = entityView(lamp, 'light');
    assert.equal(view.brightness, 50);
    assert.equal(view.dimmable, true);
    assert.equal(view.supportsColor, true);
    assert.equal(view.supportsTemp, true);
    assert.deepEqual(view.effects, ['Rainbow']);
    assert.equal(view.minKelvin, 2000);
    assert.equal(view.maxKelvin, 6536);
    assert.deepEqual(view.rgb, [255, 160, 51]);
  });

  it('never reports a lit light at 0%', () => {
    const view = entityView(
      state('light.dim', 'on', { supported_color_modes: ['brightness'], brightness: 1 }),
      'light',
    );
    assert.equal(view.brightness, 1);
  });

  it('treats off and unavailable as dark', () => {
    assert.equal(entityView(state('light.x', 'off', { supported_color_modes: ['brightness'] }), 'light').brightness, 0);
    const gone = entityView(state('light.x', 'unavailable', {}), 'light');
    assert.equal(gone.on, false);
    assert.equal(gone.unavailable, true);
  });

  it('shows optimistic overrides until Home Assistant agrees', () => {
    const override = { on: true, brightness: 80, expires: Date.now() + 5000 };
    assert.equal(entityView(lamp, 'light', override).brightness, 80);
    assert.equal(overrideSettled(override, entityView(lamp, 'light'), Date.now()), false);
    const updated = state('light.lamp', 'on', { ...lamp.attributes, brightness: 204 });
    assert.equal(overrideSettled(override, entityView(updated, 'light'), Date.now()), true);
    assert.equal(overrideSettled(override, entityView(lamp, 'light'), Date.now() + 6000), true);
  });

  it('ignores brightness overrides on lights that cannot dim or are unavailable', () => {
    const override = { on: true, brightness: 40, expires: Date.now() + 5000 };
    const bulb = state('light.bulb', 'on', { supported_color_modes: ['onoff'] });
    assert.equal(entityView(bulb, 'light', override).brightness, 100);
    assert.equal(overrideSettled(override, entityView(bulb, 'light'), Date.now()), true, 'on/off bulb settles');
    const gone = state('light.gone', 'unavailable', { supported_color_modes: ['brightness'] });
    assert.equal(entityView(gone, 'light', override).brightness, 0);
  });

  it('accepts only plain numbers for rgb_color and never hands back the state array', () => {
    const tampered = state('light.t', 'on', {
      supported_color_modes: ['rgb'],
      rgb_color: ['0;background:url(//example.invalid/x)', 0, 0],
    });
    assert.deepEqual(entityView(tampered, 'light').rgb, WARM_GLOW);
    const plain = state('light.p', 'on', { supported_color_modes: ['rgb'], rgb_color: [1, 2, 3] });
    const view = entityView(plain, 'light');
    assert.deepEqual(view.rgb, [1, 2, 3]);
    assert.notEqual(view.rgb, plain.attributes.rgb_color);
  });
});

describe('computeDomain', () => {
  it('splits at the first dot, and has no domain without one', () => {
    assert.equal(computeDomain('light.kitchen'), 'light');
    assert.equal(computeDomain('scenex'), '');
  });
});

describe('summarize', () => {
  it('counts lights once even when a group duplicates them', () => {
    const hass = home();
    const bedroom = discover(hass, config()).rooms.find((r) => r.id === 'bedroom')!;
    const summary = summarize(bedroom.entities, (e) => entityView(hass.states[e.entityId], e.kind), hass);
    assert.equal(summary.lights, 1);
    assert.equal(summary.lightsOn, 1);
    assert.equal(summary.brightness, 20);
    assert.ok(summary.lightIds.includes('light.bedroom_group'));
    assert.equal(summary.plugs, 2, 'two power-strip outlets; the PC switch is not a plug');
  });

  it('knows which lights are on, for dimming a whole room', () => {
    const hass = home();
    const living = discover(hass, config()).rooms.find((r) => r.id === 'living_room')!;
    const summary = summarize(living.entities, (e) => entityView(hass.states[e.entityId], e.kind), hass);
    assert.deepEqual(summary.litIds, ['light.living_room_lamp']);
    assert.deepEqual(summary.countedIds, ['light.living_room_ceiling', 'light.living_room_lamp']);
  });

  it('adds up floors and the whole home room by room', () => {
    const hass = home();
    hass.areas.den = { area_id: 'den', name: 'Den', floor_id: 'ground' };
    hass.entities['light.den_group'] = { entity_id: 'light.den_group', area_id: 'den', labels: [] };
    hass.states['light.den_group'] = state('light.den_group', 'on', {
      supported_color_modes: ['brightness'],
      brightness: 255,
      entity_id: ['light.den_1', 'light.den_2'],
    });
    const { rooms } = discover(hass, config());
    const viewOf = (e: { entityId: string; kind: 'light' | 'outlet' | 'switch' }) =>
      entityView(hass.states[e.entityId], e.kind);
    const all = summarizeRooms(rooms, viewOf, hass);
    // A room whose only light is a group still counts, even beside rooms with single lights.
    assert.ok(all.countedIds.includes('light.den_group'));
    assert.ok(!all.countedIds.includes('light.bedroom_group'), 'the bedroom group duplicates its member');
    assert.equal(all.plugsOn, 2);
  });

  it('adds up plug power', () => {
    const hass = home();
    const living = discover(hass, config()).rooms.find((r) => r.id === 'living_room')!;
    const summary = summarize(living.entities, (e) => entityView(hass.states[e.entityId], e.kind), hass);
    assert.equal(summary.watts, 86.4);
    assert.equal(summary.plugsOn, 1);
  });

  it('reads power in any unit and formats it', () => {
    const hass = home({ states: [state('sensor.p', '1.5', { unit_of_measurement: 'kW' })] });
    assert.equal(readWatts(hass, 'sensor.p'), 1500);
    assert.equal(readWatts(hass, 'sensor.missing'), null);
    assert.equal(formatWatts(1500, 'en'), '1.5 kW');
    assert.equal(formatWatts(86.4, 'en'), '86 W');
    assert.equal(formatWatts(4.25, 'en'), '4.3 W');
  });
});
