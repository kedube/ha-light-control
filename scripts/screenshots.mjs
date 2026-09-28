// Regenerates the README screenshots in docs/images from the demo page.
//   npm run build:demo && npm run screenshots
import { mkdir } from 'node:fs/promises';
import { launchBrowser, startServer } from './static-server.mjs';

const OUT = 'docs/images';

const shots = [
  {
    file: 'overview-dark.png',
    query: '&theme=dark&sky=night',
    width: 1200,
    target: '#card-slot',
    clipHeight: 1080,
  },
  {
    file: 'overview-light.png',
    query: '&theme=light&sky=day',
    width: 1200,
    target: '#card-slot',
    clipHeight: 1080,
  },
  {
    // A Panel view: the card alone, as wide as a desktop screen.
    file: 'panel.png',
    query: '&theme=dark&sky=night',
    width: 1600,
    panel: true,
    scale: 1,
    target: '#card-slot',
  },
  {
    file: 'house-dusk.png',
    query: '&theme=dark&sky=dusk',
    width: 1200,
    target: 'light-control-card .header',
  },
  {
    file: 'phone.png',
    query: '&theme=dark&sky=night',
    width: 390,
    height: 844,
    scale: 2,
    target: '#card-slot',
    clipHeight: 780,
  },
  {
    file: 'controls-color.png',
    query: '&theme=dark',
    open: 'Floor Lamp',
    target: 'lc-sheet .sheet',
  },
  {
    file: 'controls-white.png',
    query: '&theme=light',
    open: 'Ceiling',
    target: 'lc-sheet .sheet',
  },
  {
    file: 'plug.png',
    query: '&theme=dark',
    open: 'TV Plug',
    target: 'lc-sheet .sheet',
  },
  {
    file: 'room-controls.png',
    query: '&theme=light',
    room: 'Living Room',
    target: 'lc-sheet .sheet',
  },
  {
    file: 'german.png',
    query: '&theme=light&sky=dusk&lang=de',
    width: 1200,
    target: '#card-slot',
    clipHeight: 760,
  },
];

await mkdir(OUT, { recursive: true });
const server = await startServer('.');
const browser = await launchBrowser();

for (const shot of shots) {
  const page = await browser.newPage({
    viewport: { width: shot.width ?? 1280, height: shot.height ?? 1000 },
    deviceScaleFactor: shot.scale ?? 2,
    reducedMotion: 'reduce',
  });
  await page.goto(`${server.url}/demo/index.html?e2e${shot.query}`);
  await page.waitForSelector('light-control-card lc-tile');
  if (shot.width && shot.width <= 440) await page.click('#width-phone');
  if (shot.panel) {
    await page.evaluate(() => {
      const stage = document.getElementById('stage');
      document.body.replaceChildren(stage);
      stage.style.cssText = 'padding:24px;border:0;border-radius:0';
      document.getElementById('card-slot').style.maxWidth = 'none';
    });
  }
  await page.evaluate(() => document.fonts.ready);
  if (shot.open) {
    await page
      .locator('lc-tile')
      .filter({ has: page.locator('.name', { hasText: shot.open }) })
      .first()
      .locator('button.more')
      .click();
  }
  if (shot.room) await page.locator('button.room-title', { hasText: shot.room }).click();
  await page.waitForTimeout(700);
  // Clips are in page coordinates; measure with the page scrolled to the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  const target = page.locator(shot.target).first();
  const box = await target.boundingBox();
  await page.screenshot({
    path: `${OUT}/${shot.file}`,
    clip: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: shot.clipHeight ? Math.min(box.height, shot.clipHeight) : box.height,
    },
    fullPage: true,
  });
  console.log(`  ${OUT}/${shot.file}`);
  await page.close();
}

await browser.close();
await server.close();
