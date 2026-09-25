import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { accentFor, clamp, rgbTriplet } from '../color.ts';
import type { IconStyle } from '../config.ts';
import type { DiscoveredEntity } from '../discovery.ts';
import type { EntityView } from '../entity-model.ts';
import { bulbArt, outletArt, type OutletStyle } from '../graphics.ts';
import type { HomeAssistant } from '../ha-types.ts';
import { icon, mdiTuneVariant, mdiWifiOff } from '../icons.ts';
import { t } from '../localize.ts';
import { artStyles, buttonReset, themeVars } from '../styles.ts';
import { fireEvent, haptic } from '../utils.ts';

export interface TileActionDetail {
  entityId: string;
  action: 'tap' | 'controls';
}

export interface TileBrightnessDetail {
  entityId: string;
  value: number;
  final: boolean;
}

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  width: number;
  dragging: boolean;
  moved: boolean;
  long: boolean;
}

const LONG_PRESS_MS = 480;
const DRAG_SLOP = 7;

/**
 * One light or plug. Tap toggles, sliding sideways dims, and a long press (or right click)
 * opens the full controls. The tile fills with the light's own color up to its brightness.
 */
export class LcTile extends LitElement {
  static override properties = {
    hass: { attribute: false },
    entity: { attribute: false },
    view: { attribute: false },
    outletStyle: { attribute: false },
    iconStyle: { attribute: false },
    powerText: { attribute: false },
    drawing: { type: Boolean },
    dark: { type: Boolean, reflect: true },
    _drag: { state: true },
    _pressed: { state: true },
  };

  declare hass: HomeAssistant;
  declare entity: DiscoveredEntity;
  declare view: EntityView;
  declare outletStyle: OutletStyle;
  declare iconStyle: IconStyle;
  declare powerText?: string;
  declare drawing: boolean;
  declare dark: boolean;
  declare _drag?: number;
  declare _pressed: boolean;

  private gesture?: Gesture;
  private longPressTimer?: ReturnType<typeof setTimeout>;
  private lastPointerType = '';

  constructor() {
    super();
    this.drawing = false;
    this.dark = false;
    this._pressed = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.longPressTimer);
  }

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    // The card hands every tile a fresh `hass` and `view` on each Home Assistant update;
    // only touch the DOM when something this tile shows actually changed.
    for (const key of changed.keys()) {
      if (key === 'hass') {
        const previous = changed.get('hass') as HomeAssistant | undefined;
        if (
          !previous ||
          (this.usesEntityIcon && previous.states[this.entity.entityId] !== this.hass.states[this.entity.entityId])
        ) {
          return true;
        }
        continue;
      }
      if (key === 'view') {
        const previous = changed.get('view');
        if (!previous || JSON.stringify(previous) !== JSON.stringify(this.view)) return true;
        continue;
      }
      return true;
    }
    return false;
  }

  private get usesEntityIcon(): boolean {
    return (
      this.iconStyle === 'entity' ||
      (this.iconStyle !== 'graphic' && this.entity?.customIcon) ||
      this.view?.kind === 'switch'
    );
  }

  protected override render() {
    const { view, entity } = this;
    if (!view) return nothing;
    const dragging = this._drag !== undefined;
    const level = dragging ? this._drag! : view.brightness;
    const on = dragging ? level > 0 : view.on;
    const isLight = view.kind === 'light';
    const glow = on ? (isLight ? 0.35 + (level / 100) * 0.65 : 0.6) : 0;
    const accent = isLight ? accentFor(view.rgb, this.dark) : view.rgb;
    const classes = [
      'tile',
      view.kind,
      on ? 'is-on' : 'is-off',
      view.unavailable ? 'unavailable' : '',
      view.dimmable ? 'dimmable' : '',
      dragging ? 'dragging' : '',
      this._pressed ? 'pressed' : '',
    ].join(' ');

    return html`
      <div
        class=${classes}
        style="--lc-c:${rgbTriplet(view.rgb)};--lc-accent:${rgbTriplet(accent)};--lc-level:${isLight ? level : on ? 100 : 0}%;--lc-glow:${glow.toFixed(2)}"
        role="switch"
        tabindex=${view.unavailable ? -1 : 0}
        aria-checked=${on ? 'true' : 'false'}
        aria-disabled=${view.unavailable ? 'true' : 'false'}
        aria-label=${`${entity.fullName}, ${this.stateText(on, level)}`}
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerUp}
        @pointercancel=${this.onPointerCancel}
        @lostpointercapture=${this.onLostCapture}
        @contextmenu=${this.onContextMenu}
        @keydown=${this.onKeyDown}
        @click=${this.onClick}
      >
        <div class="fill"><span class="grip"></span></div>
        <div class="icon">${this.renderIcon(on, level)}</div>
        <div class="info">
          <div class="name">${entity.name}</div>
          <div class="state">
            ${view.unavailable ? icon(mdiWifiOff, 'mdi tiny') : nothing}
            <span>${this.stateText(on, level)}</span>
          </div>
        </div>
        ${this.renderMore()}
      </div>
    `;
  }

  private renderIcon(on: boolean, level: number) {
    const { view, entity } = this;
    if (this.usesEntityIcon && this.hass) {
      const stateObj = this.hass.states[entity.entityId];
      return html`<ha-state-icon .hass=${this.hass} .stateObj=${stateObj}></ha-state-icon>`;
    }
    if (view.kind === 'outlet') return outletArt(this.outletStyle, this.drawing && on);
    return bulbArt(on, level, view.isGroup);
  }

  private renderMore() {
    const { view } = this;
    if (view.unavailable) return nothing;
    const hasControls =
      view.dimmable || view.supportsColor || view.supportsTemp || view.effects.length > 0 || this.entity.sensors.power;
    if (!hasControls) return nothing;
    const swatch = view.supportsColor || view.supportsTemp;
    return html`<button
      class="more"
      aria-label=${`${t('controls')}: ${this.entity.fullName}`}
      @click=${this.onMoreClick}
      @pointerdown=${(ev: Event) => ev.stopPropagation()}
    >
      ${
        swatch
          ? html`<span class="swatch ${view.on ? '' : view.supportsColor ? 'rainbow' : 'whites'}"></span>`
          : icon(mdiTuneVariant)
      }
    </button>`;
  }

  private stateText(on: boolean, level: number): string {
    const { view } = this;
    if (view.unavailable) return t('unavailable');
    if (view.kind === 'light') {
      if (!on) return t('off');
      return view.dimmable ? `${Math.round(level)}%` : t('on');
    }
    if (on && this.powerText) return `${t('on')} · ${this.powerText}`;
    return on ? t('on') : t('off');
  }

  private get tileEl(): HTMLElement {
    return this.renderRoot.querySelector('.tile') as HTMLElement;
  }

  private emitAction(action: TileActionDetail['action']): void {
    fireEvent<TileActionDetail>(this, 'lc-tile-action', { entityId: this.entity.entityId, action });
  }

  private emitBrightness(value: number, final: boolean): void {
    fireEvent<TileBrightnessDetail>(this, 'lc-tile-brightness', { entityId: this.entity.entityId, value, final });
  }

  private onPointerDown = (ev: PointerEvent): void => {
    this.lastPointerType = ev.pointerType;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (this.view.unavailable) return;
    const rect = this.tileEl.getBoundingClientRect();
    this.gesture = {
      pointerId: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
      left: rect.left,
      width: rect.width,
      dragging: false,
      moved: false,
      long: false,
    };
    this._pressed = true;
    // Touch implicitly captures the pointer on whichever child was hit (icon, name, fill).
    // Capture on the tile itself so the whole gesture, including release outside it, lands here.
    try {
      this.tileEl.setPointerCapture(ev.pointerId);
    } catch {
      /* pointer already gone */
    }
    clearTimeout(this.longPressTimer);
    this.longPressTimer = setTimeout(() => {
      const g = this.gesture;
      if (!g || g.dragging || g.moved) return;
      g.long = true;
      this._pressed = false;
      haptic('medium');
      this.emitAction('controls');
    }, LONG_PRESS_MS);
  };

  private onPointerMove = (ev: PointerEvent): void => {
    const g = this.gesture;
    if (!g || ev.pointerId !== g.pointerId || g.long) return;
    if (!g.dragging) {
      const dx = Math.abs(ev.clientX - g.x);
      const dy = Math.abs(ev.clientY - g.y);
      if (dx < DRAG_SLOP && dy < DRAG_SLOP) return;
      clearTimeout(this.longPressTimer);
      this._pressed = false;
      if (!this.view.dimmable || dy > dx) {
        g.moved = true; // a scroll, or a swipe on something that can't dim
        return;
      }
      g.dragging = true;
    }
    if (g.moved) return;
    const value = Math.round(clamp(((ev.clientX - g.left) / g.width) * 100, 0, 100));
    if (value !== this._drag) {
      if (this._drag !== undefined && (value === 0) !== (this._drag === 0)) haptic('selection');
      this._drag = value;
      this.emitBrightness(value, false);
    }
  };

  private onPointerUp = (ev: PointerEvent): void => {
    const g = this.gesture;
    if (!g || ev.pointerId !== g.pointerId) return;
    clearTimeout(this.longPressTimer);
    this.gesture = undefined;
    this._pressed = false;
    if (g.dragging) {
      const value = this._drag ?? this.view.brightness;
      this.emitBrightness(value, true);
      this._drag = undefined;
    } else if (!g.moved && !g.long) {
      this.emitAction('tap');
    }
  };

  /** Children losing their implicit touch capture to the tile is expected; only the tile's own loss counts. */
  private onLostCapture = (ev: PointerEvent): void => {
    if (ev.target === this.tileEl) this.onPointerCancel(ev);
  };

  private onPointerCancel = (ev: PointerEvent): void => {
    const g = this.gesture;
    if (!g || ev.pointerId !== g.pointerId) return;
    // Also reached from lostpointercapture after a normal pointerup, when the gesture is already gone.
    clearTimeout(this.longPressTimer);
    this.gesture = undefined;
    this._pressed = false;
    if (g.dragging && this._drag !== undefined) {
      this.emitBrightness(this._drag, true);
    }
    this._drag = undefined;
  };

  private onContextMenu = (ev: Event): void => {
    ev.preventDefault();
    // Touch long-press already opened the controls; a mouse right-click opens them here.
    if (this.lastPointerType === 'mouse' && !this.view.unavailable) this.emitAction('controls');
  };

  /** Keyboard and screen-reader activation arrive as clicks without a pointer sequence. */
  private onClick = (ev: MouseEvent): void => {
    if (ev.detail === 0 && ev.target === this.tileEl && !this.view.unavailable) this.emitAction('tap');
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.target !== this.tileEl || this.view.unavailable) return;
    if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault();
      this.emitAction('tap');
      return;
    }
    if (!this.view.dimmable) return;
    const step =
      ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 10 : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -10 : 0;
    if (!step) return;
    ev.preventDefault();
    this.emitBrightness(clamp(Math.round(this.view.brightness / 10) * 10 + step, 0, 100), true);
  };

  private onMoreClick = (ev: Event): void => {
    ev.stopPropagation();
    this.emitAction('controls');
  };

  static override styles = [
    themeVars,
    artStyles,
    buttonReset,
    css`
      :host {
        display: block;
        min-width: 0;
        container-type: inline-size;
      }
      .tile {
        position: relative;
        display: flex;
        align-items: center;
        gap: 9px;
        height: 100%;
        min-height: 64px;
        padding: 7px 8px 7px 9px;
        box-sizing: border-box;
        border-radius: 18px;
        overflow: hidden;
        isolation: isolate;
        background: var(--lc-surface);
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        touch-action: pan-y;
        -webkit-tap-highlight-color: transparent;
        outline: none;
        transition:
          transform 0.18s ease,
          box-shadow 0.45s ease,
          background-color 0.45s ease;
      }
      .tile:focus-visible {
        box-shadow: 0 0 0 2px var(--primary-color, #03a9f4);
      }
      .tile.pressed {
        transform: scale(0.97);
      }
      .tile.is-on {
        background: rgba(var(--lc-c), 0.1);
        box-shadow: 0 10px 28px -16px rgba(var(--lc-c), calc(0.25 + var(--lc-glow) * 0.6));
      }
      :host([dark]) .tile.is-on {
        box-shadow:
          0 12px 34px -14px rgba(var(--lc-c), calc(0.25 + var(--lc-glow) * 0.55)),
          inset 0 0 0 1px rgba(var(--lc-c), 0.14);
      }
      .tile.outlet.is-on,
      .tile.switch.is-on {
        --lc-c: var(--lc-outlet);
        background: rgba(var(--lc-outlet), 0.12);
      }
      .fill {
        position: absolute;
        inset: 0;
        z-index: -1;
        background: linear-gradient(
          90deg,
          rgba(var(--lc-c), 0.2) 0%,
          rgba(var(--lc-c), calc(0.22 + var(--lc-glow) * 0.26)) 100%
        );
        clip-path: inset(0 calc(100% - var(--lc-level)) 0 0);
        transition: clip-path 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .tile.outlet .fill,
      .tile.switch .fill {
        display: none;
      }
      .dragging .fill {
        transition: none;
      }
      .grip {
        position: absolute;
        top: 22px;
        bottom: 22px;
        left: calc(var(--lc-level) - 7px);
        width: 3px;
        border-radius: 2px;
        background: rgba(var(--lc-c), 0.9);
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      .dragging .grip {
        opacity: 1;
        top: 14px;
        bottom: 14px;
      }
      .icon {
        position: relative;
        flex: none;
        width: 38px;
        height: 38px;
        display: grid;
        place-items: center;
        color: var(--lc-text-2);
      }
      .icon::before {
        content: '';
        position: absolute;
        inset: -10px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--lc-c), 0.7) 0%, rgba(var(--lc-c), 0) 68%);
        opacity: 0;
        transform: scale(0.6);
        transition:
          opacity 0.45s ease,
          transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
        pointer-events: none;
      }
      .is-on .icon::before {
        opacity: calc(0.2 + var(--lc-glow) * 0.6);
        transform: scale(1);
      }
      .icon .art {
        position: relative;
        width: 33px;
        height: 33px;
      }
      .is-on .icon .bulb {
        filter: drop-shadow(0 0 calc(2px + var(--lc-glow) * 6px) rgba(var(--lc-c), 0.9));
        animation: switch-on 0.5s ease-out;
      }
      .outlet .icon .art {
        width: 32px;
        height: 32px;
      }
      ha-state-icon {
        position: relative;
        --mdc-icon-size: 26px;
      }
      .is-on ha-state-icon {
        color: rgb(var(--lc-accent));
        filter: drop-shadow(0 0 calc(2px + var(--lc-glow) * 5px) rgba(var(--lc-c), 0.8));
      }
      .info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .name {
        font-size: 14px;
        font-weight: 600;
        line-height: 17px;
        color: var(--lc-text);
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        overflow-wrap: anywhere;
      }
      .state {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12.5px;
        line-height: 16px;
        color: var(--lc-text-2);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .is-on .state {
        color: rgb(var(--lc-accent));
        font-weight: 600;
      }
      :host(:not([dark])) .is-on .state {
        filter: brightness(0.85) saturate(1.2);
      }
      .outlet.is-on .state,
      .switch.is-on .state {
        color: rgb(var(--lc-outlet));
      }
      .dragging .state {
        font-size: 15px;
        color: var(--lc-text);
      }
      .tiny {
        width: 14px;
        height: 14px;
      }
      .unavailable {
        cursor: default;
      }
      .unavailable .icon,
      .unavailable .info {
        opacity: 0.55;
      }
      .more {
        flex: none;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: var(--lc-text-2);
        background: var(--lc-surface-2);
        transition: background 0.2s ease;
      }
      .more:hover {
        background: rgba(var(--lc-rgb-text), 0.14);
      }
      .swatch {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: rgb(var(--lc-c));
        box-shadow:
          0 0 0 2px rgba(255, 255, 255, 0.85),
          0 0 10px rgba(var(--lc-c), 0.9);
      }
      .swatch.rainbow {
        background: conic-gradient(#ff4d4d, #ffd24d, #5dff4d, #4dfff3, #4d6bff, #ff4df0, #ff4d4d);
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6);
        opacity: 0.75;
      }
      .swatch.whites {
        background: linear-gradient(135deg, #ffb46b, #fff6e8 55%, #d6e6ff);
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6);
        opacity: 0.8;
      }
      /* Narrow tiles stack: icon on top, the full width left for the name. */
      @container (max-width: 179px) {
        .tile {
          flex-direction: column;
          align-items: stretch;
          justify-content: space-between;
          gap: 8px;
          min-height: 100px;
          padding: 10px 10px 10px 11px;
        }
        .icon {
          width: 34px;
          height: 34px;
        }
        .more {
          position: absolute;
          top: 8px;
          right: 8px;
        }
        .info {
          flex: none;
        }
      }
      @keyframes switch-on {
        0% {
          filter: drop-shadow(0 0 0 rgba(var(--lc-c), 0)) brightness(1.6);
        }
        35% {
          filter: drop-shadow(0 0 14px rgba(var(--lc-c), 1)) brightness(1.3);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .tile,
        .fill,
        .icon::before {
          transition: none;
        }
        .is-on .icon .bulb {
          animation: none;
        }
      }
    `,
  ];
}

if (!customElements.get('lc-tile')) customElements.define('lc-tile', LcTile);
