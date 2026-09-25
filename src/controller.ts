import {
  computeDomain,
  entityView,
  isLightGroup,
  overrideSettled,
  type EntityKind,
  type EntityView,
  type Override,
} from './entity-model.ts';
import type { HassEntity, HomeAssistant } from './ha-types.ts';
import { t } from './localize.ts';
import { fireEvent, haptic } from './utils.ts';

interface Host extends EventTarget {
  requestUpdate(): void;
}

interface Snapshot {
  entityId: string;
  data: Record<string, unknown>;
}

const OVERRIDE_TTL = 5000;
const LIVE_INTERVAL = 350;

/**
 * Sends commands to Home Assistant and remembers what the user just asked for, so tiles react
 * instantly instead of waiting for slow radios (Zigbee, cloud bulbs) to report back.
 */
export class LightController {
  hass?: HomeAssistant;
  private readonly host: Host;
  private readonly overrides = new Map<string, Override>();
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private readonly liveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly liveLastSent = new Map<string, number>();

  constructor(host: Host) {
    this.host = host;
  }

  view(entityId: string, kind: EntityKind): EntityView | undefined {
    const stateObj = this.hass?.states[entityId];
    if (!stateObj) return undefined;
    const override = this.overrides.get(entityId);
    if (!override) return entityView(stateObj, kind);
    const raw = entityView(stateObj, kind);
    if (overrideSettled(override, raw, Date.now())) {
      this.overrides.delete(entityId);
      return raw;
    }
    return entityView(stateObj, kind, override);
  }

  toggle(entityId: string, kind: EntityKind): void {
    const current = this.view(entityId, kind);
    if (!current || current.unavailable) return;
    haptic('light');
    this.setPower([entityId], !current.on);
  }

  setPower(entityIds: string[], on: boolean): Promise<unknown> {
    const targets = entityIds.filter((id) => this.hass?.states[id]?.state !== 'unavailable');
    for (const id of targets) this.override(id, { on });
    return this.call(on ? 'turn_on' : 'turn_off', targets);
  }

  /** 0 turns the lights off; anything else turns them on at that level. */
  setBrightness(entityIds: string[], pct: number): Promise<unknown> {
    const value = Math.round(Math.min(100, Math.max(0, pct)));
    this.cancelLive(entityIds);
    if (value === 0) return this.setPower(entityIds, false);
    for (const id of entityIds) this.override(id, { on: true, brightness: value });
    return this.call('turn_on', entityIds, { brightness_pct: value });
  }

  /** Throttled brightness updates while a slider is still being dragged. */
  previewBrightness(entityIds: string[], pct: number): void {
    const key = entityIds.join(',');
    const run = () => {
      this.liveTimers.delete(key);
      this.liveLastSent.set(key, Date.now());
      const value = Math.round(pct);
      if (value > 0) this.call('turn_on', entityIds, { brightness_pct: value });
    };
    const since = Date.now() - (this.liveLastSent.get(key) ?? 0);
    clearTimeout(this.liveTimers.get(key));
    if (since >= LIVE_INTERVAL) run();
    else this.liveTimers.set(key, setTimeout(run, LIVE_INTERVAL - since));
  }

  setHs(entityIds: string[], hs: [number, number]): Promise<unknown> {
    const value: [number, number] = [Math.round(hs[0]), Math.round(hs[1])];
    for (const id of entityIds) this.override(id, { on: true, hs: value });
    return this.call('turn_on', entityIds, { hs_color: value });
  }

  setKelvin(entityIds: string[], kelvin: number): Promise<unknown> {
    const value = Math.round(kelvin);
    for (const id of entityIds) this.override(id, { on: true, kelvin: value });
    return this.call('turn_on', entityIds, { color_temp_kelvin: value });
  }

  setEffect(entityId: string, effect: string): Promise<unknown> {
    return this.call('turn_on', [entityId], { effect });
  }

  activateScene(sceneId: string): Promise<unknown> | undefined {
    haptic('success');
    return this.hass?.callService('scene', 'turn_on', { entity_id: sceneId });
  }

  /** Turns everything off and offers an Undo toast that restores each light's brightness and color. */
  turnOffWithUndo(entityIds: string[], name?: string): void {
    // Include things that are only optimistically on: the user sees them on, so "off" must reach them.
    const targets = entityIds.filter((id) => this.hass?.states[id]?.state === 'on' || this.overrides.get(id)?.on);
    if (!targets.length) return;
    haptic('medium');
    const snapshot = this.snapshot(targets);
    this.setPower(targets, false);
    if (!snapshot.length) return;
    fireEvent(this.host, 'hass-notification', {
      message: name && snapshot.length === 1 ? t('turned_off_one', { name }) : t('turned_off', { n: snapshot.length }),
      duration: 6000,
      action: { text: t('undo'), action: () => this.restore(snapshot) },
    });
  }

  moreInfo(entityId: string): void {
    fireEvent(this.host, 'hass-more-info', { entityId });
  }

  /**
   * What was on, with its brightness and color. Light groups are replaced by their members:
   * turning a group back on would also switch on members that were off.
   */
  private snapshot(entityIds: string[]): Snapshot[] {
    const ids = new Set<string>();
    for (const id of entityIds) {
      const stateObj = this.hass?.states[id];
      const members = stateObj && isLightGroup(stateObj) ? stateObj.attributes.entity_id : undefined;
      if (Array.isArray(members)) members.forEach((member) => ids.add(String(member)));
      else if (!stateObj || !isLightGroup(stateObj)) ids.add(id);
    }
    const result: Snapshot[] = [];
    for (const id of ids) {
      const stateObj = this.hass?.states[id];
      if (stateObj?.state !== 'on') continue;
      result.push({ entityId: id, data: computeDomain(id) === 'light' ? restoreData(stateObj) : {} });
    }
    return result;
  }

  private restore(snapshot: Snapshot[]): void {
    haptic('success');
    for (const item of snapshot) {
      this.override(item.entityId, { on: true });
      this.call('turn_on', [item.entityId], item.data);
    }
  }

  private override(entityId: string, patch: Omit<Override, 'expires'>): void {
    const existing = this.overrides.get(entityId);
    const next: Override = { ...existing, ...patch, expires: Date.now() + OVERRIDE_TTL };
    if (patch.hs) delete next.kelvin;
    if (patch.kelvin) delete next.hs;
    if (patch.on === false) delete next.brightness;
    this.overrides.set(entityId, next);
    this.scheduleExpiry();
    this.host.requestUpdate();
  }

  private scheduleExpiry(): void {
    clearTimeout(this.expiryTimer);
    const next = Math.min(...[...this.overrides.values()].map((o) => o.expires));
    if (!Number.isFinite(next)) return;
    this.expiryTimer = setTimeout(
      () => {
        const now = Date.now();
        for (const [id, override] of this.overrides) if (override.expires <= now) this.overrides.delete(id);
        this.host.requestUpdate();
        this.scheduleExpiry();
      },
      Math.max(50, next - Date.now() + 20),
    );
    // Don't keep Node (unit tests) alive for a UI refresh; browsers have no unref.
    (this.expiryTimer as { unref?: () => void }).unref?.();
  }

  private cancelLive(entityIds: string[]): void {
    const key = entityIds.join(',');
    clearTimeout(this.liveTimers.get(key));
    this.liveTimers.delete(key);
  }

  private call(
    service: 'turn_on' | 'turn_off',
    entityIds: string[],
    data: Record<string, unknown> = {},
  ): Promise<unknown> {
    const hass = this.hass;
    if (!hass || !entityIds.length) return Promise.resolve();
    const byDomain = new Map<string, string[]>();
    for (const id of entityIds) {
      const domain = computeDomain(id);
      const serviceDomain = domain === 'light' || domain === 'switch' ? domain : 'homeassistant';
      byDomain.set(serviceDomain, [...(byDomain.get(serviceDomain) ?? []), id]);
    }
    const calls = [...byDomain].map(([domain, ids]) =>
      hass
        .callService(domain, service, { entity_id: ids, ...(domain === 'light' ? data : {}) })
        .catch((err: unknown) => {
          // Drop the optimistic state so the tile shows what HA really reports.
          for (const id of ids) this.overrides.delete(id);
          this.host.requestUpdate();
          throw err;
        }),
    );
    return Promise.allSettled(calls);
  }
}

function restoreData(stateObj: HassEntity): Record<string, unknown> {
  const a = stateObj.attributes;
  const data: Record<string, unknown> = {};
  if (typeof a.brightness === 'number') data.brightness = a.brightness;
  switch (a.color_mode) {
    case 'color_temp':
      if (typeof a.color_temp_kelvin === 'number') data.color_temp_kelvin = a.color_temp_kelvin;
      break;
    case 'hs':
      if (a.hs_color) data.hs_color = a.hs_color;
      break;
    case 'xy':
      if (a.xy_color) data.xy_color = a.xy_color;
      break;
    case 'rgb':
      if (a.rgb_color) data.rgb_color = a.rgb_color;
      break;
    case 'rgbw':
      if (a.rgbw_color) data.rgbw_color = a.rgbw_color;
      break;
    case 'rgbww':
      if (a.rgbww_color) data.rgbww_color = a.rgbww_color;
      break;
  }
  return data;
}
