import { de } from './translations/de.ts';
import { en, type Plural, type Translation, type TranslationKey } from './translations/en.ts';
import { es } from './translations/es.ts';
import { fr } from './translations/fr.ts';
import { it } from './translations/it.ts';
import { nl } from './translations/nl.ts';
import { pl } from './translations/pl.ts';
import { pt } from './translations/pt.ts';

export type StringKey = TranslationKey;

/** The eight most common languages among Home Assistant users. */
export const TRANSLATIONS: Record<string, Translation> = { en, de, nl, fr, es, it, pl, pt };
export const SUPPORTED_LANGUAGES = Object.keys(TRANSLATIONS);

let current = 'en';
const pluralRules = new Map<string, Intl.PluralRules>();

/** "pt-BR" → "pt", "de_CH" → "de"; unknown languages fall back to English. */
export function resolveLanguage(language?: string | null): string {
  const primary = (language ?? '').toLowerCase().split(/[-_]/)[0];
  return primary in TRANSLATIONS ? primary : 'en';
}

/** Called with Home Assistant's profile language whenever it changes. */
export function setLanguage(language?: string | null): void {
  current = resolveLanguage(language);
}

export function getLanguage(): string {
  return current;
}

function pick(entry: string | Plural, n: number, language: string): string {
  if (typeof entry === 'string') return entry;
  let rules = pluralRules.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(language);
    pluralRules.set(language, rules);
  }
  return entry[rules.select(n)] ?? entry.other;
}

export function t(key: StringKey, vars?: Record<string, string | number>, language = current): string {
  const entry = TRANSLATIONS[language]?.[key] ?? en[key];
  let text = pick(entry, Number(vars?.n ?? 0), language);
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
