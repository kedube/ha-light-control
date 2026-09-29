import type { SkyMode } from './palette.ts';

export type { SkyMode } from './palette.ts';

export interface SunInfo {
  elevation?: number;
  azimuth?: number;
  aboveHorizon?: boolean;
}

/** Day, dusk or night from the sun's elevation, falling back to the clock without a sun entity. */
export function skyMode(sun?: SunInfo, now = new Date()): SkyMode {
  if (sun?.elevation !== undefined) {
    if (sun.elevation > 6) return 'day';
    if (sun.elevation > -6) return 'dusk';
    return 'night';
  }
  if (sun?.aboveHorizon !== undefined) return sun.aboveHorizon ? 'day' : 'night';
  const hour = now.getHours();
  if (hour >= 8 && hour < 18) return 'day';
  if (hour === 7 || hour === 18 || hour === 19) return 'dusk';
  return 'night';
}

/** The morning sun (in the east) lights the house from the left of the picture. */
export function sunFromLeft(sun?: SunInfo, now = new Date()): boolean {
  if (sun?.azimuth !== undefined) return sun.azimuth < 180;
  return now.getHours() < 13;
}
