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
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto(`${server.url}/demo/index.html?e2e&theme=dark${query}`);
  await page.waitForSelector('light-control-card lc-tile');
  page.errors = errors;
  return page;
}

const stateOf = (page, entityId) => page.evaluate((id) => window.__demo.hass.states[id], entityId);
const tile = (page, name) =>
  page
    .locator('lc-tile')
    .filter({ has: page.locator('.name', { hasText: name }) })
    .first();
const waitForState = (page, entityId, predicate) =>
  page.waitForFunction(
    ([id, source]) => new Function('s', `return ${source}`)(window.__demo.hass.states[id]),
    [entityId, predicate],
  );

describe('Light Control Card in a browser', () => {
  it('discovers rooms in Home Assistant order and leaves out the clutter', async () => {
    const page = await open();
    const rooms = await page.locator('section.room .room-name').allTextContents();
    assert.deepEqual(rooms.slice(0, 5), ['Living Room', 'Kitchen', 'Dining Room', 'Hallway', 'Garage']);
    assert.equal(rooms.at(-1), 'Other');
    const names = await page.locator('lc-tile .name').allTextContents();
    for (const hidden of ['Kitchen Switch LED', 'Old Bulb', 'Spare', 'Desktop PC', 'Garage Door Light Sync']) {
      assert.ok(!names.some((n) => n.includes(hidden)), `${hidden} should not be shown`);
    }
    assert.ok(names.includes('Coffee Maker'), 'plug found from its device model');
    assert.ok(names.includes('Ceiling'), 'room name stripped from "Living Room Ceiling"');
    assert.deepEqual(page.errors, []);
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
    const box = await tile(page, 'Ceiling').locator('.tile').boundingBox();
    const y = box.y + box.height / 2;
    // Start on the tile body; the round button on the right opens the controls instead.
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

  it('switches a whole room off and brings it back with Undo', async () => {
    const page = await open();
    await page.locator('section.room', { hasText: 'Living Room' }).locator('button.switch').click();
    await waitForState(page, 'light.living_room_ceiling', "s.state === 'off'");
    assert.equal((await stateOf(page, 'switch.tv_plug')).state, 'on', 'plugs are left alone by default');
    await page.locator('#toasts .toast button').click();
    await waitForState(
      page,
      'light.living_room_ceiling',
      "s.state === 'on' && s.attributes.color_temp_kelvin === 2700",
    );
    await waitForState(page, 'light.living_room_floor_lamp', "s.state === 'on'");
    await page.close();
  });

  it('focuses a room from the filter chips and from the house', async () => {
    const page = await open();
    const chip = (name) => page.locator('.chips').getByRole('button', { name, exact: true });
    await chip('Kitchen').click();
    assert.deepEqual(await page.locator('section.room .room-name').allTextContents(), ['Kitchen']);
    await chip('All').click();
    await page.locator('lc-house .win[aria-label^="Bedroom"]').click();
    assert.deepEqual(await page.locator('section.room .room-name').allTextContents(), ['Bedroom']);
    await page.locator('.chips .chip', { hasText: 'On now' }).click();
    await page.locator('section.room', { hasText: 'Dining Room' }).waitFor({ state: 'detached' });
    const lit = await page.locator('lc-tile .state').allTextContents();
    assert.ok(lit.length > 0 && lit.every((s) => !/^Off$/.test(s)), 'only things that are on');
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
    await page.locator('.chip', { hasText: 'Gerade an' }).waitFor();
    assert.equal(await page.locator('.all-off span').textContent(), 'Alle aus');
    await page.close();
  });

  it('shows live power and a 24-hour history for plugs', async () => {
    const page = await open();
    assert.match(await tile(page, 'TV Plug').locator('.state').textContent(), /On · 86 W/);
    await tile(page, 'TV Plug').locator('button.more').click();
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
    await page.close();
  });
});
