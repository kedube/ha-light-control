import { LightControlCardEditor } from './editor.ts';
import { LightControlCard } from './light-control-card.ts';
import { resolveLanguage, t } from './localize.ts';

declare const __VERSION__: string;

interface CustomCardEntry {
  type: string;
  name: string;
  description?: string;
  preview?: boolean;
  documentationURL?: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}

if (!customElements.get('light-control-card')) {
  customElements.define('light-control-card', LightControlCard);
  customElements.define('light-control-card-editor', LightControlCardEditor);

  // The card picker lists cards before any of them has seen hass, so it follows the page
  // language that Home Assistant sets on <html>.
  const language = resolveLanguage(document.documentElement.lang || navigator.language);
  window.customCards = window.customCards ?? [];
  window.customCards.push({
    type: 'light-control-card',
    name: 'Light Control Card',
    description: t('card_description', undefined, language),
    preview: true,
    documentationURL: 'https://github.com/kedube/ha-light-control',
  });

  console.info(
    `%c LIGHT CONTROL CARD %c ${__VERSION__} `,
    'color:#1c1300;background:#ffc46b;font-weight:700;border-radius:4px 0 0 4px;padding:2px 6px',
    'color:#ffc46b;background:#1c1c1c;border-radius:0 4px 4px 0;padding:2px 6px',
  );
}
