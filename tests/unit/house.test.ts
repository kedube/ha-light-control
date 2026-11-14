import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cameraFor, fit, INSIDE, OUTSIDE, project, skyFrame, wallsKept } from '../../src/house/camera.ts';
import { fixtureKind } from '../../src/house/fixtures.ts';
import { toWorld } from '../../src/house/math.ts';
import { STYLES, styleFor } from '../../src/house/materials.ts';
import { VERTEX_BYTES } from '../../src/house/mesh.ts';
import {
  buildModel,
  lightTables,
  roomGlow,
  TABLE_WIDTH,
  type LightState,
  type Model,
  type RoomInput,
} from '../../src/house/model.ts';
import { planHouse } from '../../src/house/plan.ts';
import { cloudCover, computeSky, moonPhase, skyMode, sunPosition } from '../../src/house/sky.ts';
import type { RoomType } from '../../src/room-types.ts';

const room = (id: string, type: RoomType, ...lights: string[]): RoomInput => ({
  id,
  type,
  lights: lights.map((name) => ({ id: `light.${id}_${name.toLowerCase().replaceAll(' ', '_')}`, name })),
});

const ground = [
  room('living', 'living', 'Ceiling', 'Floor Lamp', 'TV Backlight'),
  room('kitchen', 'kitchen', 'Pendants'),
  room('garage', 'garage', 'Garage'),
];
const upstairs = [room('bed', 'bedroom', 'Bedside Lamp')];
const cellar = [room('media', 'media', 'Sconces')];
const outdoor = [room('garden', 'garden', 'Path', 'String Lights'), room('porch', 'porch', 'Lantern')];
const indoor = [...ground, ...upstairs, ...cellar];
const plan = planHouse([
  { id: 'g', level: 0, rooms: ground.map(({ id, type }) => ({ id, type })) },
  { id: 'u', level: 1, rooms: upstairs.map(({ id, type }) => ({ id, type })) },
  { id: 'b', level: -1, rooms: cellar.map(({ id, type }) => ({ id, type })) },
]);
const model = buildModel({ plan, rooms: new Map(indoor.map((r) => [r.id, r])), outdoor, style: STYLES.colonial });

const on: LightState = { on: true, rgb: [255, 180, 100], level: 0.8 };
const states = (ids: string[]) => new Map(ids.map((id) => [id, on]));
const row = (r: number, column: number) => (r * TABLE_WIDTH + column) * 4;

/** Every vertex of a model's mesh as { position, group, room, side }. */
function vertices(m: Model) {
  const f32 = new Float32Array(m.mesh.vertices);
  const u8 = new Uint8Array(m.mesh.vertices);
  const i8 = new Int8Array(m.mesh.vertices);
  return Array.from({ length: m.mesh.vertexCount }, (_, i) => ({
    position: [f32[i * 8], f32[i * 8 + 1], f32[i * 8 + 2]],
    group: i8[i * VERTEX_BYTES + 23],
    room: u8[i * VERTEX_BYTES + 28],
    emit: u8[i * VERTEX_BYTES + 29],
    side: u8[i * VERTEX_BYTES + 31],
  }));
}

describe('the house model', () => {
  it('builds a mesh the renderer can draw', () => {
    assert.ok(model.mesh.vertexCount > 5000, 'a whole house');
    assert.equal(model.mesh.vertices.byteLength, model.mesh.vertexCount * VERTEX_BYTES);
    assert.equal(model.mesh.indices.length, model.mesh.opaque.count + model.mesh.blended.count);
    assert.ok(model.mesh.blended.count > 0, 'windows have glass');
    for (const index of model.mesh.indices) assert.ok(index < model.mesh.vertexCount);
    for (const v of vertices(model)) {
      assert.ok(v.position.every(Number.isFinite), 'no vertex is lost in space');
      assert.ok(v.group < model.groups.count && v.room < model.rooms.length && v.side <= 4);
    }
  });

  it('puts every room in the picture, from outside and with its floor opened', () => {
    const picked = (hits: { roomId: string }[]) => new Set(hits.map((h) => h.roomId));
    const outside = picked(model.exterior.hits);
    for (const r of [...indoor, ...outdoor]) assert.ok(outside.has(r.id), `${r.id} can be picked from outside`);
    plan.stories.forEach((story, i) => {
      const view = model.stories[i];
      const ids = story.cells.map((c) => c.id).filter(Boolean);
      for (const id of ids) {
        assert.ok(picked(view.hits).has(id!), `${id} can be picked on its floor`);
        assert.ok(
          view.volumes.has(id!) && view.anchors.some((a) => a.roomId === id),
          `${id} has an outline and a label`,
        );
      }
      assert.equal(view.cut, model.groups.lower[i]);
    });
    assert.ok(
      model.stories[plan.stories.findIndex((s) => s.ground)].volumes.has('garage'),
      'the garage wing is on the ground floor',
    );
  });

  it('lifts off everything above an opened floor, and nothing below it', () => {
    const { groups } = model;
    const order = [
      groups.base,
      ...plan.stories.flatMap((s) => (s.basement ? [groups.lower[s.index], groups.upper[s.index]] : [])),
    ];
    order.push(groups.ground);
    for (const s of plan.stories) if (!s.basement) order.push(groups.lower[s.index], groups.upper[s.index]);
    order.push(groups.roof);
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
      'groups rise with the house',
    );
    assert.equal(new Set(order).size, order.length);
    // A wall above its sill is in the group that lifts, one above the group that stays.
    for (const v of vertices(model))
      if (v.side) assert.ok(groups.upper.includes(v.group), 'side walls lift with their floor');
  });

  it('gives every light a fixture and its room a list of them', () => {
    const lights = [...indoor, ...outdoor].flatMap((r) => r.lights.map((l) => l.id));
    assert.deepEqual(model.fixtures.map((f) => f.lightId).sort(), [...lights].sort());
    assert.equal(new Set(model.fixtures.map((f) => f.slot)).size, model.fixtures.length, 'one row each');
    for (const r of indoor) {
      const slot = model.rooms.find((s) => s.id === r.id)!;
      const own = model.fixtures.filter((f) => f.roomId === r.id).map((f) => f.slot);
      assert.deepEqual(
        own,
        Array.from({ length: slot.count }, (_, i) => slot.first + i),
        `${r.id}'s lamps sit together`,
      );
    }
    // The outdoors is lit by the garden's lamps and by what falls out of the windows.
    const out = model.rooms[0];
    const outSlots = [
      ...model.fixtures.filter((f) => f.outdoor).map((f) => f.slot),
      ...model.spills.map((s) => s.slot),
    ];
    assert.deepEqual(
      outSlots.sort((a, b) => a - b),
      Array.from({ length: out.count }, (_, i) => out.first + i),
    );
    const emitters = new Set(vertices(model).map((v) => v.emit));
    for (const f of model.fixtures) assert.ok(emitters.has(f.slot), `${f.lightId} has something that glows`);
  });

  it('finds a place outside for every outdoor area, without overlaps', () => {
    const many = ['garden', 'garden', 'garden', 'garden', 'porch', 'pool', 'driveway', 'garden'].map((type, i) =>
      room(`out${i}`, type as RoomType, `Lamp ${i}`),
    );
    const withGarage = planHouse(
      [],
      [
        { id: 'living', type: 'living' },
        { id: 'kitchen', type: 'kitchen' },
        { id: 'garage', type: 'garage' },
      ],
    );
    const m = buildModel({ plan: withGarage, rooms: new Map(), outdoor: many, style: STYLES.brick });
    const volumes = many.map((r) => m.exterior.volumes.get(r.id)!);
    volumes.forEach((a, i) => assert.ok(a, `${many[i].id} is in the picture`));
    const areas = volumes.map((v) => ({
      x0: Math.min(...v.points.map((p) => p[0])),
      x1: Math.max(...v.points.map((p) => p[0])),
      y0: Math.min(...v.points.map((p) => p[1])),
      y1: Math.max(...v.points.map((p) => p[1])),
    }));
    for (let i = 0; i < areas.length; i++) {
      for (let j = i + 1; j < areas.length; j++) {
        const a = areas[i];
        const b = areas[j];
        const overlap =
          Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) + 0.01 && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0) + 0.01;
        assert.ok(!overlap, `${many[i].id} overlaps ${many[j].id}`);
      }
    }
  });

  it('builds any home: one room, no rooms, no floors, every style', () => {
    const studio = planHouse([], [{ id: 'studio', type: 'living' }]);
    for (const style of Object.values(STYLES)) {
      const m = buildModel({
        plan: studio,
        rooms: new Map([['studio', room('studio', 'living', 'Lamp')]]),
        outdoor: [],
        style,
      });
      assert.ok(m.mesh.vertexCount > 1000 && Number.isFinite(m.radius));
    }
    const empty = buildModel({
      plan: planHouse([]),
      rooms: new Map(),
      outdoor: [room('yard', 'garden', 'Lamp')],
      style: STYLES.colonial,
    });
    assert.ok(empty.exterior.volumes.has('yard') && empty.mesh.vertexCount > 0);
    assert.equal(styleFor('DE'), 'european');
    assert.equal(styleFor('GB'), 'brick');
    assert.equal(styleFor('ES'), 'mediterranean');
    assert.equal(styleFor('US'), 'colonial');
    assert.equal(styleFor(undefined), 'colonial');
  });

  it('is the same house every time', () => {
    const again = buildModel({ plan, rooms: new Map(indoor.map((r) => [r.id, r])), outdoor, style: STYLES.colonial });
    assert.deepEqual(new Uint8Array(again.mesh.vertices), new Uint8Array(model.mesh.vertices));
  });
});

describe('lighting', () => {
  it('keeps a room dark until one of its lamps is on', () => {
    const dark = lightTables(model, new Map(), 1, [0, 0, 0]);
    const living = model.rooms.find((r) => r.id === 'living')!;
    assert.equal(dark.rooms[row(1, living.index)], 0, 'no glow');
    assert.ok(model.fixtures.every((f) => dark.lights[row(1, f.slot)] === 0 && dark.lights[row(3, f.slot)] === 0));
    const lit = lightTables(model, states(['light.living_ceiling']), 1, [0, 0, 0]);
    const ceiling = model.fixtures.find((f) => f.lightId === 'light.living_ceiling')!;
    assert.ok(lit.lights[row(1, ceiling.slot)] > 0.5, 'the lamp lights its room');
    assert.ok(lit.lights[row(3, ceiling.slot)] > 0.5, 'and glows itself');
    assert.ok(lit.rooms[row(1, living.index)] > 0, 'the room glows');
    const kitchen = model.rooms.find((r) => r.id === 'kitchen')!;
    assert.equal(lit.rooms[row(1, kitchen.index)], 0, 'the room next door stays dark');
  });

  it('lets lit rooms shine out of their windows', () => {
    const lit = lightTables(model, states(['light.living_ceiling']), 1, [0, 0, 0]);
    const spills = model.spills.filter((s) => s.roomId === 'living');
    assert.ok(spills.length > 0);
    for (const s of spills) assert.ok(lit.lights[row(1, s.slot)] > 0);
    for (const s of model.spills.filter((x) => x.roomId !== 'living')) assert.equal(lit.lights[row(1, s.slot)], 0);
  });

  it('shows lamps faintly by day and fully at night, and opens a floor to the sky', () => {
    const ceiling = model.fixtures.find((f) => f.lightId === 'light.living_ceiling')!;
    const night = lightTables(model, states(['light.living_ceiling']), 1, [0, 0, 0]);
    const day = lightTables(model, states(['light.living_ceiling']), 0.3, [0, 0, 0]);
    assert.ok(day.lights[row(1, ceiling.slot)] < night.lights[row(1, ceiling.slot)] * 0.5);
    const living = model.rooms.find((r) => r.id === 'living')!;
    const storyOpen = plan.stories.map((s) => (s.ground ? 1 : 0));
    const opened = lightTables(model, new Map(), 1, storyOpen);
    assert.ok(
      opened.rooms[row(0, living.index) + 2] > night.rooms[row(0, living.index) + 2] * 2,
      'daylight reaches an open room',
    );
    assert.equal(opened.rooms[row(0, 0) + 2], 1, 'the outdoors is always open');
  });

  it('mixes a room’s lamps into one softer light', () => {
    assert.equal(roomGlow([{ kind: 'ceiling', state: { ...on, on: false } }]), null);
    const bright = roomGlow([{ kind: 'ceiling', state: { ...on, level: 1 } }])!;
    const dim = roomGlow([{ kind: 'ceiling', state: { ...on, level: 0.1 } }])!;
    assert.ok(bright.level > 0.5 && bright.level <= 1 && dim.level < bright.level);
    const strip = roomGlow([{ kind: 'strip', state: { ...on, level: 1 } }])!;
    assert.ok(strip.level < bright.level, 'a strip of LEDs lights its wall more than its room');
  });

  it('tells ceiling lights, pendants, lamps and strips apart by name', () => {
    assert.equal(fixtureKind('Living Room Ceiling'), 'ceiling');
    assert.equal(fixtureKind('Kitchen Pendants'), 'pendant');
    assert.equal(fixtureKind('Floor Lamp'), 'lamp');
    assert.equal(fixtureKind('Stehlampe'), 'lamp');
    assert.equal(fixtureKind('TV Backlight'), 'strip');
    assert.equal(fixtureKind('Under Cabinet'), 'strip');
    assert.equal(fixtureKind('Garden String Lights'), 'strip');
  });
});

describe('the sky', () => {
  const sky = (elevation: number, azimuth = 200, clouds?: number) =>
    computeSky({ elevation, azimuth, viewAzimuth: 320, date: new Date(Date.UTC(2026, 5, 29, 12)), clouds });
  const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  it('follows the sun', () => {
    assert.equal(skyMode({ elevation: 30 }), 'day');
    assert.equal(skyMode({ elevation: 2 }), 'dusk');
    assert.equal(skyMode({ elevation: -20 }), 'night');
    assert.equal(skyMode(undefined, new Date(2026, 0, 1, 23, 0)), 'night');
    assert.equal(skyMode(undefined, new Date(2026, 0, 1, 13, 0)), 'day');
    assert.deepEqual(sunPosition({ elevation: 12, azimuth: 100 }), { elevation: 12, azimuth: 100 });
    assert.ok(
      sunPosition({ aboveHorizon: false }, new Date(2026, 0, 1, 12, 0)).elevation < 0,
      'the entity wins over the clock',
    );
  });

  it('is blue at noon, red where the sun sets, and dark at night', () => {
    const noon = sky(55);
    const zenith = (noon.air.length / 4 - 1) * 4;
    assert.ok(noon.air[zenith + 2] > noon.air[zenith] * 2.5, 'blue overhead');
    assert.equal(noon.mode, 'day');
    assert.ok(noon.keyColor[1] > 3, 'full sun');
    const sunset = sky(1);
    assert.ok(sunset.keyColor[0] > sunset.keyColor[2] * 5, 'the low sun is red');
    assert.ok(sunset.keySize > noon.keySize, 'and its shadows are softer');
    const night = sky(-30);
    assert.equal(night.mode, 'night');
    assert.equal(night.stars, 1);
    assert.equal(noon.stars, 0);
    assert.ok(luma(night.keyColor) < luma(noon.keyColor) / 8, 'even a full moon is faint beside the sun');
    assert.ok(luma(night.ambient[2]) < luma(noon.ambient[2]) / 2.5, 'and so is the night sky, even then');
    assert.equal(luma(night.sunDisc), 0, 'the sun has set');
    assert.ok(night.keyDir[1] > 0, 'the moon is up');
  });

  it('lets lamps count for more as the daylight goes', () => {
    assert.ok(sky(40).lamp < sky(3).lamp && sky(3).lamp < sky(-20).lamp);
    assert.equal(sky(-20).lamp, 1);
  });

  it('never loses its way between day and night', () => {
    for (let elevation = 90; elevation >= -90; elevation -= 1.5) {
      const s = sky(elevation, (elevation * 7 + 360) % 360);
      const values = [...s.keyColor, ...s.ambient.flat(), ...s.ground, ...s.sunDisc, ...s.keyDir];
      assert.ok(
        values.every((v) => Number.isFinite(v) && v >= -1),
        `finite at ${elevation}°`,
      );
      assert.ok(s.air.every(Number.isFinite) && s.haze.every(Number.isFinite), `sky finite at ${elevation}°`);
      assert.ok(luma(s.ambient[2]) > 0, `some light from above at ${elevation}°`);
    }
  });

  it('dims the sun under cloud', () => {
    const clear = sky(40, 200, 0.1);
    const overcast = sky(40, 200, 0.95);
    assert.ok(luma(overcast.keyColor) < luma(clear.keyColor) * 0.3);
    assert.ok(luma(overcast.ambient[2]) > luma(clear.ambient[2]) * 0.6, 'the light comes from all round instead');
    assert.equal(cloudCover('sunny'), 0.12);
    assert.equal(cloudCover('cloudy', 40), 0.4, 'a measured cover wins over the condition');
    assert.ok(cloudCover('pouring')! > cloudCover('partlycloudy')!);
    assert.equal(cloudCover('unknown'), undefined);
  });

  it('knows the phase of the moon', () => {
    assert.ok(Math.abs(moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14)))) < 0.001, 'new');
    // Full moon of 2026-06-29, 23:57 UTC.
    assert.ok(Math.abs(moonPhase(new Date(Date.UTC(2026, 5, 29, 23, 57))) - 0.5) < 0.02, 'full');
  });
});

describe('the camera', () => {
  const corners: [number, number, number][] = [];
  for (const x of [0, 10]) for (const y of [0, 8]) for (const z of [0, 7]) corners.push([x, y, z]);
  const viewport = { width: 760, height: 420, left: 20, right: 20, top: 12, bottom: 64 };

  it('frames what it is shown, inside the margins, from any side', () => {
    for (const yaw of [OUTSIDE.yaw, 0, 2, 3.6, -1.2]) {
      for (const pitch of [OUTSIDE.pitch, INSIDE.pitch, 1.2]) {
        const pose = fit(corners, yaw, pitch, viewport, 20);
        const camera = cameraFor(pose, viewport.width / viewport.height, 20);
        const screen = corners.map((p) => project(camera, toWorld(...p), viewport.width, viewport.height));
        const xs = screen.map((p) => p[0]);
        const ys = screen.map((p) => p[1]);
        assert.ok(
          Math.min(...xs) >= viewport.left - 1 && Math.max(...xs) <= viewport.width - viewport.right + 1,
          `fits across at ${yaw}`,
        );
        assert.ok(
          Math.min(...ys) >= viewport.top - 1 && Math.max(...ys) <= viewport.height - viewport.bottom + 1,
          `fits down at ${yaw}`,
        );
        // It fills one of the two directions.
        const tight =
          Math.max(...xs) - Math.min(...xs) > viewport.width - viewport.left - viewport.right - 3 ||
          Math.max(...ys) - Math.min(...ys) > viewport.height - viewport.top - viewport.bottom - 3;
        assert.ok(tight, `no wasted space at ${yaw}, ${pitch}`);
      }
    }
  });

  it('shows what is higher up higher on the screen', () => {
    const pose = fit(corners, OUTSIDE.yaw, OUTSIDE.pitch, viewport, 20);
    const camera = cameraFor(pose, viewport.width / viewport.height, 20);
    const low = project(camera, toWorld(5, 4, 0), viewport.width, viewport.height);
    const high = project(camera, toWorld(5, 4, 6), viewport.width, viewport.height);
    assert.ok(high[1] < low[1]);
    // From the front right, the right side of the house is on the right of the picture.
    const left = project(camera, toWorld(0, 8, 0), viewport.width, viewport.height);
    const right = project(camera, toWorld(10, 8, 0), viewport.width, viewport.height);
    assert.ok(right[0] > left[0]);
  });

  it('cuts away the walls between the viewer and the rooms', () => {
    assert.deepEqual(wallsKept(OUTSIDE.yaw), [0, 0, 1, 1], 'from the front right: front and right go');
    assert.deepEqual(wallsKept(OUTSIDE.yaw + Math.PI), [1, 1, 0, 0], 'from the back left: back and left go');
    assert.deepEqual(wallsKept(0), [0, 1, 1, 1], 'from straight in front: only the front goes');
  });

  it('looks out level at the sky, wherever the camera is', () => {
    const frame = skyFrame(OUTSIDE.yaw, 760, 420);
    assert.ok(frame.forward[1] > 0 && frame.forward[1] < 0.5, 'a little above the horizon');
    const bottom = frame.forward[1] - frame.up[1];
    assert.ok(
      Math.abs(Math.asin(bottom / Math.hypot(...frame.forward.map((v, i) => v - frame.up[i]))) + 0.052) < 0.02,
      'the horizon is near the bottom',
    );
  });
});
