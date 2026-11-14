import { LitElement, css, html, nothing } from 'lit';
import type { RGB } from './color.ts';
import { COLOR_KEYS, DEFAULTS, parseColor, resolveConfig, type LightControlCardConfig } from './config.ts';
import type { HomeAssistant } from './ha-types.ts';
import { STYLE_NAMES, STYLES, styleFor, type StyleName } from './house/materials.ts';
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
      name: 'house',
      type: 'expandable',
      flatten: true,
      title: t('section_house'),
      icon: 'mdi:home-variant-outline',
      schema: [
        { name: 'show_house', selector: { boolean: {} } },
        {
          name: 'house_style',
          selector: select([
            ['auto', 'opt_style_auto'],
            ...STYLE_NAMES.map((name) => [name, `opt_style_${name}`] as [string, StringKey]),
          ]),
        },
        {
          name: 'house_top_floor',
          selector: select([
            ['auto', 'opt_top_floor_auto'],
            ['roof', 'opt_top_floor_roof'],
            ['full', 'opt_top_floor_full'],
          ]),
        },
        {
          name: 'house_colors',
          type: 'grid',
          flatten: true,
          schema: COLOR_KEYS.map((name) => ({ name, selector: { color_rgb: {} } })),
        },
        {
          name: 'house_facing',
          selector: select([
            ['auto', 'opt_facing_auto'],
            ['n', 'opt_facing_n'],
            ['ne', 'opt_facing_ne'],
            ['e', 'opt_facing_e'],
            ['se', 'opt_facing_se'],
            ['s', 'opt_facing_s'],
            ['sw', 'opt_facing_sw'],
            ['w', 'opt_facing_w'],
            ['nw', 'opt_facing_nw'],
          ]),
        },
        { name: 'animate_sky', selector: { boolean: {} } },
        { name: 'sky_weather', selector: { boolean: {} } },
        { name: 'weather_entity', selector: { entity: { filter: [{ domain: 'weather' }] } } },
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
  door_color: 'help_house_color',
  animate_sky: 'help_animate_sky',
  house_top_floor: 'help_house_top_floor',
  house_facing: 'help_house_facing',
  weather_entity: 'help_weather_entity',
  outlet_detection: 'help_outlet_detection',
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

/** The colors a style gives the house, which the color fields show until the user picks their own. */
function styleColors(style: unknown, country?: string | null): Record<(typeof COLOR_KEYS)[number], RGB> {
  const name = typeof style === 'string' && style in STYLES ? (style as StyleName) : styleFor(country);
  const s = STYLES[name];
  return { house_color: s.wall.color, roof_color: s.roof.color, trim_color: s.trim, door_color: s.door };
}

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
    const config = this._config as unknown as Record<string, unknown>;
    const colors: Record<string, RGB> = styleColors(config.house_style, this.hass.config?.country);
    for (const key of COLOR_KEYS) colors[key] = parseColor(config[key]) ?? colors[key];
    const data = { ...FORM_DEFAULTS, ...this._config, ...colors, title: this._config.title ?? t('lights') };
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
    // The default stays out of the YAML, so it keeps following the user's language.
    const title = value.title;
    if (title === undefined || title === null || title === '') config.title = '';
    else if (title !== t('lights')) config.title = title;
    // A color that is the style's own stays out of the YAML, so it follows the style if that changes.
    const own: Record<string, RGB> = styleColors(value.house_style, this.hass?.config?.country);
    for (const [key, v] of Object.entries(value)) {
      if (key === 'type' || key === 'title' || v === undefined || v === null) continue;
      if (key in own && JSON.stringify(parseColor(v)) === JSON.stringify(own[key])) continue;
      if (Array.isArray(v) && !v.length) continue;
      if ((key === 'unassigned_name' || key === 'weather_entity') && v === '') continue;
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
