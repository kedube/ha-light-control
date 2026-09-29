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
    await tile(page, 'Floor Lamp').scrollIntoViewIfNeeded();
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

  it('keeps the camera still when only a light changes', async () => {
    const { page, context } = await open();
    const viewBox = () =>
      page.locator('lc-house').evaluate((el) => el.shadowRoot.querySelector('svg.scene').getAttribute('viewBox'));
    const before = await viewBox();
    await tile(page, 'Chandelier').click();
    await page.waitForFunction(() => window.__demo.hass.states['light.dining_chandelier'].state === 'on');
    await page.waitForTimeout(100);
    assert.equal(await viewBox(), before);
    await context.close();
  });

  it('forgets a pending outlet confirmation after a few seconds', async () => {
    const { page, context } = await open();
    await page.locator('.control.outlets .switch').click();
    await page.locator('.control.outlets .confirm').waitFor();
    await page.locator('.control.outlets .confirm').waitFor({ state: 'detached', timeout: 6000 });
    await page.locator('.control.outlets .switch').click();
    await page.waitForTimeout(200);
    assert.equal((await state(page, 'switch.tv_plug')).state, 'on', 'a late second tap starts over');
    await context.close();
  });

  it('lets a finger scroll the page across a brightness bar without dimming anything', async () => {
    const { page, context } = await open({ touch: true });
    const bar = await page.locator('.control.lights lc-slider .bar').boundingBox();
    const cdp = await context.newCDPSession(page);
    const touch = (type, x, y) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const before = await page.evaluate(() => window.__demo.serviceLog.length);
    const x = bar.x + bar.width * 0.15;
    const y = bar.y + bar.height / 2;
    await touch('touchStart', x, y);
    for (let i = 1; i <= 8; i++) await touch('touchMove', x + i, y - i * 12);
    await touch('touchEnd');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__demo.serviceLog.length), before, 'a scroll is not a slide');
    // A tap still sets the level where it lands (the page has scrolled, so measure again).
    const moved = await page.locator('.control.lights lc-slider .bar').boundingBox();
    await touch('touchStart', moved.x + moved.width * 0.3, moved.y + moved.height / 2);
    await touch('touchEnd');
    await page.waitForFunction(() => window.__demo.serviceLog.at(-1)?.data.brightness_pct === 30);
    await context.close();
  });

  it('finishes moving the camera when the card is taken off the page mid-move', async () => {
    const { page, context } = await open();
    await page.locator('nav.tabs').getByRole('tab', { name: 'Upstairs', exact: true }).click();
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const card = document.querySelector('light-control-card');
      const parent = card.parentElement;
      card.remove();
      parent.append(card);
    });
    await page.waitForTimeout(1200);
    const house = await page.locator('lc-house').evaluate((el) => ({
      moving: Boolean(el.shadowRoot.querySelector('.stage.moving')),
      ghost: Boolean(el.shadowRoot.querySelector('.ghost')),
      settled: JSON.stringify(el._camera) === JSON.stringify(el.target),
    }));
    assert.deepEqual(house, { moving: false, ghost: false, settled: true });
    await page.locator('lc-house .tag', { hasText: 'Bedroom' }).waitFor();
    await context.close();
  });

  it('keeps keyboard focus on the room that was chosen in the house', async () => {
    const { page, context } = await open();
    await page.locator('lc-house .hit[aria-label^="Living Room"]').first().focus();
    await page.keyboard.press('Enter');
    await page.locator('.room-bar h2', { hasText: 'Living Room' }).waitFor();
    const focused = await page.evaluate(() => {
      let el = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      return el?.getAttribute('aria-label') ?? '';
    });
    assert.match(focused, /^Living Room/);
    await context.close();
  });

  it('asks twice before the controls sheet turns several outlets off', async () => {
    const { page, context } = await open();
    await page.locator('.control.lights .control-title').click();
    const off = page.locator('lc-sheet .outlet-list ~ .room-actions .pill-button').nth(1);
    await off.click();
    await page.locator('lc-sheet .pill-button.warning').waitFor();
    assert.equal((await state(page, 'switch.tv_plug')).state, 'on');
    await off.click();
    await page.waitForFunction(() => window.__demo.hass.states['switch.tv_plug'].state === 'off');
    await context.close();
  });

  it('forgets a pending outlet confirmation when the card leaves the page', async () => {
    const { page, context } = await open();
    await page.locator('.control.outlets .switch').click();
    await page.locator('.control.outlets .confirm').waitFor();
    await page.evaluate(() => {
      const card = document.querySelector('light-control-card');
      const parent = card.parentElement;
      card.remove();
      parent.append(card);
    });
    await page.locator('.control.outlets .switch').click();
    await page.waitForTimeout(200);
    assert.equal((await state(page, 'switch.tv_plug')).state, 'on', 'the first tap after returning only asks');
    await context.close();
  });

  it('gives switches the full width of their tile', async () => {
    const { page, context } = await open();
    await page.evaluate(() => window.__demo.setConfig({ outlet_detection: 'all_switches' }));
    const pc = tile(page, 'Desktop PC');
    await pc.waitFor();
    assert.ok((await pc.locator('.tile').boundingBox()).width > 120);
    await context.close();
  });

  it('brings back a hidden bulb as soon as it is reachable again', async () => {
    const { page, context } = await open();
    await page.evaluate(() => window.__demo.setConfig({ show_unavailable: false }));
    await tile(page, 'Kids Room Ceiling')
      .waitFor({ state: 'detached' })
      .catch(() => {});
    assert.equal(await page.locator('article.room', { hasText: 'Kids Room' }).locator('lc-tile').count(), 1);
    await page.evaluate(() => window.__demo.setUnavailable('light.kids_room_ceiling', false));
    await page.locator('article.room', { hasText: 'Kids Room' }).locator('lc-tile').nth(1).waitFor();
    assert.equal((await state(page, 'light.kids_room_ceiling')).state, 'off');
    await context.close();
  });
});
