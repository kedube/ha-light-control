import { LitElement, css, html, nothing, svg, type PropertyValues } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { repeat } from 'lit/directives/repeat.js';
import { rgbTriplet, type RGB } from '../color.ts';
import {
  ISO_X,
  ISO_Y,
  leftFace,
  polyline,
  rightFace,
  screenBounds,
  topFace,
  type Box,
  type ScreenBounds,
} from '../house/iso.ts';
import { environment, type Environment } from '../house/palette.ts';
import { planHouse, GROUND_ID, type HousePlan } from '../house/plan.ts';
import { buildScene, roofSlope, type FixtureInput, type Scene, type SceneView } from '../house/scene.ts';
import { skyMode, sunFromLeft, type SunInfo } from '../house/sky.ts';
import { t } from '../localize.ts';
import type { RoomType } from '../room-types.ts';
import { fireEvent } from '../utils.ts';

export { skyMode, type SunInfo } from '../house/sky.ts';
export { GROUND_ID } from '../house/plan.ts';

export interface HouseRoom {
  id: string;
  name: string;
  icon: string;
  type: RoomType;
  floorId: string | null;
  outdoor: boolean;
  lights: FixtureInput[];
  /** "2 of 3 on · 60%", for tooltips and screen readers. */
  caption: string;
  /** Color of the room's lit lights; null when it is dark. */
  rgb: RGB | null;
}

export interface HouseFloor {
  id: string;
  level: number | null;
}

export type HouseView = { kind: 'home' } | { kind: 'outside' } | { kind: 'floor'; floorId: string };

interface Camera {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Label {
  room: HouseRoom;
  x: number;
  y: number;
}

const DURATION = 620;
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/** Deterministic star field, so the sky doesn't reshuffle on every render. */
const STARS = (() => {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: 46 }, () => ({ x: rand(), y: rand() * 0.72, r: 0.5 + rand() * 1.1, d: rand() * 5 }));
})();

/**
 * The home in 3D. Outside, every room is a window lit in the color and brightness of its lights;
 * a floor opens up like a dollhouse, with furniture and a pool of light under every lamp.
 */
export class LcHouse extends LitElement {
  static override properties = {
    rooms: { attribute: false },
    floors: { attribute: false },
    view: { attribute: false },
    selected: { attribute: false },
    sun: { attribute: false },
    topInset: { type: Number },
    titleWidth: { type: Number },
    bottomInset: { type: Number },
    dark: { type: Boolean, reflect: true },
    _size: { state: true },
    _hover: { state: true },
    _camera: { state: true },
    _ghost: { state: true },
  };

  declare rooms: HouseRoom[];
  declare floors: HouseFloor[];
  declare view: HouseView;
  declare selected: string | null;
  declare sun?: SunInfo;
  /** Pixels at the top kept clear for the card's title. */
  declare topInset: number;
  /** Width of the title in the top left; the house only moves down when it would run into it. */
  declare titleWidth: number;
  /** Pixels at the bottom kept clear for the floor switcher. */
  declare bottomInset: number;
  declare dark: boolean;
  declare _size: { w: number; h: number };
  declare _hover: string | null;
  declare _camera?: Camera;
  /** The previous view, fading out while the new one fades in. */
  declare _ghost: { scene: Scene } | null;

  private resizeObserver?: ResizeObserver;
  private planKey = '';
  private plan?: HousePlan;
  private sceneKey = '';
  private scene?: Scene;
  private viewKey = '';
  private viewSerial = 0;
  private tween?: { from: Camera; to: Camera; start: number };
  private frame = 0;
  private ghostTimer?: ReturnType<typeof setTimeout>;
  private target?: Camera;

  constructor() {
    super();
    this.rooms = [];
    this.floors = [];
    this.view = { kind: 'home' };
    this.selected = null;
    this.topInset = 0;
    this.titleWidth = 0;
    this.bottomInset = 0;
    this.dark = false;
    this._size = { w: 0, h: 0 };
    this._hover = null;
    this._ghost = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.resizeObserver ??= new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height && (Math.abs(width - this._size.w) > 0.5 || Math.abs(height - this._size.h) > 0.5)) {
        this._size = { w: width, h: height };
      }
    });
    this.resizeObserver.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
    clearTimeout(this.ghostTimer);
    // Home Assistant detaches cards when views switch; finish any move now rather than freeze mid-way.
    if (this.tween) {
      this._camera = this.tween.to;
      this.tween = undefined;
    }
    this._ghost = null;
  }

  private get reducedMotion(): boolean {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ─── Model ─────────────────────────────────────────────────────────────────

  private planFor(): HousePlan {
    const indoor = this.rooms.filter((r) => !r.outdoor);
    const floorIds = new Set(this.floors.map((f) => f.id));
    const key = JSON.stringify([this.floors.map((f) => [f.id, f.level]), indoor.map((r) => [r.id, r.type, r.floorId])]);
    if (key !== this.planKey || !this.plan) {
      const input = (list: HouseRoom[]) => list.map((r) => ({ id: r.id, type: r.type }));
      this.plan = planHouse(
        this.floors.map((f) => ({ id: f.id, level: f.level, rooms: input(indoor.filter((r) => r.floorId === f.id)) })),
        input(indoor.filter((r) => !r.floorId || !floorIds.has(r.floorId))),
      );
      this.planKey = key;
    }
    return this.plan;
  }

  private sceneView(plan: HousePlan): SceneView {
    const view = this.view;
    if (view.kind === 'floor') {
      const ids = new Set(this.rooms.filter((r) => r.floorId === view.floorId).map((r) => r.id));
      let story = plan.stories.findIndex((s) => s.id === view.floorId || s.cells.some((c) => c.id && ids.has(c.id)));
      if (story < 0 && view.floorId === GROUND_ID) story = plan.stories.findIndex((s) => s.ground);
      if (story >= 0) return { kind: 'cutaway', story };
    }
    return { kind: 'exterior', focus: view.kind === 'outside' ? 'outside' : 'house' };
  }

  private environment(): Environment {
    return environment(skyMode(this.sun), sunFromLeft(this.sun));
  }

  private sceneFor(plan: HousePlan, view: SceneView, env: Environment, prefix: string): Scene {
    const key = JSON.stringify([
      this.planKey,
      view,
      env.mode,
      env.left > env.right,
      prefix,
      this.rooms.map((r) => [r.id, r.lights.map((l) => [l.on, l.level, l.rgb, l.name])]),
    ]);
    if (key !== this.sceneKey || !this.scene) {
      const rooms = new Map(
        this.rooms.filter((r) => !r.outdoor).map((r) => [r.id, { id: r.id, type: r.type, lights: r.lights }]),
      );
      const outdoor = this.rooms.filter((r) => r.outdoor).map((r) => ({ id: r.id, type: r.type, lights: r.lights }));
      this.scene = buildScene({ plan, rooms, outdoor, env, view, prefix });
      this.sceneKey = key;
    }
    return this.scene;
  }

  // ─── Camera ────────────────────────────────────────────────────────────────

  private fit(bounds: ScreenBounds): Camera {
    const { w, h } = this._size;
    const padX = Math.max(12, w * 0.03);
    const bottom = this.bottomInset + 10;
    const bw = Math.max(1, bounds.right - bounds.left);
    const bh = Math.max(1, bounds.bottom - bounds.top);
    const place = (top: number): Camera & { scale: number } => {
      const scale = Math.max(0.01, Math.min((w - 2 * padX) / bw, (h - top - bottom) / bh));
      const cw = w / scale;
      const ch = h / scale;
      return {
        x: bounds.left - (cw - bw) / 2,
        y: bounds.top - top / scale - ((h - top - bottom) / scale - bh) / 2,
        w: cw,
        h: ch,
        scale,
      };
    };
    // Use the full height unless the house would then run into the title in the top left.
    const tight = place(10);
    const left = ((bounds.left - tight.x) / tight.w) * w;
    const top = ((bounds.top - tight.y) / tight.h) * h;
    const clash = this.topInset > 10 && left < this.titleWidth + 12 && top < this.topInset;
    const { scale: _scale, ...camera } = clash ? place(this.topInset + 8) : tight;
    return camera;
  }

  private moveCamera(to: Camera, animate: boolean): void {
    this.target = to;
    const from = this._camera;
    if (!animate || !from || this.reducedMotion) {
      cancelAnimationFrame(this.frame);
      this.tween = undefined;
      this._camera = to;
      return;
    }
    this.tween = { from, to, start: performance.now() };
    cancelAnimationFrame(this.frame);
    const step = (now: number) => {
      const tw = this.tween;
      if (!tw) return;
      const p = Math.min(1, (now - tw.start) / DURATION);
      const k = ease(p);
      this._camera = {
        x: tw.from.x + (tw.to.x - tw.from.x) * k,
        y: tw.from.y + (tw.to.y - tw.from.y) * k,
        w: tw.from.w + (tw.to.w - tw.from.w) * k,
        h: tw.from.h + (tw.to.h - tw.from.h) * k,
      };
      if (p < 1) this.frame = requestAnimationFrame(step);
      else this.tween = undefined;
    };
    this.frame = requestAnimationFrame(step);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!this._size.w || !this.rooms.length) return;
    const plan = this.planFor();
    const view = this.sceneView(plan);
    const viewKey = JSON.stringify(view);
    const env = this.environment();
    const viewChanged = viewKey !== this.viewKey;
    if (viewChanged) {
      // Keep the old view on screen while the new one fades in.
      if (this.scene && this.viewKey && !this.reducedMotion) {
        this._ghost = { scene: this.scene };
        clearTimeout(this.ghostTimer);
        this.ghostTimer = setTimeout(() => (this._ghost = null), DURATION);
      }
      this.viewSerial++;
      this.viewKey = viewKey;
    }
    const scene = this.sceneFor(plan, view, env, `v${this.viewSerial}-`);
    const target = this.fit(scene.bounds);
    const moved =
      !this.target ||
      Math.abs(target.x - this.target.x) > 0.01 ||
      Math.abs(target.y - this.target.y) > 0.01 ||
      Math.abs(target.w - this.target.w) > 0.01;
    if (moved) this.moveCamera(target, viewChanged && !changed.has('_size'));
    if (changed.has('_size') && this.tween) this.tween.to = target;
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  protected override render() {
    const camera = this._camera;
    const scene = this.scene;
    const env = this.environment();
    const sky = html`<div
      class="sky"
      style="background:linear-gradient(${env.sky[0]}, ${env.sky[1]} 78%, ${env.horizon})"
    >
      ${this.renderCelestial(env)}
    </div>`;
    if (!camera || !scene || !this.plan) return html`<div class="stage sky-${env.mode}">${sky}</div>`;
    const prefix = `v${this.viewSerial}-`;
    const view = this.view;
    const interactive = !this.tween;
    return html`<div class="stage sky-${env.mode} ${this.tween ? 'moving' : ''}">
      ${sky}
      <svg
        class="scene"
        viewBox="${camera.x} ${camera.y} ${camera.w} ${camera.h}"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label=${t('house_overview')}
      >
        <defs>${this.renderPatterns(env)} ${this.renderDefs(scene)}</defs>
        ${this._ghost ? svg`<g class="ghost" aria-hidden="true"><defs>${this.renderDefs(this._ghost.scene)}</defs>${this.renderShapes(this._ghost.scene)}</g>` : nothing}
        ${keyed(prefix, svg`<g class=${this._ghost ? 'world enter' : 'world'}>${this.renderShapes(scene)}</g>`)}
        ${this.renderOutline(scene, env)}
        <g class="hits">${this.renderHits(scene)}</g>
      </svg>
      ${interactive ? this.renderLabels(scene, camera, view) : nothing}
    </div>`;
  }

  private renderCelestial(env: Environment) {
    const { w, h } = this._size;
    if (!w || !h) return nothing;
    if (env.mode === 'night') {
      return html`<svg class="stars" viewBox="0 0 ${w} ${h}" aria-hidden="true">
          ${STARS.map(
            (s) =>
              svg`<circle cx=${(s.x * w).toFixed(1)} cy=${(s.y * h).toFixed(1)} r=${s.r.toFixed(2)} style="animation-delay:${s.d.toFixed(2)}s"></circle>`,
          )}
        </svg>
        <div class="moon"></div>`;
    }
    const left = env.left > env.right;
    return html`<div class="sun ${left ? 'left' : 'right'} ${env.mode}"></div>`;
  }

  /** Textures, drawn in the plane of the surface they cover. */
  private renderPatterns(env: Environment) {
    const plan = this.plan!;
    const slope = roofSlope(plan);
    const holo = `rgb(${env.holo.join(',')})`;
    const top = `matrix(${ISO_X} ${ISO_Y} ${-ISO_X} ${ISO_Y} 0 0)`;
    return svg`
      <pattern id="lc-grid" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform=${top}>
        <path d="M0 0H1M0 0V1" stroke=${holo} stroke-opacity=${env.mode === 'day' ? 0.16 : 0.2} stroke-width="0.03" fill="none"></path>
      </pattern>
      <pattern id="lc-siding-front" width="4" height="0.24" patternUnits="userSpaceOnUse" patternTransform="matrix(${ISO_X} ${ISO_Y} 0 -1 0 0)">
        <path d="M0 0.01H4" stroke="#000" stroke-opacity="0.13" stroke-width="0.025"></path>
      </pattern>
      <pattern id="lc-siding-right" width="4" height="0.24" patternUnits="userSpaceOnUse" patternTransform="matrix(${-ISO_X} ${ISO_Y} 0 -1 0 0)">
        <path d="M0 0.01H4" stroke="#000" stroke-opacity="0.13" stroke-width="0.025"></path>
      </pattern>
      <pattern id="lc-shingles-front" width="0.9" height="0.3" patternUnits="userSpaceOnUse" patternTransform="matrix(${ISO_X} ${ISO_Y} ${-ISO_X} ${ISO_Y + slope} 0 0)">
        <path d="M0 0.01H0.9M0.2 0V0.15M0.65 0.15V0.3" stroke="#000" stroke-opacity="0.26" stroke-width="0.03" fill="none"></path>
      </pattern>
      <pattern id="lc-shingles-back" width="0.9" height="0.3" patternUnits="userSpaceOnUse" patternTransform="matrix(${ISO_X} ${ISO_Y} ${-ISO_X} ${ISO_Y - slope} 0 0)">
        <path d="M0 0.01H0.9M0.2 0V0.15M0.65 0.15V0.3" stroke="#000" stroke-opacity="0.2" stroke-width="0.03" fill="none"></path>
      </pattern>
      <pattern id="lc-planks" width="1.4" height="0.36" patternUnits="userSpaceOnUse" patternTransform=${top}>
        <path d="M0 0H1.4M0 0.18H1.4M0.35 0V0.18M1.05 0.18V0.36" stroke="#000" stroke-opacity="0.1" stroke-width="0.02" fill="none"></path>
      </pattern>
      <pattern id="lc-tiles" width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform=${top}>
        <path d="M0 0H0.5M0 0V0.5" stroke="#000" stroke-opacity="0.1" stroke-width="0.02" fill="none"></path>
      </pattern>
      <linearGradient id="lc-glass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color=${env.glassDay[0]}></stop>
        <stop offset="1" stop-color=${env.glassDay[1]}></stop>
      </linearGradient>
      <linearGradient id="lc-sky-window" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color=${env.sky[0]}></stop>
        <stop offset="1" stop-color=${env.sky[1]}></stop>
      </linearGradient>
      <radialGradient id="lc-hot" cx="50%" cy="45%" r="60%">
        <stop offset="0" stop-color="#fff" stop-opacity="0.9"></stop>
        <stop offset="1" stop-color="#fff" stop-opacity="0"></stop>
      </radialGradient>`;
  }

  private renderDefs(scene: Scene) {
    return svg`${scene.gradients.map((g) => {
      const color = `rgb(${g.rgb.map((v) => Math.round(v)).join(',')})`;
      const stops = g.stops.map(
        ([offset, opacity]) => svg`<stop offset=${offset} stop-color=${color} stop-opacity=${opacity}></stop>`,
      );
      return g.line
        ? svg`<linearGradient id=${g.id} gradientUnits="userSpaceOnUse" x1=${g.line[0]} y1=${g.line[1]} x2=${g.line[2]} y2=${g.line[3]}>${stops}</linearGradient>`
        : svg`<radialGradient id=${g.id}>${stops}</radialGradient>`;
    })}
    ${scene.clips.map((c) => svg`<clipPath id=${c.id}><path d=${c.d}></path></clipPath>`)}`;
  }

  private renderShapes(scene: Scene) {
    return scene.shapes.map(
      (s) => svg`<path
        d=${s.d}
        fill=${s.fill ?? 'none'}
        opacity=${s.opacity ?? nothing}
        stroke=${s.stroke ?? nothing}
        stroke-width=${s.stroke ? (s.width ?? 1) : nothing}
        class=${s.kind ?? nothing}
        clip-path=${s.clip ? `url(#${s.clip})` : nothing}
      ></path>`,
    );
  }

  /**
   * Keyed by room, so keyboard focus stays on the same room when the view changes around it. A room
   * seen on two walls gets one tab stop.
   */
  private renderHits(scene: Scene) {
    const count = new Map<string, number>();
    const hits = scene.hits.map((hit) => {
      const n = count.get(hit.roomId) ?? 0;
      count.set(hit.roomId, n + 1);
      return { ...hit, key: `${hit.roomId}#${n}`, primary: n === 0 };
    });
    return repeat(
      hits,
      (hit) => hit.key,
      (hit) => this.renderHit(hit.roomId, hit.d, hit.primary),
    );
  }

  private renderHit(roomId: string, d: string, primary: boolean) {
    const room = this.rooms.find((r) => r.id === roomId);
    if (!room) return nothing;
    const selected = this.selected === roomId;
    return svg`<path
      class="hit"
      d=${d}
      role=${primary ? 'button' : nothing}
      tabindex=${primary ? 0 : -1}
      aria-hidden=${primary ? nothing : 'true'}
      aria-label=${primary ? `${room.name}: ${room.caption}` : nothing}
      aria-pressed=${primary ? (selected ? 'true' : 'false') : nothing}
      @click=${() => this.select(roomId)}
      @keydown=${(ev: KeyboardEvent) => this.onKey(ev, roomId)}
      @focus=${() => (this._hover = roomId)}
      @blur=${() => (this._hover = null)}
      @pointerenter=${(ev: PointerEvent) => ev.pointerType === 'mouse' && (this._hover = roomId)}
      @pointerleave=${() => (this._hover = null)}
    ></path>`;
  }

  /** A glowing wireframe around the selected room, and a fainter one around the one under the mouse. */
  private renderOutline(scene: Scene, env: Environment) {
    const holo = `rgb(${env.holo.join(',')})`;
    const frame = (b: Box, strong: boolean) => {
      const top = topFace(b);
      const edges =
        polyline([...top, top[0]]) +
        polyline([
          [b.x1, b.y0, b.z1],
          [b.x1, b.y0, b.z0],
          [b.x1, b.y1, b.z0],
          [b.x0, b.y1, b.z0],
          [b.x0, b.y1, b.z1],
        ]) +
        polyline([
          [b.x1, b.y1, b.z0],
          [b.x1, b.y1, b.z1],
        ]);
      const faces = [topFace(b), leftFace(b), rightFace(b)];
      return svg`<g class="outline ${strong ? 'strong' : ''}">
        ${faces.map((f) => svg`<path d=${polyline([...f, f[0]])} fill=${holo} fill-opacity=${strong ? 0.07 : 0.04} stroke="none"></path>`)}
        <path d=${edges} stroke=${holo} stroke-width=${strong ? 7 : 5} stroke-opacity="0.22" class="line"></path>
        <path d=${edges} stroke=${holo} stroke-width=${strong ? 1.8 : 1.2} class="line"></path>
      </g>`;
    };
    const out = [];
    const hover = this._hover && this._hover !== this.selected ? scene.volumes.get(this._hover) : undefined;
    if (hover) out.push(frame(hover, false));
    const selected = this.selected ? scene.volumes.get(this.selected) : undefined;
    if (selected) out.push(frame(selected, true));
    return svg`<g class="outlines" aria-hidden="true">${out}</g>`;
  }

  private renderLabels(scene: Scene, camera: Camera, view: HouseView) {
    const { w, h } = this._size;
    const byId = new Map(this.rooms.map((r) => [r.id, r]));
    const show = (roomId: string) => {
      const room = byId.get(roomId);
      if (!room) return false;
      if (view.kind === 'floor') return true;
      if (view.kind === 'outside') return room.outdoor || roomId === this._hover || roomId === this.selected;
      return roomId === this._hover || roomId === this.selected;
    };
    const labels: Label[] = [];
    const seen = new Set<string>();
    for (const anchor of scene.anchors) {
      if (seen.has(anchor.roomId) || !show(anchor.roomId)) continue;
      seen.add(anchor.roomId);
      labels.push({
        room: byId.get(anchor.roomId)!,
        x: ((anchor.x - camera.x) / camera.w) * w,
        y: ((anchor.y - camera.y) / camera.h) * h,
      });
    }
    // A busy floor shows each room's icon; its name appears on hover or when it is selected.
    const crowded = labels.length > Math.max(5, Math.floor(w / 130));
    const full = (roomId: string) => !crowded || roomId === this._hover || roomId === this.selected;
    // Nudge labels apart so they never sit on top of each other.
    labels.sort((a, b) => a.y - b.y);
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    for (const label of labels) {
      const half = full(label.room.id) ? Math.min(90, 26 + label.room.name.length * 3.6) : 20;
      let y = label.y;
      for (let tries = 0; tries < 8; tries++) {
        const hit = placed.find((p) => label.x - half < p.r && label.x + half > p.l && y - 12 < p.b && y + 12 > p.t);
        if (!hit) break;
        y = hit.t - 13;
      }
      label.y = Math.max(this.topInset + 14, Math.min(h - this.bottomInset - 14, y));
      label.x = Math.max(half + 4, Math.min(w - half - 4, label.x));
      placed.push({ l: label.x - half, r: label.x + half, t: label.y - 12, b: label.y + 12 });
    }
    return html`<div class="labels">
      ${labels.map(({ room, x, y }) => {
        const lit = Boolean(room.rgb);
        return html`<button
          class="tag ${lit ? 'lit' : ''} ${this.selected === room.id ? 'selected' : ''} ${this._hover === room.id ? 'hover' : ''} ${full(room.id) ? '' : 'compact'}"
          style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;${room.rgb ? `--c:${rgbTriplet(room.rgb)}` : ''}"
          tabindex="-1"
          aria-hidden="true"
          @click=${() => this.select(room.id)}
          @pointerenter=${(ev: PointerEvent) => ev.pointerType === 'mouse' && (this._hover = room.id)}
          @pointerleave=${() => (this._hover = null)}
        >
          <ha-icon .icon=${room.icon}></ha-icon>
          ${full(room.id) ? html`<span class="name">${room.name}</span>` : nothing}
          ${view.kind === 'home' && (this._hover === room.id || this.selected === room.id) ? html`<span class="caption">${room.caption}</span>` : nothing}
          <i class="dot"></i>
        </button>`;
      })}
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

  /** The screen box of a room in the current scene, for tests and the card. */
  roomBounds(roomId: string): ScreenBounds | undefined {
    const box = this.scene?.volumes.get(roomId);
    return box ? screenBounds(box) : undefined;
  }

  static override styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      --lc-holo: 86, 204, 255;
    }
    .stage,
    .sky,
    svg.scene,
    .labels {
      position: absolute;
      inset: 0;
    }
    svg.scene {
      width: 100%;
      height: 100%;
      display: block;
      overflow: visible;
    }
    .sky {
      overflow: hidden;
    }
    .stars {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    .stars circle {
      fill: #fff;
      opacity: 0.7;
      animation: twinkle 4.5s ease-in-out infinite;
    }
    .moon {
      position: absolute;
      top: 18%;
      right: 9%;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: radial-gradient(circle at 38% 38%, #fbf7e6 0 58%, #e9e2c6 100%);
      box-shadow:
        0 0 24px 6px rgba(245, 240, 218, 0.22),
        0 0 80px 30px rgba(120, 160, 255, 0.08);
    }
    .moon::after {
      content: '';
      position: absolute;
      inset: -2px -2px -2px 9px;
      border-radius: 50%;
      background: inherit;
      filter: brightness(0.2);
      opacity: 0.18;
    }
    .sun {
      position: absolute;
      top: 12%;
      width: 180px;
      height: 180px;
      margin: -90px;
      border-radius: 50%;
      background: radial-gradient(
        circle,
        rgba(255, 244, 214, 0.95) 0 9%,
        rgba(255, 226, 160, 0.35) 18%,
        rgba(255, 220, 150, 0) 62%
      );
      pointer-events: none;
    }
    .sun.left {
      left: 14%;
    }
    .sun.right {
      left: 86%;
    }
    .sun.dusk {
      top: 62%;
      background: radial-gradient(
        circle,
        rgba(255, 214, 160, 0.95) 0 8%,
        rgba(255, 150, 100, 0.4) 20%,
        rgba(255, 140, 90, 0) 64%
      );
    }
    .glow {
      mix-blend-mode: screen;
    }
    .line {
      vector-effect: non-scaling-stroke;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
    }
    .world path {
      transition:
        fill 0.6s ease,
        opacity 0.6s ease;
    }
    .world.enter {
      animation: enter ${DURATION}ms ease both;
    }
    .ghost {
      animation: leave ${DURATION}ms ease both;
      pointer-events: none;
    }
    .hit {
      fill: transparent;
      cursor: pointer;
      outline: none;
    }
    .outline {
      pointer-events: none;
      animation: fade-in 0.25s ease both;
    }
    .outline.strong .line:last-child {
      animation: pulse 2.4s ease-in-out infinite;
    }
    .labels {
      pointer-events: none;
    }
    .tag {
      position: absolute;
      transform: translate(-50%, -50%);
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 180px;
      height: 24px;
      padding: 0 8px 0 6px;
      border: 1px solid rgba(var(--lc-holo), 0.35);
      border-radius: 12px;
      background: rgba(8, 16, 32, 0.62);
      color: #eaf6ff;
      font: inherit;
      font-size: 11.5px;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      pointer-events: auto;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      animation: fade-in 0.3s ease both;
      transition:
        border-color 0.2s ease,
        background 0.2s ease;
      --mdc-icon-size: 14px;
    }
    .sky-day .tag {
      background: rgba(255, 255, 255, 0.78);
      color: #10233f;
      border-color: rgba(40, 130, 230, 0.35);
    }
    .tag ha-icon {
      display: inline-flex;
      opacity: 0.85;
    }
    .tag.compact {
      padding: 0 6px;
      gap: 4px;
    }
    .tag .name {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tag .caption {
      font-weight: 500;
      opacity: 0.75;
    }
    .tag .dot {
      width: 7px;
      height: 7px;
      flex: none;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.25);
    }
    .sky-day .tag .dot {
      background: rgba(16, 35, 63, 0.2);
    }
    .tag.lit .dot {
      background: rgb(var(--c));
      box-shadow: 0 0 8px rgb(var(--c));
    }
    .tag.selected,
    .tag.hover {
      border-color: rgba(var(--lc-holo), 0.9);
      background: rgba(10, 30, 56, 0.85);
    }
    .sky-day .tag.selected,
    .sky-day .tag.hover {
      background: #fff;
      border-color: rgba(40, 130, 230, 0.9);
    }
    @keyframes twinkle {
      0%,
      100% {
        opacity: 0.85;
      }
      50% {
        opacity: 0.2;
      }
    }
    @keyframes enter {
      from {
        opacity: 0;
      }
    }
    @keyframes leave {
      to {
        opacity: 0;
        transform: translateY(-1.2px);
      }
    }
    @keyframes fade-in {
      from {
        opacity: 0;
      }
    }
    @keyframes pulse {
      50% {
        stroke-opacity: 0.55;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .stars circle,
      .outline.strong .line:last-child {
        animation: none;
      }
      .world path {
        transition: none;
      }
    }
  `;
}

if (!customElements.get('lc-house')) customElements.define('lc-house', LcHouse);
