import { LitElement, css, html, nothing, svg, type PropertyValues } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { rgbTriplet, type RGB } from '../color.ts';
import {
  cameraFor,
  fit,
  INSIDE,
  mixPose,
  OUTSIDE,
  project,
  samePose,
  skyFrame,
  skySpot,
  viewAzimuth,
  wallsKept,
  type Camera,
  type Pose,
} from '../house/camera.ts';
import { Renderer, SAMPLES, type View } from '../house/gl/renderer.ts';
import { lensFor, Life, type Conditions, type Happening, type Scene } from '../house/life.ts';
import { toWorld, type Vec3 } from '../house/math.ts';
import { STYLES, tint, type HouseStyle, type StyleName } from '../house/materials.ts';
import {
  buildModel,
  lightTables,
  type LightState,
  type Model,
  type Point,
  type Tables,
  type TopFloor,
  type ViewData,
  type Volume,
} from '../house/model.ts';
import { planHouse, GROUND_ID, type HousePlan } from '../house/plan.ts';
import { computeSky, skyMode, sunPosition, type Sky, type SunInfo } from '../house/sky.ts';
import { icon, mdiMinus, mdiPlus, mdiRestore } from '../icons.ts';
import { t } from '../localize.ts';
import type { RoomType } from '../room-types.ts';
import { fireEvent } from '../utils.ts';

export { skyMode, type SunInfo } from '../house/sky.ts';
export { GROUND_ID } from '../house/plan.ts';
export type { StyleName } from '../house/materials.ts';
export type { TopFloor } from '../house/model.ts';

export interface HouseLight {
  id: string;
  name: string;
  on: boolean;
  rgb: RGB;
  /** Brightness 0–1. */
  level: number;
}

export interface HouseRoom {
  id: string;
  name: string;
  icon: string;
  type: RoomType;
  floorId: string | null;
  outdoor: boolean;
  lights: HouseLight[];
  /** "2 of 3 on · 60%", for tooltips and screen readers. */
  caption: string;
  /** Color of the room's lit lights; null when it is dark. */
  rgb: RGB | null;
}

export interface HouseFloor {
  id: string;
  level: number | null;
  /** Named as an attic or a loft: such a floor is built into the roof. */
  attic?: boolean;
}

/** What a weather entity says, for life around the house: smoke on cold days, birds sheltering from the rain. */
export interface Climate {
  /** In °C. */
  temperature?: number;
  /** Where the wind comes from, in compass degrees, and its speed in m/s. */
  windBearing?: number;
  windSpeed?: number;
  /** Raining or snowing. */
  wet?: boolean;
}

/** Colors that replace the style's own: the walls, the roof, the trim and the front door. */
export interface HouseColors {
  wall?: RGB;
  roof?: RGB;
  trim?: RGB;
  door?: RGB;
}

export type HouseView = { kind: 'home' } | { kind: 'outside' } | { kind: 'floor'; floorId: string };

/** How the viewer has turned the house: where they stand around it, how far they look down, how close. */
interface Orbit {
  yaw: number;
  tilt: number;
  zoom: number;
}

interface Label {
  room: HouseRoom;
  x: number;
  y: number;
}

interface SunAt {
  elevation: number;
  azimuth: number;
}

const RAD = Math.PI / 180;
const DURATION = 700;
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
/** How far the roof and the floors above rise as they lift away, in meters. */
const LIFT = 2.4;
/** The most pixels drawn: beyond this the picture is scaled up, which is hard to see and much faster. */
const MAX_PIXELS = 2_400_000;
/** The sky moves slowly, so it is redrawn about this often, in milliseconds. */
const SKY_INTERVAL = 32;
/** How long the sky takes to run from one time of day to another when the sun jumps. */
const LAPSE = 1800;
const HOME: Orbit = { yaw: OUTSIDE.yaw, tilt: 0, zoom: 1 };
const MIN_PITCH = 5 * RAD;
const MAX_PITCH = 80 * RAD;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The outline of a set of screen points: their convex hull, as path data. */
function hull(points: [number, number][]): string {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return '';
  const turn = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const ring = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return `${ring.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')}Z`;
}

/**
 * The home in 3D. From outside, every room shows through its windows, lit in the color and
 * brightness of its lights; a floor opens up like a dollhouse, with furniture and a lamp for
 * every light. Drag to turn the house, pinch to come closer. The sky is the real one: it follows
 * the sun through the day, with clouds that drift and stars that twinkle.
 */
export class LcHouse extends LitElement {
  static override properties = {
    rooms: { attribute: false },
    floors: { attribute: false },
    view: { attribute: false },
    selected: { attribute: false },
    sun: { attribute: false },
    styleName: { attribute: false },
    topFloor: { attribute: false },
    colors: { attribute: false },
    facing: { attribute: false },
    clouds: { attribute: false },
    climate: { attribute: false },
    southern: { attribute: false },
    motion: { attribute: false },
    topInset: { type: Number },
    titleWidth: { type: Number },
    bottomInset: { type: Number },
    dark: { type: Boolean, reflect: true },
    _size: { state: true },
    _hover: { state: true },
    _pose: { state: true },
    _orbit: { state: true },
    _flat: { state: true },
    _shown: { state: true },
    _dragging: { state: true },
  };

  declare rooms: HouseRoom[];
  declare floors: HouseFloor[];
  declare view: HouseView;
  declare selected: string | null;
  declare sun?: SunInfo;
  /** How the house is built: siding, brick, render. */
  declare styleName: StyleName;
  /** Whether the top floor is built into the roof; 'auto' leaves it to the design and the floor's name. */
  declare topFloor: TopFloor;
  /** Colors that replace the style's own. */
  declare colors?: HouseColors;
  /** The compass direction the front of the house faces, in degrees; south by default. */
  declare facing: number;
  /** How much of the sky is clouded over, 0–1; fair weather when not given. */
  declare clouds?: number;
  /** The weather, for the life around the house. */
  declare climate?: Climate;
  /** South of the equator, where the seasons are the other way round. */
  declare southern: boolean;
  /** Whether the sky moves: clouds drift, stars twinkle, birds fly by. */
  declare motion: boolean;
  /** Pixels at the top kept clear for the card's title. */
  declare topInset: number;
  /** Width of the title in the top left; the house only moves down when it would run into it. */
  declare titleWidth: number;
  /** Pixels at the bottom kept clear for the floor switcher. */
  declare bottomInset: number;
  declare dark: boolean;
  declare _size: { w: number; h: number };
  declare _hover: string | null;
  /** Where the camera is right now. */
  declare _pose?: Pose;
  declare _orbit: Orbit;
  /** True when the house cannot be drawn in 3D, and an outline of its rooms stands in. */
  declare _flat: boolean;
  /** True once the first picture is on screen. */
  declare _shown: boolean;
  declare _dragging: boolean;

  private resizeObserver?: ResizeObserver;
  private visibility?: IntersectionObserver;
  private onScreen = true;
  private planKey = '';
  private plan?: HousePlan;
  private modelKey = '';
  private model?: Model;
  private skyKey = '';
  private sky?: Sky;
  private viewKey = '';
  /** One canvas for as long as the card is on the page: Lit moves it, never replaces it. */
  private canvas?: HTMLCanvasElement;
  private renderer?: Renderer;
  private uploaded: { model?: Model; sky?: Sky } = {};
  private tween?: { from: Pose; to: Pose; start: number };
  private target?: Pose;
  private frame = 0;
  /** How many frames have gone into the picture of the house on screen. */
  private sample = 0;
  /** How visible each group is right now, and where it is heading. */
  private groups = new Float32Array(Renderer.groups).fill(1);
  private groupGoal = new Float32Array(Renderer.groups).fill(1);
  private tables?: Tables;
  private goal?: Tables;
  /** The camera the picture on screen was drawn from. */
  private drawnPose?: Pose;
  private lastTick = 0;
  private lastSky = 0;
  /**
   * How much of the full resolution is drawn, and how many frames go into a picture. Both come
   * down on a device that cannot keep up, so the card stays quick to the touch on an old tablet.
   */
  private quality = 1;
  private budget = SAMPLES;
  /** Frames still to be timed before settling on a quality. */
  private timing = 3;
  private fastest = Infinity;
  /** Where the sun is shown, which runs to where it really is when that jumps. */
  private sunShown?: SunAt;
  private lapse?: { from: SunAt; to: SunAt; start: number };
  /** Birds, bats, fireflies, shooting stars and the rest of what goes on around the house. */
  readonly life = new Life();
  /** Fingers on the house, and where the turn they are making began. */
  private pointers = new Map<number, { x: number; y: number }>();
  private grab?: { x: number; y: number; orbit: Orbit; spread: number; moved: boolean };
  /** True just after a drag, so letting go over a room does not select it. */
  private dragged = false;
  /** The room whose hit area had keyboard focus going into an update. */
  private focusRoom: string | null = null;

  constructor() {
    super();
    this.rooms = [];
    this.floors = [];
    this.view = { kind: 'home' };
    this.selected = null;
    this.styleName = 'colonial';
    this.topFloor = 'auto';
    this.facing = 180;
    this.motion = true;
    this.southern = false;
    this.topInset = 0;
    this.titleWidth = 0;
    this.bottomInset = 0;
    this.dark = false;
    this._size = { w: 0, h: 0 };
    this._hover = null;
    this._orbit = HOME;
    this._flat = false;
    this._shown = false;
    this._dragging = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.canvas && !this._flat) {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'gl';
      this.canvas.setAttribute('aria-hidden', 'true');
    }
    this.resizeObserver ??= new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height && (Math.abs(width - this._size.w) > 0.5 || Math.abs(height - this._size.h) > 0.5)) {
        this._size = { w: width, h: height };
      }
    });
    this.resizeObserver.observe(this);
    if (typeof IntersectionObserver !== 'undefined') {
      this.visibility ??= new IntersectionObserver(([entry]) => {
        this.onScreen = entry.isIntersecting;
        if (this.onScreen) this.schedule();
      });
      this.visibility.observe(this);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.visibility?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    // Home Assistant detaches cards when views switch; finish any move now rather than freeze mid-way.
    if (this.tween) {
      this._pose = this.tween.to;
      this.tween = undefined;
    }
    if (this.lapse) {
      this.sunShown = this.lapse.to;
      this.lapse = undefined;
    }
    this.settle();
    this.pointers.clear();
    this.grab = undefined;
    this._dragging = false;
    this.drawnPose = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    // A canvas that has given up its graphics context cannot draw again; the next one starts afresh.
    this.canvas = undefined;
    this.uploaded = {};
    this._shown = false;
  }

  private onVisibility = (): void => {
    if (!document.hidden) this.schedule();
  };

  private get reducedMotion(): boolean {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ─── Model ─────────────────────────────────────────────────────────────────

  private planFor(): HousePlan {
    const indoor = this.rooms.filter((r) => !r.outdoor);
    const floorIds = new Set(this.floors.map((f) => f.id));
    const key = JSON.stringify([
      this.floors.map((f) => [f.id, f.level, Boolean(f.attic)]),
      indoor.map((r) => [r.id, r.type, r.floorId]),
    ]);
    if (key !== this.planKey || !this.plan) {
      const input = (list: HouseRoom[]) => list.map((r) => ({ id: r.id, type: r.type }));
      this.plan = planHouse(
        this.floors.map((f) => ({
          id: f.id,
          level: f.level,
          attic: f.attic,
          rooms: input(indoor.filter((r) => r.floorId === f.id)),
        })),
        input(indoor.filter((r) => !r.floorId || !floorIds.has(r.floorId))),
      );
      this.planKey = key;
    }
    return this.plan;
  }

  /** The style the house is built in, with any colors the user chose instead of its own. */
  private houseStyle(): HouseStyle {
    const style = STYLES[this.styleName] ?? STYLES.colonial;
    const colors = this.colors;
    if (!colors) return style;
    return {
      ...style,
      wall: colors.wall ? tint(style.wall, colors.wall) : style.wall,
      gable: colors.wall ? tint(style.gable, colors.wall) : style.gable,
      roof: colors.roof ? tint(style.roof, colors.roof) : style.roof,
      trim: colors.trim ?? style.trim,
      door: colors.door ?? style.door,
    };
  }

  /** The 3D model, rebuilt only when the rooms, their lights or the style change: not when a light switches. */
  private modelFor(plan: HousePlan): Model {
    const key = JSON.stringify([
      this.planKey,
      this.styleName,
      this.topFloor,
      this.colors,
      this.rooms.map((r) => [r.id, r.type, r.outdoor, r.lights.map((l) => [l.id, l.name])]),
    ]);
    if (key !== this.modelKey || !this.model) {
      const room = (r: HouseRoom) => ({
        id: r.id,
        type: r.type,
        lights: r.lights.map((l) => ({ id: l.id, name: l.name })),
      });
      this.model = buildModel({
        plan,
        rooms: new Map(this.rooms.filter((r) => !r.outdoor).map((r) => [r.id, room(r)])),
        outdoor: this.rooms.filter((r) => r.outdoor).map(room),
        style: this.houseStyle(),
        topFloor: this.topFloor,
      });
      this.modelKey = key;
      // A new house: nothing to animate from.
      this.tables = undefined;
    }
    return this.model;
  }

  private viewData(model: Model): ViewData {
    const view = this.view;
    if (view.kind === 'floor') {
      const ids = new Set(this.rooms.filter((r) => r.floorId === view.floorId).map((r) => r.id));
      const plan = model.plan;
      let story = plan.stories.findIndex((s) => s.id === view.floorId || s.cells.some((c) => c.id && ids.has(c.id)));
      if (story < 0 && view.floorId === GROUND_ID) story = plan.stories.findIndex((s) => s.ground);
      if (story >= 0) return model.stories[story];
    }
    return model.exterior;
  }

  /** Where the sun is in the model's sky, whose front faces south: a house that faces elsewhere sees it from another side. */
  private sunNow(): SunAt {
    const sun = sunPosition(this.sun);
    return { elevation: sun.elevation, azimuth: (((sun.azimuth - (this.facing - 180)) % 360) + 360) % 360 };
  }

  private skyFor(position: SunAt): Sky {
    const { w, h } = this._size;
    const now = new Date();
    const frame = skyFrame(OUTSIDE.yaw, Math.max(1, w), Math.max(1, h));
    // The moon hangs in the upper right of the picture as first seen, wherever that is in the sky.
    const moon = skySpot(frame, OUTSIDE.yaw, 0.64, 0.46).map((v) => Math.round(v)) as [number, number];
    const clouds = this.clouds === undefined ? undefined : Math.round(this.clouds * 20) / 20;
    const key = JSON.stringify([
      Math.round(position.elevation * 4),
      Math.round(position.azimuth * 2),
      moon,
      clouds,
      Math.floor(now.getTime() / 3600000),
    ]);
    if (key !== this.skyKey || !this.sky) {
      this.sky = computeSky({
        ...position,
        viewAzimuth: viewAzimuth(OUTSIDE.yaw),
        moonOffset: moon,
        date: now,
        clouds,
      });
      this.skyKey = key;
    }
    return this.sky;
  }

  // ─── Camera ────────────────────────────────────────────────────────────────

  private poseFor(model: Model, data: ViewData): Pose {
    const { w, h } = this._size;
    const points: Point[] = [];
    for (const b of data.frame) {
      for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) points.push([x, y, z]);
    }
    const base = data.story < 0 ? OUTSIDE : INSIDE;
    const yaw = this._orbit.yaw;
    const pitch = clamp(base.pitch + this._orbit.tilt, MIN_PITCH, MAX_PITCH);
    const side = Math.max(12, w * 0.03);
    const place = (top: number) =>
      fit(
        points,
        yaw,
        pitch,
        { width: w, height: h, left: side, right: side, top, bottom: this.bottomInset + 12 },
        model.radius,
      );
    // Use the full height unless the house would then run into the title in the top left.
    let pose = place(12);
    if (this.topInset > 12) {
      const camera = cameraFor(pose, w / h, model.radius);
      const screen = points.map((p) => project(camera, toWorld(p[0], p[1], p[2]), w, h));
      const left = Math.min(...screen.map((p) => p[0]));
      const top = Math.min(...screen.map((p) => p[1]));
      if (left < this.titleWidth + 12 && top < this.topInset) pose = place(this.topInset + 8);
    }
    return { ...pose, distance: pose.distance / this._orbit.zoom };
  }

  private camera(pose: Pose): Camera {
    const { w, h } = this._size;
    return cameraFor(pose, w / Math.max(1, h), this.model?.radius ?? 30);
  }

  /** Jumps every animation to its end. */
  private settle(): void {
    this.groups.set(this.groupGoal);
    if (this.goal && this.tables) {
      this.tables.lights.set(this.goal.lights);
      this.tables.rooms.set(this.goal.rooms);
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // Rooms are stacked by how near they are, so turning the house or opening a floor reorders
    // them, and a browser drops the focus of an element that is moved. Remember whose it was.
    const focused = this.shadowRoot?.activeElement;
    this.focusRoom = focused?.classList.contains('hit') ? ((focused as SVGElement).dataset.room ?? null) : null;
    if (!this._size.w || !this.rooms.length) return;
    const plan = this.planFor();
    const model = this.modelFor(plan);
    const data = this.viewData(model);
    const still = this.reducedMotion || !this._pose || !this._shown;

    // The sun: where it really is, or on its way there when it has jumped (a restart, a long
    // sleep): the sky then runs through the hours in between instead of snapping.
    const sun = this.sunNow();
    const shown = this.sunShown;
    const turn = shown ? Math.abs(((sun.azimuth - shown.azimuth + 540) % 360) - 180) : 0;
    if (!shown || still) {
      this.sunShown = sun;
      this.lapse = undefined;
    } else if (this.lapse) this.lapse.to = sun;
    else if (Math.abs(sun.elevation - shown.elevation) > 4 || turn > 12) {
      this.lapse = { from: shown, to: sun, start: performance.now() };
    } else this.sunShown = sun;
    const sky = this.skyFor(this.sunShown!);

    const viewKey = `${this.modelKey}|${data.story}`;
    const viewChanged = viewKey !== this.viewKey;
    this.viewKey = viewKey;

    // Which parts of the house show, and which floor is open to the sky.
    for (let i = 0; i < this.groupGoal.length; i++) this.groupGoal[i] = i <= data.cut ? 1 : 0;
    const open = model.plan.stories.map((s) => (s.index === data.story ? 1 : 0));
    const states = new Map<string, LightState>();
    for (const room of this.rooms)
      for (const l of room.lights) states.set(l.id, { on: l.on, rgb: l.rgb, level: l.level });
    this.goal = lightTables(model, states, sky.lamp, open, this.goal);
    if (!this.tables) {
      this.tables = { lights: new Float32Array(this.goal.lights), rooms: new Float32Array(this.goal.rooms) };
      this.groups.set(this.groupGoal);
    }
    if (still) this.settle();

    const target = this.poseFor(model, data);
    if (!this.target || !samePose(target, this.target)) {
      this.target = target;
      const from = this._pose;
      if (!from || still || !viewChanged || changed.has('_size') || changed.has('_orbit')) {
        // Nothing to glide from, the card was resized or the viewer is turning the house: go straight there.
        if (this.tween) this.tween.to = target;
        else this._pose = target;
      } else this.tween = { from, to: target, start: performance.now() };
    }
    // The next frame works out whether any of this changes the picture.
    this.schedule();
  }

  protected override updated(): void {
    if (this.focusRoom && !this.shadowRoot?.activeElement) {
      this.shadowRoot
        ?.querySelector<SVGElement>(`.hit[tabindex="0"][data-room="${CSS.escape(this.focusRoom)}"]`)
        ?.focus();
    }
    this.ensureRenderer();
    this.schedule();
  }

  // ─── Turning the house ─────────────────────────────────────────────────────

  private setOrbit(orbit: Orbit): void {
    this._orbit = {
      yaw: orbit.yaw,
      // The tilt is kept within what every view can show.
      tilt: clamp(orbit.tilt, MIN_PITCH - OUTSIDE.pitch, MAX_PITCH - INSIDE.pitch),
      zoom: clamp(orbit.zoom, MIN_ZOOM, MAX_ZOOM),
    };
  }

  private get turned(): boolean {
    const o = this._orbit;
    return Math.abs(o.yaw - HOME.yaw) > 0.01 || Math.abs(o.tilt) > 0.01 || Math.abs(o.zoom - 1) > 0.01;
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    this.dragged = false;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const points = [...this.pointers.values()];
    const spread = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
    this.grab = { x: ev.clientX, y: ev.clientY, orbit: this._orbit, spread, moved: this.grab?.moved ?? false };
  };

  private onPointerMove = (ev: PointerEvent): void => {
    const grab = this.grab;
    if (!grab || !this.pointers.has(ev.pointerId)) return;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const points = [...this.pointers.values()];
    if (points.length > 1) {
      // Two fingers: spread them to come closer.
      const spread = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (grab.spread > 10) {
        grab.moved = true;
        this.setOrbit({ ...this._orbit, zoom: grab.orbit.zoom * (spread / grab.spread) });
      }
    } else {
      const dx = ev.clientX - grab.x;
      const dy = ev.clientY - grab.y;
      if (!grab.moved && Math.hypot(dx, dy) < 5) return;
      if (!grab.moved) {
        grab.moved = true;
        // From here on the drag belongs to the house, wherever the pointer goes.
        (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
      }
      // The house follows the hand: drag right and it turns right, drag down and it tips toward you.
      this.setOrbit({ yaw: grab.orbit.yaw - dx * 0.0085, tilt: grab.orbit.tilt + dy * 0.006, zoom: this._orbit.zoom });
    }
    if (grab.moved && !this._dragging) this._dragging = true;
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (!this.pointers.delete(ev.pointerId)) return;
    const grab = this.grab;
    if (this.pointers.size) {
      // One finger of two lifted: carry on turning from where the other one is.
      const [rest] = [...this.pointers.values()];
      if (grab) this.grab = { x: rest.x, y: rest.y, orbit: this._orbit, spread: 0, moved: grab.moved };
      return;
    }
    this.dragged = Boolean(grab?.moved);
    this.grab = undefined;
    this._dragging = false;
    // A click follows a mouse drag at once; after that, clicks count again.
    if (this.dragged) setTimeout(() => (this.dragged = false), 60);
  };

  /** Pinching on a trackpad arrives as a wheel with Ctrl held; a plain wheel still scrolls the page. */
  private onWheel = (ev: WheelEvent): void => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    this.setOrbit({ ...this._orbit, zoom: this._orbit.zoom * Math.exp(-ev.deltaY * 0.01) });
  };

  private zoomBy(factor: number): void {
    this.setOrbit({ ...this._orbit, zoom: this._orbit.zoom * factor });
  }

  private resetView = (): void => {
    this._orbit = HOME;
  };

  // ─── Drawing ───────────────────────────────────────────────────────────────

  private ensureRenderer(): void {
    if (this.renderer || this._flat || !this.canvas?.isConnected) return;
    try {
      this.renderer = new Renderer(this.canvas);
      this.renderer.onRestore = () => {
        this.uploaded = {};
        this.drawnPose = undefined;
        this.schedule();
      };
      this.uploaded = {};
    } catch (error) {
      // No WebGL 2 here: the rooms are drawn as outlines instead, and everything still works.
      console.warn('Light Control Card: the 3D house needs WebGL 2.', error);
      this.canvas = undefined;
      this._flat = true;
    }
  }

  private schedule(): void {
    if (this.frame || !this.isConnected) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  /** The time of day, the season and the weather, as the life around the house needs them. */
  private conditions(sky: Sky, model: Model): Conditions {
    const date = new Date();
    const climate = this.climate;
    let wind: Conditions['wind'];
    if (climate?.windBearing !== undefined && climate.windSpeed !== undefined) {
      // Downwind, in plan space: the front of the house faces `facing`.
      const toward = (climate.windBearing + 180 - this.facing) * RAD;
      wind = { x: -Math.sin(toward), y: Math.cos(toward), speed: climate.windSpeed };
    }
    return {
      sun: this.sunShown?.elevation ?? 30,
      stars: sky.stars,
      clouds: sky.clouds,
      month: date.getMonth(),
      southern: this.southern,
      day: Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000),
      temperature: climate?.temperature,
      wind,
      wet: climate?.wet,
      roof: this.groups[model.groups.roof] ?? 1,
    };
  }

  /** Asks for something to fly or fall past now, whatever the schedule says: for the demo and tests. */
  happen(what: Happening): void {
    this.life.request(what);
    this.schedule();
  }

  private tick = (now: number): void => {
    this.frame = 0;
    const model = this.model;
    if (!model || !this.sky || !this._size.w || !this._pose) return;
    const dt = Math.min(100, this.lastTick ? now - this.lastTick : 16);
    this.lastTick = now;
    let moving = false;

    // The sun on its way to where it really is: the sky runs through the hours in between.
    if (this.lapse) {
      const p = Math.min(1, (now - this.lapse.start) / LAPSE);
      const k = ease(p);
      const { from, to } = this.lapse;
      const turn = ((to.azimuth - from.azimuth + 540) % 360) - 180;
      this.sunShown = {
        elevation: from.elevation + (to.elevation - from.elevation) * k,
        azimuth: from.azimuth + turn * k,
      };
      const lamp = this.skyFor(this.sunShown).lamp;
      if (p >= 1) this.lapse = undefined;
      // The lamps show more as the daylight goes, and the card's colors follow the time of day.
      if (p >= 1 || Math.abs(lamp - (this.uploaded.sky?.lamp ?? lamp)) > 0.02) this.requestUpdate();
      moving = true;
    }
    const sky = this.sky;

    // The camera's glide, and the roof lifting away in step with it.
    if (this.tween) {
      const p = Math.min(1, (now - this.tween.start) / DURATION);
      const k = ease(p);
      this._pose = mixPose(this.tween.from, this.tween.to, k);
      for (let i = 0; i < this.groups.length; i++) {
        const goal = this.groupGoal[i];
        // Parts that are leaving go early, parts that are arriving come late: never both at once.
        const part = goal ? Math.max(0, (k - 0.35) / 0.65) : Math.min(1, k / 0.75);
        this.groups[i] = goal ? Math.max(this.groups[i], part) : Math.min(this.groups[i], 1 - part);
      }
      if (p >= 1) {
        this.tween = undefined;
        this.groups.set(this.groupGoal);
      }
      moving = true;
    } else if (this.groups.some((v, i) => v !== this.groupGoal[i])) {
      this.groups.set(this.groupGoal);
      moving = true;
    }

    // Lights fade rather than jump.
    if (this.goal && this.tables) {
      const k = 1 - Math.exp(-dt / 110);
      for (const name of ['lights', 'rooms'] as const) {
        const current = this.tables[name];
        const goal = this.goal[name];
        for (let i = 0; i < goal.length; i++) {
          const d = goal[i] - current[i];
          if (d === 0) continue;
          current[i] = Math.abs(d) < 0.002 ? goal[i] : current[i] + d * k;
          moving = true;
        }
      }
    }

    const renderer = this.renderer;
    if (!renderer || renderer.lost || !this.tables || !this.onScreen || document.hidden) {
      // Nothing to draw on, or nobody to see it: animations still run to their end.
      if (moving) this.schedule();
      return;
    }
    const { w, h } = this._size;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const fitScale = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h * ratio * ratio))) * this.quality;
    // Start the picture of the house over when anything in it has changed; otherwise carry on refining it.
    let fresh = renderer.resize(w * ratio * fitScale, h * ratio * fitScale) || moving;
    if (this.uploaded.model !== model) {
      renderer.setMesh(model.mesh);
      this.uploaded.model = model;
      fresh = true;
    }
    if (this.uploaded.sky !== sky) {
      renderer.setSky(sky);
      this.uploaded.sky = sky;
      fresh = true;
    }
    const pose = this._pose;
    if (!this.drawnPose || !samePose(this.drawnPose, pose)) fresh = true;
    if (fresh) this.sample = 0;
    const refine = this.sample < this.budget;
    const alive = this.motion && !this.reducedMotion;
    // The sky is redrawn when the house is, and otherwise only as often as its slow drift needs:
    // every frame while a bird or a shooting star goes by, so it moves smoothly.
    const interval = this.life.busy ? 0 : SKY_INTERVAL / this.quality;
    if (!refine && !(alive && now - this.lastSky >= interval)) {
      if (alive) this.schedule();
      return;
    }
    const camera = this.camera(pose);
    const frame = skyFrame(pose.yaw, w, h, pose.pitch);
    const view: View = {
      view: camera.view,
      proj: camera.proj,
      eye: camera.eye,
      groups: this.groups,
      lift: LIFT,
      sides: wallsKept(pose.yaw),
      center: model.center as Vec3,
      radius: model.radius,
      skyForward: frame.forward,
      skyRight: frame.right,
      skyUp: frame.up,
      pixelAngle: frame.pixel / (ratio * fitScale),
      css: [w, h],
    };
    let life: Scene | undefined;
    if (alive) {
      const lens = lensFor(camera, frame, pose.target, w, h);
      life = this.life.frame(now, this.conditions(sky, model), model.stage, lens);
    }
    try {
      if (refine) {
        if (this.sample === 0) renderer.setLights(this.tables.lights, this.tables.rooms);
        this.drawnPose = pose;
        // The first few frames are timed, to find out what this device can do. One that takes
        // several times its share means it cannot keep up: draw smaller, and fewer times.
        const took = renderer.draw(view, this.sample, this.timing > 0);
        if (this.timing > 0) {
          this.fastest = Math.min(this.fastest, took);
          if (--this.timing === 0 && this.fastest > 45) {
            this.quality = Math.max(0.4, Math.sqrt(40 / this.fastest));
            this.budget = Math.max(8, Math.round((SAMPLES * 40) / this.fastest));
          }
        }
        this.sample++;
      }
      renderer.present(view, { time: alive ? now / 1000 : 0, life });
      this.lastSky = now;
    } catch (error) {
      console.warn('Light Control Card: the 3D house could not be drawn.', error);
      renderer.dispose();
      this.renderer = undefined;
      this.canvas = undefined;
      this._flat = true;
      return;
    }
    if (!this._shown) {
      this._shown = true;
      this.canvas?.classList.add('shown');
    }
    if (moving || this.sample < this.budget || alive) this.schedule();
  };

  // ─── Rendering ─────────────────────────────────────────────────────────────

  protected override render() {
    const sky = this.sky;
    const mode = sky?.mode ?? skyMode(this.sun);
    const backdrop = sky
      ? html`<div class="sky" style="background:linear-gradient(${sky.css[0]}, ${sky.css[1]})"></div>`
      : html`<div class="sky"></div>`;
    const pose = this._pose;
    const model = this.model;
    const { w, h } = this._size;
    const canvas = this._flat ? nothing : (this.canvas ?? nothing);
    if (!pose || !model || !w) return html`<div class="stage sky-${mode}">${backdrop}${canvas}</div>`;
    const camera = this.camera(pose);
    const data = this.viewData(model);
    const at = (p: Point): [number, number, number] => project(camera, toWorld(p[0], p[1], p[2]), w, h);
    const busy = Boolean(this.tween) || this._dragging;
    return html`<div
      class="stage sky-${mode} ${this.tween ? 'moving' : ''} ${this._dragging ? 'dragging' : ''}"
      @pointerdown=${this.onPointerDown}
      @pointermove=${this.onPointerMove}
      @pointerup=${this.onPointerUp}
      @pointercancel=${this.onPointerUp}
      @wheel=${this.onWheel}
    >
      ${backdrop}${canvas}
      <svg
        class="scene"
        viewBox="0 0 ${w} ${h}"
        role="group"
        aria-label=${t('house_overview')}
        data-camera=${[pose.yaw, pose.pitch, pose.distance, ...pose.target].map((v) => v.toFixed(3)).join(' ')}
      >
        ${this._flat ? this.renderFlat(data, at) : nothing} ${this.renderFrame(model, data, at)}
        ${this.renderOutline(data, at)}
        <g class="hits">${this.renderHits(data, at)}</g>
      </svg>
      ${busy ? nothing : this.renderLabels(data, at)} ${this.renderControls()}
    </div>`;
  }

  /** Closer, farther, and back to the view the house started in. */
  private renderControls() {
    return html`<div class="controls" @pointerdown=${(ev: Event) => ev.stopPropagation()}>
      ${
        this.turned
          ? html`<button
              class="control"
              aria-label=${t('reset_view')}
              title=${t('reset_view')}
              @click=${this.resetView}
            >
              ${icon(mdiRestore)}
            </button>`
          : nothing
      }
      <button
        class="control"
        aria-label=${t('zoom_in')}
        title=${t('zoom_in')}
        ?disabled=${this._orbit.zoom >= MAX_ZOOM - 0.01}
        @click=${() => this.zoomBy(1.3)}
      >
        ${icon(mdiPlus)}
      </button>
      <button
        class="control"
        aria-label=${t('zoom_out')}
        title=${t('zoom_out')}
        ?disabled=${this._orbit.zoom <= MIN_ZOOM + 0.01}
        @click=${() => this.zoomBy(1 / 1.3)}
      >
        ${icon(mdiMinus)}
      </button>
    </div>`;
  }

  /** The space the house takes up on screen, as an invisible box: the card keeps its title clear of it. */
  private renderFrame(model: Model, data: ViewData, at: (p: Point) => [number, number, number]) {
    const points: [number, number, number][] = [];
    const boxes = data.story < 0 && model.plan.stories.length ? data.frame.slice(0, 1) : data.frame;
    for (const b of boxes) {
      for (const x of [b.x0, b.x1])
        for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) points.push(at([x, y, z]));
    }
    if (!points.length) return nothing;
    const left = Math.min(...points.map((p) => p[0]));
    const top = Math.min(...points.map((p) => p[1]));
    const right = Math.max(...points.map((p) => p[0]));
    const bottom = Math.max(...points.map((p) => p[1]));
    return svg`<rect class="frame" x=${left.toFixed(1)} y=${top.toFixed(1)} width=${(right - left).toFixed(1)} height=${(bottom - top).toFixed(1)}></rect>`;
  }

  /** Without 3D: each room as an outlined box, tinted with its light. */
  private renderFlat(data: ViewData, at: (p: Point) => [number, number, number]) {
    const byId = new Map(this.rooms.map((r) => [r.id, r]));
    const boxes = [...data.volumes].map(([id, volume]) => {
      const low = Math.min(...volume.points.map((p) => p[2]));
      const floor = volume.points.filter((p) => p[2] - low < 0.01);
      const middle: Point = [0, 0, low];
      for (const p of floor) for (let i = 0; i < 2; i++) middle[i] += p[i] / floor.length;
      return { id, volume, floor, depth: at(middle)[2] };
    });
    boxes.sort((p, q) => q.depth - p.depth);
    const outline = (points: Point[]) => hull(points.map((p) => at(p)).map((p): [number, number] => [p[0], p[1]]));
    return svg`<g class="flat" aria-hidden="true">${boxes.map(({ id, volume, floor }) => {
      const room = byId.get(id);
      const solid = outline(volume.points);
      const fill = room?.rgb ? `rgb(${rgbTriplet(room.rgb)})` : 'rgb(140, 150, 165)';
      return svg`<path d=${solid} fill=${fill} fill-opacity=${room?.rgb ? 0.3 : 0.12}></path>
        <path d=${outline(floor)} fill=${fill} fill-opacity=${room?.rgb ? 0.4 : 0.18}></path>
        <path d=${solid} class="line wire"></path>`;
    })}</g>`;
  }

  /**
   * Keyed by room, so keyboard focus stays on the same room when the view changes around it.
   * Nearer rooms go on top of farther ones, whichever way the house is turned.
   */
  private renderHits(data: ViewData, at: (p: Point) => [number, number, number]) {
    const count = new Map<string, number>();
    const hits = data.hits.map((hit) => {
      const n = count.get(hit.roomId) ?? 0;
      count.set(hit.roomId, n + 1);
      const screen = hit.points.map(at);
      const depth = screen.reduce((sum, p) => sum + p[2], 0) / screen.length;
      return {
        roomId: hit.roomId,
        key: `${hit.roomId}#${n}`,
        primary: n === 0,
        depth,
        d: hull(screen.map((p) => [p[0], p[1]])),
      };
    });
    hits.sort((a, b) => b.depth - a.depth);
    return repeat(
      hits,
      (hit) => hit.key,
      (hit) => this.renderHit(hit.roomId, hit.d, hit.primary),
    );
  }

  private renderHit(roomId: string, d: string, primary: boolean) {
    const room = this.rooms.find((r) => r.id === roomId);
    if (!room || !d) return nothing;
    const selected = this.selected === roomId;
    return svg`<path
      class="hit"
      d=${d}
      data-room=${roomId}
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

  /** A frame of light around the selected room, and a fainter one around the one under the pointer. */
  private renderOutline(data: ViewData, at: (p: Point) => [number, number, number]) {
    const frame = (volume: Volume, strong: boolean) => {
      const p = volume.points.map((corner) => at(corner));
      const line = ([i, j]: [number, number]) =>
        `M${p[i][0].toFixed(1)} ${p[i][1].toFixed(1)}L${p[j][0].toFixed(1)} ${p[j][1].toFixed(1)}`;
      // The corner farthest from the viewer: the edges that meet there are drawn faintly.
      const farthest = p.reduce((best, q, i) => (q[2] > p[best][2] ? i : best), 0);
      const hidden = (e: [number, number]) => e[0] === farthest || e[1] === farthest;
      const near = volume.edges
        .filter((e) => !hidden(e))
        .map(line)
        .join('');
      const far = volume.edges.filter(hidden).map(line).join('');
      return svg`<g class="outline ${strong ? 'strong' : ''}">
        <path d=${hull(p.map((q) => [q[0], q[1]]))} class="face"></path>
        <path d=${far} class="line far"></path>
        <path d=${near} class="line halo"></path>
        <path d=${near} class="line edge"></path>
      </g>`;
    };
    const out = [];
    const hover = this._hover && this._hover !== this.selected ? data.volumes.get(this._hover) : undefined;
    if (hover) out.push(frame(hover, false));
    const selected = this.selected ? data.volumes.get(this.selected) : undefined;
    if (selected) out.push(frame(selected, true));
    return svg`<g class="outlines" aria-hidden="true">${out}</g>`;
  }

  private renderLabels(data: ViewData, at: (p: Point) => [number, number, number]) {
    const { w, h } = this._size;
    const view = this.view;
    const byId = new Map(this.rooms.map((r) => [r.id, r]));
    const show = (roomId: string) => {
      const room = byId.get(roomId);
      if (!room) return false;
      if (data.story >= 0) return true;
      if (view.kind === 'outside') return room.outdoor || roomId === this._hover || roomId === this.selected;
      return roomId === this._hover || roomId === this.selected;
    };
    // A room seen on several walls is labeled on the one nearest the viewer.
    const nearest = new Map<string, [number, number, number]>();
    for (const anchor of data.anchors) {
      if (!show(anchor.roomId)) continue;
      const spot = at(anchor.at);
      const best = nearest.get(anchor.roomId);
      if (!best || spot[2] < best[2]) nearest.set(anchor.roomId, spot);
    }
    const labels: Label[] = [...nearest].map(([roomId, [x, y]]) => ({ room: byId.get(roomId)!, x, y }));
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
          ${data.story < 0 && view.kind === 'home' && (this._hover === room.id || this.selected === room.id) ? html`<span class="caption">${room.caption}</span>` : nothing}
          <i class="dot"></i>
        </button>`;
      })}
    </div>`;
  }

  private select(roomId: string): void {
    // Letting go after turning the house is not a tap on the room under the pointer.
    if (this.dragged) return;
    fireEvent(this, 'lc-room-select', { roomId });
  }

  /** Enter picks the room; the arrow keys turn the house, plus and minus come closer and move away. */
  private onKey(ev: KeyboardEvent, roomId: string): void {
    const o = this._orbit;
    const turn: Record<string, Orbit> = {
      ArrowLeft: { ...o, yaw: o.yaw + 0.2 },
      ArrowRight: { ...o, yaw: o.yaw - 0.2 },
      ArrowUp: { ...o, tilt: o.tilt + 0.08 },
      ArrowDown: { ...o, tilt: o.tilt - 0.08 },
      '+': { ...o, zoom: o.zoom * 1.2 },
      '=': { ...o, zoom: o.zoom * 1.2 },
      '-': { ...o, zoom: o.zoom / 1.2 },
      '0': HOME,
    };
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      fireEvent(this, 'lc-room-select', { roomId });
    } else if (turn[ev.key]) {
      ev.preventDefault();
      this.setOrbit(turn[ev.key]);
    }
  }

  /** Whether the camera has arrived where it is going; for tests. */
  get settled(): boolean {
    return !this.tween && Boolean(this._pose && this.target && samePose(this._pose, this.target));
  }

  static override styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .stage,
    .sky,
    canvas.gl,
    svg.scene,
    .labels {
      position: absolute;
      inset: 0;
    }
    .stage {
      /* A sideways drag turns the house; an up-and-down swipe still scrolls the page. */
      touch-action: pan-y;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
    }
    .stage.dragging {
      cursor: grabbing;
    }
    .sky {
      background: #1b2a44;
    }
    canvas.gl {
      width: 100%;
      height: 100%;
      display: block;
      opacity: 0;
      transition: opacity 0.35s ease;
    }
    canvas.gl.shown {
      opacity: 1;
    }
    svg.scene {
      width: 100%;
      height: 100%;
      display: block;
      overflow: visible;
    }
    .frame {
      fill: none;
      stroke: none;
      pointer-events: none;
    }
    .line {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .wire {
      stroke: rgba(255, 255, 255, 0.55);
      stroke-width: 1;
    }
    .sky-day .wire {
      stroke: rgba(16, 35, 63, 0.5);
    }
    .hit {
      fill: transparent;
      cursor: pointer;
      outline: none;
    }
    .dragging .hit {
      cursor: grabbing;
    }
    .outline {
      pointer-events: none;
      animation: fade-in 0.25s ease both;
    }
    .outline .face {
      fill: rgba(255, 255, 255, 0.07);
      stroke: none;
    }
    .outline.strong .face {
      fill: rgba(255, 255, 255, 0.12);
    }
    .outline .far {
      stroke: rgba(255, 255, 255, 0.3);
      stroke-width: 1;
    }
    .outline .halo {
      stroke: rgba(255, 255, 255, 0.24);
      stroke-width: 6;
    }
    .outline.strong .halo {
      stroke-width: 8;
    }
    .outline .edge {
      stroke: rgba(255, 255, 255, 0.92);
      stroke-width: 1.4;
    }
    .outline.strong .edge {
      stroke-width: 2;
      animation: pulse 2.4s ease-in-out infinite;
    }
    .hit:focus-visible {
      stroke: #fff;
      stroke-width: 2;
      stroke-dasharray: 5 4;
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
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 12px;
      background: rgba(12, 18, 30, 0.6);
      color: #f2f6fb;
      font: inherit;
      font-size: 11.5px;
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      pointer-events: auto;
      backdrop-filter: blur(10px) saturate(1.3);
      -webkit-backdrop-filter: blur(10px) saturate(1.3);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
      animation: fade-in 0.3s ease both;
      transition:
        border-color 0.2s ease,
        background 0.2s ease;
      --mdc-icon-size: 14px;
    }
    .sky-day .tag {
      background: rgba(255, 255, 255, 0.8);
      color: #10233f;
      border-color: rgba(16, 35, 63, 0.14);
      box-shadow: 0 4px 14px rgba(20, 40, 80, 0.18);
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
      border-color: rgba(255, 255, 255, 0.85);
      background: rgba(12, 22, 40, 0.86);
    }
    .sky-day .tag.selected,
    .sky-day .tag.hover {
      background: #fff;
      border-color: rgba(16, 35, 63, 0.5);
    }
    .controls {
      position: absolute;
      top: 10px;
      right: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .control {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      background: rgba(12, 18, 30, 0.42);
      color: #f2f6fb;
      cursor: pointer;
      opacity: 0.72;
      backdrop-filter: blur(10px) saturate(1.3);
      -webkit-backdrop-filter: blur(10px) saturate(1.3);
      transition:
        opacity 0.2s ease,
        background 0.2s ease;
    }
    .sky-day .control {
      background: rgba(255, 255, 255, 0.62);
      color: #10233f;
      border-color: rgba(16, 35, 63, 0.14);
    }
    .control:hover,
    .control:focus-visible {
      opacity: 1;
    }
    .control:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 2px;
    }
    .control:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .control .mdi {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    @keyframes fade-in {
      from {
        opacity: 0;
      }
    }
    @keyframes pulse {
      50% {
        stroke-opacity: 0.5;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .outline.strong .edge {
        animation: none;
      }
      canvas.gl {
        transition: none;
      }
    }
  `;
}

if (!customElements.get('lc-house')) customElements.define('lc-house', LcHouse);
