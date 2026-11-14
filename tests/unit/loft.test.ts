// A floor under the roof: which floor is built there, how the roof stands over it, the windows it
// gets, and that nothing of it pokes out through the slopes.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAT, STYLE_NAMES, STYLES, type HouseStyle, type StyleName } from '../../src/house/materials.ts';
import { boxSides, MeshBuilder, VERTEX_BYTES, wireOf, type Region } from '../../src/house/mesh.ts';
import { buildModel, type Model, type RoomInput } from '../../src/house/model.ts';
import {
  chimneySpot,
  facadeFor,
  loftStory,
  loftWindows,
  massingOf,
  roofAt,
  under,
  wingRoofAt,
  type DormerChoice,
  type TopFloor,
} from '../../src/house/model/massing.ts';
import { planHouse, span, type PlanFloorInput } from '../../src/house/plan.ts';
import { isAtticFloor, type RoomType } from '../../src/room-types.ts';

const rooms = (...types: RoomType[]) => types.map((type, i) => ({ id: `${type}${i}`, type }));

const GROUND: PlanFloorInput = { id: 'ground', level: 0, rooms: rooms('living', 'kitchen', 'dining', 'hallway') };
const UP: PlanFloorInput = { id: 'up', level: 1, rooms: rooms('bedroom', 'kids', 'office', 'bathroom') };
const ATTIC: PlanFloorInput = { id: 'attic', level: 2, attic: true, rooms: rooms('guest', 'storage') };
const THIRD: PlanFloorInput = { id: 'third', level: 2, rooms: rooms('guest', 'gym') };
const CELLAR: PlanFloorInput = { id: 'cellar', level: -1, rooms: rooms('media', 'laundry') };

const oneStory = planHouse([GROUND]);
const twoStories = planHouse([GROUND, UP]);
const withCellar = planHouse([CELLAR, GROUND, UP]);
const withAttic = planHouse([GROUND, UP, ATTIC]);
const threeStories = planHouse([GROUND, UP, THIRD]);

const styleOf = (name: StyleName): HouseStyle => STYLES[name];
/** The designs with a roof that slopes, and so can have a floor under it. */
const PITCHED = STYLE_NAMES.filter((name) => styleOf(name).loft);

/** A plan made for a design, as the card makes one: its rooms are fitted in behind the design's windows. */
const designed = (floors: PlanFloorInput[], name: StyleName, topFloor: TopFloor = 'auto', dormers?: DormerChoice) =>
  planHouse(floors, [], facadeFor(STYLES[name], topFloor, dormers));

function model(floors: PlanFloorInput[], name: StyleName, topFloor?: TopFloor, dormers?: DormerChoice): Model {
  const plan = designed(floors, name, topFloor, dormers);
  const inputs = new Map<string, RoomInput>();
  for (const story of plan.stories) {
    for (const cell of story.cells) {
      if (!cell.id) continue;
      const light = (kind: string) => ({ id: `light.${cell.id}_${kind}`, name: `${cell.id} ${kind}` });
      inputs.set(cell.id, {
        id: cell.id,
        type: cell.type,
        lights: [light('ceiling'), light('lamp'), light('pendant')],
      });
    }
  }
  return buildModel({ plan, rooms: inputs, outdoor: [], style: STYLES[name], topFloor, dormers });
}

/** Every vertex of a mesh in plan space, with what it is made of and what it belongs to. */
function vertices(m: Model) {
  const f32 = new Float32Array(m.mesh.vertices);
  const u8 = new Uint8Array(m.mesh.vertices);
  const i8 = new Int8Array(m.mesh.vertices);
  return Array.from({ length: m.mesh.vertexCount }, (_, i) => ({
    x: f32[i * 8],
    y: f32[i * 8 + 2],
    z: f32[i * 8 + 1],
    group: i8[i * VERTEX_BYTES + 23],
    material: u8[i * VERTEX_BYTES + 27],
    room: u8[i * VERTEX_BYTES + 28],
  }));
}

describe('cutting shapes to fit under a roof', () => {
  // Under a slope that rises from the floor at x = 0 to 2 m at x = 2.
  const slope: Region = [{ n: [-1, 0, 1], d: 0 }];

  it('cuts a box off along a plane and closes it again', () => {
    const sides = boxSides(0, 0, 0, 2, 1, 2, slope);
    assert.equal(sides.filter((s) => s.cut).length, 1, 'one new side, over the cut');
    for (const side of sides) for (const [x, , z] of side.points) assert.ok(z <= x + 1e-6, 'nothing is left above');
    // A closed solid: every edge is shared by exactly two sides.
    const edges = new Map<string, number>();
    const key = (p: number[]) => p.map((v) => v.toFixed(4)).join(',');
    for (const side of sides) {
      side.points.forEach((p, i) => {
        const pair = [key(p), key(side.points[(i + 1) % side.points.length])].sort().join(' ');
        edges.set(pair, (edges.get(pair) ?? 0) + 1);
      });
    }
    assert.ok(
      [...edges.values()].every((n) => n === 2),
      'the wedge is closed all round',
    );
    const wire = wireOf(sides);
    assert.deepEqual([wire.points.length, wire.edges.length], [6, 9], 'a wedge has six corners and nine edges');
  });

  it('leaves alone what fits, and drops what does not', () => {
    assert.equal(boxSides(1.5, 0, 0, 2, 1, 1, slope).length, 6);
    assert.ok(boxSides(1.5, 0, 0, 2, 1, 1, slope).every((s) => !s.cut));
    assert.equal(boxSides(0, 0, 1, 0.5, 1, 2, slope).length, 0);
    assert.deepEqual(
      [wireOf(boxSides(0, 0, 0, 1, 1, 1)).points.length, wireOf(boxSides(0, 0, 0, 1, 1, 1)).edges.length],
      [8, 12],
    );
  });

  it('draws only what lies inside the regions it is given', () => {
    const count = (clip: Region[] | null, draw: (m: MeshBuilder) => void) => {
      const m = new MeshBuilder();
      m.with({ clip }, () => draw(m));
      const mesh = m.finish();
      const f32 = new Float32Array(mesh.vertices);
      const points = Array.from({ length: mesh.vertexCount }, (_, i) => [f32[i * 8], f32[i * 8 + 2], f32[i * 8 + 1]]);
      return { triangles: mesh.indices.length / 3, points };
    };
    const whole = count(null, (m) => m.box(0, 0, 0, 2, 1, 2));
    const cut = count([slope], (m) => m.box(0, 0, 0, 2, 1, 2));
    assert.equal(whole.triangles, 12);
    assert.ok(cut.triangles >= 8 && cut.points.every(([x, , z]) => z <= x + 1e-5));
    // A box that fits is drawn exactly as without clipping; rounded shapes are cut too.
    assert.equal(count([slope], (m) => m.box(1.5, 0, 0, 2, 1, 1)).triangles, 12);
    const round = count([slope], (m) => m.cylinder(1, 0.5, 0, 2, 0.4));
    assert.ok(round.triangles > 0 && round.points.every(([x, , z]) => z <= x + 1e-5));
    const soft = count([slope], (m) => m.softBox(0.2, 0, 0, 1.2, 1, 1.4, 0.05));
    assert.ok(soft.triangles > 0 && soft.points.every(([x, , z]) => z <= x + 1e-5));
    // Two regions side by side make one shape, with no side between them where the cut is left open.
    const left: Region = [{ n: [1, 0, 0], d: 1, open: true }];
    const right: Region = [{ n: [-1, 0, 0], d: -1, open: true }];
    const halves = count([left, right], (m) => m.box(0, 0, 0, 2, 1, 1));
    assert.equal(halves.triangles, 20, 'four sides in two pieces each, and two ends');
  });
});

describe('which floor is built into the roof', () => {
  it('puts the upper floor of a story-and-a-half house there', () => {
    for (const name of ['capecod', 'bungalow', 'craftsman', 'european'] as StyleName[]) {
      assert.equal(loftStory(twoStories, STYLES[name])?.id, 'up', name);
      assert.equal(loftStory(withCellar, STYLES[name])?.id, 'up', `${name}, with a basement`);
      assert.equal(loftStory(withAttic, STYLES[name])?.id, 'attic', `${name}, with two floors and an attic`);
    }
  });

  it('gives a taller design two full stories, and its third floor to the roof', () => {
    for (const name of ['colonial', 'victorian', 'farmhouse', 'tudor', 'brick'] as StyleName[]) {
      assert.equal(loftStory(twoStories, STYLES[name]), null, name);
      assert.equal(loftStory(withCellar, STYLES[name]), null, `${name}: a basement is not a story`);
      assert.equal(loftStory(threeStories, STYLES[name])?.id, 'third', name);
    }
  });

  it('builds an attic into any roof that slopes', () => {
    for (const name of PITCHED) assert.equal(loftStory(withAttic, STYLES[name])?.id, 'attic', name);
    // A low roof takes an attic, but never a floor that is not one.
    for (const name of ['ranch', 'mediterranean'] as StyleName[]) {
      assert.equal(loftStory(threeStories, STYLES[name]), null, name);
    }
    // Under a flat roof there is nowhere to put it.
    for (const name of ['midcentury', 'contemporary'] as StyleName[]) {
      assert.equal(loftStory(withAttic, STYLES[name]), null, name);
      assert.equal(loftStory(withAttic, STYLES[name], 'roof'), null, `${name}, even when asked`);
    }
  });

  it('never puts the ground floor there, and does as it is told for the rest', () => {
    for (const name of STYLE_NAMES) {
      assert.equal(loftStory(oneStory, STYLES[name]), null, name);
      assert.equal(loftStory(oneStory, STYLES[name], 'roof'), null, name);
      assert.equal(loftStory(planHouse([CELLAR, GROUND]), STYLES[name], 'roof'), null, name);
    }
    assert.equal(loftStory(twoStories, STYLES.colonial, 'roof')?.id, 'up');
    assert.equal(loftStory(twoStories, STYLES.capecod, 'full'), null);
    assert.equal(loftStory(withAttic, STYLES.capecod, 'full'), null);
  });

  it('knows an attic by its name, its icon or its rooms', () => {
    for (const name of [
      'Attic',
      'Loft',
      'Dachgeschoss',
      'DG',
      'Zolder',
      'Combles',
      'Buhardilla',
      'Mansarda',
      'Poddasze',
    ]) {
      assert.ok(isAtticFloor(name), name);
    }
    for (const name of ['Upstairs', 'Second Floor', 'Obergeschoss', 'Edge', 'Ground Floor']) {
      assert.ok(!isAtticFloor(name), name);
    }
    assert.ok(isAtticFloor('Top', 'mdi:home-roof'));
    assert.equal(withAttic.stories.at(-1)!.attic, true);
    assert.equal(threeStories.stories.at(-1)!.attic, false);
    // A top floor with nothing but attic rooms is one; a ground floor never is.
    const named = planHouse([GROUND, { id: 'top', level: 1, rooms: rooms('attic') }]);
    assert.equal(named.stories.at(-1)!.attic, true);
    assert.equal(planHouse([{ id: 'only', level: 0, attic: true, rooms: rooms('attic') }]).stories[0].attic, false);
    // What the planner adds to fill a sparse attic is more attic, not a hall.
    assert.ok(withAttic.stories.at(-1)!.cells.some((c) => !c.id && c.type === 'attic'));
    assert.ok(!threeStories.stories.at(-1)!.cells.some((c) => c.type === 'attic'));
  });
});

describe('the roof over it', () => {
  it('begins just above the floor instead of a story higher', () => {
    for (const name of PITCHED) {
      const style = styleOf(name);
      const built = massingOf(withAttic, style);
      const full = massingOf(withAttic, style, 'full');
      const attic = withAttic.stories.at(-1)!;
      assert.equal(built.loft, attic, name);
      assert.ok(Math.abs(built.top - (attic.z + style.loft!.knee)) < 1e-9, `${name}: low walls, then the roof`);
      assert.ok(Math.abs(full.top - (attic.z + withAttic.storyHeight)) < 1e-9, `${name}: a full story`);
      assert.ok(
        built.pitch >= style.pitch && built.pitch >= style.loft!.pitch,
        `${name} is steep enough to live under`,
      );
      // Somewhere to stand under the ridge.
      assert.ok(built.ridge - attic.z > 2.1, `${name} has headroom: ${(built.ridge - attic.z).toFixed(2)} m`);
    }
  });

  it('gives the height of the roof anywhere over the house', () => {
    const gabled = massingOf(withAttic, STYLES.capecod);
    const mid = withAttic.depth / 2;
    assert.ok(Math.abs(roofAt(gabled, 3, 0) - gabled.top) < 1e-9, 'the eaves');
    assert.ok(Math.abs(roofAt(gabled, 3, mid) - gabled.ridge) < 1e-9, 'the ridge');
    const hipped = massingOf(withAttic, STYLES.ranch);
    assert.ok(Math.abs(roofAt(hipped, 0, mid) - hipped.top) < 1e-9, 'a hip comes down at the ends too');
    assert.ok(Math.abs(roofAt(hipped, withAttic.width / 2, mid) - hipped.ridge) < 1e-9);
    const crossed = massingOf(withAttic, STYLES.tudor);
    const cross = crossed.cross!;
    assert.ok(cross.peak <= crossed.ridge, 'a gable to the front stays below the ridge');
    assert.ok(
      Math.abs(roofAt(crossed, cross.at, withAttic.depth) - cross.peak) < 1e-9,
      'its peak is at the front wall',
    );
    assert.ok(Math.abs(roofAt(crossed, cross.at - cross.half - 0.5, withAttic.depth) - crossed.top) < 1e-9);
    // The space under it, for cutting to: one region, or two with a gable to the front.
    assert.equal(under(gabled)!.length, 1);
    assert.equal(under(hipped)![0].length, 4);
    assert.equal(under(crossed)!.length, 2);
    assert.equal(under(massingOf(withAttic, STYLES.contemporary)), null);
  });
});

describe('the windows of a floor under the roof', () => {
  it('gives every room at the front a window: in a dormer, in the slope, or in a gable', () => {
    for (const name of PITCHED) {
      const style = styleOf(name);
      for (const floors of [
        [GROUND, UP, ATTIC],
        [GROUND, UP, THIRD],
        [GROUND, UP],
      ]) {
        const plan = designed(floors, name, 'roof');
        const m = massingOf(plan, style, 'roof');
        const loft = plan.stories[m.loft!.index];
        const { dormers, walls } = loftWindows(plan, style, m);
        for (const cell of loft.cells) {
          if (!span(cell, plan, 'front') || !cell.id || cell.type === 'closet') continue;
          assert.ok(
            dormers.some((d) => d.windows.some((w) => w.cell === cell)) || walls.some((w) => w.cell === cell),
            `${name}: ${cell.id} has a window under the roof`,
          );
        }
      }
    }
  });

  it('stands dormers on the roof, clear of each other and of what else is there', () => {
    for (const name of PITCHED) {
      const style = styleOf(name);
      const plan = designed([GROUND, UP, ATTIC], name);
      const m = massingOf(plan, style);
      const { dormers } = loftWindows(plan, style, m);
      const half = plan.depth / 2;
      const chimney = chimneySpot(m);
      for (const d of dormers) {
        const alongX = d.side === 'front' || d.side === 'back';
        const [from, to] = alongX ? [m.x0, m.x1] : [m.y0, m.y1];
        assert.ok(d.x - d.half > from && d.x + d.half < to, `${name}: on the roof`);
        assert.ok(d.set > 0 && d.reach > d.set, `${name}: it runs up the slope`);
        assert.ok(d.reach < (alongX ? half : m.inset), `${name}: and ends below the ridge`);
        if (m.form === 'hip') {
          assert.equal(d.kind, 'skylight', 'a hipped roof is lit through its slopes');
          // The slope narrows toward the ridge: the glass stays on it.
          const taper = alongX ? m.inset / half : half / m.inset;
          assert.ok(d.x - d.half > from + d.reach * taper && d.x + d.half < to - d.reach * taper, name);
        } else assert.ok(alongX, `${name}: a gable end has windows, not dormers`);
        if (d.kind !== 'skylight') {
          assert.ok(d.sill >= 0.75 && d.head - d.sill >= 0.7 && d.eave > d.head, `${name}: a window to look out of`);
          // Its face stands on the slope, and its sill is above the roof there.
          assert.ok(d.sill > m.knee + d.set * m.pitch, `${name}: the sill clears the roof`);
        }
        for (const w of d.windows) {
          const range = span(w.cell!, plan, d.side)!;
          assert.ok(w.x - w.half >= d.x - d.half - 1e-9 && w.x + w.half <= d.x + d.half + 1e-9);
          assert.ok(w.x - w.half > range[0] && w.x + w.half < range[1], `${name}: inside its room`);
        }
        if (d.side === 'front' && m.cross) {
          assert.ok(d.x + d.half < m.cross.at - m.cross.half || d.x - d.half > m.cross.at + m.cross.half, name);
        }
        if (d.side === 'back')
          assert.ok(d.x + d.half < chimney.x0 || d.x - d.half > chimney.x1, `${name}: the chimney`);
      }
      for (const a of dormers) {
        for (const b of dormers) {
          if (a === b || a.side !== b.side) continue;
          assert.ok(Math.abs(a.x - b.x) >= a.half + b.half, `${name}: dormers do not overlap`);
        }
      }
    }
  });

  it('sets windows in the gable ends where the roof clears them', () => {
    for (const name of PITCHED) {
      const style = STYLES[name];
      const plan = designed([GROUND, UP, ATTIC], name);
      const m = massingOf(plan, style);
      const { walls } = loftWindows(plan, style, m);
      const loft = m.loft!;
      if (m.form === 'gable')
        assert.ok(
          walls.some((w) => w.side === 'right'),
          `${name}: the gable has a window`,
        );
      else assert.equal(walls.length, 0, `${name}: a hipped roof has no gable`);
      for (const w of walls) {
        const range = span(w.cell!, plan, w.side)!;
        assert.ok(w.a > range[0] && w.b < range[1], `${name}: inside its room`);
        for (const u of [w.a, w.b]) {
          const [x, y] = w.side === 'front' ? [u, plan.depth] : [w.side === 'right' ? plan.width : 0, u];
          assert.ok(roofAt(m, x, y) - loft.z > w.z1 + 0.2, `${name}: the roof is above the ${w.side} window`);
        }
      }
      const pairs = walls.filter((w) => w.side === 'right');
      if (pairs.length === 2) {
        const mid = plan.depth / 2;
        const [a, b] = pairs.map((w) => (w.a + w.b) / 2 - mid).sort((p, q) => p - q);
        assert.ok(Math.abs(a + b) < 0.6, `${name}: a pair either side of the ridge`);
      }
    }
  });

  it('leaves out a gable window that the roof of the garage would cover', () => {
    const plan = planHouse([{ ...GROUND, rooms: [...GROUND.rooms, { id: 'garage', type: 'garage' }] }, UP, ATTIC]);
    const style = STYLES.capecod;
    const m = massingOf(plan, style);
    const { walls } = loftWindows(plan, style, m);
    for (const w of walls.filter((x) => x.side === 'left')) {
      assert.ok(wingRoofAt(plan, style, m.pitch, (w.a + w.b) / 2) < m.loft!.z + w.z0);
    }
    assert.ok(wingRoofAt(plan, style, m.pitch, plan.depth / 2) > 3, 'the garage roof stands against the wall');
    assert.equal(wingRoofAt(twoStories, style, m.pitch, 3), 0, 'no garage, nothing in the way');
  });
});

describe('the house with a floor under its roof', () => {
  it('shows as many floors as the home has', () => {
    // A Cape Cod with two floors and an attic: two stories of walls, and the attic behind the dormers.
    const cape = model([GROUND, UP, ATTIC], 'capecod');
    assert.equal(cape.loft, 2);
    assert.equal(cape.plan.stories[cape.loft].id, 'attic');
    const tall = model([GROUND, UP, ATTIC], 'capecod', 'full');
    assert.equal(tall.loft, -1);
    assert.ok(tall.top - cape.top > 2.5, 'a story lower than with the attic as a floor of its own');
    assert.equal(model([GROUND, UP], 'colonial').loft, -1);
    assert.equal(model([GROUND, UP], 'capecod').loft, 1);
    assert.equal(model([GROUND], 'capecod').loft, -1);
  });

  it('keeps everything on that floor under the roof', () => {
    for (const name of PITCHED) {
      const m = model([GROUND, UP, ATTIC], name);
      const massing = massingOf(m.plan, STYLES[name]);
      const loft = m.loft;
      const own = new Set([m.groups.lower[loft], m.groups.upper[loft]]);
      let checked = 0;
      for (const v of vertices(m)) {
        if (!own.has(v.group)) continue;
        checked++;
        assert.ok(
          v.z <= roofAt(massing, v.x, v.y) + 0.02,
          `${name}: (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}) pokes through the roof`,
        );
      }
      assert.ok(checked > 500, `${name}: the floor has walls and furniture`);
      for (const f of m.fixtures) {
        if (!m.plan.stories[loft].cells.some((c) => c.id === f.roomId)) continue;
        assert.ok(f.at[2] < roofAt(massing, f.at[0], f.at[1]) - 0.15, `${name}: ${f.lightId} hangs under the ceiling`);
        assert.ok(f.at[2] > m.plan.stories[loft].z, `${name}: ${f.lightId} is above the floor`);
      }
    }
  });

  it('lets its rooms be seen and picked: through the dormers, on the roof, and with the floor opened', () => {
    for (const name of PITCHED) {
      const m = model([GROUND, UP, ATTIC], name);
      const massing = massingOf(m.plan, STYLES[name]);
      const story = m.plan.stories[m.loft];
      const ids = story.cells.map((c) => c.id).filter((id): id is string => Boolean(id));
      const glass = vertices(m).filter((v) => v.material === MAT.glass && v.group === m.groups.roof);
      for (const id of ids) {
        assert.ok(
          m.exterior.hits.some((h) => h.roomId === id),
          `${name}: ${id} can be picked from outside`,
        );
        assert.ok(
          m.exterior.anchors.some((a) => a.roomId === id),
          `${name}: ${id} has a label outside`,
        );
        assert.ok(
          m.stories[m.loft].hits.some((h) => h.roomId === id),
          `${name}: ${id} can be picked on its floor`,
        );
        for (const view of [m.exterior, m.stories[m.loft]]) {
          for (const p of view.volumes.get(id)!.points) {
            assert.ok(p[2] <= roofAt(massing, p[0], p[1]) + 1e-6, `${name}: ${id}'s outline stays under the roof`);
          }
        }
        if (
          span(
            story.cells.find((c) => c.id === id)!,
            m.plan,
            'front',
          )
        ) {
          assert.ok(
            m.spills.some((s) => s.roomId === id),
            `${name}: ${id}'s light falls out of its windows`,
          );
        }
      }
      // The glass in the roof is lit by the rooms behind it. A roof whose gable to the front leaves
      // no room for dormers has none: its rooms look out of the gables.
      const lit = new Set(glass.map((v) => v.room));
      const { dormers } = loftWindows(m.plan, STYLES[name], massing);
      assert.ok(
        !dormers.length || ids.some((id) => lit.has(m.rooms.find((r) => r.id === id)!.index)),
        `${name}: a window in the roof shows a room`,
      );
    }
  });

  it('leaves a roof nobody lives under without windows', () => {
    for (const name of PITCHED) {
      const m = model([GROUND, UP], name, 'full');
      assert.equal(m.loft, -1);
      const glass = vertices(m).filter((v) => v.material === MAT.glass && v.group === m.groups.roof);
      assert.equal(glass.length, 0, `${name}: no glass in the roof`);
    }
  });

  it('builds every design with every kind of top floor', () => {
    for (const name of STYLE_NAMES) {
      for (const floors of [[GROUND], [GROUND, UP], [CELLAR, GROUND, UP], [GROUND, UP, ATTIC], [GROUND, UP, THIRD]]) {
        for (const choice of ['auto', 'roof', 'full'] as const) {
          const m = model(floors, name, choice);
          assert.ok(m.mesh.vertexCount > 1000 && Number.isFinite(m.radius) && Number.isFinite(m.top));
          const f32 = new Float32Array(m.mesh.vertices);
          for (let i = 0; i < m.mesh.vertexCount; i++) {
            assert.ok(
              Number.isFinite(f32[i * 8]) && Number.isFinite(f32[i * 8 + 1]) && Number.isFinite(f32[i * 8 + 2]),
            );
          }
        }
      }
    }
  });
});
