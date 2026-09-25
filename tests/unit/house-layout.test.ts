import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStories, layoutHouse, skyMode, type HouseRoom } from '../../src/house-layout.ts';

const room = (id: string, floorId: string | null = null, outdoor = false): HouseRoom => ({
  id,
  name: id,
  floorId,
  outdoor,
  onCount: 0,
  total: 1,
  rgb: null,
  level: 0,
  caption: '',
});

describe('buildStories', () => {
  it('stacks floors with the highest level on top and flags basements', () => {
    const stories = buildStories(
      [room('bed', 'up'), room('kitchen', 'ground'), room('media', 'basement'), room('hall')],
      [
        { id: 'ground', level: 0 },
        { id: 'up', level: 1 },
        { id: 'basement', level: -1 },
      ],
    );
    assert.deepEqual(
      stories.map((s) => [s.rooms.map((r) => r.id), s.basement]),
      [
        [['bed'], false],
        [['kitchen', 'hall'], false],
        [['media'], true],
      ],
    );
  });

  it('arranges a home without floors into balanced rows', () => {
    const stories = buildStories(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => room(id)),
      [],
    );
    assert.deepEqual(
      stories.map((s) => s.rooms.length),
      [4, 3],
    );
  });
});

describe('layoutHouse', () => {
  it('gives every indoor room a window and every outdoor area a lamp post', () => {
    const layout = layoutHouse(
      [room('a', 'g'), room('b', 'g'), room('c', 'b1'), room('garden', null, true), room('porch', null, true)],
      [
        { id: 'g', level: 0 },
        { id: 'b1', level: -1 },
      ],
    );
    assert.equal(layout.windows.length, 3);
    assert.equal(layout.windows.filter((w) => w.basement).length, 1);
    assert.equal(layout.lamps.length, 2);
    assert.ok(layout.door, 'the ground floor has a front door');
    assert.ok(layout.basementH > 0);
  });
});

describe('skyMode', () => {
  it('follows the sun, then the clock', () => {
    assert.equal(skyMode({ elevation: 30 }), 'day');
    assert.equal(skyMode({ elevation: 2 }), 'dusk');
    assert.equal(skyMode({ elevation: -20 }), 'night');
    assert.equal(skyMode({ aboveHorizon: true }), 'day');
    assert.equal(skyMode(undefined, new Date(2026, 0, 1, 23, 0)), 'night');
    assert.equal(skyMode(undefined, new Date(2026, 0, 1, 12, 0)), 'day');
  });
});
