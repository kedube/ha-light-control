export function fireEvent<T>(node: EventTarget, type: string, detail?: T): void {
  node.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
}

export type HapticType = 'success' | 'warning' | 'failure' | 'light' | 'medium' | 'heavy' | 'selection';

/** The Home Assistant companion apps turn this event into device vibration. */
export function haptic(type: HapticType = 'light'): void {
  if (typeof window !== 'undefined') fireEvent(window, 'haptic', type);
}

export function formatNumber(value: number, language?: string, maximumFractionDigits = 1): string {
  try {
    return new Intl.NumberFormat(language, { maximumFractionDigits }).format(value);
  } catch {
    return String(Math.round(value * 10) / 10);
  }
}
