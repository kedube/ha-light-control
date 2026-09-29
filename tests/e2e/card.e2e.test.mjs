// End-to-end tests: the real dist/ bundle, driven in Chromium against the simulated
// Home Assistant from demo/. Run `npm run build:demo` first (CI does).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { launchBrowser, startServer } from '../../scripts/static-server.mjs';

let server;
let browser;

before(async () => {
  server = await startServer('.');
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function open(query = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto(`${server.url}/demo/index.html?e2e&theme=dark${query}`);
  await page.waitForSelector('light-control-card lc-tile');
  page.errors = errors;
  return page;
}

const stateOf = (page, entityId) => page.evaluate((id) => window.__demo.hass.states[id], entityId);
const services = (page) => page.evaluate(() => window.__demo.serviceLog.map((c) => `${c.domain}.${c.service}`));
const tile = (page, name) =>
  page
    .locator('lc-tile')
    .filter({ has: page.locator('.name', { hasText: name }) })
    .first();
const room = (page, name) =>
  page.locator('article.room').filter({ has: page.locator('.room-name', { hasText: name }) });
const tab = (page, name) => page.locator('nav.tabs').getByRole('tab', { name, exact: true });
const waitForState = (page, entityId, predicate) =>
  page.waitForFunction(
    ([id, source]) => new Function('s', `return ${source}`)(window.__demo.hass.states[id]),
    [entityId, predicate],
  );

describe('Light Control Card in a browser', () => {
  it('discovers rooms, groups them by floor and leaves out the clutter', async () => {
    const page = await open();
    const floors = await page.locator('.floor-head .floor-name').allTextContents();
    assert.deepEqual(floors, ['Ground Floor', 'Upstairs', 'Basement', 'Outside', 'Other']);
    const ground = await page.locator('section.floor').first().locator('.room-name').allTextContents();
    assert.deepEqual(ground, ['Living Room', 'Kitchen', 'Dining Room', 'Hallway', 'Garage']);
    const names = await page.locator('lc-tile .name').allTextContents();
    for (const hidden of ['Kitchen Switch LED', 'Old Bulb', 'Spare', 'Desktop PC', 'Garage Door Light Sync']) {
      assert.ok(!names.some((n) => n.includes(hidden)), `${hidden} should not be shown`);
    }
    assert.ok(names.includes('Coffee Maker'), 'plug found from its device model');
    assert.ok(names.includes('Ceiling'), 'room name stripped from "Living Room Ceiling"');
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  it('keeps outlets apart from lights inside each room', async () => {
    const page = await open();
    const living = room(page, 'Living Room');
    assert.deepEqual(await living.locator('.grid lc-tile .name').allTextContents(), [
      'Ceiling',
      'Floor Lamp',
      'TV Backlight',
    ]);
    assert.deepEqual(await living.locator('.outlet-row lc-tile .name').allTextContents(), ['TV Plug']);
    await page.close();
  });

  it('toggles a light with a tap', async () => {
    const page = await open();
    await tile(page, 'Chandelier').click();
    await waitForState(page, 'light.dining_chandelier', "s.state === 'on'");
    await tile(page, 'Chandelier').click();
    await waitForState(page, 'light.dining_chandelier', "s.state === 'off'");
    await page.close();
  });

  it('dims a light by sliding across its tile', async () => {
    const page = await open();
    await tile(page, 'Ceiling').scrollIntoViewIfNeeded();
    const box = await tile(page, 'Ceiling').locator('.tile').boundingBox();
    const y = box.y + box.height * 0.75;
    await page.mouse.move(box.x + box.width * 0.6, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, y, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.3, y, { steps: 6 });
    await page.mouse.up();
    await waitForState(
      page,
      'light.living_room_ceiling',
      's.attributes.brightness < 90 && s.attributes.brightness > 60',
    );
    const call = await page.evaluate(() => window.__demo.serviceLog.at(-1));
    assert.equal(call.service, 'turn_on');
    assert.ok(Math.abs(call.data.brightness_pct - 30) <= 3, `brightness_pct ${call.data.brightness_pct}`);
    await page.close();
  });

  it('opens the controls on a long press and applies a color preset', async () => {
    const page = await open();
    await tile(page, 'Floor Lamp').scrollIntoViewIfNeeded();
    const box = await tile(page, 'Floor Lamp').locator('.icon').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    const sheet = page.locator('lc-sheet dialog[open]');
    await sheet.waitFor();
    assert.equal(await sheet.locator('h2').textContent(), 'Floor Lamp');
    await sheet.locator('button.swatch[aria-label="Blue"]').click();
    await waitForState(
      page,
      'light.living_room_floor_lamp',
      "s.attributes.color_mode === 'hs' && s.attributes.hs_color[0] === 225",
    );
    await page.keyboard.press('Escape');
    await page.locator('lc-sheet dialog[open]').waitFor({ state: 'detached' });
    await page.close();
  });

  it('switches a room’s lights off and back with Undo, leaving its outlets on', async () => {
    const page = await open();
    await room(page, 'Living Room').locator('.quick-toggle.light').click();
    await waitForState(page, 'light.living_room_ceiling', "s.state === 'off'");
    assert.equal((await stateOf(page, 'switch.tv_plug')).state, 'on', 'outlets are separate');
    await page.locator('#toasts .toast button').click();
    await waitForState(
      page,
      'light.living_room_ceiling',
      "s.state === 'on' && s.attributes.color_temp_kelvin === 2700",
    );
    await waitForState(page, 'light.living_room_floor_lamp', "s.state === 'on'");
    await page.close();
  });

  it('turns every light in the home off without touching the outlets', async () => {
    const page = await open();
    await page.locator('.control.lights .switch').click();
    await waitForState(page, 'light.living_room_ceiling', "s.state === 'off'");
    await waitForState(page, 'light.garden_path', "s.state === 'off'");
    for (const plug of ['switch.tv_plug', 'switch.monitor_plug', 'switch.dehumidifier']) {
      assert.equal((await stateOf(page, plug)).state, 'on', `${plug} stays on`);
    }
    assert.ok(!(await services(page)).includes('switch.turn_off'));
    await page.close();
  });

  it('asks for a second tap before switching several outlets off', async () => {
    const page = await open();
    const outlets = page.locator('.control.outlets');
    await outlets.locator('.switch').click();
    await outlets.locator('.confirm').waitFor();
    assert.equal((await stateOf(page, 'switch.tv_plug')).state, 'on', 'the first tap only asks');
    await outlets.locator('.switch').click();
    await waitForState(page, 'switch.tv_plug', "s.state === 'off'");
    await waitForState(page, 'switch.dehumidifier', "s.state === 'off'");
    assert.equal((await stateOf(page, 'light.living_room_ceiling')).state, 'on', 'lights are separate');
    assert.match(await page.locator('#toasts .toast').textContent(), /Turned off 3 outlets/);
    await page.close();
  });

  it('opens a floor from its tab and controls just that floor', async () => {
    const page = await open();
    await tab(page, 'Upstairs').click();
    assert.deepEqual(await page.locator('article.room .room-name').allTextContents(), [
      'Bedroom',
      'Kids Room',
      'Office',
      'Bathroom',
    ]);
    await page.locator('lc-house .tag', { hasText: 'Kids Room' }).waitFor();
    assert.match(await page.locator('.control.lights .control-state').textContent(), /3 of 8 on/);
    // The floor's slider dims the lights that are on and leaves the others off.
    const bar = await page.locator('.control.lights lc-slider .bar').boundingBox();
    await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
    await waitForState(page, 'light.bedside_left', 's.attributes.brightness > 110 && s.attributes.brightness < 145');
    await waitForState(page, 'light.office_desk_lamp', 's.attributes.brightness < 145');
    assert.equal((await stateOf(page, 'light.bedside_right')).state, 'off');
    assert.equal(
      (await stateOf(page, 'light.living_room_ceiling')).attributes.brightness,
      Math.round(0.78 * 255),
      'downstairs is untouched',
    );
    await page.close();
  });

  it('drills down from the house to a room, and back to its floor', async () => {
    const page = await open();
    await page.locator('lc-house .hit[aria-label^="Bedroom"]').first().click();
    await page.locator('.room-bar h2', { hasText: 'Bedroom' }).waitFor();
    assert.equal(await tab(page, 'Upstairs').getAttribute('aria-selected'), 'true');
    assert.deepEqual(await page.locator('.rows lc-tile .name').allTextContents(), [
      'Bedside Left',
      'Bedside Right',
      'Ceiling',
      'Fan Plug',
    ]);
    // Each light in the room has its own switch, and its own slider when it dims.
    await page.locator('.rows lc-tile', { hasText: 'Bedside Right' }).locator('.toggle').click();
    await waitForState(page, 'light.bedside_right', "s.state === 'on'");
    await page.locator('.room-bar .back').click();
    await page.locator('article.room .room-name', { hasText: 'Kids Room' }).waitFor();
    await page.close();
  });

  it('opens a room from the list, and shows it lit up in the house', async () => {
    const page = await open();
    await room(page, 'Office').locator('.room-title').click();
    await page.locator('.room-bar h2', { hasText: 'Office' }).waitFor();
    await page.locator('lc-house .tag.selected', { hasText: 'Office' }).waitFor();
    await page.close();
  });

  it('filters to what is on now', async () => {
    const page = await open();
    await page.locator('.rooms-bar .filter').click();
    await page.locator('article.room', { hasText: 'Dining Room' }).waitFor({ state: 'detached' });
    const states = await page.locator('article.room lc-tile .state').allTextContents();
    assert.ok(states.length > 0 && states.every((s) => !/^Off$/.test(s)), 'only things that are on');
    await page.close();
  });

  it('shows new devices without any configuration change', async () => {
    const page = await open();
    await page.evaluate(() => window.__demo.addLight());
    await tile(page, 'Island').waitFor();
    await page.evaluate(() => window.__demo.removeLight());
    await tile(page, 'Island').waitFor({ state: 'detached' });
    await page.close();
  });

  it('speaks the user’s language', async () => {
    const page = await open('&lang=de');
    await tab(page, 'Zuhause').waitFor();
    assert.equal(await page.locator('.control.lights .control-name').textContent(), 'Lichter');
    assert.equal(await page.locator('.control.outlets .control-name').textContent(), 'Steckdosen');
    await page.close();
  });

  it('shows live power and a 24-hour history for plugs', async () => {
    const page = await open();
    assert.match(await tile(page, 'TV Plug').locator('.state').textContent(), /On · 86 W/);
    await tile(page, 'TV Plug').locator('.tile').click({ button: 'right' });
    const sheet = page.locator('lc-sheet dialog[open]');
    await sheet.locator('.spark svg').waitFor();
    assert.match(await sheet.locator('.watts .value').textContent(), /86 W/);
    await page.close();
  });

  it('respects card options', async () => {
    const page = await open();
    await page.evaluate(() => window.__demo.setConfig({ show_outlets: false, show_house: false }));
    await page.locator('lc-house').waitFor({ state: 'detached' });
    const names = await page.locator('lc-tile .name').allTextContents();
    assert.ok(!names.includes('TV Plug'));
    assert.equal(await page.locator('.control.outlets').count(), 0, 'no outlets control without outlets');
    await page.close();
  });
});
