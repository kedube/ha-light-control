import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { formatWatts, readWatts, summarize, type Summary } from './aggregate.ts';
import { accentFor, rgbTriplet, WARM_GLOW } from './color.ts';
import { resolveConfig, type LightControlCardConfig, type ResolvedConfig } from './config.ts';
import { LightController } from './controller.ts';
import { discover, UNASSIGNED, type DiscoveredEntity, type Discovery, type Room } from './discovery.ts';
import { outletStyleFor, type OutletStyle } from './graphics.ts';
import type { HomeAssistant } from './ha-types.ts';
import { icon, mdiLightbulbOffOutline, mdiPlay, mdiTuneVariant } from './icons.ts';
import { setLanguage, t } from './localize.ts';
import { balanceColumns, columnCount, columnWidth, estimateRoomHeight } from './room-columns.ts';
import { buttonReset, themeVars } from './styles.ts';
import { skyMode, type HouseRoom, type SunInfo } from './components/lc-house.ts';
import type { SheetTarget } from './components/lc-sheet.ts';
import type { TileActionDetail, TileBrightnessDetail } from './components/lc-tile.ts';
import './components/lc-house.ts';
import './components/lc-sheet.ts';
import './components/lc-tile.ts';

const FILTER_ON = '__on__';
/** Height of a one-line title and summary over the house. */
const HEAD_INSET = 62;

/** "12 lights on · 3 plugs on · 362 W" that wraps between phrases, never inside one. */
function phrases(parts: string[]) {
  return parts.map((part, i) => html`<span class="phrase">${part}${i < parts.length - 1 ? ' ·' : ''}</span> `);
}

/** Which visible or state-hidden entities are currently unavailable or orphaned. */
function stateSignature(discovery: Discovery, hass: HomeAssistant): string {
  let signature = '';
  const add = (id: string) => {
    const stateObj = hass.states[id];
    signature += !stateObj ? 'x' : stateObj.attributes.restored ? 'r' : stateObj.state === 'unavailable' ? 'u' : '-';
  };
  discovery.stateGated.forEach(add);
  for (const room of discovery.rooms) for (const entity of room.entities) add(entity.entityId);
  return signature;
}
const REDISCOVER_MS = 30_000;

type SheetRef = { type: 'entity'; entityId: string } | { type: 'room'; roomId: string };

export class LightControlCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
    _filter: { state: true },
    _sheet: { state: true },
    _width: { state: true },
    _headHeight: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: ResolvedConfig;
  declare _filter: string | null;
  declare _sheet: SheetRef | null;
  /** The card's width, which decides how many room columns fit. */
  declare _width: number;
  /** The title and summary over the house, which wrap on narrow cards and in long languages. */
  declare _headHeight: number;

  private readonly controller = new LightController(this);
  private discovery?: Discovery;
  private discoveryKey: unknown[] = [];
  private resizeObserver?: ResizeObserver;
  private observedHead?: Element;

  constructor() {
    super();
    this._filter = null;
    this._sheet = null;
    this._width = 0;
    this._headHeight = 0;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.resizeObserver ??= new ResizeObserver((entries) => this.onResize(entries));
    this.resizeObserver.observe(this);
    if (this.observedHead) this.resizeObserver.observe(this.observedHead);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    // Leaving the dashboard closes the dialog; don't pop it open again on return.
    this._sheet = null;
  }

  setConfig(config: LightControlCardConfig): void {
    this._config = resolveConfig(config);
    this.discovery = undefined;
  }

  getCardSize(): number {
    const rooms = this.discovery?.rooms ?? [];
    const rows = rooms.reduce((sum, room) => sum + Math.ceil(room.entities.length / 2), 0);
    return Math.max(3, Math.ceil((this._config?.show_house ? 4 : 1) + rooms.length * 1.2 + rows * 1.4));
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement('light-control-card-editor');
  }

  static getStubConfig(): Partial<LightControlCardConfig> {
    return {};
  }

  // ─── Change detection ──────────────────────────────────────────────────────

  private getDiscovery(): Discovery {
    const hass = this.hass!;
    const key = [
      hass.entities,
      hass.devices,
      hass.areas,
      hass.floors,
      Object.keys(hass.states).length,
      this._config,
      Math.floor(Date.now() / REDISCOVER_MS),
      this.discovery ? stateSignature(this.discovery, hass) : '',
    ];
    if (!this.discovery || key.some((value, i) => value !== this.discoveryKey[i])) {
      this.discovery = discover(hass, {
        ...this._config!,
        unassigned_name: this._config!.unassigned_name || t('other'),
      });
      key[key.length - 1] = stateSignature(this.discovery, hass);
      this.discoveryKey = key;
    }
    return this.discovery;
  }

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    if (!this._config || !this.hass) return false;
    if (!changed.has('hass') || changed.size > 1) return true;
    const old = changed.get('hass') as HomeAssistant | undefined;
    const hass = this.hass;
    if (!old || !this.discovery) return true;
    if (
      old.entities !== hass.entities ||
      old.devices !== hass.devices ||
      old.areas !== hass.areas ||
      old.floors !== hass.floors ||
      old.themes?.darkMode !== hass.themes?.darkMode ||
      old.locale?.language !== hass.locale?.language ||
      old.language !== hass.language ||
      old.config?.country !== hass.config?.country
    ) {
      return true;
    }
    if (Object.keys(old.states).length !== Object.keys(hass.states).length) return true;
    return this.discovery.watched.some((id) => old.states[id] !== hass.states[id]);
  }

  protected override willUpdate(): void {
    this.toggleAttribute('dark', Boolean(this.hass?.themes?.darkMode));
    setLanguage(this.hass?.locale?.language ?? this.hass?.language);
    this.controller.hass = this.hass;
  }

  protected override updated(): void {
    const head = this.renderRoot.querySelector('.with-house .head-row') ?? undefined;
    if (head === this.observedHead) return;
    if (this.observedHead) this.resizeObserver?.unobserve(this.observedHead);
    this.observedHead = head;
    if (head) this.resizeObserver?.observe(head);
  }

  private onResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      const box = entry.borderBoxSize?.[0];
      if (entry.target === this) {
        const width = Math.round(box?.inlineSize ?? entry.contentRect.width);
        if (width !== this._width) this._width = width;
      } else if (entry.target === this.observedHead) {
        const height = Math.ceil(box?.blockSize ?? (entry.target as HTMLElement).offsetHeight);
        if (height !== this._headHeight) this._headHeight = height;
      }
    }
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  protected override render() {
    if (!this._config || !this.hass) return nothing;
    const config = this._config;
    const discovery = this.getDiscovery();
    const dark = Boolean(this.hass.themes?.darkMode);
    const summaries = new Map<string, Summary>();
    for (const room of discovery.rooms) summaries.set(room.id, summarize(room.entities, this.viewOf, this.hass));
    const all = summarize(
      discovery.rooms.flatMap((r) => r.entities),
      this.viewOf,
      this.hass,
    );

    const filter = this._filter && (this._filter === FILTER_ON || summaries.has(this._filter)) ? this._filter : null;
    const rooms = discovery.rooms
      .filter((room) => !filter || filter === FILTER_ON || room.id === filter)
      .map((room) => ({
        room,
        entities: filter === FILTER_ON ? room.entities.filter((e) => this.viewOf(e)?.on) : room.entities,
      }))
      .filter(({ entities }) => entities.length);
    const columns = this.roomColumns(rooms);

    return html`
      <ha-card>
        ${this.renderHeader(discovery, summaries, all, dark)}
        ${config.show_room_filter && discovery.rooms.length > 1 ? this.renderChips(discovery.rooms, summaries, all, filter) : nothing}
        <div
          class="rooms ${columns.length > 1 ? 'side-by-side' : ''}"
          @lc-tile-action=${this.onTileAction}
          @lc-tile-brightness=${this.onTileBrightness}
        >
          ${columns.map(
            (column) =>
              html`<div class="column">
                ${repeat(
                  column,
                  ({ room }) => room.id,
                  ({ room, entities }) => this.renderRoom(room, entities, summaries.get(room.id)!, dark),
                )}
              </div>`,
          )}
        </div>
        ${this.renderEmpty(discovery, rooms.length, filter)}
        <lc-sheet
          .hass=${this.hass}
          .controller=${this.controller}
          .target=${this.resolveSheet(discovery)}
          .outletStyle=${this.outletStyle}
          ?liveBrightness=${config.live_brightness}
          ?dark=${dark}
          @lc-sheet-closed=${() => (this._sheet = null)}
        ></lc-sheet>
      </ha-card>
    `;
  }

  private viewOf = (entity: DiscoveredEntity) => this.controller.view(entity.entityId, entity.kind);

  private get outletStyle(): OutletStyle {
    return outletStyleFor(this.hass?.config?.country);
  }

  private get language(): string | undefined {
    return this.hass?.locale?.language ?? this.hass?.language;
  }

  private summaryParts(all: Summary): string[] {
    const parts: string[] = [];
    if (all.lightsOn) parts.push(t('lights_on', { n: all.lightsOn }));
    if (all.plugsOn) parts.push(t('plugs_on', { n: all.plugsOn }));
    if (all.watts !== null && all.watts > 0) parts.push(formatWatts(all.watts, this.language));
    return parts.length ? parts : [t('everything_off')];
  }

  private renderHeader(discovery: Discovery, summaries: Map<string, Summary>, all: Summary, dark: boolean) {
    const config = this._config!;
    const houseRooms = config.show_house ? this.houseRooms(discovery, summaries) : [];
    const withHouse = houseRooms.length > 0;
    if (!withHouse && !config.title && !config.show_summary) return nothing;
    const sun = this.sunInfo();
    const sky = withHouse ? skyMode(sun) : undefined;
    const offTargets = config.room_switch_outlets ? [...all.lightIds, ...all.plugIds] : all.lightIds;
    const anyOn = all.lightsOn > 0 || (config.room_switch_outlets && all.plugsOn > 0);
    const hasText = Boolean(config.title || config.show_summary);
    // A title or summary that wraps (a narrow card, a long language) makes the header taller
    // and moves the house down with it, instead of running across the roof.
    const overflow = withHouse && hasText ? Math.max(0, this._headHeight - HEAD_INSET) : 0;

    return html`<div
      class="header ${withHouse ? `with-house sky-${sky}` : ''}"
      style=${overflow ? `padding-top:${overflow}px` : nothing}
    >
      ${
        withHouse
          ? html`<lc-house
              .rooms=${houseRooms}
              .floors=${discovery.floors.map((f) => ({ id: f.id, level: f.level }))}
              .selected=${this._filter !== FILTER_ON ? this._filter : null}
              .sun=${sun}
              .topInset=${hasText ? HEAD_INSET + overflow : 12}
              ?dark=${dark}
              @lc-room-select=${(ev: CustomEvent<{ roomId: string }>) => this.toggleFilter(ev.detail.roomId)}
            ></lc-house>`
          : nothing
      }
      <div class="head-row">
        <div class="head-text">
          ${config.title ? html`<h1>${config.title}</h1>` : nothing}
          ${config.show_summary ? html`<div class="summary">${phrases(this.summaryParts(all))}</div>` : nothing}
        </div>
        ${
          config.show_summary && anyOn
            ? html`<button
                class="all-off"
                @click=${() => this.controller.turnOffWithUndo(offTargets)}
                title=${t('all_off_label')}
              >
                ${icon(mdiLightbulbOffOutline)}<span>${t('all_off')}</span>
              </button>`
            : nothing
        }
      </div>
    </div>`;
  }

  private houseRooms(discovery: Discovery, summaries: Map<string, Summary>): HouseRoom[] {
    return discovery.rooms
      .filter((room) => room.id !== UNASSIGNED && summaries.get(room.id)!.lights > 0)
      .map((room) => {
        const s = summaries.get(room.id)!;
        return {
          id: room.id,
          name: room.name,
          floorId: room.floorId,
          outdoor: room.outdoor,
          onCount: s.lightsOn,
          total: s.lights,
          rgb: s.rgb,
          level: s.level,
          caption: this.roomCaption(s),
        };
      });
  }

  private sunInfo(): SunInfo | undefined {
    const sun = this.hass?.states['sun.sun'];
    if (!sun) return undefined;
    const { elevation, azimuth } = sun.attributes;
    return {
      elevation: typeof elevation === 'number' ? elevation : undefined,
      azimuth: typeof azimuth === 'number' ? azimuth : undefined,
      aboveHorizon: sun.state === 'above_horizon',
    };
  }

  private roomCaptionParts(s: Summary): string[] {
    const parts: string[] = [];
    if (s.lights) {
      if (!s.lightsOn) parts.push(t('room_off'));
      else if (s.lightsOn === s.lights)
        parts.push(s.dimmable ? `${t('room_all_on')} · ${s.brightness}%` : t('room_all_on'));
      else parts.push(t('room_on', { n: s.lightsOn, total: s.lights }));
    }
    if (s.plugsOn) parts.push(t('plugs_on', { n: s.plugsOn }));
    if (s.watts !== null && s.watts > 0) parts.push(formatWatts(s.watts, this.language));
    return parts;
  }

  private roomCaption(s: Summary): string {
    return this.roomCaptionParts(s).join(' · ');
  }

  private renderChips(rooms: Room[], summaries: Map<string, Summary>, all: Summary, filter: string | null) {
    const onCount = all.lightsOn + all.plugsOn;
    return html`<div class="chips" role="toolbar" aria-label=${t('rooms')}>
      <button
        class="chip ${filter === null ? 'active' : ''}"
        aria-pressed=${filter === null}
        @click=${() => (this._filter = null)}
      >
        ${t('all_rooms')}
      </button>
      <button
        class="chip ${filter === FILTER_ON ? 'active' : ''}"
        aria-pressed=${filter === FILTER_ON}
        style="--lc-c:${rgbTriplet(all.rgb ?? WARM_GLOW)}"
        @click=${() => this.toggleFilter(FILTER_ON)}
      >
        <span class="dot ${onCount ? 'lit' : ''}"></span>${t('on_now')}<span class="count">${onCount}</span>
      </button>
      ${rooms.map((room) => {
        const s = summaries.get(room.id)!;
        const lit = s.lightsOn > 0 || s.plugsOn > 0;
        return html`<button
          class="chip ${filter === room.id ? 'active' : ''}"
          aria-pressed=${filter === room.id}
          style="--lc-c:${rgbTriplet(s.rgb ?? (s.plugsOn ? [38, 196, 152] : WARM_GLOW))}"
          @click=${() => this.toggleFilter(room.id)}
        >
          <span class="dot ${lit ? 'lit' : ''}"></span>${room.name}
        </button>`;
      })}
    </div>`;
  }

  private showScenes(room: Room): boolean {
    return this._config!.show_scenes && room.scenes.length > 0 && this._filter !== FILTER_ON;
  }

  /** Rooms in one column, or on a wide card, in balanced columns read top to bottom. */
  private roomColumns<T extends { room: Room; entities: DiscoveredEntity[] }>(rooms: T[]): T[][] {
    const count = columnCount(this._width, rooms.length);
    if (count < 2) return rooms.length ? [rooms] : [];
    const width = columnWidth(this._width, count);
    const heights = rooms.map(({ room, entities }) =>
      estimateRoomHeight(entities.length, this.showScenes(room), width),
    );
    return balanceColumns(heights, count).map((column) => column.map((i) => rooms[i]));
  }

  private renderRoom(room: Room, entities: DiscoveredEntity[], s: Summary, dark: boolean) {
    const config = this._config!;
    const rgb = s.rgb ?? WARM_GLOW;
    const lit = s.lightsOn > 0;
    const switchTargets = config.room_switch_outlets ? [...s.lightIds, ...s.plugIds] : s.lightIds;
    const switchOn = s.lightsOn > 0 || (config.room_switch_outlets && s.plugsOn > 0);
    const hasLights = s.lightIds.length > 0;
    return html`<section
      class="room ${lit ? 'lit' : ''}"
      style="--lc-c:${rgbTriplet(rgb)};--lc-accent:${rgbTriplet(accentFor(rgb, dark))};--lc-switch:${rgbTriplet(accentFor(rgb, false))};--glow:${(0.4 + s.level * 0.6).toFixed(2)}"
      aria-label=${room.name}
    >
      <div class="room-head">
        <button
          class="room-title"
          @click=${() => (this._sheet = { type: 'room', roomId: room.id })}
          ?disabled=${!hasLights}
        >
          <span class="room-icon"><ha-icon .icon=${room.icon}></ha-icon></span>
          <span class="room-text">
            <span class="room-name">${room.name}</span>
            <span class="room-sub">${phrases(this.roomCaptionParts(s))}</span>
          </span>
          ${hasLights ? icon(mdiTuneVariant, 'mdi tune') : nothing}
        </button>
        ${
          switchTargets.length
            ? html`<button
                class="switch ${switchOn ? 'on' : ''}"
                role="switch"
                aria-checked=${switchOn ? 'true' : 'false'}
                aria-label=${`${room.name}: ${switchOn ? t('turn_off') : t('turn_on')}`}
                @click=${() =>
                  switchOn
                    ? this.controller.turnOffWithUndo(switchTargets, room.name)
                    : this.controller.setPower(hasLights ? s.lightIds : switchTargets, true)}
              >
                <span class="knob"></span>
              </button>`
            : nothing
        }
      </div>
      ${
        this.showScenes(room)
          ? html`<div class="scenes">
              ${room.scenes.map(
                (id) =>
                  html`<button class="scene" @click=${() => this.controller.activateScene(id)}>
                    ${icon(mdiPlay)}<span>${this.sceneName(id, room.name)}</span>
                  </button>`,
              )}
            </div>`
          : nothing
      }
      <div class="grid">
        ${repeat(
          entities,
          (e) => e.entityId,
          (e) => this.renderTile(e, dark),
        )}
      </div>
    </section>`;
  }

  private renderTile(entity: DiscoveredEntity, dark: boolean) {
    const view = this.viewOf(entity);
    if (!view) return nothing;
    const watts = readWatts(this.hass!, entity.sensors.power);
    return html`<lc-tile
      .hass=${this.hass}
      .entity=${entity}
      .view=${view}
      .outletStyle=${this.outletStyle}
      .iconStyle=${this._config!.icon_style}
      .powerText=${watts !== null ? formatWatts(watts, this.language) : undefined}
      ?drawing=${watts !== null && watts > 0.5}
      ?dark=${dark}
    ></lc-tile>`;
  }

  private renderEmpty(discovery: Discovery, visibleRooms: number, filter: string | null) {
    if (visibleRooms) return nothing;
    if (!discovery.rooms.length) {
      return html`<div class="empty">
        <strong>${t('no_entities')}</strong>
        <span>${t('no_entities_hint')}</span>
      </div>`;
    }
    if (filter === FILTER_ON) {
      return html`<div class="empty">
        <svg class="moon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17.8 15.6A7.5 7.5 0 0 1 8.4 6.2a7.5 7.5 0 1 0 9.4 9.4z"></path>
        </svg>
        <strong>${t('nothing_on')}</strong>
      </div>`;
    }
    return nothing;
  }

  private sceneName(sceneId: string, roomName: string): string {
    const name = this.hass!.states[sceneId]?.attributes.friendly_name ?? sceneId;
    return name.toLowerCase().startsWith(roomName.toLowerCase()) && name.length > roomName.length
      ? name.slice(roomName.length).replace(/^[\s\-_:·]+/, '')
      : name;
  }

  private resolveSheet(discovery: Discovery): SheetTarget | null {
    const ref = this._sheet;
    if (!ref) return null;
    if (ref.type === 'room') {
      const room = discovery.rooms.find((r) => r.id === ref.roomId);
      return room ? { type: 'room', room } : null;
    }
    for (const room of discovery.rooms) {
      const entity = room.entities.find((e) => e.entityId === ref.entityId);
      if (entity) return { type: 'entity', entity, roomName: room.name };
    }
    return null;
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  private toggleFilter(id: string): void {
    this._filter = this._filter === id ? null : id;
  }

  private onTileAction = (ev: CustomEvent<TileActionDetail>): void => {
    const { entityId, action } = ev.detail;
    const entity = this.discovery?.rooms.flatMap((r) => r.entities).find((e) => e.entityId === entityId);
    if (!entity) return;
    if (action === 'controls' || this._config!.tap_action === 'controls') {
      this._sheet = { type: 'entity', entityId };
    } else if (this._config!.tap_action === 'more-info') {
      this.controller.moreInfo(entityId);
    } else {
      this.controller.toggle(entityId, entity.kind);
    }
  };

  private onTileBrightness = (ev: CustomEvent<TileBrightnessDetail>): void => {
    const { entityId, value, final } = ev.detail;
    if (final) this.controller.setBrightness([entityId], value);
    else if (this._config!.live_brightness) this.controller.previewBrightness([entityId], value);
  };

  static override styles = [
    themeVars,
    buttonReset,
    css`
      :host {
        display: block;
        --lc-c: 255, 196, 116;
        --lc-accent: var(--lc-c);
      }
      ha-card {
        overflow: hidden;
        padding-bottom: 12px;
        isolation: isolate;
        container-type: inline-size;
      }
      .header {
        position: relative;
      }
      .header.with-house {
        height: 210px;
        height: clamp(196px, 36cqi, 280px);
      }
      lc-house {
        position: absolute;
        inset: 0;
      }
      .head-row {
        position: relative;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 16px 4px;
      }
      .with-house .head-row {
        position: absolute;
        inset: 0 0 auto 0;
        padding: 14px 14px 0 16px;
        pointer-events: none;
      }
      .with-house .head-row > * {
        pointer-events: auto;
      }
      .head-text {
        min-width: 0;
      }
      h1 {
        margin: 0;
        font-size: 22px;
        line-height: 28px;
        font-weight: 700;
        letter-spacing: -0.01em;
        color: var(--lc-text);
      }
      .summary {
        margin-top: 1px;
        font-size: 13.5px;
        line-height: 18px;
        color: var(--lc-text-2);
        font-variant-numeric: tabular-nums;
      }
      .phrase {
        white-space: nowrap;
      }
      .with-house h1,
      .with-house .summary {
        color: #fff;
        text-shadow: 0 1px 10px rgba(0, 0, 0, 0.45);
      }
      .with-house .summary {
        color: rgba(255, 255, 255, 0.88);
      }
      .with-house.sky-day h1,
      .with-house.sky-day .summary {
        color: #0e2340;
        text-shadow: 0 1px 8px rgba(255, 255, 255, 0.6);
      }
      .all-off {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 14px 0 11px;
        border-radius: 18px;
        font-size: 13.5px;
        font-weight: 600;
        background: var(--lc-surface-2);
        color: var(--lc-text);
        transition:
          transform 0.15s ease,
          background 0.2s ease;
      }
      .all-off:active {
        transform: scale(0.95);
      }
      .all-off .mdi {
        width: 18px;
        height: 18px;
      }
      .with-house .all-off {
        background: rgba(255, 255, 255, 0.16);
        color: #fff;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      .with-house.sky-day .all-off {
        background: rgba(255, 255, 255, 0.62);
        color: #0e2340;
      }
      .chips {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding: 12px 16px 2px;
        scrollbar-width: none;
        -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%);
        mask-image: linear-gradient(90deg, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%);
      }
      .chips::-webkit-scrollbar {
        display: none;
      }
      .chip {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 34px;
        padding: 0 14px;
        border-radius: 17px;
        background: var(--lc-surface-2);
        color: var(--lc-text-2);
        font-size: 13.5px;
        font-weight: 600;
        white-space: nowrap;
        transition:
          background 0.2s ease,
          color 0.2s ease;
      }
      .chip:hover {
        background: rgba(var(--lc-rgb-text), 0.13);
      }
      .chip.active {
        background: var(--lc-text);
        color: var(--lc-bg);
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: rgba(var(--lc-rgb-text), 0.22);
        transition:
          background 0.3s ease,
          box-shadow 0.3s ease;
      }
      .dot.lit {
        background: rgb(var(--lc-c));
        box-shadow: 0 0 8px rgba(var(--lc-c), 0.95);
      }
      .count {
        font-variant-numeric: tabular-nums;
        opacity: 0.7;
      }
      .rooms {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px 12px 0;
      }
      .column {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .room {
        position: relative;
        border-radius: 22px;
        padding: 6px 10px 10px;
        background: var(--lc-surface);
        isolation: isolate;
        overflow: hidden;
      }
      .room::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: -1;
        background: radial-gradient(
          85% 140% at 0% 0%,
          rgba(var(--lc-c), calc(var(--glow) * 0.24)),
          rgba(var(--lc-c), 0) 70%
        );
        opacity: 0;
        transition: opacity 0.7s ease;
      }
      .room.lit::before {
        opacity: 1;
      }
      .room-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 2px 8px 0;
      }
      .room-title {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 4px;
        border-radius: 16px;
        text-align: left;
      }
      .room-title:disabled {
        cursor: default;
      }
      .room-icon {
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        background: var(--lc-surface-2);
        color: var(--lc-text-2);
        --mdc-icon-size: 22px;
        transition:
          background 0.5s ease,
          color 0.5s ease,
          box-shadow 0.5s ease;
      }
      .lit .room-icon {
        background: rgba(var(--lc-c), 0.24);
        color: rgb(var(--lc-accent));
        box-shadow: 0 6px 18px -8px rgba(var(--lc-c), 0.9);
      }
      .room-text {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .room-name {
        font-size: 16px;
        line-height: 21px;
        font-weight: 700;
        color: var(--lc-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .room-sub {
        font-size: 12.5px;
        line-height: 16px;
        color: var(--lc-text-2);
        font-variant-numeric: tabular-nums;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        overflow: hidden;
      }
      .tune {
        width: 18px;
        height: 18px;
        margin-left: auto;
        color: var(--lc-text-2);
        opacity: 0.55;
        transition: opacity 0.2s ease;
      }
      .room-title:hover .tune {
        opacity: 0.9;
      }
      .switch {
        position: relative;
        flex: none;
        width: 50px;
        height: 30px;
        margin-right: 4px;
        border-radius: 15px;
        background: rgba(var(--lc-rgb-text), 0.18);
        transition:
          background 0.3s ease,
          box-shadow 0.3s ease;
      }
      .switch .knob {
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
      .switch.on {
        background: rgb(var(--lc-switch));
        box-shadow: 0 4px 16px -4px rgba(var(--lc-c), 0.9);
      }
      .switch.on .knob {
        transform: translateX(20px);
      }
      .scenes {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        scrollbar-width: none;
        padding: 0 2px 10px;
      }
      .scene {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 12px 0 9px;
        border-radius: 15px;
        background: var(--lc-surface-2);
        font-size: 12.5px;
        font-weight: 600;
        color: var(--lc-text);
        white-space: nowrap;
      }
      .scene .mdi {
        width: 15px;
        height: 15px;
        color: rgb(var(--lc-accent));
      }
      .scene:active {
        transform: scale(0.96);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 8px;
      }
      /* Rooms side by side show two tiles to a row, like a phone, and a lone tile fills its row. */
      .side-by-side .grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .side-by-side .grid > :only-child {
        grid-column: 1 / -1;
      }
      @container (max-width: 440px) {
        .grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .grid > :only-child {
          grid-column: 1 / -1;
        }
        .rooms {
          padding: 10px 8px 0;
        }
        .room {
          padding: 4px 8px 8px;
        }
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 28px 24px 18px;
        text-align: center;
        color: var(--lc-text-2);
        font-size: 13.5px;
      }
      .empty strong {
        color: var(--lc-text);
        font-size: 15px;
      }
      .moon {
        width: 44px;
        height: 44px;
        fill: #f3d98b;
        filter: drop-shadow(0 0 12px rgba(243, 217, 139, 0.6));
        margin-bottom: 4px;
      }
      @media (prefers-reduced-motion: reduce) {
        .room::before,
        .switch,
        .switch .knob {
          transition: none;
        }
      }
    `,
  ];
}
