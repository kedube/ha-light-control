import { html, type TemplateResult } from 'lit';

export {
  mdiChartLine,
  mdiClose,
  mdiCreation,
  mdiLightbulbOffOutline,
  mdiLightbulbOnOutline,
  mdiLightningBolt,
  mdiOpenInNew,
  mdiPalette,
  mdiPlay,
  mdiPower,
  mdiTuneVariant,
  mdiWhiteBalanceSunny,
  mdiWifiOff,
} from '@mdi/js';

/** Inline 24×24 Material Design icon; avoids waiting on Home Assistant's async icon loader. */
export const icon = (path: string, className = 'mdi'): TemplateResult =>
  html`<svg class=${className} viewBox="0 0 24 24" aria-hidden="true"><path d=${path}></path></svg>`;
