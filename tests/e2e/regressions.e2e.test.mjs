// Browser regressions found in review: touch gestures, dialog lifecycle and live discovery.
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

async function open({ touch = false, query = '' } = {}) {
  const context = await browser.newContext(
    touch
      ? { hasTouch: true, isMobile: true, viewport: { width: 420, height: 900 } }
      : { viewport: { width: 1280, height: 1000 } },
  );
  const page = await context.newPage();
  await page.goto(`${server.url}/demo/index.html?e2e&theme=dark${query}`);
  await page.waitForSelector('light-control-card lc-tile');
  return { page, context };
}

const tile = (page, name) =>
  page
    .locator('lc-tile')
    .filter({ has: page.locator('.name', { hasText: name }) })
    .first();
const state = (page, id) => page.evaluate((entityId) => window.__demo.hass.states[entityId], id);

describe('Regressions', () => {
  it('dims with a finger drag that starts on the tile text', async () => {
    const { page, context } = await open({ touch: true });
    const box = await tile(page, 'Floor Lamp').locator('.name').boundingBox();
    const tileBox = await tile(page, 'Floor Lamp').locator('.tile').boundingBox();
    const cdp = await context.newCDPSession(page);
    const touch = (type, x, y) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const y = box.y + box.height / 2;
    await touch('touchStart', box.x + 4, y);
    for (let i = 1; i <= 8; i++)
      await touch('touchMove', box.x + 4 + (i / 8) * (tileBox.x + tileBox.width * 0.9 - box.x), y);
    await touch('touchEnd');
    await page.waitForFunction(
      () => window.__demo.hass.states['light.living_room_floor_lamp'].attributes.brightness > 200,
    );
    await context.close();
  });

  it('stays closed after swiping the sheet away', async () => {
    const { page, context } = await open();
    await tile(page, 'Floor Lamp').locator('button.more').click();
    const grab = await page.locator('lc-sheet .grab').boundingBox();
    await page.mouse.move(grab.x + grab.width / 2, grab.y + 4);
    await page.mouse.down();
    await page.mouse.move(grab.x + grab.width / 2, grab.y + 180, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('lc-sheet dialog[open]').count(), 0);
    await context.close();
  });

  it('keeps the sheet open when a drag ends over the backdrop', async () => {
    const { page, context } = await open();
    await tile(page, 'Floor Lamp').locator('button.more').click();
    const title = await page.locator('lc-sheet h2').boundingBox();
    await page.mouse.move(title.x + 10, title.y + 10);
    await page.mouse.down();
    await page.mouse.move(title.x + 10, 5, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('lc-sheet dialog[open]').count(), 1);
    await context.close();
  });

  it('shows the running effect after the light goes off and on again', async () => {
    const { page, context } = await open();
    await tile(page, 'TV Backlight').locator('button.more').click();
    const select = page.locator('lc-sheet select');
    await select.selectOption('Rainbow');
    await page.waitForFunction(
      () => window.__demo.hass.states['light.living_room_tv_backlight'].attributes.effect === 'Rainbow',
    );
    await page.evaluate(() =>
      window.__demo.hass.callService('light', 'turn_on', {
        entity_id: 'light.living_room_tv_backlight',
        effect: 'Aurora',
      }),
    );
    await page.waitForFunction(
      () => window.__demo.hass.states['light.living_room_tv_backlight'].attributes.effect === 'Aurora',
    );
    assert.equal(await select.inputValue(), 'Aurora');
    await context.close();
  });

  it('brings back a hidden bulb as soon as it is reachable again', async () => {
    const { page, context } = await open();
    await page.evaluate(() => window.__demo.setConfig({ show_unavailable: false }));
    await tile(page, 'Kids Room Ceiling')
      .waitFor({ state: 'detached' })
      .catch(() => {});
    assert.equal(await page.locator('section.room', { hasText: 'Kids Room' }).locator('lc-tile').count(), 1);
    await page.evaluate(() => window.__demo.setUnavailable('light.kids_room_ceiling', false));
    await page.locator('section.room', { hasText: 'Kids Room' }).locator('lc-tile').nth(1).waitFor();
    assert.equal((await state(page, 'light.kids_room_ceiling')).state, 'off');
    await context.close();
  });
});
