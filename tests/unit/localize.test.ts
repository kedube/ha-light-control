import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveLanguage, SUPPORTED_LANGUAGES, t, TRANSLATIONS } from '../../src/localize.ts';
import { en, type Plural } from '../../src/translations/en.ts';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const forms = (entry: string | Plural) =>
  typeof entry === 'string' ? [entry] : Object.values(entry).filter((v): v is string => typeof v === 'string');

describe('translations', () => {
  it('covers the eight most-used Home Assistant languages', () => {
    assert.deepEqual([...SUPPORTED_LANGUAGES].sort(), ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt']);
  });

  for (const language of SUPPORTED_LANGUAGES) {
    it(`${language}: every string exists and keeps its placeholders`, () => {
      const table = TRANSLATIONS[language];
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        const entry = table[key];
        assert.ok(entry, `${language} is missing "${key}"`);
        const expected = placeholders(forms(en[key]).at(-1)!);
        for (const form of forms(entry)) {
          assert.ok(form.trim().length > 0, `${language}.${key} is empty`);
          assert.deepEqual(placeholders(form), expected, `${language}.${key} placeholders`);
        }
      }
      assert.deepEqual(Object.keys(table).sort(), Object.keys(en).sort(), `${language} has extra keys`);
    });
  }

  it('maps regional variants and falls back to English', () => {
    assert.equal(resolveLanguage('pt-BR'), 'pt');
    assert.equal(resolveLanguage('de_CH'), 'de');
    assert.equal(resolveLanguage('zh-Hans'), 'en');
    assert.equal(resolveLanguage(undefined), 'en');
  });

  it('chooses plural forms per language', () => {
    assert.equal(t('lights_on', { n: 1 }, 'en'), '1 light on');
    assert.equal(t('lights_on', { n: 3 }, 'en'), '3 lights on');
    assert.equal(t('lights_on', { n: 1 }, 'pl'), '1 światło włączone');
    assert.equal(t('lights_on', { n: 3 }, 'pl'), '3 światła włączone');
    assert.equal(t('lights_on', { n: 5 }, 'pl'), '5 świateł włączonych');
    assert.equal(t('room_on', { n: 1, total: 4 }, 'fr'), '1 sur 4 allumée');
    assert.equal(t('turned_off_one', { name: 'Lamp' }, 'de'), 'Lamp ausgeschaltet');
  });
});
