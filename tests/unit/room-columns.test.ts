import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { balanceColumns, columnCount, columnWidth, estimateRoomHeight, tilesPerRow } from '../../src/room-columns.ts';

describe('columnCount', () => {
  it('keeps phones, masonry columns and sections in a single column', () => {
    for (const width of [320, 390, 500, 715]) assert.equal(columnCount(width, 14), 1, `${width}px`);
  });

  it('adds a column for every 340px or so of card', () => {
    assert.equal(columnCount(716, 14), 2);
    assert.equal(columnCount(1100, 14), 3);
    assert.equal(columnCount(1500, 14), 4);
  });

  it('never makes more columns than there are rooms', () => {
    assert.equal(columnCount(1500, 2), 2);
    assert.equal(columnCount(1500, 1), 1);
    assert.equal(columnCount(1500, 0), 1);
  });

  it('shares the width between the columns', () => {
    assert.equal(columnWidth(760, 2), 362);
  });
});

describe('estimateRoomHeight', () => {
  it('grows with each row of tiles, a row of outlets and the scenes', () => {
    const base = estimateRoomHeight(2, 0, false, 440);
    assert.ok(estimateRoomHeight(4, 0, false, 440) > base, 'a second row of lights');
    assert.ok(estimateRoomHeight(2, 1, false, 440) > base, 'outlets get their own row');
    assert.ok(estimateRoomHeight(2, 0, true, 440) > base, 'scenes');
    assert.equal(estimateRoomHeight(0, 0, false, 440), 64, 'just the header');
  });

  it('knows narrow tiles stack their icon above the name', () => {
    // Two tiles to a row in a 340px column are narrower than 190px, so they stand taller.
    assert.ok(estimateRoomHeight(2, 0, false, 340) > estimateRoomHeight(2, 0, false, 460));
  });

  it('lets a lone tile fill its row', () => {
    assert.equal(estimateRoomHeight(1, 0, false, 340), 64 + 10 + 64);
  });

  it('fits more tiles to a row in wider rooms', () => {
    assert.equal(tilesPerRow(340), 2);
    assert.equal(tilesPerRow(560), 3);
  });
});

describe('balanceColumns', () => {
  it('keeps rooms in order, top to bottom and then across', () => {
    const columns = balanceColumns([100, 100, 100, 100, 100, 100], 3, 0);
    assert.deepEqual(columns, [
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it('keeps the tallest column as short as it can be', () => {
    // Options: 300 | 436, 412 | 324 or 524 | 212. The middle one wins.
    assert.deepEqual(balanceColumns([300, 100, 100, 100, 100], 2), [
      [0, 1],
      [2, 3, 4],
    ]);
  });

  it('puts at least one room in every column', () => {
    assert.deepEqual(balanceColumns([100, 100, 100, 100], 3, 0), [[0, 1], [2], [3]]);
    assert.deepEqual(balanceColumns([500, 100, 100], 3), [[0], [1], [2]]);
  });

  it('handles one column and fewer rooms than columns', () => {
    assert.deepEqual(balanceColumns([100, 200, 300], 1), [[0, 1, 2]]);
    assert.deepEqual(balanceColumns([100, 200], 4), [[0], [1]]);
    assert.deepEqual(balanceColumns([], 3), []);
  });
});
