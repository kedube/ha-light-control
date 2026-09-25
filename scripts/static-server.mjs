// Minimal static file server for the demo page, screenshots and end-to-end tests.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Serves `root` on a free port. Resolves to { url, close }. */
export function startServer(root = '.') {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = normalize(join(base, path));
      if (!file.startsWith(base)) throw new Error('outside root');
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((ready) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      ready({ url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

/** Launches Chromium: Playwright's own build if installed, else the local Google Chrome. */
export async function launchBrowser() {
  const { chromium } = await import('playwright-core');
  const attempts = [
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : null,
    {},
    { channel: 'chrome' },
  ].filter(Boolean);
  let lastError;
  for (const options of attempts) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
