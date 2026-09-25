import { averageRgb, type RGB } from './color.ts';
import type { DiscoveredEntity } from './discovery.ts';
import type { EntityView } from './entity-model.ts';
import type { HomeAssistant } from './ha-types.ts';

export interface Summary {
  lights: number;
  lightsOn: number;
  plugs: number;
  plugsOn: number;
  /** Average brightness (0–100) of the lit, dimmable lights. */
  brightness: number;
  /** Brightness-weighted color of the lit lights. */
  rgb: RGB | null;
  /** Glow strength 0–1 for artwork. */
  level: number;
  dimmable: boolean;
  supportsColor: boolean;
  supportsTemp: boolean;
  minKelvin: number;
  maxKelvin: number;
  /** Command targets: every light, including groups. */
  lightIds: string[];
  plugIds: string[];
  /** Total draw of plugs with a power sensor, in watts; null when none report power. */
  watts: number | null;
}

/** Reads a power sensor in watts, converting kW/mW. */
export function readWatts(hass: HomeAssistant, sensorId: string | undefined): number | null {
  if (!sensorId) return null;
  const stateObj = hass.states[sensorId];
  const value = stateObj ? Number.parseFloat(stateObj.state) : Number.NaN;
  if (!Number.isFinite(value)) return null;
  const unit = String(stateObj!.attributes.unit_of_measurement ?? 'W');
  if (unit === 'kW') return value * 1000;
  if (unit === 'mW') return value / 1000;
  return value;
}

export function summarize(
  entities: DiscoveredEntity[],
  viewOf: (entity: DiscoveredEntity) => EntityView | undefined,
  hass: HomeAssistant,
): Summary {
  const lightEntities = entities.filter((e) => e.kind === 'light');
  // Groups duplicate their members; only count them when a room has nothing else.
  const counted = lightEntities.some((e) => !e.isGroup) ? lightEntities.filter((e) => !e.isGroup) : lightEntities;
  const summary: Summary = {
    lights: counted.length,
    lightsOn: 0,
    plugs: 0,
    plugsOn: 0,
    brightness: 0,
    rgb: null,
    level: 0,
    dimmable: false,
    supportsColor: false,
    supportsTemp: false,
    minKelvin: Number.POSITIVE_INFINITY,
    maxKelvin: 0,
    lightIds: lightEntities.map((e) => e.entityId),
    plugIds: [],
    watts: null,
  };

  const colors: { rgb: RGB; weight: number }[] = [];
  let brightnessSum = 0;
  let dimmableOn = 0;
  let levelSum = 0;
  for (const entity of counted) {
    const view = viewOf(entity);
    if (!view) continue;
    summary.dimmable ||= view.dimmable;
    summary.supportsColor ||= view.supportsColor;
    if (view.supportsTemp) {
      summary.supportsTemp = true;
      summary.minKelvin = Math.min(summary.minKelvin, view.minKelvin);
      summary.maxKelvin = Math.max(summary.maxKelvin, view.maxKelvin);
    }
    if (!view.on) continue;
    summary.lightsOn++;
    levelSum += view.brightness / 100;
    colors.push({ rgb: view.rgb, weight: 0.25 + view.brightness / 100 });
    if (view.dimmable) {
      brightnessSum += view.brightness;
      dimmableOn++;
    }
  }
  if (!summary.supportsTemp) {
    summary.minKelvin = 2000;
    summary.maxKelvin = 6500;
  }
  summary.brightness = dimmableOn ? Math.round(brightnessSum / dimmableOn) : summary.lightsOn ? 100 : 0;
  summary.level = summary.lightsOn ? levelSum / summary.lightsOn : 0;
  summary.rgb = averageRgb(colors);

  for (const entity of entities) {
    if (entity.kind === 'light') continue;
    summary.plugs++;
    summary.plugIds.push(entity.entityId);
    const view = viewOf(entity);
    if (view?.on) summary.plugsOn++;
    const watts = readWatts(hass, entity.sensors.power);
    if (watts !== null) summary.watts = (summary.watts ?? 0) + (view?.on || watts > 0 ? watts : 0);
  }
  return summary;
}

export function formatWatts(watts: number, language?: string): string {
  if (Math.abs(watts) >= 1000) {
    return `${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(watts / 1000)} kW`;
  }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: watts < 10 ? 1 : 0 }).format(watts)} W`;
}
