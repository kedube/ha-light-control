// On wide cards (panel views, wide sections) rooms sit side by side in balanced columns
// instead of each stretching across the whole card.

/** Narrowest a room column gets; below two of these the card keeps a single column. */
export const MIN_COLUMN_WIDTH = 340;
export const COLUMN_GAP = 12;
/** Horizontal padding around the rooms (`.rooms` in the card's styles). */
const SIDE_PADDING = 24;

// Room and tile heights in pixels, mirroring the card's and lc-tile's styles. The estimates only
// balance the columns, so a few pixels off (a caption on two lines) costs nothing.
const ROOM_CHROME = 74; // top and bottom padding plus the header
const SCENE_ROW = 40;
const TILE_TALL = 100; // narrow tiles stack the icon above the name
const TILE_WIDE = 64;
const TILE_GAP = 8;
const ROOM_PADDING_X = 20;
/** lc-tile switches to the stacked layout below this width. */
const STACK_BELOW = 180;

/** How many room columns fit a card this wide; never more than there are rooms. */
export function columnCount(cardWidth: number, rooms: number): number {
  const fit = Math.floor((cardWidth - SIDE_PADDING + COLUMN_GAP) / (MIN_COLUMN_WIDTH + COLUMN_GAP));
  return Math.max(1, Math.min(fit, rooms));
}

export function columnWidth(cardWidth: number, columns: number): number {
  return (cardWidth - SIDE_PADDING - COLUMN_GAP * (columns - 1)) / columns;
}

/** Height of a room in a column, where tiles sit two to a row and a lone tile fills its row. */
export function estimateRoomHeight(tiles: number, scenes: boolean, width: number): number {
  const rows = Math.ceil(tiles / 2);
  const tileWidth = (width - ROOM_PADDING_X - TILE_GAP) / 2;
  const tileHeight = tiles === 1 || tileWidth >= STACK_BELOW ? TILE_WIDE : TILE_TALL;
  return ROOM_CHROME + (scenes ? SCENE_ROW : 0) + rows * tileHeight + Math.max(0, rows - 1) * TILE_GAP;
}

/**
 * Splits items, in order, into consecutive runs read top to bottom like newspaper columns, with
 * the tallest run as short as possible. Every column gets at least one item when there are enough.
 * Returns each column's item indexes.
 */
export function balanceColumns(heights: number[], count: number, gap = COLUMN_GAP): number[][] {
  const n = heights.length;
  if (!n) return [];
  const columns = Math.max(1, Math.min(count, n));

  const split = (limit: number): number[][] => {
    const result: number[][] = [[]];
    let height = 0;
    heights.forEach((h, i) => {
      const current = result[result.length - 1];
      const next = current.length ? height + gap + h : h;
      // A new column when this one is full, or when each remaining item needs a column of its own.
      if (current.length && (next > limit || n - i <= columns - result.length)) {
        result.push([i]);
        height = h;
      } else {
        current.push(i);
        height = next;
      }
    });
    return result;
  };

  let low = Math.max(...heights);
  let high = heights.reduce((sum, h) => sum + h, 0) + gap * (n - 1);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (split(mid).length <= columns) high = mid;
    else low = mid + 1;
  }
  return split(low);
}
