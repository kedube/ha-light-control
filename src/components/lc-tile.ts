import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { accentFor, clamp, kelvinPresetKey, rgbTriplet } from '../color.ts';
import type { IconStyle } from '../config.ts';
import type { DiscoveredEntity } from '../discovery.ts';
import type { EntityView } from '../entity-model.ts';
import { bulbArt, outletArt, type OutletStyle } from '../graphics.ts';
import type { HomeAssistant } from '../ha-types.ts';
import type { FixtureKind } from '../house/scene.ts';
import { icon, mdiTuneVariant, mdiWifiOff } from '../icons.ts';
import { t } from '../localize.ts';
import { artStyles, buttonReset, themeVars } from '../styles.ts';
import { fireEvent, haptic } from '../utils.ts';
import type { SlideDetail } from './lc-pill.ts';
import './lc-slider.ts';

export interface TileActionDetail {
  entityId: string;
  action: 'tap' | 'controls' | 'toggle';
}

export interface TileBrightnessDetail {
  entityId: string;
  value: number;
  final: boolean;
}

export type TileLayout = 'tile' | 'chip' | 'row';

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
 * One light or outlet.
 *
 * - `tile`: tap to switch, slide sideways to dim, press and hold (or the round button) for the
 *   full controls. A bar along the bottom shows the brightness in the light's color.
 * - `chip`: a compact outlet with its power draw; tap to switch, hold for details.
 * - `row`: everything in view at once: a switch, a brightness slider and the color button.
 */
export class LcTile extends LitElement {
  static override properties = {
    hass: { attribute: false },
    entity: { attribute: false },
    view: { attribute: false },
    layout: { reflect: true },
    outletStyle: { attribute: false },
    iconStyle: { attribute: false },
    fixture: { attribute: false },
    powerText: { attribute: false },
    drawing: { type: Boolean },
    dark: { type: Boolean, reflect: true },
    _drag: { state: true },
    _pressed: { state: true },
  };

  declare hass: HomeAssistant;
  declare entity: DiscoveredEntity;
  declare view: EntityView;
  declare layout: TileLayout;
  declare outletStyle: OutletStyle;
  declare iconStyle: IconStyle;
  declare fixture: FixtureKind;
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
    this.layout = 'tile';
    this.fixture = 'ceiling';
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

  private get hasControls(): boolean {
    const { view } = this;
    return (
      view.dimmable ||
      view.supportsColor ||
      view.supportsTemp ||
      view.effects.length > 0 ||
      Boolean(this.entity.sensors.power)
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
    const style = `--lc-c:${rgbTriplet(view.rgb)};--lc-accent:${rgbTriplet(accent)};--lc-level:${isLight ? level : on ? 100 : 0}%;--lc-glow:${glow.toFixed(2)}`;

    if (this.layout === 'row') return this.renderRow(classes, style, on, level);

    return html`
      <div
        class=${classes}
        style=${style}
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
        ${
          isLight
            ? html`<div class="fill"></div>
                <div class="bar"></div>`
            : nothing
        }
        <div class="icon">${this.renderIcon(on, level)}</div>
        <div class="info">
          <div class="name">${entity.name}</div>
          <div class="state">
            ${view.unavailable ? icon(mdiWifiOff, 'mdi tiny') : nothing}
            <span>${this.stateText(on, level)}</span>
          </div>
        </div>
        ${this.layout === 'tile' ? this.renderMore() : nothing}
      </div>
    `;
  }

  /** The detailed layout: tap the name for the full controls, and control everything else in place. */
  private renderRow(classes: string, style: string, on: boolean, level: number) {
    const { view, entity } = this;
    const isLight = view.kind === 'light';
    return html`<div class="${classes} row-layout" style=${style}>
      <button
        class="row-main"
        ?disabled=${view.unavailable}
        aria-label=${`${entity.fullName}, ${this.stateText(on, level)}. ${t('controls')}`}
        @click=${() => (this.hasControls ? this.emitAction('controls') : this.emitAction('toggle'))}
        @contextmenu=${(ev: Event) => {
          ev.preventDefault();
          if (!view.unavailable) this.emitAction('controls');
        }}
      >
        <span class="icon">${this.renderIcon(on, level)}</span>
        <span class="info">
          <span class="name">${entity.name}</span>
          <span class="state">
            ${view.unavailable ? icon(mdiWifiOff, 'mdi tiny') : nothing}
            <span>${this.stateText(on, level, true)}</span>
          </span>
        </span>
      </button>
      ${
        isLight && view.dimmable
          ? html`<lc-slider
              class="row-slider"
              .value=${on ? level : 0}
              .label=${`${entity.fullName}, ${t('brightness')}`}
              ?disabled=${view.unavailable}
              @lc-slide=${(ev: CustomEvent<SlideDetail>) => {
                ev.stopPropagation();
                this._drag = ev.detail.final ? undefined : ev.detail.value;
                this.emitBrightness(ev.detail.value, ev.detail.final);
              }}
            ></lc-slider>`
          : nothing
      }
      ${this.hasControls && (view.supportsColor || view.supportsTemp || !isLight) ? this.renderMore() : nothing}
      <button
        class="toggle ${on ? 'on' : ''}"
        role="switch"
        aria-checked=${on ? 'true' : 'false'}
        aria-label=${entity.fullName}
        ?disabled=${view.unavailable}
        @click=${() => this.emitAction('toggle')}
      >
        <span class="knob"></span>
      </button>
    </div>`;
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
    if (view.unavailable || !this.hasControls) return nothing;
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

  private stateText(on: boolean, level: number, detailed = false): string {
    const { view } = this;
    if (view.unavailable) return t('unavailable');
    if (view.kind === 'light') {
      if (!on) return t('off');
      const parts = [view.dimmable ? `${Math.round(level)}%` : t('on')];
      if (detailed && view.colorMode === 'color_temp' && view.kelvin) parts.push(t(kelvinPresetKey(view.kelvin)));
      if (detailed && view.effect && view.effect.toLowerCase() !== 'none') parts.push(view.effect);
      return parts.join(' · ');
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
        gap: 10px;
        height: 100%;
        min-height: 64px;
        padding: 8px 8px 8px 10px;
        box-sizing: border-box;
        border-radius: 18px;
        overflow: hidden;
        isolation: isolate;
        background: var(--lc-tile, rgba(var(--lc-rgb-text), 0.055));
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
      /* On: a lighter surface, with the light's color kept to the icon and the brightness bar. */
      .tile.is-on {
        background: var(--lc-tile-on, rgba(var(--lc-rgb-text), 0.1));
        box-shadow:
          inset 0 0 0 1px rgba(var(--lc-c), 0.22),
          0 10px 26px -18px rgba(var(--lc-c), calc(0.3 + var(--lc-glow) * 0.6));
      }
      :host(:not([dark])) .tile.is-on {
        background: var(--lc-tile-on, #fff);
        box-shadow:
          0 0 0 1px rgba(var(--lc-c), 0.28),
          0 6px 18px -10px rgba(0, 0, 0, 0.25),
          0 10px 26px -16px rgba(var(--lc-c), 0.7);
      }
      .tile.outlet.is-on,
      .tile.switch.is-on {
        --lc-c: var(--lc-outlet);
      }
      .fill {
        position: absolute;
        inset: 0;
        z-index: -1;
        background: linear-gradient(
          90deg,
          rgba(var(--lc-c), 0.05),
          rgba(var(--lc-c), calc(0.08 + var(--lc-glow) * 0.1))
        );
        clip-path: inset(0 calc(100% - var(--lc-level)) 0 0);
        opacity: 0;
        transition:
          clip-path 0.4s cubic-bezier(0.2, 0.8, 0.2, 1),
          opacity 0.4s ease;
      }
      .dragging .fill {
        opacity: 1;
        background: linear-gradient(90deg, rgba(var(--lc-c), 0.18), rgba(var(--lc-c), 0.34));
        transition: none;
      }
      .bar {
        position: absolute;
        left: 12px;
        right: 12px;
        bottom: 5px;
        height: 3px;
        border-radius: 2px;
        background: linear-gradient(
          90deg,
          rgb(var(--lc-c)) var(--lc-level),
          rgba(var(--lc-rgb-text), 0.1) var(--lc-level)
        );
        opacity: 0;
        transition: opacity 0.4s ease;
      }
      .is-on.dimmable .bar,
      .dragging .bar {
        opacity: 1;
      }
      .icon {
        position: relative;
        flex: none;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: var(--lc-text-2);
        background: rgba(var(--lc-rgb-text), 0.06);
        transition: background 0.45s ease;
      }
      .is-on .icon {
        background: rgba(var(--lc-c), 0.2);
      }
      .icon::before {
        content: '';
        position: absolute;
        inset: -8px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--lc-c), 0.55) 0%, rgba(var(--lc-c), 0) 68%);
        opacity: 0;
        transform: scale(0.6);
        transition:
          opacity 0.45s ease,
          transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
        pointer-events: none;
      }
      .is-on .icon::before {
        opacity: calc(0.15 + var(--lc-glow) * 0.5);
        transform: scale(1);
      }
      .icon .art {
        position: relative;
        width: 30px;
        height: 30px;
      }
      .is-on .icon .bulb {
        filter: drop-shadow(0 0 calc(2px + var(--lc-glow) * 5px) rgba(var(--lc-c), 0.9));
        animation: switch-on 0.5s ease-out;
      }
      .outlet .icon .art {
        width: 28px;
        height: 28px;
      }
      ha-state-icon {
        position: relative;
        --mdc-icon-size: 22px;
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
        text-align: left;
      }
      .name {
        font-size: 13.5px;
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
        color: var(--lc-text);
        font-weight: 600;
      }
      .outlet.is-on .state,
      .switch.is-on .state {
        color: rgb(var(--lc-outlet));
      }
      :host(:not([dark])) .outlet.is-on .state {
        filter: brightness(0.8);
      }
      .dragging .state {
        font-size: 14px;
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
        opacity: 0.5;
      }
      .more {
        flex: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: var(--lc-text-2);
        transition: background 0.2s ease;
      }
      .more:hover {
        background: rgba(var(--lc-rgb-text), 0.1);
      }
      .more .mdi {
        width: 18px;
        height: 18px;
      }
      .swatch {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: rgb(var(--lc-c));
        box-shadow:
          0 0 0 2px rgba(var(--lc-rgb-text), 0.12),
          0 0 10px rgba(var(--lc-c), 0.8);
      }
      .swatch.rainbow {
        background: conic-gradient(#ff5a5a, #ffd24d, #6ae36a, #4de6f0, #5a78ff, #ee5aff, #ff5a5a);
        box-shadow: none;
        opacity: 0.7;
      }
      .swatch.whites {
        background: linear-gradient(135deg, #ffb46b, #fff6e8 55%, #cfe0ff);
        box-shadow: 0 0 0 1px rgba(var(--lc-rgb-text), 0.15);
        opacity: 0.85;
      }

      /* Outlets as chips: one line, with the power draw. */
      :host([layout='chip']) .tile {
        min-height: 44px;
        gap: 8px;
        padding: 5px 12px 5px 5px;
        border-radius: 22px;
      }
      :host([layout='chip']) .icon {
        width: 34px;
        height: 34px;
      }
      :host([layout='chip']) .icon .art {
        width: 24px;
        height: 24px;
      }
      :host([layout='chip']) .info {
        flex-direction: row;
        align-items: baseline;
        gap: 8px;
      }
      :host([layout='chip']) .name {
        -webkit-line-clamp: 1;
        line-clamp: 1;
      }
      :host([layout='chip']) .state {
        margin-left: auto;
        flex: none;
      }

      /* Detailed rows. */
      /* Two lines: the light and its switch, then its brightness across the full width. */
      .row-layout {
        min-height: 60px;
        gap: 8px 8px;
        padding: 8px 10px 8px 8px;
        cursor: default;
        flex-wrap: wrap;
      }
      .row-main {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 10px;
        border-radius: 14px;
      }
      .row-main:disabled {
        cursor: default;
      }
      .row-slider {
        order: 5;
        flex: 1 0 100%;
        --lc-slider-height: 32px;
      }
      /* The row's own on/off switch ("toggle": a tile of kind "switch" already uses that class). */
      .toggle {
        position: relative;
        flex: none;
        width: 48px;
        height: 30px;
        border-radius: 15px;
        background: rgba(var(--lc-rgb-text), 0.18);
        transition: background 0.3s ease;
      }
      .toggle .knob {
        position: absolute;
        top: 3px;
        left: 3px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        transition: transform 0.28s cubic-bezier(0.3, 0.7, 0.4, 1.3);
      }
      .toggle.on {
        background: rgb(var(--lc-accent));
      }
      .tile.outlet .toggle.on,
      .tile.switch .toggle.on {
        background: rgb(var(--lc-outlet));
      }
      .toggle.on .knob {
        transform: translateX(18px);
      }
      .toggle:disabled {
        opacity: 0.4;
        cursor: default;
      }
      /* Narrow tiles stack: icon on top, the full width left for the name. */
      @container (max-width: 189px) {
        :host(:not([layout='chip'])) .tile:not(.row-layout) {
          flex-direction: column;
          align-items: stretch;
          justify-content: space-between;
          gap: 8px;
          min-height: 92px;
          padding: 10px 10px 12px;
        }
        :host(:not([layout='chip'])) .more {
          position: absolute;
          top: 7px;
          right: 7px;
        }
        :host(:not([layout='chip'])) .info {
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
        .bar,
        .icon::before,
        .toggle,
        .toggle .knob {
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
