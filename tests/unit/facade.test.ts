// The outside of the house as a builder sets it out: the front door in the middle, a window of
// one size in the middle of every bay, the same either side of the door, floor above floor; and the
// dormers in a row over them, symmetrical about the middle of the roof, or none when asked.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAT, STYLE_NAMES, STYLES, type HouseStyle, type StyleName } from '../../src/house/materials.ts';
import { VERTEX_BYTES } from '../../src/house/mesh.ts';
import { buildModel, type Model, type RoomInput } from '../../src/house/model.ts';
import { facadeFor, loftWindows, massingOf, type DormerChoice, type TopFloor } from '../../src/house/model/massing.ts';
import { bayMiddles, frontDoor, planHouse, span, type HousePlan, type PlanFloorInput } from '../../src/house/plan.ts';
import type { RoomType } from '../../src/room-types.ts';

const rooms = (...types: RoomType[]) => types.map((type, i) => ({ id: `${type}${i}`, type }));
const GROUND: PlanFloorInput = {
  id: 'ground',
  level: 0,
  rooms: rooms('living', 'kitchen', 'dining', 'hallway', 'garage'),
};
const UP: PlanFloorInput = { id: 'up', level: 1, rooms: rooms('bedroom', 'kids', 'office', 'bathroom') };
const ATTIC: PlanFloorInput = { id: 'attic', level: 2, attic: true, rooms: rooms('guest', 'attic') };
const CELLAR: PlanFloorInput = { id: 'cellar', level: -1, rooms: rooms('media', 'laundry') };
const HOMES: Record<string, PlanFloorInput[]> = {
  'two floors over a basement': [CELLAR, GROUND, UP],
  'two floors and an attic': [GROUND, UP, ATTIC],
  'one floor': [{ id: 'g', level: 0, rooms: rooms('living', 'kitchen', 'bedroom', 'bathroom', 'office') }],
  'no hall': [{ id: 'g', level: 0, rooms: rooms('kitchen', 'living', 'dining', 'laundry') }, UP],
};

/** A home built in a design, planned for it as the card plans it. */
function build(floors: PlanFloorInput[], name: StyleName, topFloor: TopFloor = 'auto', dormers?: DormerChoice) {
  const style = STYLES[name];
  const plan = planHouse(floors, [], facadeFor(style, topFloor, dormers));
  const inputs = new Map<string, RoomInput>();
  const cells = [...plan.stories.flatMap((s) => s.cells), ...(plan.wing ? [plan.wing] : [])];
  for (const cell of cells) {
    if (cell.id)
      inputs.set(cell.id, { id: cell.id, type: cell.type, lights: [{ id: `light.${cell.id}`, name: 'Ceiling' }] });
  }
  const model = buildModel({ plan, rooms: inputs, outdoor: [], style, topFloor, dormers });
  return { plan, model };
}

/** The panes of glass in the front wall, story by story, each from its left edge to its right. */
function frontPanes(model: Model, plan: HousePlan): Map<number, [number, number][]> {
  const f32 = new Float32Array(model.mesh.vertices);
  const u8 = new Uint8Array(model.mesh.vertices);
  const out = new Map<number, [number, number][]>();
  const glass = (i: number) =>
    u8[i * VERTEX_BYTES + 27] === MAT.glass && Math.abs(f32[i * 8 + 2] - (plan.depth - 0.097)) < 1e-3;
  for (let i = 0; i < model.mesh.vertexCount; i++) {
    if (!glass(i)) continue;
    // A pane is a quad: its four corners come one after another.
    const xs = [0, 1, 2, 3].map((k) => f32[(i + k) * 8]);
    const low = Math.min(...[0, 1, 2, 3].map((k) => f32[(i + k) * 8 + 1]));
    const story = plan.stories.filter((s) => s.z <= low + 0.05).at(-1)!.index;
    const list = out.get(story) ?? [];
    list.push([Math.min(...xs), Math.max(...xs)]);
    out.set(story, list);
    i += 3;
  }
  return out;
}

const near = (a: number, b: number, tolerance = 2e-3) => Math.abs(a - b) < tolerance;
const styleOf = (name: StyleName): HouseStyle => STYLES[name];

describe('the front of the house', () => {
  it('has its front door in the middle', () => {
    for (const [home, floors] of Object.entries(HOMES)) {
      for (const name of STYLE_NAMES) {
        const { plan } = build(floors, name);
        const door = frontDoor(plan);
        assert.ok(door, `${home}, ${name}: a front door`);
        assert.equal(door.x, plan.width / 2, `${home}, ${name}`);
        // In the middle bay, and wholly in the room it opens into.
        assert.ok(bayMiddles(plan, 'front').some((u) => near(u, door.x)));
        const range = span(door.cell, plan, 'front')!;
        assert.ok(range[0] < door.x - 0.6 && range[1] > door.x + 0.6, `${home}, ${name}: the door clears the walls`);
      }
    }
  });

  it('has a window of one size in every bay, the same either side of the door, floor above floor', () => {
    for (const [home, floors] of Object.entries(HOMES)) {
      for (const name of STYLE_NAMES) {
        const { plan, model } = build(floors, name);
        const middles = bayMiddles(plan, 'front');
        const panes = frontPanes(model, plan);
        for (const story of plan.stories) {
          // Under the roof the windows are in the dormers.
          if (story.index === model.loft) continue;
          const list = panes.get(story.index) ?? [];
          const what = `${home}, ${name}, ${story.id}`;
          const centres = list.map(([a, b]) => (a + b) / 2).sort((p, q) => p - q);
          // Every bay but the front door's has its window.
          const expected = middles.filter((u) => !(story.ground && near(u, plan.width / 2)));
          assert.equal(centres.length, expected.length, `${what}: ${centres.map((c) => c.toFixed(2))}`);
          centres.forEach((c, i) => assert.ok(near(c, expected[i]), `${what}: a window in the middle of its bay`));
          const widths = list.map(([a, b]) => b - a);
          assert.ok(
            widths.every((w) => near(w, widths[0])),
            `${what}: windows of one size, not ${widths.map((w) => w.toFixed(2))}`,
          );
        }
      }
    }
  });

  it('gives every room along the front and the side its windows', () => {
    for (const [home, floors] of Object.entries(HOMES)) {
      for (const name of STYLE_NAMES) {
        const { plan, model } = build(floors, name);
        const lit = new Set(model.spills.map((s) => s.roomId));
        for (const story of plan.stories) {
          for (const cell of story.cells) {
            if (!cell.id || cell.type === 'closet' || (!span(cell, plan, 'front') && !span(cell, plan, 'right')))
              continue;
            assert.ok(lit.has(cell.id), `${home}, ${name}: ${cell.id} has a window`);
          }
        }
      }
    }
  });
});

describe('the dormers', () => {
  /** The designs with a floor in the roof of a house with two floors and an attic. */
  const lofted = STYLE_NAMES.filter((name) => styleOf(name).loft);

  it('stand in a row over the windows, symmetrical about the middle of the roof', () => {
    for (const name of lofted) {
      for (const floors of [
        [GROUND, UP, ATTIC],
        [GROUND, UP],
      ]) {
        for (const choice of ['auto', 'off'] as DormerChoice[]) {
          const style = STYLES[name];
          const plan = planHouse(floors, [], facadeFor(style, 'roof', choice));
          const m = massingOf(plan, style, 'roof');
          const front = loftWindows(plan, style, m, choice).dormers.filter((d) => d.side === 'front');
          const half = plan.width / plan.bays.front / 2;
          const what = `${name}, ${floors.length} floors, ${choice}`;
          for (const d of front) {
            // On the middle of a bay below, or where two meet.
            const k = d.x / half;
            assert.ok(near(k, Math.round(k), 1e-2), `${what}: a dormer at ${d.x} is off the bays`);
          }
          // A gable to the front at one end of the house leaves the roof lopsided by design.
          const centred = !m.cross || near(m.cross.at, plan.width / 2);
          if (!centred || !front.length) continue;
          const xs = front.map((d) => d.x).sort((p, q) => p - q);
          xs.forEach((x, i) =>
            assert.ok(near(x + xs[xs.length - 1 - i], plan.width, 1e-2), `${what}: ${xs.map((v) => v.toFixed(2))}`),
          );
        }
      }
    }
    // The Cape Cod has a row of three over a front five bays wide.
    const plan = planHouse([GROUND, UP, ATTIC], [], facadeFor(STYLES.capecod));
    const m = massingOf(plan, STYLES.capecod);
    const xs = loftWindows(plan, STYLES.capecod, m)
      .dormers.filter((d) => d.kind === 'gable')
      .map((d) => d.x);
    assert.equal(xs.length, 3);
    assert.ok(near(xs[1], plan.width / 2), 'one over the front door');
  });

  it('can be left out, with glass in the roof for the rooms instead', () => {
    for (const name of lofted) {
      const style = STYLES[name];
      const plan = planHouse([GROUND, UP, ATTIC], [], facadeFor(style, 'auto', 'off'));
      const m = massingOf(plan, style);
      const { dormers, walls } = loftWindows(plan, style, m, 'off');
      assert.ok(
        dormers.every((d) => d.kind === 'skylight'),
        `${name}: no dormers`,
      );
      for (const cell of plan.stories[m.loft!.index].cells) {
        if (!cell.id || cell.type === 'closet') continue;
        assert.ok(
          dormers.some((d) => d.windows.some((w) => w.cell === cell)) || walls.some((w) => w.cell === cell),
          `${name}: ${cell.id} still has a window`,
        );
      }
    }
  });

  it('stand on a roof nobody lives under only when asked for, with dark glass', () => {
    for (const name of ['colonial', 'capecod', 'victorian', 'tudor', 'european'] as StyleName[]) {
      const auto = build([GROUND, UP], name, 'full');
      assert.equal(auto.model.loft, -1);
      const on = build([GROUND, UP], name, 'full', 'on');
      const windows = loftWindows(on.plan, STYLES[name], massingOf(on.plan, STYLES[name], 'full'), 'on');
      assert.equal(windows.attic, true, name);
      assert.ok(windows.dormers.length > 0 || name === 'tudor', `${name}: dormers on the attic`);
      assert.ok(
        windows.dormers.every((d) => d.windows.every((w) => w.cell === null)),
        `${name}: they light no room`,
      );
      const xs = windows.dormers.map((d) => d.x).sort((p, q) => p - q);
      if (styleOf(name).crossGable?.at !== 'left' && styleOf(name).crossGable?.at !== 'right') {
        xs.forEach((x, i) => assert.ok(near(x + xs[xs.length - 1 - i], on.plan.width, 1e-2), `${name}: symmetrical`));
      }
      // More of the house, and none of it lit by a room.
      assert.ok(on.model.mesh.vertexCount > auto.model.mesh.vertexCount || windows.dormers.length === 0, name);
    }
    // A roof too low for them stays as it is.
    const low = build([GROUND], 'ranch', 'auto', 'on');
    assert.equal(loftWindows(low.plan, STYLES.ranch, massingOf(low.plan, STYLES.ranch), 'on').dormers.length, 0);
  });
});
