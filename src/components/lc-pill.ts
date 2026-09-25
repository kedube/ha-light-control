import { LitElement, css, html } from 'lit';
import { clamp } from '../color.ts';
import { t } from '../localize.ts';
import { themeVars } from '../styles.ts';
import { fireEvent, haptic } from '../utils.ts';

export interface SlideDetail {
  value: number;
  final: boolean;
}

/**
 * A tall brightness slider filled with the light's color. Drag anywhere (or tap a level) to set it;
 * dragging to the bottom turns the light off.
 */
export class LcPill extends LitElement {
  static override properties = {
    value: { type: Number },
    disabled: { type: Boolean, reflect: true },
    label: {},
    _drag: { state: true },
  };

  declare value: number;
  declare disabled: boolean;
  declare label: string;
  declare _drag?: number;

  private pointerId?: number;

  constructor() {
    super();
    this.value = 0;
    this.disabled = false;
    this.label = t('brightness');
  }

  protected override render() {
    const value = Math.round(this._drag ?? this.value);
    return html`
      <div
        class="pill ${this._drag !== undefined ? 'dragging' : ''}"
        style="--v:${value}%;--glow:${(value / 100).toFixed(2)}"
        role="slider"
        tabindex=${this.disabled ? -1 : 0}
        aria-label=${this.label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${value}
        aria-valuetext=${value ? `${value}%` : t('off')}
        aria-disabled=${this.disabled ? 'true' : 'false'}
        @pointerdown=${this.onDown}
        @pointermove=${this.onMove}
        @pointerup=${this.onUp}
        @pointercancel=${this.onUp}
        @keydown=${this.onKey}
      >
        <div class="fill"></div>
      </div>
    `;
  }

  private valueAt(ev: PointerEvent): number {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.round(clamp(((rect.bottom - ev.clientY) / rect.height) * 100, 0, 100));
  }

  private onDown = (ev: PointerEvent): void => {
    if (this.disabled || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    this.pointerId = ev.pointerId;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    this._drag = this.valueAt(ev);
    fireEvent<SlideDetail>(this, 'lc-slide', { value: this._drag, final: false });
  };

  private onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.pointerId) return;
    const value = this.valueAt(ev);
    if (value === this._drag) return;
    if ((value === 0 || value === 100) && value !== this._drag) haptic('selection');
    this._drag = value;
    fireEvent<SlideDetail>(this, 'lc-slide', { value, final: false });
  };

  private onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.pointerId) return;
    this.pointerId = undefined;
    const value = this._drag ?? this.value;
    this._drag = undefined;
    this.value = value;
    fireEvent<SlideDetail>(this, 'lc-slide', { value, final: true });
  };

  private onKey = (ev: KeyboardEvent): void => {
    if (this.disabled) return;
    const steps: Record<string, number> = {
      ArrowUp: 5,
      ArrowRight: 5,
      ArrowDown: -5,
      ArrowLeft: -5,
      PageUp: 20,
      PageDown: -20,
    };
    let value: number;
    if (ev.key in steps) value = clamp(this.value + steps[ev.key], 0, 100);
    else if (ev.key === 'Home') value = 0;
    else if (ev.key === 'End') value = 100;
    else return;
    ev.preventDefault();
    this.value = value;
    fireEvent<SlideDetail>(this, 'lc-slide', { value, final: true });
  };

  static override styles = [
    themeVars,
    css`
      :host {
        display: block;
        width: 100px;
        height: 250px;
        flex: none;
      }
      .pill {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 34px;
        overflow: hidden;
        isolation: isolate;
        background: var(--lc-surface-2);
        box-shadow:
          inset 0 0 0 1px rgba(var(--lc-rgb-text), 0.08),
          0 18px 50px -18px rgba(var(--lc-c, 255, 196, 116), calc(var(--glow) * 0.9));
        cursor: ns-resize;
        touch-action: none;
        outline: none;
        transition: box-shadow 0.4s ease;
      }
      .pill:focus-visible {
        box-shadow:
          0 0 0 3px var(--primary-color, #03a9f4),
          0 18px 50px -18px rgba(var(--lc-c, 255, 196, 116), calc(var(--glow) * 0.9));
      }
      :host([disabled]) .pill {
        cursor: default;
        opacity: 0.5;
      }
      .fill {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: var(--v);
        background:
          radial-gradient(120% 50% at 50% 0%, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0) 70%),
          linear-gradient(to top, rgb(var(--lc-c, 255, 196, 116)), rgba(var(--lc-c, 255, 196, 116), 0.9));
        transition: height 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .fill::after {
        content: '';
        position: absolute;
        top: 9px;
        left: 50%;
        width: 28px;
        height: 4px;
        margin-left: -14px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.75);
        opacity: min(1, calc(var(--glow) * 8));
      }
      .dragging .fill {
        transition: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .fill {
          transition: none;
        }
      }
    `,
  ];
}

if (!customElements.get('lc-pill')) customElements.define('lc-pill', LcPill);
