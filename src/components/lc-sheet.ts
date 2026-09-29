import { LitElement, css, html, nothing, svg, type PropertyValues } from 'lit';
import { formatWatts, readWatts, summarizeRooms, type Summary } from '../aggregate.ts';
import {
  HUE_PRESETS,
  KELVIN_PRESETS,
  accentFor,
  hsToRgb,
  kelvinPresetKey,
  kelvinToDisplayRgb,
  kelvinToRgb,
  rgbTriplet,
  type RGB,
} from '../color.ts';
import type { LightController } from '../controller.ts';
import type { DiscoveredEntity, Room } from '../discovery.ts';
import type { EntityView } from '../entity-model.ts';
import { bulbArt, outletArt, type OutletStyle } from '../graphics.ts';
import type { HomeAssistant } from '../ha-types.ts';
import {
  icon,
  mdiClose,
  mdiCreation,
  mdiLightbulbOffOutline,
  mdiLightbulbOnOutline,
  mdiOpenInNew,
  mdiPalette,
  mdiPlay,
  mdiPower,
  mdiPowerPlug,
  mdiWhiteBalanceSunny,
} from '../icons.ts';
import { t } from '../localize.ts';
import { artStyles, buttonReset, themeVars } from '../styles.ts';
import { fireEvent, formatNumber, haptic } from '../utils.ts';
import type { SlideDetail } from './lc-pill.ts';
import './lc-pill.ts';
import type { PickDetail } from './lc-wheel.ts';
import './lc-wheel.ts';

export type SheetTarget =
  | { type: 'entity'; entity: DiscoveredEntity; roomName?: string }
  | {
      /** A room, a floor or the whole home. */
      type: 'scope';
      key: string;
      eyebrow: string;
      title: string;
      rooms: Room[];
      scenes: string[];
    };

type Tab = 'color' | 'white';

interface Preview {
  brightness?: number;
  rgb?: RGB;
}

interface HistoryPoint {
  t: number;
  v: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Everything below the brightness and color stage; it moves beside the stage on short, wide screens. */
function side(...parts: unknown[]) {
  return html`<div class="side">${parts}</div>`;
}

/** Everything a light, plug or whole room can do, in one sheet. */
export class LcSheet extends LitElement {
  static override properties = {
    hass: { attribute: false },
    controller: { attribute: false },
    target: { attribute: false },
    outletStyle: { attribute: false },
    liveBrightness: { type: Boolean },
    dark: { type: Boolean, reflect: true },
    _tab: { state: true },
    _preview: { state: true },
    _history: { state: true },
    _confirmOff: { state: true },
    _dragY: { state: true },
  };

  declare hass: HomeAssistant;
  declare controller: LightController;
  declare target: SheetTarget | null;
  declare outletStyle: OutletStyle;
  declare liveBrightness: boolean;
  declare dark: boolean;
  declare _tab: Tab;
  declare _preview: Preview;
  declare _history?: HistoryPoint[];
  /** "All off" for several outlets is waiting for its second tap. */
  declare _confirmOff: boolean;
  declare _dragY: number;

  private swipe?: { pointerId: number; y: number };
  private historyFor?: string;
  /** The target the dialog was opened for; re-renders while it closes must not reopen it. */
  private openedFor?: string;
  private pressedBackdrop = false;

  constructor() {
    super();
    this.target = null;
    this.liveBrightness = false;
    this.dark = false;
    this._tab = 'color';
    this._preview = {};
    this._dragY = 0;
    this._confirmOff = false;
  }

  private get dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector('dialog');
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('target') && this.target) {
      const previous = changed.get('target') as SheetTarget | null | undefined;
      if (!previous || targetKey(previous) !== targetKey(this.target)) this.resetFor(this.target);
    }
  }

  protected override updated(): void {
    const dialog = this.dialog;
    if (!dialog) return;
    const key = this.target ? targetKey(this.target) : undefined;
    if (!key) {
      this.openedFor = undefined;
      if (dialog.open) dialog.close();
      return;
    }
    // Open once per target. After the user closes it, the card clears `target`; until then,
    // re-renders (a hass update, the swipe resetting) must not show it again.
    if (key !== this.openedFor) {
      this.openedFor = key;
      if (!dialog.open) {
        dialog.showModal();
        haptic('light');
      }
    }
  }

  close(): void {
    this.dialog?.close();
  }

  private confirmTimer?: ReturnType<typeof setTimeout>;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.confirmTimer);
    this._confirmOff = false;
  }

  private resetFor(target: SheetTarget): void {
    clearTimeout(this.confirmTimer);
    this._confirmOff = false;
    this._preview = {};
    this._dragY = 0;
    this._history = undefined;
    const view = target.type === 'entity' ? this.viewOf(target.entity) : undefined;
    const summary = target.type === 'scope' ? this.scopeSummary(target.rooms) : undefined;
    const supportsColor = view?.supportsColor ?? summary?.supportsColor ?? false;
    const supportsTemp = view?.supportsTemp ?? summary?.supportsTemp ?? false;
    this._tab = supportsColor && !(supportsTemp && view?.colorMode === 'color_temp') ? 'color' : 'white';
    if (target.type === 'entity' && target.entity.sensors.power) this.loadHistory(target.entity.sensors.power);
  }

  private viewOf(entity: DiscoveredEntity): EntityView | undefined {
    return this.controller?.view(entity.entityId, entity.kind);
  }

  private scopeSummary(rooms: Room[]): Summary {
    return summarizeRooms(rooms, (e) => this.viewOf(e), this.hass);
  }

  protected override render() {
    return html`<dialog
      @close=${this.onClose}
      @pointerdown=${this.onDialogPointerDown}
      @click=${this.onDialogClick}
      aria-label=${this.target ? this.titleFor(this.target) : ''}
    >
      ${this.target ? this.renderSheet(this.target) : nothing}
    </dialog>`;
  }

  private titleFor(target: SheetTarget): string {
    return target.type === 'scope' ? target.title : target.entity.fullName;
  }

  private renderSheet(target: SheetTarget) {
    if (target.type === 'scope') return this.renderScope(target);
    const view = this.viewOf(target.entity);
    if (!view) return nothing;
    return target.entity.kind === 'light'
      ? this.renderLight(target.entity, view, target.roomName)
      : this.renderPlug(target.entity, view, target.roomName);
  }

  private frame(opts: {
    eyebrow?: string;
    title: string;
    status: string;
    rgb: RGB;
    glow: number;
    moreInfo?: string;
    body: unknown;
    kind: string;
  }) {
    const accent = accentFor(opts.rgb, this.dark);
    return html`<div
      class="sheet ${opts.kind}"
      style="--lc-c:${rgbTriplet(opts.rgb)};--lc-accent:${rgbTriplet(accent)};--glow:${opts.glow.toFixed(2)};transform:translateY(${this._dragY}px)"
    >
      <div
        class="grab"
        @pointerdown=${this.onSwipeStart}
        @pointermove=${this.onSwipeMove}
        @pointerup=${this.onSwipeEnd}
        @pointercancel=${this.onSwipeEnd}
      >
        <span></span>
      </div>
      <header>
        <div class="titles">
          ${opts.eyebrow ? html`<div class="eyebrow">${opts.eyebrow}</div>` : nothing}
          <h2>${opts.title}</h2>
          <div class="status">${opts.status}</div>
        </div>
        ${
          opts.moreInfo
            ? html`<button
                class="round"
                title=${t('details')}
                aria-label=${t('details')}
                @click=${() => this.openMoreInfo(opts.moreInfo!)}
              >
                ${icon(mdiOpenInNew)}
              </button>`
            : nothing
        }
        <button class="round" aria-label=${t('close')} @click=${() => this.close()}>${icon(mdiClose)}</button>
      </header>
      <div class="body">${opts.body}</div>
    </div>`;
  }

  // ─── Lights ────────────────────────────────────────────────────────────────

  private renderLight(entity: DiscoveredEntity, view: EntityView, roomName?: string) {
    const brightness = this._preview.brightness ?? view.brightness;
    const on = this._preview.brightness !== undefined ? brightness > 0 : view.on;
    const rgb = this._preview.rgb ?? view.rgb;
    const hasPicker = view.supportsColor || view.supportsTemp;
    const ids = [entity.entityId];

    let status: string;
    if (view.unavailable) status = t('unavailable');
    else if (!on) status = t('off');
    else {
      const parts = [view.dimmable ? `${brightness}%` : t('on')];
      if (view.colorMode === 'color_temp' && view.kelvin) parts.push(t(kelvinPresetKey(view.kelvin)));
      if (view.effect && view.effect.toLowerCase() !== 'none') parts.push(view.effect);
      status = parts.join(' · ');
    }

    const stage = view.dimmable
      ? html`<div class="stage ${hasPicker ? '' : 'solo'}">
          <div class="pill-col">
            <lc-pill
              .value=${on ? brightness : 0}
              ?disabled=${view.unavailable}
              @lc-slide=${(ev: CustomEvent<SlideDetail>) => this.onSlide(ev, ids)}
            ></lc-pill>
            ${this.powerButton(on, view.unavailable, () => this.controller.toggle(entity.entityId, 'light'))}
          </div>
          ${hasPicker ? this.renderPicker(view, ids) : html`<div class="hero-bulb ${on ? 'is-on' : ''}">${bulbArt(on, brightness, view.isGroup, 'lc-hero')}</div>`}
        </div>`
      : html`<div class="stage solo">
          <button
            class="big-toggle ${on ? 'is-on' : ''}"
            ?disabled=${view.unavailable}
            aria-pressed=${on ? 'true' : 'false'}
            aria-label=${on ? t('turn_off') : t('turn_on')}
            @click=${() => this.controller.toggle(entity.entityId, 'light')}
          >
            ${bulbArt(on, 100, view.isGroup, 'lc-hero')}
          </button>
        </div>`;

    return this.frame({
      kind: 'light',
      eyebrow: roomName,
      title: entity.name,
      status,
      rgb,
      glow: on ? 0.3 + (brightness / 100) * 0.7 : 0,
      moreInfo: entity.entityId,
      body: html`${stage}${side(hasPicker ? this.renderPresets(view, ids) : nothing, this.renderEffects(entity, view))}`,
    });
  }

  private powerButton(on: boolean, disabled: boolean, action: () => void) {
    return html`<button
      class="power ${on ? 'is-on' : ''}"
      ?disabled=${disabled}
      aria-pressed=${on ? 'true' : 'false'}
      aria-label=${on ? t('turn_off') : t('turn_on')}
      @click=${action}
    >
      ${icon(mdiPower)}
    </button>`;
  }

  private renderPicker(
    view: Pick<
      EntityView,
      'supportsColor' | 'supportsTemp' | 'hs' | 'kelvin' | 'minKelvin' | 'maxKelvin' | 'colorMode' | 'unavailable'
    >,
    ids: string[],
    kelvinIds = ids,
  ) {
    const tab: Tab = view.supportsColor && view.supportsTemp ? this._tab : view.supportsColor ? 'color' : 'white';
    return html`<div class="picker">
      <lc-wheel
        .mode=${tab === 'color' ? 'hs' : 'temp'}
        .hs=${view.hs}
        .kelvin=${view.kelvin}
        .minKelvin=${view.minKelvin}
        .maxKelvin=${view.maxKelvin}
        .active=${tab === 'color' ? view.colorMode !== 'color_temp' : view.colorMode === 'color_temp'}
        ?disabled=${view.unavailable}
        @lc-pick=${(ev: CustomEvent<PickDetail>) => this.onPick(ev, ids, kelvinIds)}
      ></lc-wheel>
      ${
        view.supportsColor && view.supportsTemp
          ? html`<div class="tabs" role="tablist">
              ${this.tabButton('color', mdiPalette, t('color'))}
              ${this.tabButton('white', mdiWhiteBalanceSunny, t('white'))}
            </div>`
          : nothing
      }
    </div>`;
  }

  private tabButton(tab: Tab, path: string, label: string) {
    return html`<button
      role="tab"
      class="tab ${this._tab === tab ? 'active' : ''}"
      aria-selected=${this._tab === tab ? 'true' : 'false'}
      @click=${() => (this._tab = tab)}
    >
      ${icon(path)}<span>${label}</span>
    </button>`;
  }

  private renderPresets(
    view: Pick<EntityView, 'supportsColor' | 'supportsTemp' | 'minKelvin' | 'maxKelvin' | 'unavailable'>,
    ids: string[],
    kelvinIds = ids,
  ) {
    const tab: Tab = view.supportsColor && view.supportsTemp ? this._tab : view.supportsColor ? 'color' : 'white';
    const swatches =
      tab === 'white'
        ? KELVIN_PRESETS.filter((p) => p.kelvin >= view.minKelvin - 60 && p.kelvin <= view.maxKelvin + 60).map((p) => ({
            label: t(p.key),
            rgb: kelvinToDisplayRgb(p.kelvin),
            apply: () =>
              this.controller.setKelvin(kelvinIds, Math.min(view.maxKelvin, Math.max(view.minKelvin, p.kelvin))),
          }))
        : HUE_PRESETS.map((p) => ({
            label: t(p.key),
            rgb: hsToRgb(p.hs[0], p.hs[1]),
            apply: () => this.controller.setHs(ids, p.hs),
          }));
    return html`<div class="presets" role="group" aria-label=${tab === 'white' ? t('white') : t('color')}>
      ${swatches.map(
        (s) =>
          html`<button
            class="swatch"
            style="--s:${rgbTriplet(s.rgb)}"
            title=${s.label}
            aria-label=${s.label}
            ?disabled=${view.unavailable}
            @click=${() => {
              haptic('selection');
              s.apply();
            }}
          ></button>`,
      )}
    </div>`;
  }

  private renderEffects(entity: DiscoveredEntity, view: EntityView) {
    if (!view.effects.length) return nothing;
    return html`<label class="effects">
      ${icon(mdiCreation)}
      <span>${t('effect')}</span>
      <select
        ?disabled=${view.unavailable}
        @change=${(ev: Event) => this.controller.setEffect(entity.entityId, (ev.target as HTMLSelectElement).value)}
      >
        ${!view.effect ? html`<option value="" .selected=${true} disabled>${t('no_effect')}</option>` : nothing}
        ${view.effects.map(
          (effect) => html`<option .value=${effect} .selected=${effect === view.effect}>${effect}</option>`,
        )}
      </select>
    </label>`;
  }

  private onSlide(ev: CustomEvent<SlideDetail>, ids: string[]): void {
    const { value, final } = ev.detail;
    if (final) {
      this._preview = { ...this._preview, brightness: undefined };
      this.controller.setBrightness(ids, value);
    } else {
      this._preview = { ...this._preview, brightness: value };
      if (this.liveBrightness) this.controller.previewBrightness(ids, value);
    }
  }

  private onPick(ev: CustomEvent<PickDetail>, ids: string[], kelvinIds = ids): void {
    const { hs, kelvin, final } = ev.detail;
    if (final) {
      this._preview = { ...this._preview, rgb: undefined };
      if (hs) this.controller.setHs(ids, hs);
      else if (kelvin) this.controller.setKelvin(kelvinIds, kelvin);
      return;
    }
    this._preview = { ...this._preview, rgb: hs ? hsToRgb(hs[0], hs[1]) : kelvinToRgb(kelvin!) };
  }

  // ─── Plugs ─────────────────────────────────────────────────────────────────

  private renderPlug(entity: DiscoveredEntity, view: EntityView, roomName?: string) {
    const { sensors } = entity;
    const language = this.hass.locale?.language ?? this.hass.language;
    const watts = readWatts(this.hass, sensors.power);
    const drawing = view.on && watts !== null && watts > 0.5;
    const readings: [string, string | undefined][] = [
      [t('energy'), sensors.energy],
      [t('voltage'), sensors.voltage],
      [t('current'), sensors.current],
    ];
    let status = view.unavailable ? t('unavailable') : view.on ? t('on') : t('off');
    if (view.on && watts !== null) status += ` · ${drawing ? t('in_use') : t('idle')}`;

    return this.frame({
      kind: 'plug',
      eyebrow: roomName,
      title: entity.name,
      status,
      rgb: view.rgb,
      glow: 0,
      moreInfo: entity.entityId,
      body: html`
        <div class="stage solo">
          <button
            class="big-toggle plug ${view.on ? 'is-on' : ''}"
            ?disabled=${view.unavailable}
            aria-pressed=${view.on ? 'true' : 'false'}
            aria-label=${view.on ? t('turn_off') : t('turn_on')}
            @click=${() => this.controller.toggle(entity.entityId, entity.kind)}
          >
            ${outletArt(this.outletStyle, drawing)}
          </button>
        </div>
        ${side(
          watts !== null
            ? html`<div class="watts ${drawing ? 'live' : ''}">
                <span class="value">${formatWatts(watts, language)}</span>
                <span class="label">${t('power')}</span>
              </div>`
            : nothing,
          this.renderSparkline(),
          html`<div class="readings">
            ${readings
              .filter(([, id]) => id && this.hass.states[id])
              .map(([label, id]) => {
                const stateObj = this.hass.states[id!];
                const value = Number.parseFloat(stateObj.state);
                const text = Number.isFinite(value)
                  ? `${formatNumber(value, language, 2)} ${stateObj.attributes.unit_of_measurement ?? ''}`
                  : stateObj.state;
                return html`<div class="reading"><span>${label}</span><strong>${text}</strong></div>`;
              })}
          </div>`,
        )}
      `,
    });
  }

  private renderSparkline() {
    const points = this._history;
    if (!points || points.length < 2) return nothing;
    const end = Date.now();
    const start = end - DAY_MS;
    const max = Math.max(...points.map((p) => p.v), 1);
    const width = 300;
    const height = 64;
    const x = (time: number) => ((Math.max(start, time) - start) / DAY_MS) * width;
    const y = (v: number) => height - 4 - (v / max) * (height - 10);
    // Step line: power holds its value until the next reading.
    let d = `M${x(points[0].t).toFixed(1)} ${y(points[0].v).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      d += `H${x(points[i].t).toFixed(1)}V${y(points[i].v).toFixed(1)}`;
    }
    d += `H${width}`;
    const area = `${d}V${height}H${x(points[0].t).toFixed(1)}Z`;
    const language = this.hass.locale?.language ?? this.hass.language;
    return html`<figure class="spark">
      <figcaption><span>${t('last_24h')}</span><span>${formatWatts(max, language)}</span></figcaption>
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        ${svg`<path class="area" d=${area}></path><path class="line" d=${d}></path>`}
      </svg>
    </figure>`;
  }

  private async loadHistory(sensorId: string): Promise<void> {
    this.historyFor = sensorId;
    if (!this.hass?.callWS) return;
    const end = new Date();
    const start = new Date(end.getTime() - DAY_MS);
    try {
      const result = await this.hass.callWS<Record<string, { s: string; lu: number }[]>>({
        type: 'history/history_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [sensorId],
        minimal_response: true,
        no_attributes: true,
      });
      if (this.historyFor !== sensorId) return;
      this._history = (result[sensorId] ?? [])
        .map((row) => ({ t: row.lu * 1000, v: Number.parseFloat(row.s) }))
        .filter((p) => Number.isFinite(p.v));
    } catch {
      this._history = undefined;
    }
  }

  // ─── Rooms, floors and the whole home ───────────────────────────────────────

  private renderScope(target: Extract<SheetTarget, { type: 'scope' }>) {
    const summary = this.scopeSummary(target.rooms);
    const brightness = this._preview.brightness ?? summary.brightness;
    const on = this._preview.brightness !== undefined ? brightness > 0 : summary.lightsOn > 0;
    const rgb = this._preview.rgb ?? summary.rgb ?? [255, 196, 116];
    // Color and brightness go to the lights that are on; with none on, to all of them.
    const targets = summary.litIds.length ? summary.litIds : summary.countedIds;
    const views = target.rooms
      .flatMap((r) => r.entities)
      .filter((e) => targets.includes(e.entityId))
      .map((e) => this.viewOf(e))
      .filter((v): v is EntityView => Boolean(v));
    const lead = views.find((v) => v.on && (v.supportsColor || v.supportsTemp));
    const colorIds = views.filter((v) => v.supportsColor).map((v) => v.entityId);
    const tempIds = views.filter((v) => v.supportsColor || v.supportsTemp).map((v) => v.entityId);
    const pickerView = {
      supportsColor: summary.supportsColor,
      supportsTemp: summary.supportsTemp,
      hs: lead?.hs,
      kelvin: lead?.kelvin,
      minKelvin: summary.minKelvin,
      maxKelvin: summary.maxKelvin,
      colorMode: lead?.colorMode,
      unavailable: false,
    };
    const hasLights = summary.lightIds.length > 0;
    const hasPicker = summary.supportsColor || summary.supportsTemp;
    const status = !hasLights
      ? summary.plugsOn
        ? t('plugs_on', { n: summary.plugsOn })
        : t('everything_off')
      : summary.lightsOn
        ? summary.lightsOn === summary.lights
          ? t('room_all_on')
          : t('room_on', { n: summary.lightsOn, total: summary.lights })
        : t('lights_off');
    const outlets = target.rooms.flatMap((r) => r.entities.filter((e) => e.kind !== 'light'));
    // Undo toasts name a room or a floor ("Turned off Kitchen"); the whole home counts instead.
    const toastName = target.key === 'home' ? undefined : target.title;

    return this.frame({
      kind: 'room',
      eyebrow: target.eyebrow,
      title: target.title,
      status,
      rgb,
      glow: on ? 0.3 + (brightness / 100) * 0.7 : 0,
      body: html`
        ${
          hasLights && summary.dimmable
            ? html`<div class="stage ${hasPicker ? '' : 'solo'}">
                <div class="pill-col">
                  <lc-pill
                    .value=${on ? brightness : 0}
                    @lc-slide=${(ev: CustomEvent<SlideDetail>) => this.onScopeSlide(ev, summary, toastName)}
                  ></lc-pill>
                  ${this.powerButton(on, false, () =>
                    on
                      ? this.controller.turnOffWithUndo(summary.lightIds, toastName)
                      : this.controller.setPower(summary.countedIds, true),
                  )}
                </div>
                ${hasPicker ? this.renderPicker(pickerView, colorIds.length ? colorIds : tempIds, tempIds) : nothing}
              </div>`
            : nothing
        }
        ${side(
          hasPicker && hasLights ? this.renderPresets(pickerView, colorIds, tempIds) : nothing,
          hasLights
            ? html`<div class="room-actions">
                <button class="pill-button" @click=${() => this.controller.setPower(summary.countedIds, true)}>
                  ${icon(mdiLightbulbOnOutline)}<span>${t('all_on')}</span>
                </button>
                <button
                  class="pill-button"
                  @click=${() => this.controller.turnOffWithUndo(summary.lightIds, toastName)}
                >
                  ${icon(mdiLightbulbOffOutline)}<span>${t('all_off')}</span>
                </button>
              </div>`
            : nothing,
          target.scenes.length
            ? html`<div class="section-label">${t('scenes')}</div>
                <div class="scenes">
                  ${target.scenes.map(
                    (id) =>
                      html`<button class="scene" @click=${() => this.controller.activateScene(id)}>
                        ${icon(mdiPlay)}<span>${this.sceneName(id, target.title)}</span>
                      </button>`,
                  )}
                </div>`
            : nothing,
          outlets.length ? this.renderOutletList(outlets, summary, toastName) : nothing,
        )}
      `,
    });
  }

  private onScopeSlide(ev: CustomEvent<SlideDetail>, summary: Summary, name?: string): void {
    const { value, final } = ev.detail;
    if (final) {
      this._preview = { ...this._preview, brightness: undefined };
      this.controller.adjustBrightness(summary, value, name);
    } else {
      this._preview = { ...this._preview, brightness: value };
      if (this.liveBrightness) this.controller.previewAdjust(summary, value);
    }
  }

  /** Outlets have their own section: turning the lights off never cuts their power. */
  private renderOutletList(outlets: DiscoveredEntity[], summary: Summary, name?: string) {
    const language = this.hass.locale?.language ?? this.hass.language;
    const parts = [summary.plugsOn ? t('outlets_on', { n: summary.plugsOn, total: summary.plugs }) : t('off')];
    if (summary.watts !== null && summary.watts > 0) parts.push(formatWatts(summary.watts, language));
    return html`<div class="section-label outlets-label">
        <span>${t('outlets')}</span><span class="section-meta">${parts.join(' · ')}</span>
      </div>
      <div class="outlet-list">
        ${outlets.map((entity) => {
          const view = this.viewOf(entity);
          if (!view) return nothing;
          const watts = readWatts(this.hass, entity.sensors.power);
          return html`<div class="outlet-item ${view.on ? 'is-on' : ''}">
            <span class="outlet-icon">${icon(mdiPowerPlug)}</span>
            <span class="outlet-name">${entity.name}</span>
            ${watts !== null && view.on ? html`<span class="outlet-watts">${formatWatts(watts, language)}</span>` : nothing}
            <button
              class="mini-switch ${view.on ? 'on' : ''}"
              role="switch"
              aria-checked=${view.on ? 'true' : 'false'}
              aria-label=${entity.fullName}
              ?disabled=${view.unavailable}
              @click=${() => this.controller.toggle(entity.entityId, entity.kind)}
            >
              <span class="knob"></span>
            </button>
          </div>`;
        })}
      </div>
      ${
        outlets.length > 1
          ? html`<div class="room-actions">
              <button class="pill-button" @click=${() => this.controller.setPower(summary.plugIds, true)}>
                ${icon(mdiPowerPlug)}<span>${t('all_on')}</span>
              </button>
              <button
                class="pill-button ${this._confirmOff ? 'warning' : ''}"
                aria-live="polite"
                ?disabled=${!summary.plugsOn}
                @click=${() => this.onOutletsOff(summary, name)}
              >
                ${icon(mdiPower)}<span
                  >${this._confirmOff ? t('outlets_off_confirm', { n: summary.plugsOn }) : t('all_off')}</span
                >
              </button>
            </div>`
          : nothing
      }`;
  }

  /** Like the card's outlet switches: turning several off takes a second tap. */
  private onOutletsOff(summary: Summary, name?: string): void {
    clearTimeout(this.confirmTimer);
    if (summary.plugsOn > 1 && !this._confirmOff) {
      this._confirmOff = true;
      this.confirmTimer = setTimeout(() => (this._confirmOff = false), 4000);
      return;
    }
    this._confirmOff = false;
    this.controller.turnOffWithUndo(summary.plugIds, summary.plugsOn > 1 ? name : undefined, 'outlets');
  }

  private sceneName(sceneId: string, roomName: string): string {
    const name = this.hass.states[sceneId]?.attributes.friendly_name ?? sceneId;
    const lower = roomName.toLowerCase();
    return name.toLowerCase().startsWith(lower) && name.length > roomName.length
      ? name.slice(roomName.length).replace(/^[\s\-_:·]+/, '')
      : name;
  }

  // ─── Dialog plumbing ───────────────────────────────────────────────────────

  private openMoreInfo(entityId: string): void {
    this.close();
    this.controller.moreInfo(entityId);
  }

  private onClose = (): void => {
    this._dragY = 0;
    fireEvent(this, 'lc-sheet-closed');
  };

  private onDialogPointerDown = (ev: PointerEvent): void => {
    this.pressedBackdrop = ev.target === this.dialog;
  };

  private onDialogClick = (ev: MouseEvent): void => {
    // Backdrop clicks land on the <dialog> itself. Only close when the press started there too,
    // so a drag that ends outside the sheet (a slider, a text selection) doesn't dismiss it.
    if (ev.target === this.dialog && this.pressedBackdrop) this.close();
    this.pressedBackdrop = false;
  };

  private onSwipeStart = (ev: PointerEvent): void => {
    this.swipe = { pointerId: ev.pointerId, y: ev.clientY };
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  };

  private onSwipeMove = (ev: PointerEvent): void => {
    if (this.swipe?.pointerId !== ev.pointerId) return;
    this._dragY = Math.max(0, ev.clientY - this.swipe.y);
  };

  private onSwipeEnd = (ev: PointerEvent): void => {
    if (this.swipe?.pointerId !== ev.pointerId) return;
    this.swipe = undefined;
    if (this._dragY > 90) this.close();
    else this._dragY = 0;
  };

  static override styles = [
    themeVars,
    artStyles,
    buttonReset,
    css`
      dialog {
        padding: 0;
        border: none;
        background: transparent;
        color: var(--lc-text);
        max-width: 100vw;
        max-height: 100dvh;
        width: 100%;
        margin: auto 0 0 0;
        overflow: visible;
        font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, inherit));
      }
      dialog::backdrop {
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
        animation: fade 0.25s ease;
      }
      .sheet {
        --sheet-bg: var(--ha-dialog-surface-background, var(--mdc-theme-surface, var(--lc-bg)));
        position: relative;
        box-sizing: border-box;
        max-height: 92dvh;
        overflow: auto;
        overscroll-behavior: contain;
        padding: 0 20px calc(22px + env(safe-area-inset-bottom));
        border-radius: 26px 26px 0 0;
        background:
          radial-gradient(140% 55% at 50% -12%, rgba(var(--lc-c), calc(var(--glow) * 0.34)), rgba(var(--lc-c), 0) 70%),
          var(--sheet-bg);
        box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.3);
        animation: slide-up 0.34s cubic-bezier(0.2, 0.85, 0.25, 1);
        transition: background 0.5s ease;
      }
      @media (min-width: 640px) {
        dialog {
          width: 460px;
          margin: auto;
        }
        .sheet {
          border-radius: 28px;
          animation: pop-in 0.26s cubic-bezier(0.2, 0.85, 0.25, 1);
          padding-bottom: 24px;
        }
        .grab span {
          display: none;
        }
      }
      .grab {
        display: flex;
        justify-content: center;
        padding: 10px 0 4px;
        touch-action: none;
        cursor: grab;
      }
      .grab span {
        width: 40px;
        height: 5px;
        border-radius: 3px;
        background: rgba(var(--lc-rgb-text), 0.2);
      }
      header {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 6px 0 14px;
      }
      .titles {
        flex: 1;
        min-width: 0;
      }
      .eyebrow {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--lc-text-2);
      }
      h2 {
        margin: 2px 0 2px;
        font-size: 24px;
        line-height: 30px;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .status {
        font-size: 15px;
        color: var(--lc-text-2);
        font-variant-numeric: tabular-nums;
      }
      .round {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--lc-surface-2);
        color: var(--lc-text-2);
        flex: none;
      }
      .round:hover {
        background: rgba(var(--lc-rgb-text), 0.14);
      }
      .body,
      .side {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .side:empty {
        display: none;
      }
      .stage {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        min-height: 250px;
      }
      .stage.solo {
        justify-content: center;
        gap: 34px;
      }
      .pill-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
      }
      lc-pill {
        width: 96px;
        height: 236px;
      }
      .power {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--lc-surface-2);
        color: var(--lc-text-2);
        transition:
          background 0.3s ease,
          color 0.3s ease,
          box-shadow 0.3s ease;
      }
      .power .mdi {
        width: 26px;
        height: 26px;
      }
      .power.is-on {
        background: rgb(var(--lc-c));
        color: rgba(0, 0, 0, 0.72);
        box-shadow: 0 6px 22px -6px rgba(var(--lc-c), 0.9);
      }
      .power:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .picker {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
      }
      lc-wheel {
        width: min(100%, 230px);
      }
      .tabs {
        display: inline-flex;
        padding: 3px;
        border-radius: 14px;
        background: var(--lc-surface-2);
      }
      .tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 13px;
        border-radius: 11px;
        font-size: 13px;
        font-weight: 600;
        color: var(--lc-text-2);
      }
      .tab .mdi {
        width: 17px;
        height: 17px;
      }
      .tab.active {
        background: var(--sheet-bg);
        color: var(--lc-text);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
      }
      /* One row on any phone: the swatches shrink a little rather than leave one on a line of its own. */
      .presets {
        display: flex;
        justify-content: center;
        align-items: center;
        column-gap: clamp(6px, 3%, 12px);
      }
      .swatch {
        flex: 0 1 36px;
        min-width: 0;
        aspect-ratio: 1;
        border-radius: 50%;
        background: rgb(var(--s));
        box-shadow:
          inset 0 0 0 1px rgba(0, 0, 0, 0.12),
          0 4px 14px -4px rgba(var(--s), 0.9);
        transition: transform 0.15s ease;
      }
      .swatch:hover {
        transform: scale(1.1);
      }
      .swatch:active {
        transform: scale(0.92);
      }
      .swatch:disabled {
        opacity: 0.4;
      }
      .effects {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 16px;
        background: var(--lc-surface);
        font-size: 14px;
        font-weight: 600;
      }
      .effects span {
        flex: 1;
      }
      .effects select {
        font: inherit;
        font-weight: 500;
        max-width: 60%;
        padding: 6px 10px;
        border-radius: 10px;
        border: 1px solid rgba(var(--lc-rgb-text), 0.15);
        background: var(--sheet-bg);
        color: var(--lc-text);
      }
      .hero-bulb,
      .big-toggle {
        width: 150px;
        height: 150px;
        display: grid;
        place-items: center;
      }
      .hero-bulb .art,
      .big-toggle .art {
        width: 120px;
        height: 120px;
        transition: filter 0.4s ease;
      }
      .hero-bulb.is-on .art,
      .big-toggle.is-on .bulb {
        filter: drop-shadow(0 0 calc(6px + var(--glow) * 22px) rgba(var(--lc-c), 0.85));
      }
      .big-toggle {
        border-radius: 40px;
        background: var(--lc-surface);
        transition:
          transform 0.15s ease,
          background 0.3s ease;
      }
      .big-toggle:active {
        transform: scale(0.96);
      }
      .big-toggle:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .big-toggle.plug.is-on {
        background: rgba(var(--lc-outlet), 0.12);
        box-shadow: 0 16px 40px -18px rgba(var(--lc-outlet), 0.9);
      }
      .big-toggle.plug .art {
        width: 104px;
        height: 104px;
      }
      .stage.solo:has(.big-toggle) {
        min-height: 190px;
      }
      .watts {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }
      .watts .value {
        font-size: 34px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
      }
      .watts.live .value {
        color: rgb(var(--lc-outlet));
      }
      .watts .label {
        font-size: 13px;
        color: var(--lc-text-2);
      }
      .spark {
        margin: 0;
        padding: 12px 14px 8px;
        border-radius: 16px;
        background: var(--lc-surface);
      }
      .spark figcaption {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: var(--lc-text-2);
        margin-bottom: 6px;
      }
      .spark svg {
        display: block;
        width: 100%;
        height: 64px;
      }
      .spark .line {
        fill: none;
        stroke: rgb(var(--lc-outlet));
        stroke-width: 2;
        vector-effect: non-scaling-stroke;
        stroke-linejoin: round;
      }
      .spark .area {
        fill: rgba(var(--lc-outlet), 0.16);
      }
      .readings {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
        gap: 10px;
      }
      .readings:empty {
        display: none;
      }
      .reading {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 10px 14px;
        border-radius: 16px;
        background: var(--lc-surface);
      }
      .reading span {
        font-size: 12px;
        color: var(--lc-text-2);
      }
      .reading strong {
        font-size: 16px;
        font-variant-numeric: tabular-nums;
      }
      .section-label {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--lc-text-2);
        margin-bottom: -8px;
      }
      .scenes {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .scene,
      .pill-button {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border-radius: 999px;
        background: var(--lc-surface-2);
        font-size: 14px;
        font-weight: 600;
        transition:
          background 0.2s ease,
          transform 0.15s ease;
      }
      .scene:hover,
      .pill-button:hover {
        background: rgba(var(--lc-rgb-text), 0.14);
      }
      .scene:active,
      .pill-button:active {
        transform: scale(0.97);
      }
      .scene .mdi {
        width: 16px;
        height: 16px;
        color: rgb(var(--lc-accent));
      }
      .room-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .outlets-label {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-top: 4px;
      }
      .section-meta {
        text-transform: none;
        letter-spacing: 0;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }
      .outlet-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .outlet-item {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 52px;
        padding: 6px 10px 6px 8px;
        box-sizing: border-box;
        border-radius: 16px;
        background: var(--lc-surface);
      }
      .outlet-icon {
        flex: none;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--lc-surface-2);
        color: var(--lc-text-2);
        transition:
          background 0.3s ease,
          color 0.3s ease;
      }
      .is-on .outlet-icon {
        background: rgba(var(--lc-outlet), 0.18);
        color: rgb(var(--lc-outlet));
      }
      .outlet-name {
        flex: 1;
        min-width: 0;
        font-size: 14.5px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .outlet-watts {
        font-size: 13.5px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: rgb(var(--lc-outlet));
      }
      .mini-switch {
        position: relative;
        flex: none;
        width: 46px;
        height: 28px;
        border-radius: 14px;
        background: rgba(var(--lc-rgb-text), 0.18);
        transition: background 0.3s ease;
      }
      .mini-switch .knob {
        position: absolute;
        top: 3px;
        left: 3px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
        transition: transform 0.28s cubic-bezier(0.3, 0.7, 0.4, 1.3);
      }
      .mini-switch.on {
        background: rgb(var(--lc-outlet));
      }
      .mini-switch.on .knob {
        transform: translateX(18px);
      }
      .mini-switch:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .room-actions .pill-button {
        justify-content: center;
      }
      .pill-button.warning {
        background: rgba(255, 170, 60, 0.18);
        color: rgb(255, 170, 60);
        box-shadow: inset 0 0 0 1.5px rgba(255, 170, 60, 0.7);
      }
      .pill-button:disabled {
        opacity: 0.45;
        cursor: default;
      }
      @media (max-width: 380px) {
        .stage {
          gap: 12px;
        }
        lc-pill {
          width: 84px;
        }
      }
      /* Short, wide screens (wall tablets and phones in landscape): controls beside the stage. */
      @media (min-width: 720px) and (max-height: 700px) {
        dialog {
          width: min(780px, calc(100vw - 32px));
        }
        /* Nothing to set side by side: keep the usual width. */
        dialog:has(.side:empty),
        dialog:not(:has(.stage)) {
          width: 460px;
        }
        .body {
          flex-direction: row;
          align-items: center;
          gap: 28px;
        }
        .body > * {
          flex: 1 1 0;
          min-width: 0;
        }
      }
      @media (min-width: 720px) and (max-height: 440px) {
        header {
          padding-bottom: 8px;
        }
        .side {
          gap: 10px;
        }
        .spark svg {
          height: 40px;
        }
        .stage,
        .stage.solo:has(.big-toggle) {
          min-height: 0;
        }
        lc-pill {
          height: 150px;
        }
        lc-wheel {
          width: min(100%, 170px);
        }
        .hero-bulb,
        .big-toggle {
          width: 120px;
          height: 120px;
        }
      }
      @keyframes slide-up {
        from {
          transform: translateY(100%);
        }
      }
      @keyframes pop-in {
        from {
          transform: scale(0.94);
          opacity: 0;
        }
      }
      @keyframes fade {
        from {
          opacity: 0;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .sheet,
        dialog::backdrop {
          animation: none;
        }
      }
    `,
  ];
}

function targetKey(target: SheetTarget): string {
  return target.type === 'scope' ? `scope:${target.key}` : `entity:${target.entity.entityId}`;
}

if (!customElements.get('lc-sheet')) customElements.define('lc-sheet', LcSheet);
