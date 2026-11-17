import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startServer } from '../../scripts/static-server.mjs';

describe('static server', () => {
  let dir: string;
  let server: { url: string; close: () => Promise<void> };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lc-static-'));
    await mkdir(join(dir, 'site'));
    await mkdir(join(dir, 'site-secret'));
    await writeFile(join(dir, 'site', 'index.html'), 'home');
    await writeFile(join(dir, 'site-secret', 'key.txt'), 'SECRET');
    server = await startServer(join(dir, 'site'));
  });

  after(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('serves files inside the root', async () => {
    const res = await fetch(`${server.url}/`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'home');
  });

  it('refuses a sibling directory whose name starts with the root name', async () => {
    const res = await fetch(`${server.url}/..%2Fsite-secret%2Fkey.txt`);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), 'Not found');
  });
});
