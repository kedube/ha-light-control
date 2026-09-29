import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { formatWatts, readWatts, summarize, summarizeRooms, type Summary } from './aggregate.ts';
import { accentFor, rgbTriplet, WARM_GLOW } from './color.ts';
import { resolveConfig, type LightControlCardConfig, type ResolvedConfig } from './config.ts';
import { LightController } from './controller.ts';
import { discover, UNASSIGNED, type DiscoveredEntity, type Discovery, type Room } from './discovery.ts';
import { outletStyleFor, type OutletStyle } from './graphics.ts';
import type { HomeAssistant } from './ha-types.ts';
import { fixtureKind } from './house/scene.ts';
import {
  icon,
  mdiChevronLeft,
  mdiChevronRight,
  mdiHomeVariant,
  mdiLightbulb,
  mdiPlay,
  mdiPowerPlug,
  mdiTuneVariant,
} from './icons.ts';
import { setLanguage, t } from './localize.ts';
import { balanceColumns, columnCount, columnWidth, estimateRoomHeight } from './room-columns.ts';
import { floorGroups, groupOf, OUTSIDE, roomsIn, validScope, type FloorGroup, type Scope } from './scope.ts';
import { buttonReset, themeVars } from './styles.ts';
import { skyMode, type HouseRoom, type HouseView, type SunInfo } from './components/lc-house.ts';
import type { SlideDetail } from './components/lc-pill.ts';
import type { SheetTarget } from './components/lc-sheet.ts';
import type { TileActionDetail, TileBrightnessDetail } from './components/lc-tile.ts';
import './components/lc-house.ts';
import './components/lc-sheet.ts';
import './components/lc-slider.ts';
import './components/lc-tile.ts';

/** "12 lights on · 3 outlets on · 362 W" that wraps between phrases, never inside one. */
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
const CONFIRM_MS = 4000;

type SheetRef = { type: 'entity'; entityId: string } | { type: 'scope'; scope: Scope };

export class LightControlCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
    _scope: { state: true },
    _onlyOn: { state: true },
    _sheet: { state: true },
    _width: { state: true },
    _headHeight: { state: true },
    _headWidth: { state: true },
    _confirm: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: ResolvedConfig;
  declare _scope: Scope;
  declare _onlyOn: boolean;
  declare _sheet: SheetRef | null;
  /** The card's width, which decides how many room columns fit. */
  declare _width: number;
  /** The title and summary over the house, which wrap on narrow cards and in long languages. */
  declare _headHeight: number;
  declare _headWidth: number;
  /** An outlets switch waiting for a second tap before it turns several outlets off. */
  declare _confirm: string | null;

  private readonly controller = new LightController(this);
  private discovery?: Discovery;
  private discoveryKey: unknown[] = [];
  private resizeObserver?: ResizeObserver;
  private observedHead?: Element;
  private confirmTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    this._scope = { kind: 'home' };
    this._onlyOn = false;
    this._sheet = null;
    this._width = 0;
    this._headHeight = 0;
    this._headWidth = 0;
    this._confirm = null;
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
    clearTimeout(this.confirmTimer);
    // A pending "tap again" must not survive leaving the dashboard.
    this._confirm = null;
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
    return Math.max(3, Math.ceil((this._config?.show_house ? 6 : 2) + rooms.length * 1.2 + rows * 1.3));
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

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('_scope')) {
      // Keep the selected place in view when the switcher scrolls on a narrow card.
      const active = this.renderRoot.querySelector<HTMLElement>('.tab.active');
      const track = active?.parentElement;
      if (active && track && track.scrollWidth > track.clientWidth) {
        const tab = active.getBoundingClientRect();
        const bar = track.getBoundingClientRect();
        track.scrollTo({ left: track.scrollLeft + tab.left - bar.left - (bar.width - tab.width) / 2 });
      }
    }
    const head = this.renderRoot.querySelector('.hero .hero-head') ?? undefined;
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
        // The text's own width, not the full-width box it sits in.
        const text = [...(entry.target as HTMLElement).children].map((el) => (el as HTMLElement).scrollWidth);
        const width = Math.ceil(Math.max(0, ...text) + 16);
        if (width !== this._headWidth) this._headWidth = width;
      }
    }
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  protected override render() {
    if (!this._config || !this.hass) return nothing;
    const discovery = this.getDiscovery();
    const groups = floorGroups(discovery, { inside: t('inside'), outside: t('outside') });
    const scope = validScope(groups, this._scope);
    const dark = Boolean(this.hass.themes?.darkMode);
    const summaries = new Map<string, Summary>();
    for (const room of discovery.rooms) summaries.set(room.id, summarize(room.entities, this.viewOf, this.hass));
    const all = summarizeRooms(discovery.rooms, this.viewOf, this.hass);
    const scopeRooms = roomsIn(groups, scope);
    const scopeSummary = scope.kind === 'home' ? all : summarizeRooms(scopeRooms, this.viewOf, this.hass);

    return html`
      <ha-card>
        ${this.renderHero(discovery, groups, scope, all)}
        ${discovery.rooms.length ? this.renderPanel(groups, scope, scopeRooms, scopeSummary, summaries, dark) : nothing}
        ${scope.kind === 'room' ? nothing : this.renderRooms(groups, scope, summaries, dark)}
        ${this.renderEmpty(discovery)}
        <lc-sheet
          .hass=${this.hass}
          .controller=${this.controller}
          .target=${this.resolveSheet(groups)}
          .outletStyle=${this.outletStyle}
          ?liveBrightness=${this._config.live_brightness}
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

  // ─── Hero: the house, the title and the floor switcher ─────────────────────

  private renderHero(discovery: Discovery, groups: FloorGroup[], scope: Scope, all: Summary) {
    const config = this._config!;
    const houseRooms = config.show_house ? this.houseRooms(discovery) : [];
    const withHouse = houseRooms.length > 0;
    const tabs = this.renderTabs(groups, scope, withHouse);
    const hasText = Boolean(config.title || config.show_summary);
    const head = hasText
      ? html`<div class="hero-head">
          ${config.title ? html`<h1>${config.title}</h1>` : nothing}
          ${config.show_summary ? html`<div class="summary">${phrases(this.summaryParts(all))}</div>` : nothing}
        </div>`
      : nothing;
    if (!withHouse) {
      if (!hasText && tabs === nothing) return nothing;
      return html`<header class="plain">${head}${tabs}</header>`;
    }
    const sun = this.sunInfo();
    return html`<section class="hero sky-${skyMode(sun)}">
      <lc-house
        .rooms=${houseRooms}
        .floors=${discovery.floors.map((f) => ({ id: f.id, level: f.level }))}
        .view=${this.houseView(groups, scope)}
        .selected=${scope.kind === 'room' ? scope.id : null}
        .sun=${sun}
        .topInset=${hasText ? this._headHeight + 6 : 8}
        .titleWidth=${hasText ? this._headWidth : 0}
        .bottomInset=${tabs === nothing ? 0 : 52}
        ?dark=${Boolean(this.hass?.themes?.darkMode)}
        @lc-room-select=${(ev: CustomEvent<{ roomId: string }>) => this.onHouseSelect(groups, ev.detail.roomId)}
      ></lc-house>
      ${head} ${tabs}
    </section>`;
  }

  /** Home, each floor and the outdoors, as a switcher over the bottom of the house. */
  private renderTabs(groups: FloorGroup[], scope: Scope, overHouse: boolean) {
    if (!this._config!.show_room_filter) return nothing;
    const places = groups.filter((g) => g.kind !== 'other');
    if (!places.length || (places.length === 1 && !overHouse)) return nothing;
    const active =
      scope.kind === 'home' ? 'home' : scope.kind === 'floor' ? scope.id : (groupOf(groups, scope.id)?.id ?? 'home');
    const pip = (rooms: Room[]) => {
      const s = summarizeRooms(rooms, this.viewOf, this.hass!);
      return s.lightsOn ? html`<i class="pip" style="--lc-c:${rgbTriplet(s.rgb ?? WARM_GLOW)}"></i>` : nothing;
    };
    const tab = (id: string, label: string, iconTemplate: unknown, rooms: Room[], onClick: () => void) =>
      html`<button
        class="tab ${active === id ? 'active' : ''}"
        role="tab"
        aria-selected=${active === id ? 'true' : 'false'}
        aria-label=${label}
        title=${label}
        @click=${onClick}
      >
        ${iconTemplate}<span class="tab-label">${label}</span>${pip(rooms)}
      </button>`;
    return html`<nav
      class="tabs ${overHouse ? 'over' : ''}"
      role="tablist"
      aria-label=${t('floors')}
      @keydown=${this.onTabKey}
    >
      <div class="tab-track">
        ${tab(
          'home',
          t('home'),
          icon(mdiHomeVariant),
          groups.flatMap((g) => g.rooms),
          () => this.setScope({ kind: 'home' }),
        )}
        ${places.map((g) =>
          tab(g.id, g.name, html`<ha-icon .icon=${g.icon}></ha-icon>`, g.rooms, () =>
            this.setScope({ kind: 'floor', id: g.id }),
          ),
        )}
      </div>
    </nav>`;
  }

  private onTabKey = (ev: KeyboardEvent): void => {
    const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const tabs = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('.tab')];
    const index = tabs.indexOf(ev.composedPath()[0] as HTMLButtonElement);
    if (index < 0) return;
    ev.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    next.focus();
    next.click();
  };

  private houseView(groups: FloorGroup[], scope: Scope): HouseView {
    if (scope.kind === 'floor')
      return scope.id === OUTSIDE ? { kind: 'outside' } : { kind: 'floor', floorId: scope.id };
    if (scope.kind === 'room') {
      const group = groupOf(groups, scope.id);
      if (group?.kind === 'outside') return { kind: 'outside' };
      if (group?.kind === 'floor') return { kind: 'floor', floorId: group.id };
    }
    return { kind: 'home' };
  }

  private houseRooms(discovery: Discovery): HouseRoom[] {
    // Every room is in the house, lit or not, so the house and the floor tabs always agree.
    return discovery.rooms
      .filter((room) => room.id !== UNASSIGNED)
      .map((room) => {
        const lights = room.entities.filter((e) => e.kind === 'light');
        const members = lights.some((e) => !e.isGroup) ? lights.filter((e) => !e.isGroup) : lights;
        const s = summarize(room.entities, this.viewOf, this.hass!);
        return {
          id: room.id,
          name: room.name,
          icon: room.icon,
          type: room.type,
          floorId: room.floorId,
          outdoor: room.outdoor,
          caption: this.roomCaption(s),
          rgb: s.lightsOn ? s.rgb : null,
          lights: members.map((e) => {
            const view = this.viewOf(e);
            return {
              id: e.entityId,
              name: e.fullName,
              on: Boolean(view?.on),
              rgb: view?.rgb ?? WARM_GLOW,
              level: (view?.brightness ?? 0) / 100,
            };
          }),
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

  // ─── The controls for what is selected: lights and outlets, separately ─────

  private renderPanel(
    groups: FloorGroup[],
    scope: Scope,
    rooms: Room[],
    s: Summary,
    summaries: Map<string, Summary>,
    dark: boolean,
  ) {
    const room = scope.kind === 'room' ? rooms[0] : undefined;
    const group =
      scope.kind === 'floor' ? groups.find((g) => g.id === scope.id) : room ? groupOf(groups, room.id) : undefined;
    const name = room?.name ?? group?.name ?? t('home');
    const key = room ? `room:${room.id}` : scope.kind === 'floor' ? `floor:${scope.id}` : 'home';
    const hasLights = s.lightIds.length > 0;
    const hasOutlets = s.plugIds.length > 0;
    return html`<section class="panel ${room ? 'room-panel' : ''}" aria-label=${name}>
      ${room ? this.renderRoomHeader(room, group, summaries.get(room.id)!, dark) : nothing}
      ${
        hasLights || hasOutlets
          ? html`<div class="controls ${hasLights && hasOutlets ? 'pair' : ''}">
              ${hasLights ? this.renderLightsControl(key, name, scope, s, dark) : nothing}
              ${hasOutlets ? this.renderOutletsControl(key, name, s) : nothing}
            </div>`
          : nothing
      }
      ${room ? this.renderRoomDetail(room, dark) : nothing}
    </section>`;
  }

  private renderRoomHeader(room: Room, group: FloorGroup | undefined, s: Summary, dark: boolean) {
    const back: Scope = group && group.kind !== 'other' ? { kind: 'floor', id: group.id } : { kind: 'home' };
    const rgb = s.rgb ?? WARM_GLOW;
    return html`<div
      class="room-bar ${s.lightsOn ? 'lit' : ''}"
      style="--lc-c:${rgbTriplet(rgb)};--lc-accent:${rgbTriplet(accentFor(rgb, dark))}"
    >
      <button class="round back" aria-label=${t('back')} title=${t('back')} @click=${() => this.setScope(back)}>
        ${icon(mdiChevronLeft)}
      </button>
      <span class="room-icon"><ha-icon .icon=${room.icon}></ha-icon></span>
      <div class="room-bar-text">
        <span class="eyebrow">${group && group.kind !== 'other' ? group.name : t('home')}</span>
        <h2>${room.name}</h2>
      </div>
    </div>`;
  }

  private renderLightsControl(key: string, name: string, scope: Scope, s: Summary, dark: boolean) {
    const on = s.lightsOn > 0;
    const rgb = s.rgb ?? WARM_GLOW;
    const state = on
      ? `${s.lights > 1 ? t('room_on', { n: s.lightsOn, total: s.lights }) : t('on')}${s.dimmable ? ` · ${s.brightness}%` : ''}`
      : t('off');
    const label = `${name}: ${t('lights')}`;
    return html`<div
      class="control lights ${on ? 'on' : ''}"
      style="--lc-c:${rgbTriplet(rgb)};--lc-accent:${rgbTriplet(accentFor(rgb, dark))}"
    >
      <div class="control-top">
        <button
          class="control-title"
          @click=${() => (this._sheet = { type: 'scope', scope })}
          aria-label=${`${label}, ${t('controls')}`}
        >
          <span class="badge">${icon(mdiLightbulb)}</span>
          <span class="control-text">
            <span class="control-name">${t('lights')}</span>
            <span class="control-state">${state}</span>
          </span>
          ${s.supportsColor || s.supportsTemp || s.dimmable ? icon(mdiTuneVariant, 'mdi tune') : nothing}
        </button>
        ${this.renderSwitch(`lights:${key}`, on, label, () =>
          // "Turned off Kitchen" reads well; "Turned off Home" doesn't, so the home counts its lights.
          on
            ? this.controller.turnOffWithUndo(s.lightIds, scope.kind === 'home' ? undefined : name)
            : this.controller.setPower(s.countedIds, true),
        )}
      </div>
      ${
        s.dimmable
          ? html`<lc-slider
              .value=${on ? s.brightness : 0}
              .label=${`${label}, ${t('brightness')}`}
              @lc-slide=${(ev: CustomEvent<SlideDetail>) => this.onScopeSlide(ev, s, name)}
            ></lc-slider>`
          : nothing
      }
    </div>`;
  }

  private renderOutletsControl(key: string, name: string, s: Summary) {
    const on = s.plugsOn > 0;
    const confirmKey = `outlets:${key}`;
    const confirming = this._confirm === confirmKey;
    const state = on ? (s.plugs > 1 ? t('outlets_on', { n: s.plugsOn, total: s.plugs }) : t('on')) : t('off');
    const label = `${name}: ${t('outlets')}`;
    return html`<div class="control outlets ${on ? 'on' : ''} ${confirming ? 'confirming' : ''}">
      <div class="control-top">
        <div class="control-title">
          <span class="badge">${icon(mdiPowerPlug)}</span>
          <span class="control-text">
            <span class="control-name">${t('outlets')}</span>
            <span class="control-state"
              >${state}${s.watts !== null ? html`<span class="inline-watts"> · ${formatWatts(s.watts, this.language)}</span>` : nothing}</span
            >
          </span>
        </div>
        ${this.renderSwitch(confirmKey, on, label, () => this.onOutletsSwitch(confirmKey, s, name), confirming)}
      </div>
      <div class="control-foot ${confirming ? 'confirming' : ''}" aria-live="polite">
        ${
          confirming
            ? html`<span class="confirm">${t('outlets_off_confirm', { n: s.plugsOn })}</span>`
            : s.watts !== null
              ? html`<span class="watts">${formatWatts(s.watts, this.language)}</span>`
              : nothing
        }
      </div>
    </div>`;
  }

  private renderSwitch(key: string, on: boolean, label: string, action: () => void, warning = false) {
    return html`<button
      class="switch ${on ? 'on' : ''} ${warning ? 'warning' : ''}"
      role="switch"
      data-key=${key}
      aria-checked=${on ? 'true' : 'false'}
      aria-label=${label}
      title=${warning ? t('tap_to_confirm') : on ? t('turn_off') : t('turn_on')}
      @click=${action}
    >
      <span class="knob"></span>
    </button>`;
  }

  private onScopeSlide(ev: CustomEvent<SlideDetail>, s: Summary, name: string): void {
    const { value, final } = ev.detail;
    if (final) this.controller.adjustBrightness(s, value, name);
    else if (this._config!.live_brightness) this.controller.previewAdjust(s, value);
  }

  /** Turning several outlets off at once takes a second tap: a fridge or a computer may be on one. */
  private onOutletsSwitch(key: string, s: Summary, name: string): void {
    clearTimeout(this.confirmTimer);
    if (!s.plugsOn) {
      this._confirm = null;
      this.controller.setPower(s.plugIds, true);
      return;
    }
    if (s.plugsOn > 1 && this._confirm !== key) {
      this._confirm = key;
      this.confirmTimer = setTimeout(() => (this._confirm = null), CONFIRM_MS);
      return;
    }
    this._confirm = null;
    this.controller.turnOffWithUndo(s.plugIds, s.plugsOn === 1 ? undefined : name, 'outlets');
  }

  // ─── Rooms ─────────────────────────────────────────────────────────────────

  private renderRooms(groups: FloorGroup[], scope: Scope, summaries: Map<string, Summary>, dark: boolean) {
    const sections =
      scope.kind === 'home' ? groups : groups.filter((g) => g.id === (scope.kind === 'floor' ? scope.id : ''));
    const visible = sections
      .map((group) => ({
        group,
        rooms: group.rooms
          .map((room) => ({
            room,
            entities: this._onlyOn ? room.entities.filter((e) => this.viewOf(e)?.on) : room.entities,
          }))
          .filter(({ entities }) => entities.length),
      }))
      .filter(({ rooms }) => rooms.length);
    const all = summarizeRooms(
      sections.flatMap((g) => g.rooms),
      this.viewOf,
      this.hass!,
    );
    const onCount = all.lightsOn + all.plugsOn;
    const count = sections.reduce((n, g) => n + g.rooms.length, 0);
    const headers = scope.kind === 'home' && sections.length > 1;
    return html`<div class="rooms-bar">
        <span class="rooms-title">${t('rooms_count', { n: count })}</span>
        <button
          class="filter ${this._onlyOn ? 'active' : ''}"
          aria-pressed=${this._onlyOn ? 'true' : 'false'}
          style="--lc-c:${rgbTriplet(all.rgb ?? WARM_GLOW)}"
          @click=${() => (this._onlyOn = !this._onlyOn)}
        >
          <span class="dot ${onCount ? 'lit' : ''}"></span>${t('on_now')}<span class="count">${onCount}</span>
        </button>
      </div>
      <div class="rooms" @lc-tile-action=${this.onTileAction} @lc-tile-brightness=${this.onTileBrightness}>
        ${visible.map(({ group, rooms }) => {
          const s = summarizeRooms(group.rooms, this.viewOf, this.hass!);
          return html`<section class="floor" aria-label=${group.name}>
            ${headers ? this.renderFloorHeader(group, s) : nothing}
            <div class="columns">
              ${this.roomColumns(rooms).map(
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
          </section>`;
        })}
        ${
          !visible.length && this._onlyOn
            ? html`<div class="empty">
                <svg class="moon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M17.8 15.6A7.5 7.5 0 0 1 8.4 6.2a7.5 7.5 0 1 0 9.4 9.4z"></path>
                </svg>
                <strong>${t('nothing_on')}</strong>
              </div>`
            : nothing
        }
      </div>`;
  }

  private renderFloorHeader(group: FloorGroup, s: Summary) {
    const parts: string[] = [];
    if (s.lights) parts.push(s.lightsOn ? t('lights_on', { n: s.lightsOn }) : t('lights_off'));
    if (s.plugsOn) parts.push(t('plugs_on', { n: s.plugsOn }));
    const openable = group.kind !== 'other';
    return html`<header class="floor-head" style="--lc-c:${rgbTriplet(s.rgb ?? WARM_GLOW)}">
      <button
        class="floor-title"
        ?disabled=${!openable}
        @click=${() => openable && this.setScope({ kind: 'floor', id: group.id })}
      >
        <ha-icon .icon=${group.icon}></ha-icon>
        <span class="floor-text">
          <span class="floor-name">${group.name}</span>
          <span class="floor-sub ${s.lightsOn ? 'lit' : ''}">${parts.join(' · ')}</span>
        </span>
        ${openable ? icon(mdiChevronRight, 'mdi chevron') : nothing}
      </button>
    </header>`;
  }

  /** Rooms in one column, or on a wide card, in balanced columns read top to bottom. */
  private roomColumns<T extends { room: Room; entities: DiscoveredEntity[] }>(rooms: T[]): T[][] {
    const count = columnCount(this._width, rooms.length);
    if (count < 2) return rooms.length ? [rooms] : [];
    const width = columnWidth(this._width, count);
    const heights = rooms.map(({ room, entities }) =>
      estimateRoomHeight(
        entities.filter((e) => e.kind === 'light').length,
        entities.filter((e) => e.kind !== 'light').length,
        this.showScenes(room),
        width,
      ),
    );
    return balanceColumns(heights, count).map((column) => column.map((i) => rooms[i]));
  }

  private showScenes(room: Room): boolean {
    return this._config!.show_scenes && room.scenes.length > 0 && !this._onlyOn;
  }

  private renderRoom(room: Room, entities: DiscoveredEntity[], s: Summary, dark: boolean) {
    const rgb = s.rgb ?? WARM_GLOW;
    const lit = s.lightsOn > 0;
    const lights = entities.filter((e) => e.kind === 'light');
    const outlets = entities.filter((e) => e.kind !== 'light');
    return html`<article
      class="room ${lit ? 'lit' : ''}"
      style="--lc-c:${rgbTriplet(rgb)};--lc-accent:${rgbTriplet(accentFor(rgb, dark))};--glow:${(0.4 + s.level * 0.6).toFixed(2)}"
      aria-label=${room.name}
    >
      <header class="room-head">
        <button class="room-title" @click=${() => this.openRoom(room.id)}>
          <span class="room-icon"><ha-icon .icon=${room.icon}></ha-icon></span>
          <span class="room-text">
            <span class="room-name">${room.name}</span>
            <span class="room-sub">${phrases(this.roomCaptionParts(s))}</span>
          </span>
        </button>
        <div class="quick">
          ${
            s.lightIds.length
              ? html`<button
                  class="quick-toggle light ${lit ? 'on' : ''}"
                  role="switch"
                  aria-checked=${lit ? 'true' : 'false'}
                  aria-label=${`${room.name}: ${t('lights')}`}
                  title=${`${t('lights')}: ${lit ? t('turn_off') : t('turn_on')}`}
                  @click=${() => (lit ? this.controller.turnOffWithUndo(s.lightIds, room.name) : this.controller.setPower(s.countedIds, true))}
                >
                  ${icon(mdiLightbulb)}
                </button>`
              : nothing
          }
          ${s.plugIds.length ? this.renderOutletQuick(room, s) : nothing}
        </div>
      </header>
      ${
        this._confirm === `outlets:quick:${room.id}`
          ? html`<div class="confirm-hint" role="status">${t('outlets_off_confirm', { n: s.plugsOn })}</div>`
          : nothing
      }
      ${
        lights.length
          ? html`<div class="grid">
              ${repeat(
                lights,
                (e) => e.entityId,
                (e) => this.renderTile(e, dark, 'tile'),
              )}
            </div>`
          : nothing
      }
      ${
        outlets.length
          ? html`<div class="outlet-row">
              ${repeat(
                outlets,
                (e) => e.entityId,
                (e) => this.renderTile(e, dark, 'chip'),
              )}
            </div>`
          : nothing
      }
      ${this.showScenes(room) ? this.renderScenes(room) : nothing}
    </article>`;
  }

  private renderOutletQuick(room: Room, s: Summary) {
    const on = s.plugsOn > 0;
    const key = `outlets:quick:${room.id}`;
    const confirming = this._confirm === key;
    return html`<button
      class="quick-toggle outlet ${on ? 'on' : ''} ${confirming ? 'warning' : ''}"
      role="switch"
      aria-checked=${on ? 'true' : 'false'}
      aria-label=${`${room.name}: ${t('outlets')}`}
      title=${confirming ? t('outlets_off_confirm', { n: s.plugsOn }) : `${t('outlets')}: ${on ? t('turn_off') : t('turn_on')}`}
      @click=${() => this.onOutletsSwitch(key, s, room.name)}
    >
      ${icon(mdiPowerPlug)}
    </button>`;
  }

  private renderScenes(room: Room) {
    return html`<div class="scenes">
      ${room.scenes.map(
        (id) =>
          html`<button class="scene" @click=${() => this.controller.activateScene(id)}>
            ${icon(mdiPlay)}<span>${this.sceneName(id, room.name)}</span>
          </button>`,
      )}
    </div>`;
  }

  /** One room, up close: every light with its own switch, brightness and color. */
  private renderRoomDetail(room: Room, dark: boolean) {
    const lights = room.entities.filter((e) => e.kind === 'light');
    const outlets = room.entities.filter((e) => e.kind !== 'light');
    return html`${room.scenes.length && this._config!.show_scenes ? html`<div class="detail-scenes">${this.renderScenes(room)}</div>` : nothing}
      <div class="detail" @lc-tile-action=${this.onTileAction} @lc-tile-brightness=${this.onTileBrightness}>
        ${
          lights.length
            ? html`<h3 class="detail-head">${icon(mdiLightbulb)}${t('lights')}</h3>
                <div class="rows">
                  ${repeat(
                    lights,
                    (e) => e.entityId,
                    (e) => this.renderTile(e, dark, 'row'),
                  )}
                </div>`
            : nothing
        }
        ${
          outlets.length
            ? html`<h3 class="detail-head">${icon(mdiPowerPlug)}${t('outlets')}</h3>
                <div class="rows">
                  ${repeat(
                    outlets,
                    (e) => e.entityId,
                    (e) => this.renderTile(e, dark, 'row'),
                  )}
                </div>`
            : nothing
        }
      </div>`;
  }

  private renderTile(entity: DiscoveredEntity, dark: boolean, layout: 'tile' | 'chip' | 'row') {
    const view = this.viewOf(entity);
    if (!view) return nothing;
    const watts = readWatts(this.hass!, entity.sensors.power);
    return html`<lc-tile
      .hass=${this.hass}
      .entity=${entity}
      .view=${view}
      .layout=${layout}
      .outletStyle=${this.outletStyle}
      .iconStyle=${this._config!.icon_style}
      .fixture=${entity.kind === 'light' ? fixtureKind(entity.fullName) : 'ceiling'}
      .powerText=${watts !== null ? formatWatts(watts, this.language) : undefined}
      ?drawing=${watts !== null && watts > 0.5}
      ?dark=${dark}
    ></lc-tile>`;
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

  private renderEmpty(discovery: Discovery) {
    if (discovery.rooms.length) return nothing;
    return html`<div class="empty">
      <strong>${t('no_entities')}</strong>
      <span>${t('no_entities_hint')}</span>
    </div>`;
  }

  private sceneName(sceneId: string, roomName: string): string {
    const name = this.hass!.states[sceneId]?.attributes.friendly_name ?? sceneId;
    return name.toLowerCase().startsWith(roomName.toLowerCase()) && name.length > roomName.length
      ? name.slice(roomName.length).replace(/^[\s\-_:·]+/, '')
      : name;
  }

  private resolveSheet(groups: FloorGroup[]): SheetTarget | null {
    const ref = this._sheet;
    if (!ref) return null;
    if (ref.type === 'scope') {
      const scope = validScope(groups, ref.scope);
      const rooms = roomsIn(groups, scope);
      if (!rooms.length) return null;
      if (scope.kind === 'room') {
        const group = groupOf(groups, scope.id);
        return {
          type: 'scope',
          key: `room:${scope.id}`,
          eyebrow: group && group.kind !== 'other' ? group.name : t('room_controls'),
          title: rooms[0].name,
          rooms,
          scenes: rooms[0].scenes,
        };
      }
      const group = scope.kind === 'floor' ? groups.find((g) => g.id === scope.id) : undefined;
      return {
        type: 'scope',
        key: scope.kind === 'floor' ? `floor:${scope.id}` : 'home',
        eyebrow: group ? t('floor_controls') : t('home_controls'),
        title: group?.name || this._config!.title || t('home'),
        rooms,
        scenes: [],
      };
    }
    for (const room of groups.flatMap((g) => g.rooms)) {
      const entity = room.entities.find((e) => e.entityId === ref.entityId);
      if (entity) return { type: 'entity', entity, roomName: room.name };
    }
    return null;
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  private setScope(scope: Scope): void {
    this._scope = scope;
    this._confirm = null;
  }

  /** Opens a room from the list, and brings the house (now showing that room) into view. */
  private openRoom(roomId: string): void {
    this.setScope({ kind: 'room', id: roomId });
    const target = this.renderRoot.querySelector('.hero') ?? this.renderRoot.querySelector('.panel');
    const rect = target?.getBoundingClientRect();
    if (rect && (rect.top < 0 || rect.top > window.innerHeight * 0.5)) {
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      target!.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    }
  }

  private onHouseSelect(groups: FloorGroup[], roomId: string): void {
    const scope = validScope(groups, this._scope);
    if (scope.kind === 'room' && scope.id === roomId) {
      const group = groupOf(groups, roomId);
      this.setScope(group && group.kind !== 'other' ? { kind: 'floor', id: group.id } : { kind: 'home' });
    } else this.setScope({ kind: 'room', id: roomId });
  }

  private onTileAction = (ev: CustomEvent<TileActionDetail>): void => {
    const { entityId, action } = ev.detail;
    const entity = this.discovery?.rooms.flatMap((r) => r.entities).find((e) => e.entityId === entityId);
    if (!entity) return;
    if (action === 'controls' || (action === 'tap' && this._config!.tap_action === 'controls')) {
      this._sheet = { type: 'entity', entityId };
    } else if (action === 'tap' && this._config!.tap_action === 'more-info') {
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
        --lc-holo: var(--lc-holo-rgb, 86, 204, 255);
        /* Every light switch that is on shares one warm color; the lights' own colors live in the house and the tiles. */
        --lc-on: var(--lc-on-rgb, 255, 190, 92);
      }
      ha-card {
        overflow: hidden;
        padding-bottom: 14px;
        isolation: isolate;
        container-type: inline-size;
      }

      /* ── Hero ── */
      .hero {
        position: relative;
        height: 340px;
        height: clamp(340px, 20cqi + 270px, 480px);
        overflow: hidden;
      }
      lc-house {
        position: absolute;
        inset: 0;
      }
      .hero::after {
        /* The scene fades into the card below it. */
        content: '';
        position: absolute;
        inset: auto 0 0 0;
        height: 36px;
        background: linear-gradient(to bottom, transparent, var(--lc-bg));
        opacity: 0.55;
        pointer-events: none;
      }
      .hero-head {
        position: absolute;
        inset: 0 0 auto 0;
        padding: 14px 16px 0;
        pointer-events: none;
      }
      .hero-head > * {
        width: fit-content;
        max-width: 100%;
      }
      .plain {
        padding: 16px 16px 4px;
      }
      .plain .hero-head {
        position: static;
        padding: 0 0 10px;
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
      .hero h1 {
        color: #fff;
        text-shadow: 0 1px 12px rgba(0, 0, 0, 0.5);
      }
      .hero .summary {
        color: rgba(235, 244, 255, 0.86);
        text-shadow: 0 1px 10px rgba(0, 0, 0, 0.5);
      }
      .hero.sky-day h1,
      .hero.sky-day .summary {
        color: #0e2340;
        text-shadow: 0 1px 10px rgba(255, 255, 255, 0.7);
      }

      /* ── Floor switcher ── */
      .tabs {
        display: flex;
        justify-content: center;
        padding: 10px 12px 0;
      }
      .tabs.over {
        position: absolute;
        z-index: 2;
        inset: auto 0 12px 0;
        padding: 0 10px;
        pointer-events: none;
      }
      .tab-track {
        display: flex;
        gap: 2px;
        max-width: 100%;
        padding: 4px;
        overflow-x: auto;
        scrollbar-width: none;
        border-radius: 999px;
        background: var(--lc-surface-2);
        pointer-events: auto;
      }
      .tab-track::-webkit-scrollbar {
        display: none;
      }
      /* On phones only the selected tab spells out its name; floors keep their numbered icons. */
      @container (max-width: 520px) {
        .tab:not(.active) .tab-label {
          display: none;
        }
        .tab:not(.active) {
          gap: 3px;
          padding: 0 8px;
        }
        .tab.active {
          gap: 5px;
          padding: 0 10px 0 8px;
        }
        .tab.active .tab-label {
          max-width: 118px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tabs.over {
          padding: 0 6px;
        }
        .tab-track {
          gap: 0;
        }
      }
      .over .tab-track {
        background: rgba(8, 16, 32, 0.55);
        box-shadow:
          inset 0 0 0 1px rgba(var(--lc-holo), 0.28),
          0 8px 30px rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(14px) saturate(1.3);
        -webkit-backdrop-filter: blur(14px) saturate(1.3);
      }
      .sky-day .over .tab-track {
        background: rgba(255, 255, 255, 0.66);
        box-shadow:
          inset 0 0 0 1px rgba(40, 130, 230, 0.22),
          0 8px 30px rgba(20, 40, 80, 0.16);
      }
      .tab {
        position: relative;
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        padding: 0 13px 0 10px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        color: var(--lc-text-2);
        white-space: nowrap;
        transition:
          background 0.25s ease,
          color 0.25s ease,
          box-shadow 0.25s ease;
        --mdc-icon-size: 18px;
      }
      .tab .mdi,
      .tab ha-icon {
        width: 18px;
        height: 18px;
        display: inline-flex;
      }
      .over .tab {
        color: rgba(225, 238, 255, 0.78);
      }
      .sky-day .over .tab {
        color: #3a4e6b;
      }
      .tab:hover {
        color: var(--lc-text);
      }
      .over .tab:hover {
        color: #fff;
      }
      .tab.active {
        background: var(--lc-text);
        color: var(--lc-bg);
      }
      .over .tab.active {
        background: rgba(var(--lc-holo), 0.22);
        color: #fff;
        box-shadow:
          inset 0 0 0 1px rgba(var(--lc-holo), 0.75),
          0 0 18px rgba(var(--lc-holo), 0.35);
      }
      .sky-day .over .tab.active {
        background: #fff;
        color: #0d3b78;
        box-shadow:
          inset 0 0 0 1px rgba(40, 130, 230, 0.55),
          0 2px 10px rgba(40, 130, 230, 0.25);
      }
      .pip {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        margin-left: 1px;
        background: rgb(var(--lc-c));
        box-shadow: 0 0 8px rgb(var(--lc-c));
      }

      /* ── Panel: lights and outlets for what is selected ── */
      .panel {
        padding: 14px 12px 0;
      }
      .room-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 2px 12px;
      }
      .room-bar-text {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .eyebrow {
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--lc-text-2);
      }
      h2 {
        margin: 0;
        font-size: 20px;
        line-height: 25px;
        font-weight: 700;
        color: var(--lc-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .round {
        flex: none;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--lc-surface-2);
        color: var(--lc-text);
        transition: background 0.2s ease;
      }
      .round:hover {
        background: var(--lc-surface-3);
      }
      .controls {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 10px;
      }
      @container (min-width: 560px) {
        .controls.pair {
          grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
        }
      }
      .control {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 12px 12px 12px;
        border-radius: 20px;
        background: var(--lc-surface);
        box-shadow: inset 0 0 0 1px var(--lc-border);
        transition:
          background 0.4s ease,
          box-shadow 0.4s ease;
      }
      .control.on {
        background: var(--lc-surface-2);
      }
      .control.confirming {
        box-shadow: inset 0 0 0 1.5px rgba(255, 170, 60, 0.85);
      }
      .control-top {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .control-title {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 11px;
        text-align: left;
        border-radius: 14px;
      }
      .badge {
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--lc-surface-2);
        color: var(--lc-text-2);
        transition:
          background 0.4s ease,
          color 0.4s ease,
          box-shadow 0.4s ease;
      }
      .badge .mdi {
        width: 22px;
        height: 22px;
      }
      .lights.on .badge {
        background: rgba(var(--lc-c), 0.24);
        color: rgb(var(--lc-accent));
        box-shadow: 0 0 22px -4px rgba(var(--lc-c), 0.8);
      }
      .outlets.on .badge {
        background: rgba(var(--lc-outlet), 0.2);
        color: rgb(var(--lc-outlet));
      }
      .control-text {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .control-name {
        font-size: 15px;
        font-weight: 600;
        color: var(--lc-text);
      }
      .control-state {
        font-size: 13px;
        color: var(--lc-text-2);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tune {
        width: 18px;
        height: 18px;
        margin-left: auto;
        color: var(--lc-text-2);
        opacity: 0.6;
      }
      .control-title:hover .tune {
        opacity: 1;
      }
      .control-foot {
        min-height: 36px;
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding-left: 2px;
      }
      .inline-watts {
        display: none;
      }
      /* Stacked on a phone, the outlets keep to one line, with their power beside the count. */
      @container (max-width: 559px) {
        .control-foot:not(.confirming) {
          display: none;
        }
        .control-foot {
          min-height: 0;
        }
        .inline-watts {
          display: inline;
        }
      }
      .watts {
        font-size: 26px;
        line-height: 30px;
        font-weight: 700;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
        color: var(--lc-text);
      }
      .outlets.on .watts {
        color: rgb(var(--lc-outlet));
      }
      .confirm {
        font-size: 13.5px;
        font-weight: 600;
        line-height: 18px;
        color: rgb(255, 170, 60);
      }
      .switch {
        position: relative;
        flex: none;
        width: 52px;
        height: 32px;
        border-radius: 16px;
        background: rgba(var(--lc-rgb-text), 0.18);
        transition:
          background 0.3s ease,
          box-shadow 0.3s ease;
      }
      .switch .knob {
        position: absolute;
        top: 3px;
        left: 3px;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        transition: transform 0.28s cubic-bezier(0.3, 0.7, 0.4, 1.3);
      }
      .switch.on .knob {
        transform: translateX(20px);
      }
      .lights .switch.on {
        background: rgb(var(--lc-on));
        box-shadow: 0 4px 16px -4px rgba(var(--lc-on), 0.8);
      }
      .outlets .switch.on {
        background: rgb(var(--lc-outlet));
      }
      .switch.warning,
      .outlets .switch.warning {
        background: rgb(255, 170, 60);
        animation: nudge 0.5s ease;
      }
      lc-slider {
        --lc-slider-height: 38px;
      }

      /* ── Rooms ── */
      .rooms-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 18px 16px 2px;
      }
      .rooms-title {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--lc-text-2);
      }
      .filter {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 30px;
        padding: 0 12px;
        border-radius: 15px;
        background: var(--lc-surface-2);
        color: var(--lc-text-2);
        font-size: 12.5px;
        font-weight: 600;
        white-space: nowrap;
      }
      .filter.active {
        background: var(--lc-text);
        color: var(--lc-bg);
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: rgba(var(--lc-rgb-text), 0.25);
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
        padding: 6px 12px 0;
      }
      .floor + .floor {
        margin-top: 10px;
      }
      .floor-head {
        padding: 8px 4px 8px;
      }
      .floor-title {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 4px 4px;
        border-radius: 12px;
        text-align: left;
        color: var(--lc-text);
        --mdc-icon-size: 20px;
      }
      .floor-title ha-icon {
        color: var(--lc-text-2);
        display: inline-flex;
      }
      .floor-title:disabled {
        cursor: default;
      }
      .floor-text {
        min-width: 0;
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        column-gap: 10px;
      }
      .floor-name {
        font-size: 16px;
        font-weight: 700;
      }
      .floor-sub {
        font-size: 12.5px;
        color: var(--lc-text-2);
        font-variant-numeric: tabular-nums;
      }
      .floor-sub.lit::before {
        content: '';
        display: inline-block;
        width: 6px;
        height: 6px;
        margin: 0 6px 1px 2px;
        border-radius: 50%;
        background: rgb(var(--lc-c));
        box-shadow: 0 0 7px rgb(var(--lc-c));
      }
      .chevron {
        width: 20px;
        height: 20px;
        margin-left: auto;
        color: var(--lc-text-2);
        opacity: 0.7;
      }
      .columns {
        display: flex;
        align-items: flex-start;
        gap: 12px;
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
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px 10px 12px;
        border-radius: 22px;
        background: var(--lc-surface);
        box-shadow: inset 0 0 0 1px var(--lc-border);
        isolation: isolate;
        overflow: hidden;
      }
      .room::before {
        /* A thread of the room's light along its top edge. */
        content: '';
        position: absolute;
        inset: 0 22px auto;
        height: 1px;
        background: linear-gradient(
          90deg,
          rgba(var(--lc-c), 0),
          rgba(var(--lc-c), calc(var(--glow) * 0.9)),
          rgba(var(--lc-c), 0)
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
      }
      .room-title {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 2px;
        border-radius: 14px;
        text-align: left;
      }
      .room-icon {
        flex: none;
        width: 38px;
        height: 38px;
        border-radius: 13px;
        display: grid;
        place-items: center;
        background: var(--lc-surface-2);
        color: var(--lc-text-2);
        --mdc-icon-size: 21px;
        transition:
          background 0.5s ease,
          color 0.5s ease,
          box-shadow 0.5s ease;
      }
      .lit .room-icon,
      .room-bar.lit .room-icon {
        background: rgba(var(--lc-c), 0.22);
        color: rgb(var(--lc-accent));
        box-shadow: 0 6px 18px -8px rgba(var(--lc-c), 0.9);
      }
      .room-text {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .room-name {
        font-size: 15.5px;
        line-height: 20px;
        font-weight: 600;
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
      .quick {
        flex: none;
        display: flex;
        gap: 6px;
      }
      .quick-toggle {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--lc-surface-2);
        color: var(--lc-text-2);
        transition:
          background 0.3s ease,
          color 0.3s ease,
          box-shadow 0.3s ease,
          transform 0.15s ease;
      }
      .quick-toggle .mdi {
        width: 19px;
        height: 19px;
      }
      .quick-toggle:active {
        transform: scale(0.92);
      }
      .quick-toggle.light.on {
        background: rgb(var(--lc-on));
        color: rgba(40, 24, 0, 0.8);
        box-shadow: 0 4px 16px -4px rgba(var(--lc-on), 0.8);
      }
      .quick-toggle.outlet.on {
        background: rgb(var(--lc-outlet));
        color: rgba(0, 0, 0, 0.7);
      }
      .quick-toggle.warning {
        background: rgb(255, 170, 60);
        color: rgba(0, 0, 0, 0.75);
        animation: nudge 0.5s ease;
      }
      .confirm-hint {
        margin: -2px 2px 0;
        padding: 7px 10px;
        border-radius: 12px;
        background: rgba(255, 170, 60, 0.14);
        color: rgb(255, 170, 60);
        font-size: 12.5px;
        font-weight: 600;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 8px;
      }
      .grid > :only-child {
        grid-column: 1 / -1;
      }
      @container (max-width: 440px) {
        .grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .rooms {
          padding: 4px 8px 0;
        }
        .panel {
          padding: 12px 8px 0;
        }
      }
      .outlet-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .outlet-row > lc-tile {
        flex: 1 1 150px;
        min-width: 0;
      }
      .scenes {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .scene {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        padding: 0 11px 0 8px;
        border-radius: 14px;
        background: transparent;
        box-shadow: inset 0 0 0 1px var(--lc-border-strong);
        font-size: 12.5px;
        font-weight: 600;
        color: var(--lc-text);
        white-space: nowrap;
        transition: background 0.2s ease;
      }
      .scene:hover {
        background: var(--lc-surface-2);
      }
      .scene .mdi {
        width: 14px;
        height: 14px;
        color: rgb(var(--lc-accent));
      }
      .scene:active {
        transform: scale(0.96);
      }
      .detail-scenes {
        padding: 14px 2px 0;
      }
      .detail {
        padding: 6px 0 0;
      }
      .detail-head {
        display: flex;
        align-items: center;
        gap: 7px;
        margin: 14px 4px 8px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--lc-text-2);
      }
      .detail-head .mdi {
        width: 16px;
        height: 16px;
      }
      .rows {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr));
        gap: 8px;
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
      @keyframes nudge {
        20% {
          transform: translateX(-3px);
        }
        40% {
          transform: translateX(3px);
        }
        60% {
          transform: translateX(-2px);
        }
        80% {
          transform: translateX(1px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .room::before,
        .switch,
        .switch .knob,
        .quick-toggle {
          transition: none;
          animation: none;
        }
      }
    `,
  ];
}
