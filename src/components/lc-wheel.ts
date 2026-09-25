import { LitElement, css, html, type PropertyValues } from 'lit';
import { clamp, hsToRgb, kelvinToDisplayRgb, rgbTriplet, type RGB } from '../color.ts';
import { t } from '../localize.ts';
import { themeVars } from '../styles.ts';
import { fireEvent, haptic } from '../utils.ts';

export type WheelMode = 'hs' | 'temp';

export interface PickDetail {
  hs?: [number, number];
  kelvin?: number;
  final: boolean;
}

interface Point {
  x: number;
  y: number;
}

const RAD = Math.PI / 180;

/**
 * Color wheel (hue around, saturation outward, red at the top) or a white-temperature disc
 * (cool at the top, warm at the bottom). Same size and gestures, so switching tabs feels familiar.
 */
export class LcWheel extends LitElement {
  static override properties = {
    mode: {},
    hs: { attribute: false },
    kelvin: { type: Number },
    minKelvin: { type: Number },
    maxKelvin: { type: Number },
    active: { type: Boolean },
    disabled: { type: Boolean, reflect: true },
    _drag: { state: true },
  };

  declare mode: WheelMode;
  declare hs?: [number, number];
  declare kelvin?: number;
  declare minKelvin: number;
  declare maxKelvin: number;
  /** The light is currently in this wheel's color mode, so its marker is exact. */
  declare active: boolean;
  declare disabled: boolean;
  declare _drag?: Point;

  private pointerId?: number;
  private resizeObserver?: ResizeObserver;
  private pixelSize = 0;
  private drawnKey = '';
  /** Horizontal position of the temperature marker; only its height means anything. */
  private tempX = 0;

  constructor() {
    super();
    this.mode = 'hs';
    this.minKelvin = 2000;
    this.maxKelvin = 6500;
    this.active = true;
    this.disabled = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.resizeObserver ??= new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('mode') || changed.has('minKelvin') || changed.has('maxKelvin')) this.draw();
  }

  protected override render() {
    const point = this._drag ?? this.pointFromValue();
    const color = point ? this.colorAt(point) : undefined;
    const label = this.mode === 'hs' ? t('color') : t('white');
    return html`
      <div
        class="wheel"
        role="slider"
        tabindex=${this.disabled ? -1 : 0}
        aria-label=${label}
        aria-valuetext=${this.valueText()}
        @pointerdown=${this.onDown}
        @pointermove=${this.onMove}
        @pointerup=${this.onUp}
        @pointercancel=${this.onUp}
        @keydown=${this.onKey}
      >
        <canvas></canvas>
        ${
          point && color
            ? html`<div
                class="marker ${this._drag ? 'dragging' : ''} ${this.active || this._drag ? '' : 'inactive'}"
                style="left:${50 + point.x * 50}%;top:${50 + point.y * 50}%;--m:${rgbTriplet(color)}"
              ></div>`
            : ''
        }
      </div>
    `;
  }

  private valueText(): string {
    if (this.mode === 'hs') return this.hs ? `${Math.round(this.hs[0])}°, ${Math.round(this.hs[1])}%` : '';
    return this.kelvin ? `${Math.round(this.kelvin)} K` : '';
  }

  private pointFromValue(): Point | undefined {
    if (this.mode === 'hs') {
      if (!this.hs) return undefined;
      const [hue, sat] = this.hs;
      const r = clamp(sat, 0, 100) / 100;
      return { x: Math.sin(hue * RAD) * r, y: -Math.cos(hue * RAD) * r };
    }
    if (!this.kelvin) return undefined;
    const span = this.maxKelvin - this.minKelvin || 1;
    const y = clamp(((this.maxKelvin - this.kelvin) / span) * 2 - 1, -1, 1) * 0.94;
    const maxX = Math.sqrt(Math.max(0, 1 - y * y)) * 0.9;
    return { x: clamp(this.tempX, -maxX, maxX), y };
  }

  private kelvinAt(y: number): number {
    return this.maxKelvin - ((clamp(y / 0.94, -1, 1) + 1) / 2) * (this.maxKelvin - this.minKelvin);
  }

  private colorAt(point: Point): RGB {
    if (this.mode === 'temp') return kelvinToDisplayRgb(this.kelvinAt(point.y));
    const hue = (Math.atan2(point.x, -point.y) / RAD + 360) % 360;
    return hsToRgb(hue, Math.min(1, Math.hypot(point.x, point.y)) * 100);
  }

  private pointFromEvent(ev: PointerEvent): Point {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    let x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    let y = ((ev.clientY - rect.top) / rect.height) * 2 - 1;
    const dist = Math.hypot(x, y);
    const limit = this.mode === 'temp' ? 0.94 : 1;
    if (dist > limit) {
      x = (x / dist) * limit;
      y = (y / dist) * limit;
    }
    return { x, y };
  }

  private detailFor(point: Point, final: boolean): PickDetail {
    if (this.mode === 'temp') return { kelvin: Math.round(this.kelvinAt(point.y)), final };
    const hue = (Math.atan2(point.x, -point.y) / RAD + 360) % 360;
    return { hs: [Math.round(hue), Math.round(Math.min(1, Math.hypot(point.x, point.y)) * 100)], final };
  }

  private onDown = (ev: PointerEvent): void => {
    if (this.disabled || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    this.pointerId = ev.pointerId;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    this._drag = this.pointFromEvent(ev);
    fireEvent<PickDetail>(this, 'lc-pick', this.detailFor(this._drag, false));
  };

  private onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.pointerId) return;
    this._drag = this.pointFromEvent(ev);
    fireEvent<PickDetail>(this, 'lc-pick', this.detailFor(this._drag, false));
  };

  private onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.pointerId || !this._drag) return;
    this.pointerId = undefined;
    const point = this._drag;
    if (this.mode === 'temp') this.tempX = point.x;
    const detail = this.detailFor(point, true);
    if (detail.hs) this.hs = detail.hs;
    if (detail.kelvin) this.kelvin = detail.kelvin;
    this._drag = undefined;
    haptic('selection');
    fireEvent<PickDetail>(this, 'lc-pick', detail);
  };

  private onKey = (ev: KeyboardEvent): void => {
    if (this.disabled) return;
    let detail: PickDetail | undefined;
    if (this.mode === 'hs') {
      const [hue, sat] = this.hs ?? [0, 0];
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-5, 0],
        ArrowRight: [5, 0],
        ArrowUp: [0, 5],
        ArrowDown: [0, -5],
      };
      const move = moves[ev.key];
      if (move) detail = { hs: [(hue + move[0] + 360) % 360, clamp(sat + move[1], 0, 100)], final: true };
    } else {
      const kelvin = this.kelvin ?? (this.minKelvin + this.maxKelvin) / 2;
      const step =
        ev.key === 'ArrowUp' || ev.key === 'ArrowRight'
          ? 100
          : ev.key === 'ArrowDown' || ev.key === 'ArrowLeft'
            ? -100
            : 0;
      if (step) detail = { kelvin: clamp(kelvin + step, this.minKelvin, this.maxKelvin), final: true };
    }
    if (!detail) return;
    ev.preventDefault();
    if (detail.hs) this.hs = detail.hs;
    if (detail.kelvin) this.kelvin = detail.kelvin;
    fireEvent<PickDetail>(this, 'lc-pick', detail);
  };

  private draw(): void {
    const canvas = this.renderRoot.querySelector('canvas');
    if (!canvas) return;
    const cssSize = canvas.getBoundingClientRect().width;
    if (!cssSize) return;
    const size = Math.round(cssSize * Math.min(2, window.devicePixelRatio || 1));
    const key = `${this.mode}:${size}:${this.minKelvin}:${this.maxKelvin}`;
    if (key === this.drawnKey && size === this.pixelSize) return;
    this.drawnKey = key;
    this.pixelSize = size;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(size, size);
    const data = image.data;
    const radius = size / 2;
    for (let y = 0; y < size; y++) {
      const dy = y + 0.5 - radius;
      const rowColor = this.mode === 'temp' ? kelvinToDisplayRgb(this.kelvinAt(dy / radius)) : undefined;
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - radius;
        const dist = Math.hypot(dx, dy);
        const alpha = clamp(radius - dist, 0, 1);
        if (alpha <= 0) continue;
        const rgb = rowColor ?? hsToRgb((Math.atan2(dx, -dy) / RAD + 360) % 360, Math.min(1, dist / radius) * 100);
        const i = (y * size + x) * 4;
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
        data[i + 3] = alpha * 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  static override styles = [
    themeVars,
    css`
      :host {
        display: block;
        width: 230px;
        aspect-ratio: 1;
        flex: none;
      }
      .wheel {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        touch-action: none;
        cursor: crosshair;
        outline: none;
        box-shadow:
          0 0 0 1px rgba(var(--lc-rgb-text), 0.08),
          0 14px 40px -18px rgba(0, 0, 0, 0.55);
      }
      .wheel:focus-visible {
        box-shadow: 0 0 0 3px var(--primary-color, #03a9f4);
      }
      :host([disabled]) .wheel {
        opacity: 0.45;
        cursor: default;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 50%;
      }
      .marker {
        position: absolute;
        width: 30px;
        height: 30px;
        margin: -15px 0 0 -15px;
        border-radius: 50%;
        box-sizing: border-box;
        background: rgb(var(--m));
        border: 4px solid #fff;
        box-shadow:
          0 2px 10px rgba(0, 0, 0, 0.35),
          0 0 0 1px rgba(0, 0, 0, 0.12);
        pointer-events: none;
        transition:
          transform 0.15s ease,
          left 0.3s ease,
          top 0.3s ease;
      }
      .marker.dragging {
        transform: scale(1.25);
        transition: transform 0.15s ease;
      }
      .marker.inactive {
        background: transparent;
        border-width: 3px;
        opacity: 0.8;
      }
    `,
  ];
}

if (!customElements.get('lc-wheel')) customElements.define('lc-wheel', LcWheel);
