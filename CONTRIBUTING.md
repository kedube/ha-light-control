# Contributing

Thanks for helping. This guide covers building the card, running the tests, and how releases work.

## Set up

You need Node.js 22.18 or newer (CI uses Node 24).

```sh
npm ci
npm run dev
```

`npm run dev` rebuilds on every change and serves the demo at <http://localhost:5173/demo/>: the real card running against a simulated Home Assistant in [`demo/demo.ts`](demo/demo.ts). The demo lets you switch theme, time of day, screen width and language, lay the home out with or without floors and areas, and add or remove a bulb to watch discovery work.

To try a build in your own Home Assistant, run `npm run build` and copy `dist/ha-light-control.js` to `config/www/`.

## Commands

| Command                           | What it does                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`                     | Watch mode plus the demo server.                                                |
| `npm run build`                   | Production bundle in `dist/ha-light-control.js`.                                |
| `npm run build:demo`              | The bundle plus `demo/build/` (needed by the end-to-end tests and screenshots). |
| `npm run typecheck`               | TypeScript in strict mode.                                                      |
| `npm test`                        | Unit tests (Node's built-in test runner, no build needed).                      |
| `npm run test:e2e`                | Browser tests with Playwright against the demo. Run `npm run build:demo` first. |
| `npm run format` / `format:check` | Prettier.                                                                       |
| `npm run screenshots`             | Regenerates `docs/images/` from the demo. Run `npm run build:demo` first.       |

The end-to-end tests use Playwright's Chromium when installed (`npx playwright-core install chromium`), and fall back to a local Google Chrome.

## Project layout

```text
src/
  index.ts                 registers the card with Home Assistant
  light-control-card.ts    the card: house, floor switcher, lights and outlets controls, rooms
  editor.ts                visual editor (wraps Home Assistant's ha-form)
  discovery.ts             finds lights and plugs and groups them into rooms
  room-types.ts            what kind of room an area is (living room, kitchen, garden…)
  scope.ts                 the whole home, a floor, the outdoors or one room: which rooms each covers
  entity-model.ts          turns a state object into what the UI shows
  controller.ts            service calls, optimistic updates and undo
  aggregate.ts             counts, colors, brightness and power for a room, a floor or the home
  room-columns.ts          rooms → balanced columns on wide cards
  house/
    plan.ts                floors and areas → a floor plan (rooms along the outside walls, stairs)
    furniture.ts           furniture for each kind of room
    scene.ts               the plan and the lights → SVG shapes: outside, or a floor cut open
    iso.ts                 isometric projection and painter's-order sorting
    palette.ts             materials, and how daylight and lamps light them
    sky.ts                 day, dusk or night from the sun
  color.ts, config.ts, localize.ts, graphics.ts, styles.ts
  components/              house, tile, controls sheet, sliders and color wheel
  translations/            one file per language
tests/unit/                pure logic, run directly by Node
tests/e2e/                 the built card in Chromium
demo/                      simulated Home Assistant and the demo page
scripts/                   build, screenshots and release helpers
```

Keep logic that doesn't need the DOM in plain modules (like `discovery.ts` and everything in `house/`) so it can be unit tested without a browser. Components use Lit without decorators, so Node can run the TypeScript sources directly.

The 3D house is plain SVG, drawn in isometric projection: no WebGL, no extra dependencies, and it stays sharp at any size. `scene.ts` returns the same list of shapes whatever the lights are doing, so a light turning on fades in rather than redrawing the picture; the unit tests check that.

## Translations

Strings live in [`src/translations`](src/translations). `en.ts` defines every key; other languages must provide all of them, which both TypeScript and `tests/unit/localize.test.ts` check. Counted phrases use plural objects (`one`, `few`, `many`, `other`) matched with `Intl.PluralRules`. Use the same terms as Home Assistant's own translation for your language.

To add a language, copy `en.ts` to `<code>.ts`, translate it, add it to `TRANSLATIONS` in [`src/localize.ts`](src/localize.ts), and add it to the demo's language menu.

## Commit messages

Release notes are built from commit messages, so write them for the people who use the card. [Conventional Commits](https://www.conventionalcommits.org/) prefixes sort them into sections:

| Prefix                                  | Section in the release notes |
| --------------------------------------- | ---------------------------- |
| `feat:`                                 | New features                 |
| `fix:`                                  | Fixes                        |
| `perf:` `refactor:` `style:` `i18n:`    | Improvements                 |
| `docs:`                                 | Documentation                |
| `test:` `build:` `ci:` `chore:` `deps:` | Maintenance                  |
| `feat!:` or a `BREAKING CHANGE:` line   | Breaking changes             |

Plain messages work too: ones starting with _Add_ count as features and ones starting with _Fix_ as fixes. The commit body is included under its line in the notes, so use it for the details.

## Releases

Releases are automatic. Every push to `main` runs [`release.yml`](.github/workflows/release.yml):

1. The full CI job runs: formatting, types, unit tests, build and browser tests.
2. [`scripts/release/next-version.mjs`](scripts/release/next-version.mjs) picks the next version from the existing tags. Versions are `x.y` and go up by 0.1 each release, with the minor digit rolling over after 9: 0.1 → 0.2 → … → 0.9 → 1.0 → 1.1 → … → 1.9 → 2.0. Only plain `x.y` tags count; a tag such as `v0.1` is ignored.
3. The card is built with that version embedded (it's printed in the browser console).
4. [`scripts/release/notes.mjs`](scripts/release/notes.mjs) writes release notes from the commits since the previous release, with a list of changed files and a comparison link.
5. A GitHub release is published with `ha-light-control.js` attached. Its tag and title are the plain version, such as `0.4` (never `v0.4`). HACS picks it up as an update.
6. HACS validation runs against the new release.

Put `[skip release]` in a commit message to push without releasing. If a release job is re-run for a commit that is already released, it does nothing.

Built files are never committed; HACS installs the file attached to each release.

## One-time repository settings

HACS validation also checks settings that live on GitHub rather than in the code:

- A repository description, for example _Home Assistant card that finds your lights and smart plugs and groups them by room_.
- Topics, for example `home-assistant`, `hacs`, `lovelace`, `lovelace-custom-card`, `dashboard`, `lights`.
- Issues enabled.

With the GitHub CLI:

```sh
gh repo edit kedube/ha-light-control \
  --description "Home Assistant card that finds your lights and smart plugs and groups them by room" \
  --add-topic home-assistant --add-topic hacs --add-topic lovelace \
  --add-topic lovelace-custom-card --add-topic dashboard --add-topic lights \
  --enable-issues
```

The release job asks for permission to publish releases itself (`contents: write`), so no workflow setting needs changing unless an organization policy restricts it.
