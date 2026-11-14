// The 3D house: turning it, coming closer, the designs it can be built in, and what stands in
// for it where a browser cannot draw in 3D. Run `npm run build:demo` first (CI does).
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

async function open(query = '', setup, motion = 'reduce') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: motion });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
  });
  if (setup) await page.addInitScript(setup);
  await page.goto(`${server.url}/demo/index.html?e2e&theme=dark${query}`);
  await page.waitForSelector('light-control-card lc-tile');
  await page.locator('lc-house svg.scene').waitFor();
  page.errors = errors;
  return page;
}

/** Where the camera is: yaw, pitch, distance and the point it looks at. */
const camera = (page) =>
  page
    .locator('lc-house')
    .evaluate((el) => el.shadowRoot.querySelector('svg.scene').dataset.camera.split(' ').map(Number));

describe('The 3D house', () => {
  it('draws the house, or outlines of its rooms where there is no WebGL', async () => {
    const page = await open();
    await page.waitForFunction(() => {
      const el = document.querySelector('light-control-card').shadowRoot.querySelector('lc-house');
      return el._flat || el._shown;
    });
    const house = await page.locator('lc-house').evaluate((el) => ({
      flat: el._flat,
      canvas: Boolean(el.shadowRoot.querySelector('canvas.gl.shown')),
      outlines: el.shadowRoot.querySelectorAll('.flat path').length,
      rooms: el.shadowRoot.querySelectorAll('.hit[role=button]').length,
    }));
    assert.ok(house.flat ? house.outlines > 0 : house.canvas, JSON.stringify(house));
    assert.equal(house.rooms, 13, 'every room and outdoor area can be picked');
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  it('turns when dragged, without picking the room under the pointer', async () => {
    const page = await open();
    const before = await camera(page);
    const box = await page.locator('lc-house').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 10, { steps: 4 });
    await page.mouse.move(x + 160, y + 30, { steps: 6 });
    await page.mouse.up();
    const turned = await camera(page);
    assert.ok(turned[0] < before[0] - 0.8, `the house follows the hand: yaw ${before[0]} → ${turned[0]}`);
    assert.ok(turned[1] > before[1] + 0.05, 'and tips toward the viewer');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.room-bar').count(), 0, 'no room was opened');
    // A plain click still opens a room.
    await page.locator('lc-house .hit[role=button]').last().click();
    await page.locator('.room-bar h2').waitFor();
    await page.close();
  });

  it('comes closer and goes back with its buttons, and from the keyboard', async () => {
    const page = await open();
    const before = await camera(page);
    assert.equal(await page.locator('lc-house .control').count(), 2, 'nothing to reset yet');
    await page.locator('lc-house .control[aria-label="Zoom in"]').click();
    const near = await camera(page);
    assert.ok(near[2] < before[2] * 0.85, `closer: ${before[2]} → ${near[2]}`);
    await page.locator('lc-house .control[aria-label="Reset the view"]').click();
    assert.deepEqual(await camera(page), before);
    // With a room focused, the arrow keys turn the house and 0 puts it back.
    await page.locator('lc-house .hit[role=button]').first().focus();
    await page.keyboard.press('ArrowLeft');
    assert.ok((await camera(page))[0] > before[0] + 0.15);
    await page.keyboard.press('0');
    assert.deepEqual(await camera(page), before);
    await page.close();
  });

  it('opens a floor from behind as well as from the front', async () => {
    const page = await open();
    await page.locator('nav.tabs').getByRole('tab', { name: 'Upstairs', exact: true }).click();
    await page.locator('lc-house .tag', { hasText: 'Bedroom' }).waitFor();
    await page.locator('lc-house').evaluate((el) => (el._orbit = { yaw: 3.6, tilt: 0.1, zoom: 1 }));
    await page.locator('lc-house .tag', { hasText: 'Bedroom' }).waitFor();
    await page.locator('lc-house .hit[aria-label^="Office"]').click();
    await page.locator('.room-bar h2', { hasText: 'Office' }).waitFor();
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  it('builds every design of house, in the colors asked for', async () => {
    const page = await open();
    for (const style of [
      'capecod',
      'bungalow',
      'ranch',
      'craftsman',
      'victorian',
      'midcentury',
      'farmhouse',
      'mediterranean',
      'tudor',
      'contemporary',
      'brick',
      'european',
      'colonial',
    ]) {
      await page.evaluate(
        (s) => window.__demo.setConfig({ house_style: s, house_color: '#8899aa', door_color: [200, 40, 40] }),
        style,
      );
      const built = await page.locator('lc-house').evaluate(async (el) => {
        await el.updateComplete;
        return { style: el.styleName, wall: el.colors.wall, door: el.colors.door, vertices: el.model.mesh.vertexCount };
      });
      assert.equal(built.style, style);
      assert.deepEqual(
        [built.wall, built.door],
        [
          [136, 153, 170],
          [200, 40, 40],
        ],
      );
      assert.ok(built.vertices > 20000, `${style} is a whole house`);
    }
    await page.locator('nav.tabs').getByRole('tab', { name: 'Ground Floor', exact: true }).click();
    await page.locator('lc-house .tag', { hasText: 'Kitchen' }).waitFor();
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  it('follows the country when no design is chosen', async () => {
    const page = await open('&country=DE');
    assert.equal(await page.locator('lc-house').evaluate((el) => el.styleName), 'european');
    await page.close();
  });

  it('builds the attic into the roof, behind the dormers, and as a full floor when asked', async () => {
    const page = await open('&home=attic&drop=basement&style=capecod');
    const stories = () =>
      page.locator('lc-house').evaluate((el) => ({ loft: el.model.loft, floors: el.model.plan.stories.length }));
    assert.deepEqual(await stories(), { loft: 2, floors: 3 }, 'two floors of walls, and the attic in the roof');
    await page.evaluate(() => {
      const card = document.querySelector('light-control-card');
      card.setConfig({ type: 'custom:light-control-card', house_style: 'capecod', house_top_floor: 'full' });
    });
    await page.waitForFunction(
      () => document.querySelector('light-control-card').shadowRoot.querySelector('lc-house').model.loft === -1,
    );
    // The attic can still be opened and its rooms picked.
    await page.locator('light-control-card nav.tabs .tab[aria-label="Attic"]').click();
    await page.locator('lc-house .hit[aria-label^="Guest Room"]').first().waitFor();
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  it('stands dormers on the roof when asked, even over an attic nobody lives in', async () => {
    const page = await open('&style=colonial');
    const house = () =>
      page.locator('lc-house').evaluate((el) => ({ dormers: el.dormers, vertices: el.model.mesh.vertexCount }));
    const plain = await house();
    assert.equal(plain.dormers, 'auto');
    await page.evaluate(() => {
      const card = document.querySelector('light-control-card');
      card.setConfig({ type: 'custom:light-control-card', house_style: 'colonial', house_dormers: 'on' });
    });
    await page.waitForFunction((before) => {
      const el = document.querySelector('light-control-card').shadowRoot.querySelector('lc-house');
      return el.dormers === 'on' && el.model.mesh.vertexCount > before;
    }, plain.vertices);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  it('brings the sky to life when it moves, and keeps it still when motion is reduced', async () => {
    const happen = async (page, what) => {
      await page.locator('lc-house').evaluate((el, list) => list.forEach((x) => el.happen(x)), what.split(','));
      return page.waitForFunction(
        (key) => {
          const scene = document.querySelector('light-control-card').shadowRoot.querySelector('lc-house').life.scene;
          return scene[key] > 0;
        },
        what === 'meteor' ? 'meteorCount' : 'birdCount',
        { timeout: 8000 },
      );
    };
    const page = await open('&sky=day', undefined, 'no-preference');
    await happen(page, 'gull,songbird');
    await page.close();
    const dark = await open('&sky=night', undefined, 'no-preference');
    await happen(dark, 'meteor');
    assert.deepEqual(dark.errors, []);
    await dark.close();
    const still = await open('&sky=day');
    await still.locator('lc-house').evaluate((el) => el.happen('gull'));
    await still.waitForTimeout(600);
    assert.equal(await still.locator('lc-house').evaluate((el) => el.life.scene.birdCount), 0, 'nothing flies');
    await still.close();
  });

  it('still works where there is no WebGL', async () => {
    const page = await open('', () => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return type === 'webgl2' ? null : original.call(this, type, ...rest);
      };
    });
    await page.waitForFunction(
      () => document.querySelector('light-control-card').shadowRoot.querySelector('lc-house')._flat,
    );
    assert.ok((await page.locator('lc-house .flat path').count()) > 10, 'the rooms are drawn as outlines');
    assert.equal(await page.locator('lc-house canvas').count(), 0);
    await page.locator('lc-house .hit[aria-label^="Bedroom"]').first().click();
    await page.locator('.room-bar h2', { hasText: 'Bedroom' }).waitFor();
    await page.locator('lc-house .tag.selected', { hasText: 'Bedroom' }).waitFor();
    await page.close();
  });
});
