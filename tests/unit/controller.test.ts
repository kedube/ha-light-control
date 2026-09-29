import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { LightController } from '../../src/controller.ts';
import { home, state, type ServiceCall } from './fixtures.ts';

class Host extends EventTarget {
  updates = 0;
  requestUpdate() {
    this.updates++;
  }
}

function setup(failServices = false) {
  const calls: ServiceCall[] = [];
  const host = new Host();
  const controller = new LightController(host);
  controller.hass = home({ calls, failServices });
  return { calls, host, controller };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LightController', () => {
  it('toggles lights and plugs through their own domains', async () => {
    const { calls, controller } = setup();
    controller.toggle('light.living_room_ceiling', 'light');
    controller.toggle('switch.tv_plug', 'outlet');
    await settle();
    assert.deepEqual(calls, [
      { domain: 'light', service: 'turn_on', data: { entity_id: ['light.living_room_ceiling'] } },
      { domain: 'switch', service: 'turn_off', data: { entity_id: ['switch.tv_plug'] } },
    ]);
  });

  it('routes other domains through homeassistant.turn_on', async () => {
    const { calls, controller } = setup();
    controller.setPower(['input_boolean.guest_mode'], true);
    await settle();
    assert.equal(calls[0].domain, 'homeassistant');
  });

  it('shows the new state instantly, before Home Assistant confirms', () => {
    const { controller, host } = setup();
    controller.setBrightness(['light.living_room_ceiling'], 40);
    const view = controller.view('light.living_room_ceiling', 'light')!;
    assert.equal(view.on, true);
    assert.equal(view.brightness, 40);
    assert.ok(host.updates > 0);
  });

  it('turns lights off when dimmed to zero', async () => {
    const { calls, controller } = setup();
    controller.setBrightness(['light.living_room_lamp'], 0);
    await settle();
    assert.equal(calls[0].service, 'turn_off');
  });

  it('sends colors and white temperatures', async () => {
    const { calls, controller } = setup();
    controller.setHs(['light.living_room_lamp'], [200.4, 55.6]);
    controller.setKelvin(['light.bedroom'], 3999.6);
    await settle();
    assert.deepEqual(calls[0].data, { entity_id: ['light.living_room_lamp'], hs_color: [200, 56] });
    assert.deepEqual(calls[1].data, { entity_id: ['light.bedroom'], color_temp_kelvin: 4000 });
  });

  it('offers an undo that restores brightness and color', async () => {
    const { calls, controller, host } = setup();
    let toast: { message: string; action: { action: () => void } } | undefined;
    host.addEventListener('hass-notification', (ev) => (toast = (ev as CustomEvent).detail));
    controller.turnOffWithUndo(['light.living_room_lamp', 'light.bedroom', 'light.living_room_ceiling']);
    await settle();
    assert.equal(toast?.message, 'Turned off 2 lights');
    assert.deepEqual(calls[0], {
      domain: 'light',
      service: 'turn_off',
      data: { entity_id: ['light.living_room_lamp', 'light.bedroom'] },
    });
    calls.length = 0;
    toast!.action.action();
    await settle();
    assert.deepEqual(
      calls.map((c) => c.data),
      [
        { entity_id: ['light.living_room_lamp'], brightness: 128, hs_color: [30, 80] },
        { entity_id: ['light.bedroom'], brightness: 51, color_temp_kelvin: 2700 },
      ],
    );
  });

  it('undo restores group members individually, never the whole group', async () => {
    const { calls, controller, host } = setup();
    const hass = controller.hass!;
    hass.states['light.bedroom_group'] = state('light.bedroom_group', 'on', {
      supported_color_modes: ['brightness'],
      entity_id: ['light.bedroom', 'light.bedroom_reading'],
    });
    hass.states['light.bedroom_reading'] = state('light.bedroom_reading', 'off', {
      supported_color_modes: ['brightness'],
    });
    let undo: (() => void) | undefined;
    host.addEventListener('hass-notification', (ev) => (undo = (ev as CustomEvent).detail.action.action));
    controller.turnOffWithUndo(['light.bedroom_group', 'light.bedroom', 'light.bedroom_reading']);
    await settle();
    calls.length = 0;
    undo!();
    await settle();
    assert.deepEqual(
      calls.map((c) => c.data.entity_id),
      [['light.bedroom']],
      'the reading light was off and must stay off',
    );
  });

  it('dims a room, floor or home through the lights that are on', async () => {
    const { calls, controller } = setup();
    controller.adjustBrightness(
      { litIds: ['light.living_room_lamp'], countedIds: ['light.living_room_lamp', 'light.living_room_ceiling'] },
      30,
    );
    await settle();
    assert.deepEqual(calls[0].data, { entity_id: ['light.living_room_lamp'], brightness_pct: 30 });
    calls.length = 0;
    controller.adjustBrightness({ litIds: [], countedIds: ['light.living_room_ceiling'] }, 60);
    await settle();
    assert.deepEqual(
      calls[0].data,
      { entity_id: ['light.living_room_ceiling'], brightness_pct: 60 },
      'nothing on: all of them',
    );
  });

  it('keeps a live slider drag on the lights it started with', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    try {
      const { calls, controller } = setup();
      const both = ['light.living_room_lamp', 'light.living_room_ceiling'];
      controller.previewAdjust({ litIds: [], countedIds: both }, 20);
      mock.timers.tick(100);
      controller.previewAdjust({ litIds: [], countedIds: both }, 40);
      mock.timers.tick(100);
      // Part-way through, Home Assistant reports one of them on.
      controller.adjustBrightness({ litIds: ['light.living_room_lamp'], countedIds: both }, 80);
      mock.timers.tick(2000);
      assert.deepEqual(
        calls.map((c) => [c.data.entity_id, c.data.brightness_pct]),
        [
          [both, 20],
          [both, 80],
        ],
      );
    } finally {
      mock.timers.reset();
    }
  });

  it('turns lights off with Undo when a room slider reaches zero', async () => {
    const { calls, controller, host } = setup();
    let message = '';
    host.addEventListener('hass-notification', (ev) => (message = (ev as CustomEvent).detail.message));
    controller.adjustBrightness(
      { litIds: ['light.living_room_lamp'], countedIds: ['light.living_room_lamp'] },
      0,
      'Living Room',
    );
    await settle();
    assert.equal(calls[0].service, 'turn_off');
    assert.equal(message, 'Turned off Living Room');
  });

  it('says "outlets" when outlets are switched off together', async () => {
    const { controller, host } = setup();
    let message = '';
    host.addEventListener('hass-notification', (ev) => (message = (ev as CustomEvent).detail.message));
    controller.turnOffWithUndo(['switch.tv_plug', 'switch.strip_outlet_1'], 'Home', 'outlets');
    await settle();
    assert.equal(message, 'Turned off 2 outlets');
  });

  it('still turns off a light that is only optimistically on', async () => {
    const { calls, controller } = setup();
    controller.setPower(['light.living_room_ceiling'], true);
    controller.turnOffWithUndo(['light.living_room_ceiling']);
    await settle();
    assert.deepEqual(
      calls.map((c) => c.service),
      ['turn_on', 'turn_off'],
    );
    assert.equal(controller.view('light.living_room_ceiling', 'light')!.on, false);
  });

  it('expires every optimistic change, not just the first', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    try {
      const { controller, host } = setup();
      controller.setPower(['light.living_room_ceiling'], true);
      mock.timers.tick(2000);
      controller.setPower(['light.no_area'], true);
      mock.timers.tick(3100);
      assert.equal(controller.view('light.living_room_ceiling', 'light')!.on, false, 'first change expired');
      assert.equal(controller.view('light.no_area', 'light')!.on, true, 'second change still pending');
      const updates = host.updates;
      mock.timers.tick(2100);
      assert.ok(host.updates > updates, 'a second expiry refresh was scheduled');
      assert.equal(controller.view('light.no_area', 'light')!.on, false, 'second change expired');
    } finally {
      mock.timers.reset();
    }
  });

  it('drops the optimistic state when a command fails', async () => {
    const { controller } = setup(true);
    controller.setBrightness(['light.living_room_ceiling'], 70);
    assert.equal(controller.view('light.living_room_ceiling', 'light')!.brightness, 70);
    await settle();
    await settle();
    assert.equal(controller.view('light.living_room_ceiling', 'light')!.on, false);
  });
});
