import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STYLE_NAMES, STYLES } from '../../src/house/materials.ts';
import { facadeFor } from '../../src/house/model/massing.ts';
import {
  bayMiddles,
  facadesOf,
  floorLevels,
  frontDoor,
  GROUND_ID,
  groundLevel,
  planHouse,
  sortFloors,
  span,
  stairsBay,
  type HousePlan,
  type PlanFloorInput,
  type PlanRoomInput,
  type Side,
} from '../../src/house/plan.ts';
import type { RoomType } from '../../src/room-types.ts';

const rooms = (...types: RoomType[]): PlanRoomInput[] => types.map((type, i) => ({ id: `${type}${i}`, type }));

const demo: PlanFloorInput[] = [
  { id: 'ground', level: 0, rooms: rooms('living', 'kitchen', 'dining', 'hallway', 'garage') },
  { id: 'upstairs', level: 1, rooms: rooms('bedroom', 'kids', 'office', 'bathroom') },
  { id: 'basement', level: -1, rooms: rooms('media', 'laundry') },
];

const area = (r: { x0: number; y0: number; x1: number; y1: number }) => (r.x1 - r.x0) * (r.y1 - r.y0);

/** Every story is tiled exactly by its cells: inside the footprint, no overlaps, no gaps. */
function assertTiled(plan: HousePlan): void {
  for (const story of plan.stories) {
    const total = story.cells.reduce((sum, c) => sum + area(c.rect), 0);
    assert.ok(
      Math.abs(total - plan.width * plan.depth) < 0.05,
      `${story.id}: cells cover ${total} of ${plan.width * plan.depth}`,
    );
    for (const cell of story.cells) {
      const r = cell.rect;
      assert.ok(
        r.x0 >= -1e-6 && r.y0 >= -1e-6 && r.x1 <= plan.width + 1e-6 && r.y1 <= plan.depth + 1e-6,
        `${cell.id} is outside`,
      );
      assert.ok(r.x1 - r.x0 > 0.3 && r.y1 - r.y0 > 0.3, `${cell.id ?? cell.type} is a sliver`);
    }
    for (let i = 0; i < story.cells.length; i++) {
      for (let j = i + 1; j < story.cells.length; j++) {
        const a = story.cells[i].rect;
        const b = story.cells[j].rect;
        const overlap =
          Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
          Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
        assert.ok(overlap < 1e-3, `${story.cells[i].id} overlaps ${story.cells[j].id}`);
      }
    }
  }
}

describe('planHouse', () => {
  it('stacks floors by level, with the basement below ground', () => {
    const plan = planHouse(demo);
    assert.deepEqual(
      plan.stories.map((s) => [s.id, s.basement, s.ground]),
      [
        ['basement', true, false],
        ['ground', false, true],
        ['upstairs', false, false],
      ],
    );
    assert.ok(plan.stories[0].z < 0 && plan.stories[1].z > 0 && plan.stories[2].z > plan.stories[1].z);
  });

  it('places every room exactly once and tiles each floor', () => {
    const plan = planHouse(demo);
    assertTiled(plan);
    const placed = [...plan.stories.flatMap((s) => s.cells.map((c) => c.id)), plan.wing?.id].filter(Boolean);
    const expected = demo.flatMap((f) => f.rooms.map((r) => r.id));
    assert.deepEqual([...placed].sort(), [...expected].sort());
  });

  it('builds the garage on as a wing beside the house', () => {
    const plan = planHouse(demo);
    const wing = plan.wing!;
    assert.equal(wing.type, 'garage');
    assert.ok(wing.rect.x1 === 0 && wing.rect.x0 < -3, 'left of the house, wide enough for a car');
    assert.ok(wing.rect.y0 >= 0 && wing.rect.y1 < plan.depth, 'set back from the front');
    assert.ok(wing.rect.y1 - wing.rect.y0 > 4.5, 'long enough for a car');
    assert.ok(!plan.stories.some((s) => s.cells.some((c) => c.type === 'garage')), 'and not inside it as well');
    // A garage that is all there is stays the house; a second one stays inside.
    const alone = planHouse([], rooms('garage'));
    assert.equal(alone.wing, null);
    assert.equal(alone.stories[0].cells[0].type, 'garage');
    const two = planHouse([], [...rooms('living', 'garage'), { id: 'second', type: 'garage' }]);
    assert.equal(two.wing!.id, 'garage1');
    assert.ok(two.stories[0].cells.some((c) => c.id === 'second'));
    assert.equal(planHouse([], rooms('living', 'kitchen')).wing, null);
  });

  it('gives every room a wall the viewer can see when there is space along the outside', () => {
    // Closets, storage and rooms that don't fit along the outside walls go to the middle instead.
    const plan = planHouse(demo);
    for (const story of plan.stories) {
      for (const cell of story.cells) {
        if (cell.id) assert.ok(facadesOf(cell, plan).length > 0, `${cell.id} has no visible wall`);
      }
    }
  });

  it('puts the stairs in the same place on every floor, behind the front door, and none in a bungalow', () => {
    const plan = planHouse(demo);
    const [x0, x1] = stairsBay(plan);
    assert.ok(Math.abs((x0 + x1) / 2 - plan.width / 2) < 1e-6, 'in the middle bay');
    for (const story of plan.stories) {
      const stairs = story.cells.find((c) => c.type === 'stairs');
      assert.ok(stairs, `${story.id} has stairs`);
      assert.deepEqual([stairs.rect.x0, stairs.rect.y0, stairs.rect.x1], [x0, 0, x1]);
    }
    const bungalow = planHouse([], rooms('living', 'kitchen', 'bedroom', 'bathroom'));
    assert.ok(!bungalow.stories[0].cells.some((c) => c.type === 'stairs'));
  });

  it('uses a Stairs area as the stairwell', () => {
    const plan = planHouse([
      { id: 'g', level: 0, rooms: [{ id: 'my_stairs', type: 'stairs' }, ...rooms('living')] },
      { id: 'u', level: 1, rooms: rooms('bedroom') },
    ]);
    const stairs = plan.stories[0].cells.find((c) => c.type === 'stairs')!;
    assert.equal(stairs.id, 'my_stairs');
    assert.equal(plan.stories[1].cells.find((c) => c.type === 'stairs')!.id, null);
  });

  it('keeps rooms in proportion', () => {
    for (const plan of [planHouse(demo), planHouse([], rooms('living', 'kitchen', 'bedroom', 'bathroom'))]) {
      for (const story of plan.stories) {
        for (const cell of story.cells) {
          if (!cell.id || cell.type === 'hallway') continue;
          const w = cell.rect.x1 - cell.rect.x0;
          const d = cell.rect.y1 - cell.rect.y0;
          assert.ok(Math.max(w, d) / Math.min(w, d) < 2.8, `${cell.id} is ${w.toFixed(1)} × ${d.toFixed(1)}`);
        }
      }
    }
  });

  it('builds one story for a home without floors, and moves rooms without a floor to the ground', () => {
    const flat = planHouse([], rooms('living', 'bedroom'));
    assert.deepEqual(
      flat.stories.map((s) => s.id),
      [GROUND_ID],
    );
    const plan = planHouse(
      [
        { id: 'up', level: 1, rooms: rooms('bedroom') },
        { id: 'g', level: 0, rooms: rooms('living') },
      ],
      [{ id: 'orphan', type: 'office' }],
    );
    const ground = plan.stories.find((s) => s.ground)!;
    assert.equal(ground.id, 'g');
    assert.ok(ground.cells.some((c) => c.id === 'orphan'));
  });

  it('fills a single-room floor, and moves crowded rooms off the outside walls', () => {
    const tiny = planHouse([], [{ id: 'studio', type: 'living' }]);
    assert.equal(tiny.stories[0].cells.length, 1);
    assert.deepEqual(tiny.stories[0].cells[0].rect, { x0: 0, y0: 0, x1: tiny.width, y1: tiny.depth });

    const crowded = planHouse(
      [],
      rooms('living', 'kitchen', 'dining', 'office', 'bathroom', 'laundry', 'media', 'gym', 'guest', 'bedroom', 'kids'),
    );
    assertTiled(crowded);
    assert.equal(crowded.stories[0].cells.filter((c) => c.id).length, 11);
  });

  it('is deterministic', () => {
    assert.deepEqual(planHouse(demo), planHouse(demo));
  });

  it('puts floors without a level above the others instead of merging them', () => {
    assert.deepEqual(
      [
        ...floorLevels([
          { id: 'attic', level: null },
          { id: 'ground', level: 0 },
          { id: 'up', level: 1 },
        ]),
      ],
      [
        ['attic', 2],
        ['ground', 0],
        ['up', 1],
      ],
    );
    assert.deepEqual(
      [
        ...floorLevels([
          { id: 'a', level: null },
          { id: 'b', level: null },
        ]).values(),
      ],
      [0, 1],
    );
    const plan = planHouse([
      { id: 'attic', level: null, rooms: rooms('attic') },
      { id: 'ground', level: 0, rooms: rooms('living') },
      { id: 'up', level: 1, rooms: rooms('bedroom') },
    ]);
    assert.deepEqual(
      plan.stories.map((s) => s.id),
      ['ground', 'up', 'attic'],
    );
    assert.equal(groundLevel([-1, 2, 3]), 2);
    assert.equal(groundLevel([-2, -1]), -1);
  });

  it('sorts floors from the lowest up, keeping the list order where it cannot tell', () => {
    const ids = (floors: { id: string; level: number | null }[]) => sortFloors(floors).map((f) => f.id);
    assert.deepEqual(
      ids([
        { id: 'attic', level: null },
        { id: 'up', level: 1 },
        { id: 'ground', level: 0 },
        { id: 'basement', level: -1 },
      ]),
      ['basement', 'ground', 'up', 'attic'],
    );
    assert.deepEqual(
      ids([
        { id: 'b', level: null },
        { id: 'a', level: null },
      ]),
      ['b', 'a'],
    );
  });

  it('divides the walls into bays: an odd number across the front, so the door has the middle one', () => {
    const plans = [
      planHouse(demo),
      planHouse([], rooms('living')),
      planHouse([], rooms('living', 'kitchen', 'bedroom')),
    ];
    for (const name of STYLE_NAMES) plans.push(planHouse(demo, [], facadeFor(STYLES[name])));
    for (const plan of plans) {
      assert.equal(plan.bays.front % 2, 1);
      assert.ok(plan.bays.front >= 3 && plan.bays.side >= 1);
      for (const side of ['front', 'right'] as Side[]) {
        const middles = bayMiddles(plan, side);
        const bay = (side === 'front' ? plan.width : plan.depth) / middles.length;
        assert.ok(bay >= 1.8 && bay <= 3.3, `${side}: bays ${bay.toFixed(2)} m wide`);
        // Symmetrical about the middle of the wall.
        middles.forEach((u, i) =>
          assert.ok(Math.abs(u + middles[middles.length - 1 - i] - middles.length * bay) < 1e-2),
        );
      }
    }
    // Wide windows want wide bays.
    assert.ok(planHouse(demo, [], facadeFor(STYLES.midcentury)).bays.front < planHouse(demo).bays.front);
  });

  it('puts the front door in the middle, into the hall, or the living room without one', () => {
    const plan = planHouse(demo);
    const door = frontDoor(plan)!;
    assert.equal(door.x, plan.width / 2);
    assert.equal(door.cell.id, 'hallway3');
    assert.ok(door.cell.rect.x0 < door.x - 0.5 && door.cell.rect.x1 > door.x + 0.5, 'the door opens into the hall');
    const open = planHouse([
      { id: 'g', level: 0, rooms: rooms('kitchen', 'living', 'dining', 'bathroom') },
      { id: 'u', level: 1, rooms: rooms('bedroom') },
    ]);
    assert.equal(frontDoor(open)!.cell.id, 'living1');
    assert.equal(
      frontDoor(planHouse([], rooms('bedroom', 'office')))!.x,
      planHouse([], rooms('bedroom', 'office')).width / 2,
    );
  });

  it('fits the rooms in behind the windows: a wall between two rooms meets the front or the side between bays', () => {
    const homes: PlanFloorInput[][] = [
      demo,
      [{ id: 'g', level: 0, rooms: rooms('living', 'kitchen', 'bedroom', 'bathroom', 'office') }],
      [{ id: 'g', level: 0, rooms: rooms('kitchen', 'dining', 'living', 'laundry', 'office', 'guest') }],
    ];
    for (const floors of homes) {
      for (const name of STYLE_NAMES) {
        // Every floor with walls of its own: under a roof the windows are the roof's.
        const plan = planHouse(floors, [], facadeFor(STYLES[name], 'full'));
        assertTiled(plan);
        for (const story of plan.stories) {
          for (const side of ['front', 'right'] as Side[]) {
            const length = side === 'front' ? plan.width : plan.depth;
            const count = side === 'front' ? plan.bays.front : plan.bays.side;
            for (const cell of story.cells) {
              for (const end of span(cell, plan, side) ?? []) {
                const k = (end / length) * count;
                assert.ok(
                  Math.abs(k - Math.round(k)) < 1e-3,
                  `${name}, ${story.id}: ${cell.id ?? cell.type} ends at ${end} along the ${side}`,
                );
              }
            }
          }
        }
      }
    }
  });

  it('copes with no rooms at all', () => {
    assert.deepEqual(planHouse([]).stories, []);
  });
});
