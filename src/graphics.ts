import { html, svg, nothing, type TemplateResult } from 'lit';

export type OutletStyle = 'us' | 'eu' | 'uk' | 'au';

const GLASS =
  'M24 5C16.27 5 10 11.27 10 19c0 4.9 2.5 8.6 5.6 11.4 1.5 1.4 2.4 3 2.4 5V36.5h12V35.4c0-2 .9-3.6 2.4-5C35.5 27.6 38 23.9 38 19 38 11.27 31.73 5 24 5z';
const FILAMENT = 'M20.6 31v-3.6c0-2.7 1.4-4.9 3.4-2.4 2-2.5 3.4-.3 3.4 2.4V31';
const RAY_ANGLES = [-162, -126, -90, -54, -18];

function bulbShape(gradientId: string, on: boolean, rays: number) {
  const rayLines = RAY_ANGLES.map((deg) => {
    const rad = (deg * Math.PI) / 180;
    const [x1, y1, x2, y2] = [
      24 + Math.cos(rad) * 17,
      19 + Math.sin(rad) * 17,
      24 + Math.cos(rad) * 21,
      19 + Math.sin(rad) * 21,
    ];
    return svg`<line x1=${x1.toFixed(1)} y1=${y1.toFixed(1)} x2=${x2.toFixed(1)} y2=${y2.toFixed(1)}></line>`;
  });
  // The gradient goes on the fill attribute: Safari does not resolve url(#id) set from CSS in shadow DOM.
  return svg`
    ${rays > 0 ? svg`<g class="rays" style="opacity:${rays.toFixed(2)}">${rayLines}</g>` : nothing}
    <path class=${on ? 'glass lit' : 'glass'} d=${GLASS} fill=${on ? `url(#${gradientId})` : 'none'}></path>
    <path class="highlight" d="M15.4 16.2a9.2 9.2 0 0 1 5.4-5.9"></path>
    <path class="filament" d=${FILAMENT}></path>
    <rect class="base" x="18" y="37.6" width="12" height="2.7" rx="1.35"></rect>
    <rect class="base" x="18.9" y="41.1" width="10.2" height="2.5" rx="1.25"></rect>
    <path class="base" d="M21.4 44.4h5.2a2.6 2.6 0 0 1-5.2 0z"></path>`;
}

function gradient(id: string) {
  return svg`<defs>
    <radialGradient id=${id} cx="50%" cy="38%" r="62%">
      <stop offset="0" style="stop-color:#fffdf4"></stop>
      <stop offset="0.38" style="stop-color:rgb(var(--lc-c))"></stop>
      <stop offset="1" style="stop-color:rgb(var(--lc-c))"></stop>
    </radialGradient>
  </defs>`;
}

/**
 * A light bulb whose glass takes on the light's color; rays fade in with brightness.
 * `id` names the glass gradient and must be unique within the rendering shadow root.
 */
export function bulbArt(on: boolean, level: number, group = false, id = 'lc-glass'): TemplateResult {
  const rays = on ? Math.max(0, (level - 20) / 80) : 0;
  const body = group
    ? svg`<g class="back" transform="translate(-4.5 -1.5) scale(.8)">${bulbShape(id, on, 0)}</g>
          <g transform="translate(10.5 8.5) scale(.8)">${bulbShape(id, on, rays)}</g>`
    : bulbShape(id, on, rays);
  return html`<svg class="art bulb" viewBox="0 0 48 48" aria-hidden="true">${gradient(id)}${body}</svg>`;
}

function sockets(style: OutletStyle) {
  switch (style) {
    case 'us':
      return svg`
        <rect class="hole" x="16.4" y="14.6" width="3.3" height="10.4" rx="1.65"></rect>
        <rect class="hole" x="28.3" y="15.3" width="3.3" height="8.8" rx="1.65"></rect>
        <path class="hole" d="M21.5 34.6v-2.3a2.5 2.5 0 0 1 5 0v2.3z"></path>`;
    case 'uk':
      return svg`
        <rect class="hole" x="22.4" y="12.8" width="3.2" height="8.4" rx=".9"></rect>
        <rect class="hole" x="12.8" y="27.3" width="8" height="3.3" rx=".9"></rect>
        <rect class="hole" x="27.2" y="27.3" width="8" height="3.3" rx=".9"></rect>`;
    case 'au':
      return svg`
        <rect class="hole" x="15.4" y="15.5" width="3.1" height="9" rx="1" transform="rotate(30 17 20)"></rect>
        <rect class="hole" x="29.5" y="15.5" width="3.1" height="9" rx="1" transform="rotate(-30 31 20)"></rect>
        <rect class="hole" x="22.45" y="27.5" width="3.1" height="8" rx="1"></rect>`;
    default:
      return svg`
        <circle class="recess" cx="24" cy="24" r="12.2"></circle>
        <circle class="hole" cx="18.6" cy="24" r="2.5"></circle>
        <circle class="hole" cx="29.4" cy="24" r="2.5"></circle>
        <rect class="hole clip" x="22.4" y="12.4" width="3.2" height="2.4" rx=".6"></rect>
        <rect class="hole clip" x="22.4" y="33.2" width="3.2" height="2.4" rx=".6"></rect>`;
  }
}

/**
 * A wall outlet faceplate in the style used where the user lives, with a status LED and a
 * lightning badge while something plugged into it is drawing power.
 */
export function outletArt(style: OutletStyle, drawing: boolean): TemplateResult {
  return html`<svg class="art outlet" viewBox="0 0 48 48" aria-hidden="true">
    <rect class="plate" x="6" y="6" width="36" height="36" rx="10"></rect>
    ${sockets(style)}
    <circle class="led" cx="36" cy="12" r="2.1"></circle>
    ${
      drawing
        ? svg`<g class="badge"><circle cx="39.5" cy="39.5" r="8.5"></circle>
          <path d="M41 33.2 36 40.6h3.3l-1.5 5.6 5.2-7.9h-3.4z"></path></g>`
        : nothing
    }
  </svg>`;
}

const COUNTRY_STYLE: Record<string, OutletStyle> = {
  US: 'us',
  CA: 'us',
  MX: 'us',
  JP: 'us',
  TW: 'us',
  PH: 'us',
  CO: 'us',
  EC: 'us',
  VE: 'us',
  PR: 'us',
  PA: 'us',
  CR: 'us',
  GT: 'us',
  DO: 'us',
  HN: 'us',
  SV: 'us',
  NI: 'us',
  CU: 'us',
  HT: 'us',
  JM: 'us',
  GB: 'uk',
  IE: 'uk',
  HK: 'uk',
  SG: 'uk',
  MY: 'uk',
  AE: 'uk',
  QA: 'uk',
  BH: 'uk',
  KW: 'uk',
  OM: 'uk',
  CY: 'uk',
  MT: 'uk',
  KE: 'uk',
  UG: 'uk',
  TZ: 'uk',
  NG: 'uk',
  GH: 'uk',
  LK: 'uk',
  MU: 'uk',
  BN: 'uk',
  AU: 'au',
  NZ: 'au',
  CN: 'au',
  AR: 'au',
  FJ: 'au',
  PG: 'au',
};

/** Picks a socket style from HA's configured country, falling back to the browser locale. */
export function outletStyleFor(country?: string | null): OutletStyle {
  let code = country?.toUpperCase();
  if (!code && typeof navigator !== 'undefined') {
    code = navigator.language?.split('-')[1]?.toUpperCase();
  }
  return (code && COUNTRY_STYLE[code]) || (code ? 'eu' : 'us');
}
