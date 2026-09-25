import { LitElement, css, html, nothing, svg, type PropertyValues } from 'lit';
import { clamp, mixRgb, type RGB } from '../color.ts';
import {
  DOOR_H,
  DOOR_W,
  OVERHANG,
  layoutHouse,
  skyMode,
  type HouseFloor,
  type HouseLayout,
  type HouseRoom,
  type SkyMode,
  type Slot,
  type Lamp,
  type SunInfo,
} from '../house-layout.ts';
import { t } from '../localize.ts';
import { fireEvent } from '../utils.ts';

export { skyMode, type HouseRoom, type SunInfo } from '../house-layout.ts';

interface Palette {
  sky: [string, string];
  wall: string;
  trim: string;
  roof: string;
  roofEdge: string;
  grass: string;
  earth: string;
  glass: string;
  door: string;
  bush: string;
  lampPost: string;
  foundation: string;
}

const PALETTES: Record<SkyMode, Palette> = {
  night: {
    sky: ['#0a1026', '#1d2c4d'],
    wall: '#2a3245',
    trim: '#3b465d',
    roof: '#161b27',
    roofEdge: '#252d3e',
    grass: '#12241a',
    earth: '#15110f',
    glass: '#121a2a',
    door: '#3a2b25',
    bush: '#0f2a1c',
    lampPost: '#3c4760',
    foundation: '#232a38',
  },
  dusk: {
    sky: ['#2a2358', '#e98a67'],
    wall: '#6a5870',
    trim: '#87738d',
    roof: '#382840',
    roofEdge: '#4c3a54',
    grass: '#34502f',
    earth: '#2a211c',
    glass: '#2e2d4b',
    door: '#5a3c30',
    bush: '#284628',
    lampPost: '#4b3f55',
    foundation: '#4a3d50',
  },
  day: {
    sky: ['#58a8f2', '#d2e9ff'],
    wall: '#f0e5d2',
    trim: '#fffaf1',
    roof: '#b5543b',
    roofEdge: '#8e3e2b',
    grass: '#79bd5b',
    earth: '#8a6b52',
    glass: '#a9c9e7',
    door: '#8b5a3c',
    bush: '#4c9844',
    lampPost: '#5b6577',
    foundation: '#b9ab96',
  },
};

/** Deterministic star field so the sky doesn't reshuffle on every render. */
const STARS = (() => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: 30 }, () => ({ x: rand(), y: rand() * 0.8, r: 0.5 + rand() * 0.9, d: rand() * 4 }));
})();

const css3 = (rgb: RGB) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

/**
 * The home at a glance: each room is a window lit in the color and brightness of its lights,
 * outdoor areas are lamp posts, and the sky follows the sun. Tap a window to focus that room.
 */
export class LcHouse extends LitElement {
  static override properties = {
    rooms: { attribute: false },
    floors: { attribute: false },
    selected: { attribute: false },
    sun: { attribute: false },
    topInset: { type: Number },
    dark: { type: Boolean, reflect: true },
    _size: { state: true },
    _hover: { state: true },
  };

  declare rooms: HouseRoom[];
  declare floors: HouseFloor[];
  declare selected: string | null;
  declare sun?: SunInfo;
  /** Pixels at the top kept clear of the house for the card's title overlay. */
  declare topInset: number;
  declare dark: boolean;
  declare _size: { w: number; h: number };
  declare _hover: string | null;

  private resizeObserver?: ResizeObserver;

  constructor() {
    super();
    this.rooms = [];
    this.floors = [];
    this.selected = null;
    this.topInset = 0;
    this.dark = false;
    this._size = { w: 400, h: 190 };
    this._hover = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.resizeObserver ??= new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height && (Math.abs(width - this._size.w) > 1 || Math.abs(height - this._size.h) > 1)) {
        this._size = { w: width, h: height };
      }
    });
    this.resizeObserver.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
  }

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    // The card rebuilds these arrays on every Home Assistant update; compare by content.
    for (const [key, previous] of changed as Map<PropertyKey, unknown>) {
      if ((key === 'rooms' || key === 'floors' || key === 'sun') && previous) {
        const current = key === 'rooms' ? this.rooms : key === 'floors' ? this.floors : this.sun;
        if (JSON.stringify(previous) !== JSON.stringify(current)) return true;
        continue;
      }
      return true;
    }
    return false;
  }

  protected override render() {
    const layout = layoutHouse(this.rooms, this.floors);
    const mode = skyMode(this.sun);
    const p = PALETTES[mode];
    const { w, h } = this._size;
    const aspect = w / h;
    const contentW = layout.bounds.right - layout.bounds.left;
    const contentH = layout.bounds.bottom - layout.bounds.top;
    // Fit the house below the title overlay, with a little ground showing underneath.
    const bottomPx = 8;
    const usable = Math.max(0.35, (h - this.topInset - bottomPx) / h);
    const vbH = Math.max(contentH / usable, contentW / 0.9 / aspect);
    const vbW = vbH * aspect;
    const vbX = (layout.bounds.left + layout.bounds.right) / 2 - vbW / 2;
    const vbY = layout.bounds.bottom + (bottomPx / h) * vbH - vbH;
    const focus = this._hover ?? this.selected;
    const focusSlot =
      layout.windows.find((s) => s.room.id === focus) ??
      (() => {
        const lamp = layout.lamps.find((l) => l.room.id === focus);
        return lamp ? { room: lamp.room, x: lamp.x - 6, y: -58, w: 12, h: 10, basement: false } : undefined;
      })();

    return html`
      <svg
        viewBox="${vbX} ${vbY} ${vbW} ${vbH}"
        preserveAspectRatio="xMidYMid meet"
        class="sky-${mode}"
        role="group"
        aria-label=${t('house_overview')}
      >
        <defs>
          <linearGradient id="lc-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color=${p.sky[0]}></stop>
            <stop offset="1" stop-color=${p.sky[1]}></stop>
          </linearGradient>
          <filter id="lc-blur" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="7"></feGaussianBlur>
          </filter>
          <filter id="lc-soft" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3"></feGaussianBlur>
          </filter>
          <pattern id="lc-siding" width="10" height="7" patternUnits="userSpaceOnUse">
            <path d="M0 6.5H10" stroke="rgba(0,0,0,0.07)" stroke-width="1"></path>
          </pattern>
          <mask id="lc-moon">
            <rect x="-50" y="-50" width="100" height="100" fill="white"></rect>
            <circle cx="5" cy="-4" r="10" fill="black"></circle>
          </mask>
          ${layout.windows.map(
            (s, i) => svg`<radialGradient id="lc-win-${i}" cx="50%" cy="60%" r="75%">
              <stop offset="0" stop-color=${css3(mixRgb(s.room.rgb ?? [255, 200, 120], [255, 255, 255], 0.55))}></stop>
              <stop offset="1" stop-color=${css3(s.room.rgb ?? [255, 200, 120])}></stop>
            </radialGradient>`,
          )}
        </defs>
        <rect x=${vbX} y=${vbY} width=${vbW} height=${-vbY + 1} fill="url(#lc-sky)"></rect>
        ${this.renderCelestial(mode, layout, vbX, vbY, vbW, vbH)}
        <rect x=${vbX} y="0" width=${vbW} height=${vbY + vbH} fill=${p.grass}></rect>
        ${
          layout.basementH
            ? svg`<rect x=${vbX} y="6" width=${vbW} height=${vbY + vbH} fill=${p.earth}></rect>`
            : nothing
        }
        ${this.renderHouse(layout, p)} ${layout.lamps.map((lamp) => this.renderLamp(lamp, p))}
      </svg>
      ${focusSlot ? this.renderTip(focusSlot, vbX, vbY, vbW, vbH) : nothing}
    `;
  }

  private renderCelestial(mode: SkyMode, layout: HouseLayout, x: number, y: number, w: number, h: number) {
    const skyH = -y;
    // Open sky: below the title overlay, beside the house. East is on the left, west on the right.
    const top = y + (this.topInset / this._size.h) * h + 16;
    const bottom = Math.min(layout.topY, -30);
    const leftX = (x + layout.bounds.left) / 2;
    const rightX = (x + w + layout.bounds.right) / 2;
    const roomy = layout.bounds.left - x > 34;
    if (mode === 'night') {
      const moonX = roomy ? rightX : x + w * 0.5;
      const moonY = roomy ? top + 8 : Math.max(top, layout.bounds.top - 26);
      return svg`
        <g class="stars">${STARS.map(
          (s) => svg`<circle cx=${x + s.x * w} cy=${y + s.y * skyH} r=${s.r} style="animation-delay:${s.d}s"></circle>`,
        )}</g>
        <g transform="translate(${moonX} ${moonY})">
          <circle r="18" fill="#f5f0da" opacity="0.28" filter="url(#lc-blur)"></circle>
          <circle r="11" fill="#f5f0da" mask="url(#lc-moon)"></circle>
        </g>`;
    }
    const azimuth = this.sun?.azimuth ?? 180;
    const elevation = this.sun?.elevation ?? (mode === 'day' ? 40 : 2);
    const sx = roomy ? (azimuth < 180 ? leftX : rightX) : x + w * clamp((azimuth - 60) / 240, 0.1, 0.9);
    const sy = bottom - (bottom - top) * clamp((elevation + 4) / 60, 0, 1);
    // Position on the outer group; the CSS drift animation owns the inner group's transform.
    const cloud = (cx: number, cy: number, s: number, cls: string) => svg`
      <g transform="translate(${cx} ${cy}) scale(${s})"><g class="cloud ${cls}">
        <path d="M-22 6a9 9 0 0 1 6-15 12 12 0 0 1 22-3 10 10 0 0 1 16 10 7 7 0 0 1-2 14h-38a6 6 0 0 1-4-6z"></path>
      </g></g>`;
    return svg`
      <g class="sun" transform="translate(${sx} ${sy})">
        <circle r="30" opacity="0.12"></circle>
        <circle r="20" opacity="0.22"></circle>
        <circle r="12"></circle>
      </g>
      ${cloud(roomy ? leftX : x + w * 0.22, top + 14, 0.7, 'c1')}
      ${cloud(x + w * 0.5 + layout.bodyW * 0.42, top + 4, 0.55, 'c2')}`;
  }

  private renderHouse(layout: HouseLayout, p: Palette) {
    const { bodyW, topY, roofH } = layout;
    const peakX = bodyW / 2;
    const roofY = topY;
    const chimneyX = bodyW * 0.72;
    const slopeAt = (x: number) => roofY - roofH * (1 - Math.abs(x - peakX) / (peakX + OVERHANG));
    return svg`
      <g class="house">
        <rect x=${chimneyX} y=${roofY - roofH * 0.82} width="13" height=${roofH * 0.82 - (roofY - slopeAt(chimneyX + 13)) + 2}
          fill=${p.roofEdge}></rect>
        <rect x=${chimneyX - 2} y=${roofY - roofH * 0.82 - 4} width="17" height="5" rx="1.5" fill=${p.roof}></rect>
        ${
          layout.basementH
            ? svg`<rect x="0" y="0" width=${bodyW} height=${layout.basementH} fill=${p.foundation}></rect>`
            : nothing
        }
        <rect x="0" y=${topY} width=${bodyW} height=${-topY} fill=${p.wall}></rect>
        <rect x="0" y=${topY} width=${bodyW} height=${-topY} fill="url(#lc-siding)"></rect>
        ${layout.bands.map((y) => svg`<rect x="0" y=${y - 2} width=${bodyW} height="4" fill=${p.trim} opacity="0.7"></rect>`)}
        <path d="M${-OVERHANG} ${roofY + 3} L${peakX} ${roofY - roofH} L${bodyW + OVERHANG} ${roofY + 3} Z" fill=${p.roof}></path>
        <path d="M${-OVERHANG} ${roofY + 3} L${peakX} ${roofY - roofH} L${bodyW + OVERHANG} ${roofY + 3}"
          fill="none" stroke=${p.roofEdge} stroke-width="4" stroke-linejoin="round" stroke-linecap="round"></path>
        ${layout.door ? this.renderDoor(layout.door.x, p) : nothing}
        ${layout.windows.map((slot, i) => this.renderWindow(slot, i, p))}
        ${this.renderBush(-OVERHANG + 2, p, false)}
        ${this.renderBush(bodyW + OVERHANG - 2, p, true)}
      </g>`;
  }

  private renderDoor(x: number, p: Palette) {
    return svg`
      <g class="door">
        <rect x=${x - 3} y=${-DOOR_H - 3} width=${DOOR_W + 6} height=${DOOR_H + 3} rx="4" fill=${p.trim}></rect>
        <path d="M${x} 0V${-DOOR_H + 9}a9 9 0 0 1 9-9h6a9 9 0 0 1 9 9V0z" fill=${p.door}></path>
        <circle cx=${x + DOOR_W - 6} cy=${-DOOR_H / 2 + 2} r="1.6" fill="#e8c46a"></circle>
        <rect x=${x - 6} y="-1" width=${DOOR_W + 12} height="3" rx="1.5" fill=${p.trim}></rect>
      </g>`;
  }

  private renderBush(x: number, p: Palette, flip: boolean) {
    const d = flip ? -1 : 1;
    return svg`<g class="bush" fill=${p.bush}>
      <circle cx=${x} cy="-6" r="9"></circle>
      <circle cx=${x + 9 * d} cy="-4" r="7"></circle>
      <circle cx=${x - 8 * d} cy="-3" r="6"></circle>
    </g>`;
  }

  private renderWindow(slot: Slot, index: number, p: Palette) {
    const { room, x, y, w, h } = slot;
    const lit = room.onCount > 0 && room.rgb;
    const selected = this.selected === room.id;
    const glow = lit ? 0.35 + room.level * 0.55 : 0;
    const curtain = slot.basement
      ? nothing
      : svg`
      <path class="curtain" d="M0 0h7c-2 ${h * 0.45}-1 ${h * 0.8} 1 ${h}H0z"></path>
      <path class="curtain" d="M${w} 0h-7c2 ${h * 0.45} 1 ${h * 0.8}-1 ${h}H${w}z"></path>`;
    return svg`
      <g transform="translate(${x} ${y})"><g
        class="win ${lit ? 'lit' : ''} ${selected ? 'selected' : ''}"
        role="button"
        tabindex="0"
        aria-label=${`${room.name}: ${room.caption}`}
        aria-pressed=${selected ? 'true' : 'false'}
        style="--glow:${glow.toFixed(2)}"
        @click=${() => this.select(room.id)}
        @keydown=${(ev: KeyboardEvent) => this.onKey(ev, room.id)}
        @pointerenter=${(ev: PointerEvent) => ev.pointerType === 'mouse' && (this._hover = room.id)}
        @pointerleave=${() => (this._hover = null)}
      >
        <rect class="halo" x="-12" y="-12" width=${w + 24} height=${h + 24} rx="12"
          fill=${lit ? css3(room.rgb!) : 'transparent'} filter="url(#lc-blur)"></rect>
        <rect class="ring" x="-6" y="-6" width=${w + 12} height=${h + 12} rx="7"></rect>
        <rect x="-3" y="-3" width=${w + 6} height=${h + 6} rx="4" fill=${p.trim}></rect>
        <rect width=${w} height=${h} rx="2" fill=${p.glass}></rect>
        <rect class="light" width=${w} height=${h} rx="2" fill="url(#lc-win-${index})"
          style="opacity:${lit ? (0.55 + room.level * 0.45).toFixed(2) : 0}"></rect>
        ${curtain}
        <path class="mullion" d="M${w / 2} 0V${h}M0 ${h * 0.46}H${w}" stroke=${p.trim}></path>
        ${slot.basement ? nothing : svg`<rect x="-5" y=${h + 3} width=${w + 10} height="3.5" rx="1.5" fill=${p.trim}></rect>`}
      </g></g>`;
  }

  private renderLamp(lamp: Lamp, p: Palette) {
    const { room, x } = lamp;
    const lit = room.onCount > 0 && room.rgb;
    const color = lit ? css3(room.rgb!) : 'transparent';
    const selected = this.selected === room.id;
    return svg`
      <g transform="translate(${x} 0)"><g
        class="lamp ${lit ? 'lit' : ''} ${selected ? 'selected' : ''}"
        role="button"
        tabindex="0"
        aria-label=${`${room.name}: ${room.caption}`}
        aria-pressed=${selected ? 'true' : 'false'}
        style="--glow:${lit ? (0.4 + room.level * 0.6).toFixed(2) : 0}"
        @click=${() => this.select(room.id)}
        @keydown=${(ev: KeyboardEvent) => this.onKey(ev, room.id)}
        @pointerenter=${(ev: PointerEvent) => ev.pointerType === 'mouse' && (this._hover = room.id)}
        @pointerleave=${() => (this._hover = null)}
      >
        <ellipse class="pool" cx="0" cy="1" rx="22" ry="4" fill=${color} filter="url(#lc-soft)"></ellipse>
        <circle class="halo" cx="0" cy="-50" r="16" fill=${color} filter="url(#lc-blur)"></circle>
        <rect class="hit" x="-12" y="-64" width="24" height="66" fill="transparent"></rect>
        <circle class="ring" cx="0" cy="-50" r="11"></circle>
        <rect x="-1.6" y="-44" width="3.2" height="44" rx="1.2" fill=${p.lampPost}></rect>
        <rect x="-5" y="-2" width="10" height="3" rx="1" fill=${p.lampPost}></rect>
        <path d="M-6 -44h12l-2-11h-8z" fill=${lit ? css3(mixRgb(room.rgb!, [255, 255, 255], 0.5)) : p.glass}
          stroke=${p.lampPost} stroke-width="1.4"></path>
        <path d="M-7.5 -55h15l-7.5-5z" fill=${p.lampPost}></path>
      </g></g>`;
  }

  private renderTip(slot: Slot, vbX: number, vbY: number, vbW: number, vbH: number) {
    const { w, h } = this._size;
    const left = ((slot.x + slot.w / 2 - vbX) / vbW) * w;
    const top = ((slot.y - 8 - vbY) / vbH) * h;
    const lit = slot.room.onCount > 0;
    return html`<div
      class="tip ${lit ? 'lit' : ''}"
      style="left:${clamp(left, 60, w - 60)}px;top:${Math.max(18, top)}px"
    >
      <strong>${slot.room.name}</strong><span>${slot.room.caption}</span>
    </div>`;
  }

  private select(roomId: string): void {
    fireEvent(this, 'lc-room-select', { roomId });
  }

  private onKey(ev: KeyboardEvent, roomId: string): void {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this.select(roomId);
    }
  }

  static override styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    :host([dark]) svg.sky-day {
      filter: brightness(0.86) saturate(0.92);
    }
    .stars circle {
      fill: #fff;
      animation: twinkle 4s ease-in-out infinite;
    }
    .sun circle {
      fill: #ffd45e;
    }
    .sky-dusk .sun circle {
      fill: #ffb067;
    }
    .cloud path {
      fill: #fff;
      opacity: 0.85;
    }
    .sky-dusk .cloud path {
      fill: #f6b9a3;
      opacity: 0.5;
    }
    .cloud.c1 {
      animation: drift 38s ease-in-out infinite alternate;
    }
    .cloud.c2 {
      animation: drift 52s ease-in-out infinite alternate-reverse;
    }
    .win,
    .lamp {
      cursor: pointer;
      outline: none;
      transition: transform 0.25s ease;
      transform-box: fill-box;
      transform-origin: center;
    }
    .win:hover {
      transform: scale(1.08);
    }
    .halo {
      opacity: var(--glow);
      transition:
        opacity 0.6s ease,
        fill 0.6s ease;
    }
    .pool {
      opacity: calc(var(--glow) * 0.8);
      transition: opacity 0.6s ease;
    }
    .light {
      transition: opacity 0.6s ease;
    }
    .curtain {
      fill: rgba(0, 0, 0, 0.18);
    }
    .lit .curtain {
      fill: rgba(0, 0, 0, 0.12);
    }
    .mullion {
      stroke-width: 2.4;
      fill: none;
    }
    .ring {
      fill: none;
      stroke: transparent;
      stroke-width: 2.5;
      transition: stroke 0.25s ease;
    }
    .selected .ring,
    .win:focus-visible .ring,
    .lamp:focus-visible .ring {
      stroke: var(--primary-color, #03a9f4);
    }
    .sky-night .selected .ring {
      stroke: #fff;
    }
    .tip {
      position: absolute;
      transform: translate(-50%, -100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 5px 10px;
      border-radius: 10px;
      background: rgba(15, 18, 28, 0.82);
      color: #fff;
      font-size: 12px;
      line-height: 15px;
      white-space: nowrap;
      pointer-events: none;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
    }
    .tip strong {
      font-weight: 600;
    }
    .tip span {
      opacity: 0.75;
      font-size: 11px;
    }
    @keyframes twinkle {
      0%,
      100% {
        opacity: 0.9;
      }
      50% {
        opacity: 0.25;
      }
    }
    @keyframes drift {
      from {
        transform: translateX(-18px);
      }
      to {
        transform: translateX(18px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .stars circle,
      .cloud {
        animation: none !important;
      }
    }
  `;
}

if (!customElements.get('lc-house')) customElements.define('lc-house', LcHouse);
