# Light Control Card

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories)
[![Latest release](https://img.shields.io/badge/dynamic/xml?url=https%3A%2F%2Fgithub.com%2Fkedube%2Fha-light-control%2Freleases.atom&query=%2F%2F%2A%5Blocal-name%28%29%3D%27entry%27%5D%5B1%5D%2F%2A%5Blocal-name%28%29%3D%27title%27%5D&label=release&color=blue)](https://github.com/kedube/ha-light-control/releases/latest)
[![Release workflow](https://github.com/kedube/ha-light-control/actions/workflows/release.yml/badge.svg)](https://github.com/kedube/ha-light-control/actions/workflows/release.yml)
[![License: GPL-3.0](https://img.shields.io/github/license/kedube/ha-light-control)](LICENSE)

Every light and smart plug in your home, found automatically and grouped by room. Tap to switch, slide to dim, hold for color, and watch your house light up.

![Light Control Card at night: a house illustration whose windows glow in each room's light color, above rooms of light and plug tiles](https://raw.githubusercontent.com/kedube/ha-light-control/main/docs/images/overview-dark.png)

## Highlights

- **No entity lists to maintain.** Lights and plugs are discovered from your Home Assistant areas and floors. New devices appear on their own, and removed ones disappear.
- **Your home at a glance.** An illustrated house where every room is a window glowing in the real color and brightness of its lights. Floors become stories, outdoor areas become lamp posts, and the sky follows the sun.
- **Natural controls.** Tap a tile to switch it, slide across it to dim, and press and hold for a full sheet with a brightness slider, color wheel, white temperature and effects.
- **Whole rooms at once.** Every room has its own switch, a room-wide brightness and color sheet, and its scenes one tap away.
- **Smart plugs done right.** Live wattage, a 24-hour power chart, energy, voltage and current, on a faceplate drawn in your country's socket style. Room switches never cut power to plugs unless you ask them to.
- **Undo.** "All off" and room switches remember each light's brightness and color, so one tap brings everything back.
- **Instant feedback.** Tiles react immediately, even while slow Zigbee or cloud bulbs catch up.
- **Eight languages.** English, Deutsch, Nederlands, Français, Español, Italiano, Polski and Português, following each person's Home Assistant language.
- **Accessible.** Keyboard control, screen-reader labels, reduced-motion support, and light and dark themes.

|                                                                Color and white controls                                                                 |                                                                      Smart plugs                                                                      |                                                                       A whole room                                                                       |
| :-----------------------------------------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------: |
| ![Controls sheet with brightness slider and color wheel](https://raw.githubusercontent.com/kedube/ha-light-control/main/docs/images/controls-color.png) | ![Plug sheet with live power, 24-hour chart and energy readings](https://raw.githubusercontent.com/kedube/ha-light-control/main/docs/images/plug.png) | ![Room controls with brightness, color, scenes and on/off](https://raw.githubusercontent.com/kedube/ha-light-control/main/docs/images/room-controls.png) |

|                                                              Daytime, light theme                                                              |                                                                     On a phone                                                                      |
| :--------------------------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------: |
| ![The card in a light theme with a daytime sky](https://raw.githubusercontent.com/kedube/ha-light-control/main/docs/images/overview-light.png) | ![The card on a phone-sized screen with two columns of tiles](https://raw.githubusercontent.com/kedube/ha-light-control/main/docs/images/phone.png) |

## Installation

### HACS (recommended)

[![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=kedube&repository=ha-light-control&category=plugin)

1. Select the button above. Alternatively, open **HACS**, open the **⋮** menu, choose **Custom repositories**, and add `https://github.com/kedube/ha-light-control` with the type **Dashboard**.
2. Search for **Light Control Card** and select **Download**.
3. Reload the browser. In the companion app, clear the frontend cache from **Settings → Companion app → Debugging**.

HACS registers the dashboard resource for you and offers updates whenever a new version is released.

### Manual

1. Download `ha-light-control.js` from the [latest release](https://github.com/kedube/ha-light-control/releases/latest).
2. Copy it to `config/www/ha-light-control.js` in your Home Assistant configuration folder.
3. Go to **Settings → Dashboards**, open the **⋮** menu, choose **Resources**, and add `/local/ha-light-control.js` as a **JavaScript module**. (Resources appear only with **Advanced mode** turned on in your user profile.)
4. Reload the browser.

When you update manually, add a version to the resource URL (for example `/local/ha-light-control.js?v=0.4`) so browsers fetch the new file.

**Requirements:** Home Assistant 2024.11 or newer.

## Add the card

Edit a dashboard, select **Add card**, and search for **Light Control**. The whole configuration is one line:

```yaml
type: custom:light-control-card
```

Every option is also available in the visual editor, grouped into Display, Plugs & outlets, Rooms, Entities and Behavior.

## Using the card

| Gesture                                                  | On a light                                                       | On a plug                              |
| -------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| **Tap**                                                  | Turn on or off                                                   | Turn on or off                         |
| **Slide sideways**                                       | Set the brightness; slide to the far left to turn it off         | —                                      |
| **Press and hold**, right-click, or tap the round button | Open the controls: brightness, color, white temperature, effects | Open power, energy and a 24-hour chart |

| Elsewhere                        | What it does                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Room switch**                  | Turns every light in the room on or off. Plugs are left alone unless `room_switch_outlets` is on. |
| **Room name**                    | Opens room controls: brightness and color for the whole room, its scenes, and all on/off.         |
| **Scene chips**                  | Activate a scene assigned to the room.                                                            |
| **All off**                      | Turns off every light in the card, with an **Undo** button in the notification.                   |
| **House windows and room chips** | Show just that room. Select it again to show everything.                                          |
| **On now**                       | Shows only what is currently on.                                                                  |

With a keyboard, **Tab** moves between tiles, **Enter** or **Space** toggles, and the arrow keys change brightness in 10% steps. The controls sheet sliders and wheels also work with arrow keys.

## How discovery works

The card reads Home Assistant's own registries, so organizing your home in **Settings → Areas, labels & zones** is all the setup it needs.

- **Lights:** every `light.*` entity.
- **Plugs and outlets:** `switch.*` entities that Home Assistant shows as an outlet, plus, in the default _smart_ mode, switches whose device name or model says plug, outlet, socket or power strip (in any of the supported languages). Settings switches on those devices, such as child lock or LED indicator, stay out.
- **Rooms:** an entity's own area, or else its device's area. Rooms follow the order of your floors and areas in Home Assistant, which you can drag to reorder. Entities without an area appear under **Other**.
- **Left out automatically:** hidden entities, configuration and diagnostic entities, and entities the integration no longer provides.
- **Names:** the room name is removed from the start of each tile, so "Living Room Floor Lamp" in the Living Room reads "Floor Lamp".
- **Related sensors:** power, energy, voltage and current sensors on the same device as a plug are attached to it. On power strips, a sensor is attached only when it is clearly named after that outlet.

**A plug is missing?** Open the switch in Home Assistant, go to its settings, and set **Show as** to **Outlet**. It will always count as a plug from then on. You can also add it to `include`.

**Something shows up that shouldn't?** Hide the entity in Home Assistant, or add it to `exclude` or `exclude_patterns`.

## Configuration

All options are optional.

| Option                | Default  | Description                                                                                                                                |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`               | `Lights` | Card title. Set to `""` to hide it.                                                                                                        |
| `show_house`          | `true`   | Show the house illustration.                                                                                                               |
| `show_summary`        | `true`   | Show the status line and the **All off** button.                                                                                           |
| `show_room_filter`    | `true`   | Show the room chips below the header.                                                                                                      |
| `show_scenes`         | `true`   | Show scenes assigned to each room.                                                                                                         |
| `icon_style`          | `auto`   | `auto`: the card's artwork unless an entity has its own icon. `graphic`: always the card's artwork. `entity`: always Home Assistant icons. |
| `show_outlets`        | `true`   | Include smart plugs and outlets.                                                                                                           |
| `outlet_detection`    | `smart`  | `smart`: outlets plus switches on plug devices. `device_class`: only switches shown as Outlet. `all_switches`: every switch.               |
| `room_switch_outlets` | `false`  | Let room switches and **All off** turn off plugs too.                                                                                      |
| `areas`               | all      | Show only these area IDs, in this order.                                                                                                   |
| `floors`              | all      | Show only areas on these floor IDs.                                                                                                        |
| `exclude_areas`       | none     | Area IDs to leave out.                                                                                                                     |
| `show_unassigned`     | `true`   | Show entities that have no area.                                                                                                           |
| `unassigned_name`     | `Other`  | Name of the section for entities without an area.                                                                                          |
| `include`             | none     | Entity IDs to always show, even hidden ones or other domains such as `input_boolean` and `fan`.                                            |
| `exclude`             | none     | Entity IDs to always hide.                                                                                                                 |
| `exclude_patterns`    | none     | Wildcard patterns to hide, such as `switch.*_led`. A pattern without a domain (`*_child_lock`) matches every domain.                       |
| `show_unavailable`    | `true`   | Show unavailable entities, dimmed. Entities the integration no longer provides are always hidden.                                          |
| `show_light_groups`   | `true`   | Show light group entities (listed first in their room).                                                                                    |
| `strip_area_names`    | `true`   | Remove the room name from the start of entity names.                                                                                       |
| `tap_action`          | `toggle` | What tapping a tile does: `toggle`, `controls` (open the controls sheet), or `more-info` (Home Assistant's dialog).                        |
| `live_brightness`     | `false`  | Update lights continuously while sliding. Leave off on slow Zigbee networks.                                                               |

### Examples

One card per floor:

```yaml
type: custom:light-control-card
title: Upstairs
floors:
  - upstairs
```

Just the lights, most-used rooms first:

```yaml
type: custom:light-control-card
show_outlets: false
areas:
  - living_room
  - kitchen
  - bedroom
```

A compact card without the illustration, where tapping opens the controls:

```yaml
type: custom:light-control-card
title: ''
show_house: false
tap_action: controls
exclude_patterns:
  - '*_indicator'
  - 'switch.*_child_lock'
```

## Languages

The card uses the language set in each person's Home Assistant profile. It includes English, German, Dutch, French, Spanish, Italian, Polish and Portuguese, and falls back to English for other languages. Numbers and units follow the same locale.

![The card in German at dusk](https://raw.githubusercontent.com/kedube/ha-light-control/main/docs/images/german.png)

Translations live in [`src/translations`](src/translations). To add a language, copy `en.ts`, translate the strings, and register it in [`src/localize.ts`](src/localize.ts); the tests check that nothing is missing.

## Theming

The card uses your Home Assistant theme's colors, fonts, card background and radius. One extra variable is available:

| Variable          | Default        | Used for                                              |
| ----------------- | -------------- | ----------------------------------------------------- |
| `--lc-outlet-rgb` | `38, 196, 152` | Accent for plugs that are on, as comma-separated RGB. |

```yaml
my-theme:
  lc-outlet-rgb: '0, 150, 255'
```

## Try it without Home Assistant

The repository includes a simulated home (13 areas on three floors, 24 lights and 5 plugs, plus a few hidden and retired devices the card has to skip) for trying the card and for automated tests:

```sh
npm ci
npm run dev
```

Then open <http://localhost:5173/demo/>.

## Versions and releases

Every change merged into `main` is tested and released automatically as the next version: 0.1, 0.2 … 0.9, then 1.0, 1.1 and so on. Each [release](https://github.com/kedube/ha-light-control/releases) lists what changed, and HACS offers it as an update.

## Contributing

Bug reports, ideas and translations are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build, test and release the card.

## License

[GPL-3.0](LICENSE)
