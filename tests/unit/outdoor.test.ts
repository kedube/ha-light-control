// Lights outdoors: what their names say, and that they stand all round the house as a real
// house's do, by its doors, on its corners, along its paths and in its beds, never in a row.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STYLES, type StyleName } from '../../src/house/materials.ts';
import { VERTEX_BYTES } from '../../src/house/mesh.ts';
import { buildModel, type Model, type RoomInput } from '../../src/house/model.ts';
import { facadeFor } from '../../src/house/model/massing.ts';
import { aimFor, aimOf } from '../../src/house/model/outdoor.ts';
import { backDoor, frontDoor, planHouse, type HousePlan } from '../../src/house/plan.ts';
import type { RoomType } from '../../src/room-types.ts';

const rooms = (...types: RoomType[]) => types.map((type, i) => ({ id: `${type}${i}`, type }));

function plan(name: StyleName = 'colonial', garage = true): HousePlan {
  return planHouse(
    [
      {
        id: 'g',
        level: 0,
        rooms: [...rooms('living', 'kitchen', 'dining', 'hallway'), ...(garage ? rooms('garage') : [])],
      },
      { id: 'u', level: 1, rooms: rooms('bedroom', 'kids', 'office', 'bathroom') },
    ],
    [],
    facadeFor(STYLES[name]),
  );
}

const area = (id: string, name: string, type: RoomType, ...lights: string[]): RoomInput => ({
  id,
  name,
  type,
  lights: lights.map((light, i) => ({ id: `light.${id}_${i}`, name: light })),
});

/** The outside of a home with one area for everything outdoors, as many homes have it. */
const EVERYTHING = [
  'Porch Light',
  'Garage Left',
  'Garage Right',
  'Landscape Lights',
  'Driveway Lights',
  'Lamp Post',
  'Walkway Lights',
  'Rear Lights',
  'Side Light',
  'Yard Flood',
  'String Lights',
  'Christmas Tree',
  'Holiday Lights',
];

function build(outdoor: RoomInput[], p = plan(), name: StyleName = 'colonial'): Model {
  return buildModel({ plan: p, rooms: new Map(), outdoor, style: STYLES[name] });
}

/** Where everything that glows for a light is, in plan space. */
function glowOf(m: Model, lightId: string): [number, number, number][] {
  const slot = m.fixtures.find((f) => f.lightId === lightId)!.slot;
  const f32 = new Float32Array(m.mesh.vertices);
  const u8 = new Uint8Array(m.mesh.vertices);
  const out: [number, number, number][] = [];
  for (let i = 0; i < m.mesh.vertexCount; i++) {
    if (u8[i * VERTEX_BYTES + 29] === slot) out.push([f32[i * 8], f32[i * 8 + 2], f32[i * 8 + 1]]);
  }
  return out;
}

describe('lights outdoors', () => {
  it('know from their names what they are and where they go, in the card’s languages', () => {
    const cases: [string, string | null, string | null, number?][] = [
      ['Porch Light', null, 'door'],
      ['Front Door Lantern', null, 'door'],
      ['Garage Left', null, 'garage', -1],
      ['Garage Right', null, 'garage', 1],
      ['Landscape Lights', 'landscape', null],
      ['Driveway Lights', 'driveway', null],
      ['Lamp Post', 'post', null],
      ['Walkway Lights', 'path', null],
      ['Rear Lights', null, 'back'],
      ['Side Light', null, 'side'],
      ['Backyard Flood', 'flood', 'back'],
      ['String Lights', 'string', null],
      ['Bistro Lights', 'string', null],
      ['Christmas Tree', 'tree', null],
      ['Holiday Lights', 'roofline', null],
      ['Pool Light', 'pool', null],
      ['Weihnachtsbaum', 'tree', null],
      ['Einfahrt', 'driveway', null],
      ['Gartenweg', 'path', 'garden'],
      ['Lichterkette Terrasse', 'string', 'back'],
      ['Guirlande', 'string', null],
      ['Farola', 'post', null],
      ['Kerstboom', 'tree', null],
      ['Lampione giardino', 'post', 'garden'],
    ];
    for (const [name, fitting, place, hand = 0] of cases) {
      assert.deepEqual(aimOf(name), { fitting, place, hand }, name);
    }
    // "Outside" is no side of the house.
    assert.equal(aimOf('Outside').place, null);
    assert.equal(aimOf('Outside Light').place, null);
  });

  it('go where their area’s name or kind says, when their own names say nothing', () => {
    assert.deepEqual(aimFor('Light 1', { name: 'Backyard', type: 'garden' }), {
      fitting: null,
      place: 'back',
      hand: 0,
    });
    assert.deepEqual(aimFor('Light 1', { name: 'Front Porch', type: 'porch' }), {
      fitting: 'lantern',
      place: 'door',
      hand: 0,
    });
    assert.equal(aimFor('Light 1', { name: 'Driveway', type: 'driveway' }).fitting, 'driveway');
    assert.equal(aimFor('Light 1', { name: 'Outside', type: 'garden' }).place, null);
    // A light named for a place has a lantern there, whatever its area is for.
    assert.deepEqual(aimFor('Garage Light', { name: 'Driveway', type: 'driveway' }), {
      fitting: null,
      place: 'garage',
      hand: 0,
    });
  });

  it('stand all round the house, never in a row', () => {
    const p = plan();
    const outside = area('outside', 'Outside', 'garden', ...EVERYTHING);
    const m = build([outside], p);
    const W = p.width;
    const D = p.depth;
    // One row of the light table each.
    assert.deepEqual(m.fixtures.map((f) => f.lightId).sort(), outside.lights.map((l) => l.id).sort());
    const at = m.fixtures.map((f) => f.at);
    // In front, behind, beside and by the garage.
    assert.ok(
      at.some(([, y]) => y > D + 1),
      'in front of the house',
    );
    assert.ok(
      at.some(([, y]) => y < 0),
      'behind it',
    );
    assert.ok(
      at.some(([x]) => x > W),
      'beside it',
    );
    assert.ok(
      at.some(([x]) => x < 0),
      'by the garage',
    );
    // Not along one line: no line through two of them passes near most of the rest.
    for (let i = 0; i < at.length; i++) {
      for (let j = i + 1; j < at.length; j++) {
        const [a, b] = [at[i], at[j]];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 1) continue;
        const near = at.filter(
          (q) => Math.abs((b[0] - a[0]) * (a[1] - q[1]) - (a[0] - q[0]) * (b[1] - a[1])) / length < 0.4,
        ).length;
        assert.ok(near <= at.length / 2, `${near} of ${at.length} lights in a row`);
      }
    }
    // Each where its name says.
    const fixture = (name: string) => m.fixtures[EVERYTHING.indexOf(name)];
    const tree = fixture('Christmas Tree').at;
    assert.ok(tree[1] > D + 1 && tree[0] > 0 && tree[0] < W + 2, 'the tree on the front lawn');
    const post = fixture('Lamp Post').at;
    assert.ok(post[1] > D + 2 && post[2] > 1.8, 'the lamppost out by the pavement');
    const rear = fixture('Rear Lights').at;
    assert.ok(rear[1] < 0 && Math.abs(rear[0] - backDoor(p)!.x) < 0.01, 'the rear lights by the back door');
    const eaves = fixture('Holiday Lights');
    assert.equal(eaves.kind, 'strip');
    assert.ok(eaves.at[2] > p.base + 2.5 && eaves.at[1] > D && Math.abs(eaves.along![0]) > W * 0.8, 'along the eaves');
  });

  it('flank the doors with a lantern either side, or give each of a pair its own', () => {
    const p = plan();
    const m = build([area('outside', 'Outside', 'garden', 'Porch Light', 'Garage Left', 'Garage Right')], p);
    const door = frontDoor(p)!.x;
    const porch = glowOf(m, 'light.outside_0');
    const left = Math.min(...porch.map(([x]) => x));
    const right = Math.max(...porch.map(([x]) => x));
    assert.ok(left < door - 0.6 && right > door + 0.6, 'either side of the front door');
    assert.ok(Math.abs(left + right - 2 * door) < 0.05, 'the same either side');
    const wing = p.wing!.rect;
    const middle = (wing.x0 + wing.x1) / 2;
    assert.ok(
      glowOf(m, 'light.outside_1').every(([x]) => x < middle),
      'the left one on the left',
    );
    assert.ok(
      glowOf(m, 'light.outside_2').every(([x]) => x > middle),
      'the right one on the right',
    );
  });

  it('take their places from their areas: a porch, a driveway, a back yard', () => {
    const p = plan();
    const m = build(
      [
        area('porch', 'Front Porch', 'porch', 'Light'),
        area('drive', 'Driveway', 'driveway', 'Light 1', 'Light 2'),
        area('back', 'Backyard', 'garden', 'Light'),
      ],
      p,
    );
    const door = frontDoor(p)!.x;
    const porch = m.fixtures.find((f) => f.roomId === 'porch')!;
    assert.ok(Math.abs(porch.at[0] - door) < 0.05 && porch.at[1] > p.depth, 'by the front door');
    const drive = m.fixtures.filter((f) => f.roomId === 'drive');
    assert.equal(drive.length, 2);
    for (const f of drive) assert.equal(f.kind, 'strip', 'a row of bollards along the drive');
    // One side of the drive each.
    const sides = drive.map((f) => glowOf(m, f.lightId).map(([x]) => x));
    assert.ok(Math.max(...sides[0]) < Math.min(...sides[1]) || Math.max(...sides[1]) < Math.min(...sides[0]));
    const back = m.fixtures.find((f) => f.roomId === 'back')!;
    assert.ok(back.at[1] < 0, 'behind the house');
  });

  it('never run out of places, and never pile up', () => {
    const p = plan('capecod');
    const names = Array.from({ length: 30 }, (_, i) => `Light ${i + 1}`);
    const m = build([area('outside', 'Exterior', 'garden', ...names)], p, 'capecod');
    assert.equal(m.fixtures.length, 30, 'every light has a place');
    const at = m.fixtures.map((f) => f.at);
    for (let i = 0; i < at.length; i++) {
      const crowd = at.filter((q) => Math.hypot(q[0] - at[i][0], q[1] - at[i][1], q[2] - at[i][2]) < 0.3).length;
      assert.ok(crowd <= 1, `lights stand apart: ${crowd} at (${at[i][0].toFixed(1)}, ${at[i][1].toFixed(1)})`);
    }
  });

  it('light a pool from inside, and a house without a garage too', () => {
    const p = plan('mediterranean', false);
    const m = build(
      [
        area('pool', 'Pool', 'pool', 'Pool Light'),
        area('outside', 'Outside', 'garden', 'Garage Lights', 'Driveway Lights', 'Christmas Tree'),
      ],
      p,
      'mediterranean',
    );
    assert.equal(m.fixtures.length, 4);
    const pool = m.fixtures.find((f) => f.roomId === 'pool')!;
    assert.ok(pool.at[0] > p.width, 'over the pool beside the house');
    assert.ok(m.fixtures.every((f) => f.at.every(Number.isFinite)));
  });
});
