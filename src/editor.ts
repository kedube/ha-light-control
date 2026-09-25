import { LitElement, css, html, nothing } from 'lit';
import { DEFAULTS, resolveConfig, type LightControlCardConfig } from './config.ts';
import type { HomeAssistant } from './ha-types.ts';
import { setLanguage, t, TRANSLATIONS, type StringKey } from './localize.ts';
import { fireEvent } from './utils.ts';

type Schema = Record<string, unknown>;

function buildSchema(): Schema[] {
  const select = (options: [string, StringKey][]) => ({
    select: { mode: 'dropdown', options: options.map(([value, key]) => ({ value, label: t(key) })) },
  });
  return [
    { name: 'title', selector: { text: {} } },
    {
      name: 'display',
      type: 'expandable',
      flatten: true,
      title: t('section_display'),
      icon: 'mdi:palette-outline',
      expanded: true,
      schema: [
        {
          name: 'display_grid',
          type: 'grid',
          flatten: true,
          schema: [
            { name: 'show_house', selector: { boolean: {} } },
            { name: 'show_summary', selector: { boolean: {} } },
            { name: 'show_room_filter', selector: { boolean: {} } },
            { name: 'show_scenes', selector: { boolean: {} } },
          ],
        },
        {
          name: 'icon_style',
          selector: select([
            ['auto', 'opt_icon_auto'],
            ['graphic', 'opt_icon_graphic'],
            ['entity', 'opt_icon_entity'],
          ]),
        },
      ],
    },
    {
      name: 'plugs',
      type: 'expandable',
      flatten: true,
      title: t('section_plugs'),
      icon: 'mdi:power-socket',
      schema: [
        { name: 'show_outlets', selector: { boolean: {} } },
        {
          name: 'outlet_detection',
          selector: select([
            ['smart', 'opt_outlet_smart'],
            ['device_class', 'opt_outlet_device_class'],
            ['all_switches', 'opt_outlet_all'],
          ]),
        },
        { name: 'room_switch_outlets', selector: { boolean: {} } },
      ],
    },
    {
      name: 'rooms',
      type: 'expandable',
      flatten: true,
      title: t('section_rooms'),
      icon: 'mdi:floor-plan',
      schema: [
        { name: 'areas', selector: { area: { multiple: true } } },
        { name: 'floors', selector: { floor: { multiple: true } } },
        { name: 'exclude_areas', selector: { area: { multiple: true } } },
        { name: 'show_unassigned', selector: { boolean: {} } },
        { name: 'unassigned_name', selector: { text: {} } },
      ],
    },
    {
      name: 'entities',
      type: 'expandable',
      flatten: true,
      title: t('section_entities'),
      icon: 'mdi:lightbulb-group-outline',
      schema: [
        {
          name: 'include',
          selector: { entity: { multiple: true, filter: [{ domain: ['light', 'switch', 'input_boolean', 'fan'] }] } },
        },
        { name: 'exclude', selector: { entity: { multiple: true, filter: [{ domain: ['light', 'switch'] }] } } },
        { name: 'exclude_patterns', selector: { text: { multiple: true } } },
        {
          name: 'entity_grid',
          type: 'grid',
          flatten: true,
          schema: [
            { name: 'show_unavailable', selector: { boolean: {} } },
            { name: 'show_light_groups', selector: { boolean: {} } },
            { name: 'strip_area_names', selector: { boolean: {} } },
          ],
        },
      ],
    },
    {
      name: 'behavior',
      type: 'expandable',
      flatten: true,
      title: t('section_behavior'),
      icon: 'mdi:gesture-tap',
      schema: [
        {
          name: 'tap_action',
          selector: select([
            ['toggle', 'opt_tap_toggle'],
            ['controls', 'opt_tap_controls'],
            ['more-info', 'opt_tap_more_info'],
          ]),
        },
        { name: 'live_brightness', selector: { boolean: {} } },
      ],
    },
  ];
}

const HELPERS: Record<string, StringKey> = {
  outlet_detection: 'help_outlet_detection',
  room_switch_outlets: 'help_room_switch_outlets',
  areas: 'help_areas',
  exclude_patterns: 'help_exclude_patterns',
  live_brightness: 'help_live_brightness',
};

const label = (name: string): string => {
  const key = `cfg_${name}` as StringKey;
  return key in TRANSLATIONS.en ? t(key) : name;
};

/** Keys the form toggles; used to show defaults and keep saved YAML minimal. */
const FORM_DEFAULTS = DEFAULTS as unknown as Record<string, unknown>;

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<{ createCardElement(config: Record<string, unknown>): HTMLElement }>;
  }
}

/** Home Assistant only loads ha-form on demand; borrow a built-in editor to pull it in. */
async function ensureHaForm(): Promise<void> {
  if (customElements.get('ha-form')) return;
  try {
    const helpers = await window.loadCardHelpers?.();
    helpers?.createCardElement({ type: 'button', entity: 'sun.sun' });
    await customElements.whenDefined('hui-button-card');
    const ctor = customElements.get('hui-button-card') as unknown as { getConfigElement?: () => Promise<unknown> };
    await ctor?.getConfigElement?.();
  } catch {
    // The form appears as soon as Home Assistant defines ha-form by other means.
  }
}

export class LightControlCardEditor extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
    _ready: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: LightControlCardConfig;
  declare _ready: boolean;

  constructor() {
    super();
    this._ready = Boolean(customElements.get('ha-form'));
  }

  setConfig(config: LightControlCardConfig): void {
    this._config = config;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._ready) {
      ensureHaForm();
      customElements.whenDefined('ha-form').then(() => (this._ready = true));
    }
  }

  protected override render() {
    if (!this.hass || !this._config || !this._ready) return nothing;
    setLanguage(this.hass.locale?.language ?? this.hass.language);
    const data = { ...FORM_DEFAULTS, ...this._config };
    return html`
      <p class="intro">${t('editor_intro')}</p>
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${buildSchema()}
        .computeLabel=${(s: { name: string }) => label(s.name)}
        .computeHelper=${(s: { name: string }) => (HELPERS[s.name] ? t(HELPERS[s.name]) : undefined)}
        @value-changed=${this.valueChanged}
      ></ha-form>
    `;
  }

  private valueChanged(ev: CustomEvent<{ value: Record<string, unknown> }>): void {
    ev.stopPropagation();
    const value = ev.detail.value;
    const config: Record<string, unknown> = { type: this._config!.type };
    // The form always shows a title, so an emptied field (sent as undefined) means "no title".
    const title = value.title;
    if (title === undefined || title === null || title === '') config.title = '';
    else if (title !== FORM_DEFAULTS.title) config.title = title;
    for (const [key, v] of Object.entries(value)) {
      if (key === 'type' || key === 'title' || v === undefined || v === null) continue;
      if (Array.isArray(v) && !v.length) continue;
      if (key === 'unassigned_name' && v === '') continue;
      if (JSON.stringify(v) === JSON.stringify(FORM_DEFAULTS[key])) continue;
      config[key] = v;
    }
    try {
      resolveConfig(config as unknown as LightControlCardConfig);
    } catch {
      return;
    }
    fireEvent(this, 'config-changed', { config });
  }

  static override styles = css`
    .intro {
      margin: 0 0 12px;
      color: var(--secondary-text-color);
      font-size: 13px;
      line-height: 1.45;
    }
  `;
}
