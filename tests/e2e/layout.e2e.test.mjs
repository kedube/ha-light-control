// Layout at the sizes the card really meets: phones, masonry columns, full-width panels and
// short wall tablets. Run `npm run build:demo` first (CI does).
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

/** Opens the demo with the card alone on the page at exactly `width` pixels. */
async function open({ width, viewport = { width: Math.max(width, 400), height: 900 }, query = '' }) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  await page.goto(`${server.url}/demo/index.html?e2e&theme=dark${query}`);
  await page.waitForSelector('light-control-card lc-tile');
  await page.evaluate((w) => {
    const stage = document.getElementById('stage');
    document.body.replaceChildren(stage, document.getElementById('toasts'));
    stage.style.cssText = `width:${w}px;padding:0;border:0;border-radius:0;display:block`;
    document.getElementById('card-slot').style.maxWidth = 'none';
  }, width);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const box = (locator) => locator.boundingBox();
const bottom = (b) => b.y + b.height;
const right = (b) => b.x + b.width;
const tabByName = (page, name) => page.locator('nav.tabs').getByRole('tab', { name, exact: true });

describe('Layout', () => {
  it('sets rooms side by side on a wide card, still in Home Assistant order', async () => {
    const page = await open({ width: 390 });
    const order = await page.locator('article.room .room-name').allTextContents();
    const ground = page.locator('section.floor[aria-label="Ground Floor"]');
    assert.equal(await ground.locator('.column').count(), 1);

    await page.evaluate(() => (document.getElementById('stage').style.width = '1100px'));
    await page.setViewportSize({ width: 1200, height: 900 });
    await ground.locator('.column').nth(2).waitFor();
    assert.equal(await ground.locator('.column').count(), 3);
    // Read top to bottom, a column at a time, the rooms keep their order.
    assert.deepEqual(await page.locator('article.room .room-name').allTextContents(), order);

    const columns = await ground.locator('.column').evaluateAll((els) => els.map((el) => el.offsetHeight));
    const rooms = await ground.locator('article.room').evaluateAll((els) => els.map((el) => el.offsetHeight));
    assert.ok(Math.max(...columns) - Math.min(...columns) < Math.max(...rooms), `unbalanced: ${columns}`);
    await page.close();
  });

  it('estimates room heights closely enough to balance the columns', async () => {
    const page = await open({ width: 1100 });
    const measured = await page.locator('article.room').evaluateAll((els) => els.map((el) => el.offsetHeight));
    // Every room is laid out from the same few measurements; none is wildly off.
    for (const h of measured) assert.ok(h > 100 && h < 420, `room ${h}px tall`);
    await page.close();
  });

  it('shows one room up close, with a row for each light', async () => {
    const page = await open({ width: 1100 });
    await page.locator('article.room .room-title', { hasText: 'Kitchen' }).click();
    const rows = page.locator('.rows lc-tile');
    assert.equal(await rows.count(), 3);
    const [panel, row] = [await box(page.locator('.panel')), await box(rows.first())];
    assert.ok(row.width > 300, `rows are roomy: ${row.width}px`);
    assert.ok(row.x >= panel.x && right(row) <= right(panel) + 1);
    await page.close();
  });

  it('lets a lone tile fill its row and lines up the room switches on a phone', async () => {
    const page = await open({ width: 390 });
    const dining = page.locator('article.room', { hasText: 'Dining Room' });
    const [grid, tile] = [await box(dining.locator('.grid')), await box(dining.locator('lc-tile'))];
    assert.ok(Math.abs(grid.width - tile.width) < 1, `tile ${tile.width}px in a ${grid.width}px row`);
    const edges = await page
      .locator('article.room .quick')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().right)));
    assert.equal(new Set(edges).size, 1, `room switches end at ${[...new Set(edges)]}`);
    await page.close();
  });

  it('keeps a wrapped title and summary clear of the house', async () => {
    const page = await open({ width: 360, query: '&lang=pl&sky=day' });
    const text = await box(page.locator('.hero-head'));
    const house = await page.locator('lc-house').evaluate((el) => {
      const world = el.shadowRoot.querySelector('g.world');
      // The house itself: its roof is the highest thing in the picture.
      const r = world.getBoundingClientRect();
      return { top: r.top };
    });
    assert.ok(text.height > 60, 'the Polish summary wraps at this width');
    assert.ok(bottom(text) <= house.top + 1, `text ends at ${bottom(text)}, the roof starts at ${house.top}`);
    await page.close();
  });

  it('fits the floor switcher on a phone without scrolling', async () => {
    const page = await open({ width: 360, viewport: { width: 360, height: 800 } });
    const track = page.locator('nav.tabs .tab-track');
    const size = await track.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    assert.ok(size.scroll <= size.client + 1, `the tabs need ${size.scroll}px of ${size.client}px`);
    assert.equal(
      await tabByName(page, 'Home').locator('.tab-label').isVisible(),
      true,
      'the selected tab has its name',
    );
    assert.equal(
      await tabByName(page, 'Upstairs').locator('.tab-label').isVisible(),
      false,
      'the others show their icons',
    );
    await page.close();
  });

  it('wraps a long room caption instead of cutting it off', async () => {
    const page = await open({ width: 320, query: '&lang=nl' });
    const caption = page.locator('article.room', { hasText: 'Living Room' }).locator('.room-sub');
    const size = await caption.evaluate((el) => ({
      clipped: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight,
      lines: Math.round(el.clientHeight / 16),
    }));
    assert.equal(size.clipped, false);
    assert.ok(size.lines > 1);
    await page.close();
  });

  it('keeps the color presets on one row on a small phone', async () => {
    const page = await open({ width: 320, viewport: { width: 320, height: 640 } });
    await page
      .locator('lc-tile')
      .filter({ has: page.locator('.name', { hasText: 'Floor Lamp' }) })
      .locator('button.more')
      .click();
    const tops = await page.locator('lc-sheet .presets .swatch').evaluateAll((els) => els.map((el) => el.offsetTop));
    assert.equal(tops.length, 8);
    assert.equal(new Set(tops).size, 1);
    await page.close();
  });

  it('puts the controls beside the stage on a short wall tablet, without scrolling', async () => {
    const page = await open({ width: 1024, viewport: { width: 1024, height: 600 } });
    for (const open of [
      () =>
        page
          .locator('lc-tile')
          .filter({ has: page.locator('.name', { hasText: 'TV Backlight' }) })
          .locator('button.more')
          .click(),
      () =>
        page
          .locator('lc-tile')
          .filter({ has: page.locator('.name', { hasText: 'TV Plug' }) })
          .locator('.tile')
          .click({ button: 'right' }),
    ]) {
      await open();
      const [stage, side] = [await box(page.locator('lc-sheet .stage')), await box(page.locator('lc-sheet .side'))];
      assert.ok(side.x >= stage.x + stage.width, 'controls beside the stage');
      const sheet = await page.locator('lc-sheet .sheet').evaluate((el) => [el.scrollHeight, el.clientHeight]);
      assert.ok(sheet[0] <= sheet[1], `${sheet[0]}px of content in ${sheet[1]}px`);
      await page.keyboard.press('Escape');
      await page.locator('lc-sheet dialog[open]').waitFor({ state: 'detached' });
    }
    await page.close();
  });
});
