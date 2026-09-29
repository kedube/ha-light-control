import { LitElement, css, html } from 'lit';
import { clamp } from '../color.ts';
import { t } from '../localize.ts';
import { themeVars } from '../styles.ts';
import { fireEvent, haptic } from '../utils.ts';
import type { SlideDetail } from './lc-pill.ts';

/** How far a finger moves before the bar decides between a slide and a scroll. */
const DRAG_SLOP = 7;

/**
 * A horizontal brightness bar, like the slider on Home Assistant's tile cards: it fills with the
 * light's color up to its level. Drag or tap anywhere on it; arrow keys move it in 5% steps.
 */
export class LcSlider extends LitElement {
  static override properties = {
    value: { type: Number },
    disabled: { type: Boolean, reflect: true },
    label: {},
    min: { type: Number },
    _drag: { state: true },
  };

  declare value: number;
  declare disabled: boolean;
  declare label: string;
  /** Lowest value the bar can be dragged to; 0 lets it turn lights off. */
  declare min: number;
  declare _drag?: number;

  private pointerId?: number;
  /** Where a touch began, until it turns out to be a slide. */
  private start?: { x: number; y: number };

  constructor() {
    super();
    this.value = 0;
    this.disabled = false;
    this.label = t('brightness');
    this.min = 0;
  }

  protected override render() {
    const value = Math.round(this._drag ?? this.value);
    return html`<div
      class="bar ${this._drag !== undefined ? 'dragging' : ''}"
      style="--v:${value}%"
      role="slider"
      tabindex=${this.disabled ? -1 : 0}
      aria-label=${this.label}
      aria-valuemin=${this.min}
      aria-valuemax="100"
      aria-valuenow=${value}
      aria-valuetext=${value ? `${value}%` : t('off')}
      aria-disabled=${this.disabled ? 'true' : 'false'}
      @pointerdown=${this.onDown}
      @pointermove=${this.onMove}
      @pointerup=${this.onUp}
      @pointercancel=${this.onCancel}
      @keydown=${this.onKey}
    >
      <div class="fill"></div>
      <div class="handle"></div>
    </div>`;
  }

  private get bar(): HTMLElement {
    return this.renderRoot.querySelector('.bar') as HTMLElement;
  }

  private valueAt(ev: PointerEvent): number {
    const rect = this.bar.getBoundingClientRect();
    return Math.round(clamp(((ev.clientX - rect.left) / rect.width) * 100, this.min, 100));
  }

  /**
   * A mouse sets the level as soon as it presses. A finger may be scrolling the page instead, so
   * the bar waits until it moves sideways (or lifts without moving, a tap) before changing anything.
   */
  private onDown = (ev: PointerEvent): void => {
    if (this.disabled || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    ev.stopPropagation();
    this.pointerId = ev.pointerId;
    this.start = { x: ev.clientX, y: ev.clientY };
    if (ev.pointerType === 'mouse') this.begin(ev);
  };

  private begin(ev: PointerEvent): void {
    this.start = undefined;
    try {
      this.bar.setPointerCapture(ev.pointerId);
    } catch {
      /* pointer already gone */
    }
    this._drag = this.valueAt(ev);
    fireEvent<SlideDetail>(this, 'lc-slide', { value: this._drag, final: false });
  }

  private onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.pointerId) return;
    if (this.start) {
      const dx = Math.abs(ev.clientX - this.start.x);
      const dy = Math.abs(ev.clientY - this.start.y);
      if (dx < DRAG_SLOP && dy < DRAG_SLOP) return;
      if (dy > dx) {
        // A scroll: let the page have it.
        this.reset();
        return;
      }
      this.begin(ev);
      return;
    }
    const value = this.valueAt(ev);
    if (value === this._drag) return;
    if ((value === this.min || value === 100) && value !== this._drag) haptic('selection');
    this._drag = value;
    fireEvent<SlideDetail>(this, 'lc-slide', { value, final: false });
  };

  private onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.pointerId) return;
    // A finger that never moved is a tap: jump to where it touched.
    const value = this.start ? this.valueAt(ev) : (this._drag ?? this.value);
    this.reset();
    this.value = value;
    fireEvent<SlideDetail>(this, 'lc-slide', { value, final: true });
  };

  /** The browser took the pointer over (usually to scroll): nothing changes. */
  private onCancel = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.pointerId) return;
    this.reset();
  };

  private reset(): void {
    this.pointerId = undefined;
    this.start = undefined;
    this._drag = undefined;
  }

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
    if (ev.key in steps) value = clamp(this.value + steps[ev.key], this.min, 100);
    else if (ev.key === 'Home') value = this.min;
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
        min-width: 0;
        --lc-slider-height: 36px;
      }
      .bar {
        position: relative;
        height: var(--lc-slider-height);
        border-radius: calc(var(--lc-slider-height) / 3);
        overflow: hidden;
        isolation: isolate;
        background: rgba(var(--lc-rgb-text), 0.08);
        cursor: pointer;
        touch-action: pan-y;
        outline: none;
        transition: background 0.3s ease;
      }
      :host([disabled]) .bar {
        cursor: default;
        background: var(--lc-surface-2);
      }
      .bar:focus-visible {
        box-shadow: 0 0 0 2px var(--primary-color, #03a9f4);
      }
      .fill {
        position: absolute;
        inset: 0;
        right: auto;
        width: var(--v);
        background: linear-gradient(
          90deg,
          rgb(var(--lc-accent, var(--lc-c, 255, 196, 116))),
          color-mix(in srgb, rgb(var(--lc-c, 255, 196, 116)) 78%, white)
        );
        transition: width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      :host([disabled]) .fill {
        opacity: 0.3;
      }
      .handle {
        position: absolute;
        top: 50%;
        left: clamp(6px, calc(var(--v) - 7px), calc(100% - 10px));
        width: 4px;
        height: 45%;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.92);
        transform: translateY(-50%);
        box-shadow: 0 0 6px rgba(0, 0, 0, 0.25);
        transition: left 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .dragging .fill,
      .dragging .handle {
        transition: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .fill,
        .handle {
          transition: none;
        }
      }
    `,
  ];
}

if (!customElements.get('lc-slider')) customElements.define('lc-slider', LcSlider);
