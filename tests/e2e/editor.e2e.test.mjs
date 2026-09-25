// The visual editor wraps Home Assistant's ha-form, which only exists inside Home Assistant.
// A stand-in ha-form records what the editor passes it and lets the test report edits back.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { launchBrowser, startServer } from '../../scripts/static-server.mjs';

let server;
let browser;
let page;

before(async () => {
  server = await startServer('.');
  browser = await launchBrowser();
  page = await browser.newPage();
  await page.goto(`${server.url}/demo/index.html?e2e&lang=fr`);
  await page.waitForSelector('light-control-card lc-tile');
  await page.evaluate(async () => {
    customElements.define('ha-form', class extends HTMLElement {});
    const editor = document.createElement('light-control-card-editor');
    editor.hass = window.__demo.hass;
    editor.setConfig({ type: 'custom:light-control-card', show_house: false });
    editor.addEventListener('config-changed', (ev) => (window.__lastConfig = ev.detail.config));
    document.body.append(editor);
    await editor.updateComplete;
    window.__editor = editor;
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const form = () => page.evaluateHandle(() => window.__editor.shadowRoot.querySelector('ha-form'));

describe('Visual editor', () => {
  it('shows defaults for options that are not in the YAML', async () => {
    const data = await page.evaluate((f) => f.data, await form());
    assert.equal(data.show_house, false, 'value from the config');
    assert.equal(data.show_outlets, true, 'default shown as on');
    assert.equal(data.outlet_detection, 'smart');
  });

  it('labels fields and sections in the user’s language', async () => {
    const { label, sections } = await page.evaluate(
      (f) => ({
        label: f.computeLabel({ name: 'show_outlets' }),
        sections: f.schema.filter((s) => s.type === 'expandable').map((s) => s.title),
      }),
      await form(),
    );
    assert.equal(label, 'Afficher les prises connectées');
    assert.deepEqual(sections, ['Affichage', 'Prises', 'Pièces', 'Entités', 'Comportement']);
  });

  it('writes back only what differs from the defaults', async () => {
    const config = await page.evaluate(
      (f) => {
        f.dispatchEvent(
          new CustomEvent('value-changed', {
            detail: { value: { ...f.data, show_scenes: false, areas: [], title: 'Lights' } },
          }),
        );
        return window.__lastConfig;
      },
      await form(),
    );
    assert.deepEqual(config, { type: 'custom:light-control-card', show_house: false, show_scenes: false });
  });

  it('saves an emptied title as no title', async () => {
    const config = await page.evaluate(
      (f) => {
        f.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...f.data, title: undefined } } }));
        return window.__lastConfig;
      },
      await form(),
    );
    assert.equal(config.title, '');
  });
});
