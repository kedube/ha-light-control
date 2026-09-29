import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { box, paintOrder, paintsBefore, project } from '../../src/house/iso.ts';
import { environment, lit, MATERIAL } from '../../src/house/palette.ts';
import { planHouse } from '../../src/house/plan.ts';
import { buildScene, fixtureKind, roomLamp, type RoomLights, type SceneView } from '../../src/house/scene.ts';
import { skyMode, sunFromLeft } from '../../src/house/sky.ts';

const light = (name: string, on = true, level = 0.8) => ({
  id: name,
  name,
  on,
  level,
  rgb: [255, 180, 100] as [number, number, number],
});

const rooms: RoomLights[] = [
  { id: 'living', type: 'living', lights: [light('Ceiling'), light('Floor Lamp'), light('TV Backlight', false)] },
  { id: 'kitchen', type: 'kitchen', lights: [light('Pendants', false)] },
  { id: 'bed', type: 'bedroom', lights: [light('Bedside Lamp', true, 0.2)] },
];
const outdoor: RoomLights[] = [{ id: 'garden', type: 'garden', lights: [light('Path')] }];
const plan = planHouse([
  { id: 'g', level: 0, rooms: rooms.slice(0, 2).map((r) => ({ id: r.id, type: r.type })) },
  { id: 'u', level: 1, rooms: [{ id: 'bed', type: 'bedroom' }] },
]);

const scene = (view: SceneView, mode: 'day' | 'night' = 'night') =>
  buildScene({
    plan,
    rooms: new Map(rooms.map((r) => [r.id, r])),
    outdoor,
    env: environment(mode, true),
    view,
    prefix: 't-',
  });

describe('isometric projection', () => {
  it('puts nearer points lower on the picture', () => {
    assert.deepEqual(project(0, 0, 0), [0, 0]);
    assert.ok(project(1, 1, 0)[1] > project(0, 0, 0)[1]);
    assert.ok(project(0, 0, 1)[1] < project(0, 0, 0)[1], 'up is up');
  });

  it('paints farther boxes first', () => {
    const back = box(0, 0, 0, 1, 1, 1);
    const front = box(2, 0, 0, 3, 1, 1);
    const above = box(0, 0, 2, 1, 1, 3);
    assert.equal(paintsBefore(back, front), true);
    assert.equal(paintsBefore(front, back), false);
    assert.equal(paintsBefore(back, above), true);
    const order = paintOrder([
      { box: front, name: 'front' },
      { box: back, name: 'back' },
    ]);
    assert.deepEqual(
      order.map((o) => o.name),
      ['back', 'front'],
    );
  });

  it('orders a long wall correctly against a chair beside it', () => {
    // The wall runs along x = 5; a chair on its far side must be painted before it.
    const wall = box(4.95, 0, 0, 5.05, 8, 1.1);
    const chair = box(3, 6, 0, 3.5, 6.5, 0.9);
    assert.deepEqual(
      paintOrder([
        { box: wall, name: 'wall' },
        { box: chair, name: 'chair' },
      ]).map((o) => o.name),
      ['chair', 'wall'],
    );
  });
});

describe('lighting', () => {
  it('keeps rooms dark at night until a lamp is on', () => {
    const night = environment('night', true);
    const dark = lit(MATERIAL.plaster, 1, night);
    const bright = lit(MATERIAL.plaster, 1, night, { rgb: [255, 200, 150], intensity: 1 });
    assert.ok(Number.parseInt(bright.slice(1, 3), 16) > Number.parseInt(dark.slice(1, 3), 16) + 80);
  });

  it('mixes a room’s lamps into one softer light', () => {
    assert.equal(roomLamp([light('A', false)]), null);
    const lamp = roomLamp([light('Ceiling', true, 1)])!;
    assert.ok(lamp.intensity > 0.5 && lamp.intensity <= 1);
    const dim = roomLamp([light('Ceiling', true, 0.1)])!;
    assert.ok(dim.intensity < lamp.intensity);
  });

  it('tells ceiling lights, pendants, lamps and strips apart by name', () => {
    assert.equal(fixtureKind('Living Room Ceiling'), 'ceiling');
    assert.equal(fixtureKind('Kitchen Pendants'), 'pendant');
    assert.equal(fixtureKind('Floor Lamp'), 'lamp');
    assert.equal(fixtureKind('Stehlampe'), 'lamp');
    assert.equal(fixtureKind('TV Backlight'), 'strip');
    assert.equal(fixtureKind('Under Cabinet'), 'strip');
  });

  it('follows the sun', () => {
    assert.equal(skyMode({ elevation: 30 }), 'day');
    assert.equal(skyMode({ elevation: 2 }), 'dusk');
    assert.equal(skyMode({ elevation: -20 }), 'night');
    assert.equal(skyMode(undefined, new Date(2026, 0, 1, 23, 0)), 'night');
    assert.equal(sunFromLeft({ azimuth: 100 }), true);
    assert.equal(sunFromLeft({ azimuth: 250 }), false);
  });
});

describe('buildScene', () => {
  it('shows the house from outside with a clickable window for every room', () => {
    const outside = scene({ kind: 'exterior', focus: 'house' });
    assert.ok(outside.shapes.length > 50);
    const hit = new Set(outside.hits.map((h) => h.roomId));
    for (const id of ['living', 'kitchen', 'bed', 'garden']) assert.ok(hit.has(id), `${id} can be clicked`);
    for (const value of Object.values(outside.bounds)) assert.ok(Number.isFinite(value));
  });

  it('opens a floor like a dollhouse, labelling only that floor’s rooms', () => {
    const ground = scene({ kind: 'cutaway', story: 0 });
    assert.deepEqual([...new Set(ground.anchors.map((a) => a.roomId))].sort(), ['kitchen', 'living']);
    assert.ok(ground.volumes.has('living'));
    assert.ok(
      ground.shapes.some((s) => s.kind === 'glow' && (s.opacity ?? 0) > 0),
      'a lamp throws light',
    );
  });

  it('keeps the same shapes when a light changes, so it can fade instead of jumping', () => {
    const before = scene({ kind: 'cutaway', story: 0 });
    rooms[1].lights[0].on = true;
    const after = scene({ kind: 'cutaway', story: 0 });
    rooms[1].lights[0].on = false;
    assert.equal(after.shapes.length, before.shapes.length);
    assert.notDeepEqual(after.shapes, before.shapes);
  });

  it('uses the prefix for ids, so two scenes can share a picture', () => {
    const s = scene({ kind: 'cutaway', story: 1 });
    assert.ok(s.gradients.every((g) => g.id.startsWith('t-')));
    assert.ok(s.clips.every((c) => c.id.startsWith('t-')));
  });

  it('finds a place outside for every outdoor area, without overlaps', () => {
    const many: RoomLights[] = ['garden', 'garden', 'garden', 'garden', 'porch', 'pool', 'driveway', 'garden'].map(
      (type, i) => ({
        id: `out${i}`,
        type: type as RoomLights['type'],
        lights: [light(`Lamp ${i}`)],
      }),
    );
    const withGarage = planHouse(
      [],
      [
        { id: 'living', type: 'living' },
        { id: 'kitchen', type: 'kitchen' },
        { id: 'garage', type: 'garage' },
      ],
    );
    const outside = buildScene({
      plan: withGarage,
      rooms: new Map(),
      outdoor: many,
      env: environment('night', true),
      view: { kind: 'exterior', focus: 'outside' },
    });
    for (const room of many)
      assert.ok(
        outside.hits.some((h) => h.roomId === room.id),
        `${room.id} is in the picture`,
      );
    const areas = many.map((r) => outside.volumes.get(r.id)!);
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

  it('draws a daytime scene too', () => {
    assert.ok(scene({ kind: 'exterior', focus: 'outside' }, 'day').shapes.length > 50);
  });
});
