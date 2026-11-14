// What the surfaces of the 3D house are made of. A material picks the pattern the shader draws
// (boards, bricks, shingles, grass) and how shiny the surface is; the color tints it. Colors are
// what the surface looks like in plain daylight.

import type { RGB } from '../color.ts';
import type { Paint } from './mesh.ts';

/** Shader patterns. The numbers are shared with the fragment shader; keep them in step. */
export const MAT = {
  /** A plain matte surface: plaster, paint. */
  plain: 0,
  siding: 1,
  brick: 2,
  stucco: 3,
  shingle: 4,
  roofTile: 5,
  /** Wood with the grain running along u. */
  wood: 6,
  /** Floorboards. */
  planks: 7,
  floorTile: 8,
  carpet: 9,
  concrete: 10,
  grass: 11,
  soil: 12,
  paving: 13,
  asphalt: 14,
  fabric: 15,
  metal: 16,
  /** Smooth and shiny: ceramic, enamel, car paint. */
  gloss: 17,
  glass: 18,
  water: 19,
  leaf: 20,
  bark: 21,
  /** A lamp shade or bulb: glows with its light. */
  lamp: 22,
  screen: 23,
  /** The cut face of a wall that has been sliced open. */
  cut: 24,
  rug: 25,
  /** Decking: boards with gaps between them. */
  deck: 26,
  /** Flowers: leaf-like, with bright specks. */
  flowers: 27,
  gravel: 28,
  /** A strip of LEDs: a line of light. */
  strip: 29,
  /** Board and batten: wide upright boards with a narrow strip over each joint. */
  battens: 30,
  /** Narrow upright boards. */
  boards: 31,
  /** Wooden shingles on a wall. */
  shake: 32,
  /** Half-timbering: dark beams with pale render between them. */
  timber: 33,
  /** Rough stone laid in courses. */
  stone: 34,
  /** A metal roof with standing seams. */
  seam: 35,
  /** A shrub in bloom, its flowers all one color. */
  bloom: 36,
} as const;

export type MaterialId = (typeof MAT)[keyof typeof MAT];

const paint = (material: number, r: number, g: number, b: number): Paint => ({ material, color: [r, g, b] });

/** Everything inside the house and in the garden. The house's own walls and roof come from its style. */
export const PAINT = {
  // Floors
  oak: paint(MAT.planks, 176, 128, 86),
  lightOak: paint(MAT.planks, 205, 170, 126),
  walnut: paint(MAT.planks, 122, 82, 56),
  tile: paint(MAT.floorTile, 214, 216, 216),
  slate: paint(MAT.floorTile, 118, 124, 132),
  carpet: paint(MAT.carpet, 172, 160, 146),
  carpetBlue: paint(MAT.carpet, 126, 142, 160),
  concrete: paint(MAT.concrete, 158, 158, 156),
  // Walls
  plaster: paint(MAT.plain, 238, 234, 226),
  ceiling: paint(MAT.plain, 244, 243, 240),
  cut: paint(MAT.cut, 246, 244, 240),
  baseboard: paint(MAT.plain, 248, 247, 244),
  // Furniture
  fabric: paint(MAT.fabric, 104, 118, 138),
  fabricWarm: paint(MAT.fabric, 194, 178, 156),
  fabricGreen: paint(MAT.fabric, 108, 128, 104),
  linen: paint(MAT.fabric, 240, 238, 233),
  blanket: paint(MAT.fabric, 124, 150, 186),
  blanketWarm: paint(MAT.fabric, 190, 124, 110),
  pillow: paint(MAT.fabric, 246, 245, 242),
  wood: paint(MAT.wood, 150, 104, 68),
  darkWood: paint(MAT.wood, 92, 62, 42),
  paleWood: paint(MAT.wood, 204, 170, 128),
  white: paint(MAT.gloss, 244, 244, 242),
  counter: paint(MAT.gloss, 54, 57, 62),
  stone: paint(MAT.gloss, 206, 202, 196),
  steel: paint(MAT.metal, 190, 194, 199),
  chrome: paint(MAT.metal, 214, 217, 221),
  black: paint(MAT.gloss, 30, 32, 36),
  screen: paint(MAT.screen, 18, 20, 24),
  rugBlue: paint(MAT.rug, 104, 126, 152),
  rugSand: paint(MAT.rug, 194, 172, 140),
  rugRose: paint(MAT.rug, 190, 142, 140),
  pot: paint(MAT.plain, 188, 118, 82),
  potWhite: paint(MAT.gloss, 232, 230, 224),
  car: paint(MAT.gloss, 168, 44, 40),
  carGlass: paint(MAT.gloss, 34, 40, 48),
  tire: paint(MAT.plain, 30, 31, 34),
  toy: paint(MAT.gloss, 232, 176, 62),
  mirror: paint(MAT.metal, 208, 216, 222),
  book: paint(MAT.plain, 150, 80, 70),
  // Outdoors
  leaf: paint(MAT.leaf, 74, 122, 62),
  leafDark: paint(MAT.leaf, 50, 94, 54),
  leafLight: paint(MAT.leaf, 108, 148, 70),
  hedge: paint(MAT.leaf, 58, 104, 58),
  flowers: paint(MAT.flowers, 88, 128, 70),
  roses: paint(MAT.bloom, 196, 44, 66),
  hydrangea: paint(MAT.bloom, 122, 150, 222),
  lavender: paint(MAT.bloom, 148, 118, 204),
  whiteBloom: paint(MAT.bloom, 244, 240, 232),
  bougainvillea: paint(MAT.bloom, 208, 52, 132),
  boxwood: paint(MAT.leaf, 52, 96, 50),
  olive: paint(MAT.leaf, 124, 138, 104),
  cypress: paint(MAT.leaf, 44, 78, 52),
  maple: paint(MAT.leaf, 150, 52, 44),
  reeds: paint(MAT.leaf, 150, 156, 96),
  blueGrass: paint(MAT.leaf, 110, 140, 132),
  palm: paint(MAT.leaf, 82, 128, 66),
  boulder: paint(MAT.concrete, 138, 134, 126),
  terracotta: paint(MAT.plain, 190, 112, 76),
  brickPath: paint(MAT.paving, 156, 92, 72),
  flagstone: paint(MAT.paving, 150, 146, 138),
  ironwork: paint(MAT.plain, 30, 30, 34),
  bark: paint(MAT.bark, 96, 72, 54),
  grass: paint(MAT.grass, 96, 142, 66),
  soil: paint(MAT.soil, 104, 76, 54),
  mulch: paint(MAT.gravel, 86, 58, 42),
  gravel: paint(MAT.gravel, 168, 162, 152),
  path: paint(MAT.paving, 190, 182, 170),
  patio: paint(MAT.paving, 176, 166, 152),
  asphalt: paint(MAT.asphalt, 74, 76, 80),
  deck: paint(MAT.deck, 158, 114, 78),
  water: paint(MAT.water, 64, 150, 176),
  poolTile: paint(MAT.floorTile, 196, 222, 228),
  lampPost: paint(MAT.metal, 44, 46, 50),
  iron: paint(MAT.plain, 38, 40, 44),
  shade: paint(MAT.lamp, 238, 228, 208),
  bulb: paint(MAT.lamp, 255, 250, 240),
  strip: paint(MAT.strip, 220, 220, 220),
  fence: paint(MAT.plain, 240, 238, 232),
} satisfies Record<string, Paint>;

export type PaintName = keyof typeof PAINT;

export const tint = (base: Paint, color: RGB): Paint => ({ material: base.material, color });

export type RoofForm = 'gable' | 'hip' | 'flat' | 'shed';
/** What stands at the front door: steps alone, a small roof on columns, or a porch to sit on. */
export type EntryKind = 'stoop' | 'portico' | 'porch' | 'wrap' | 'loggia' | 'canopy';
export type ColumnKind = 'square' | 'round' | 'pier' | 'turned' | 'steel';
export type GardenKind =
  'formal' | 'cottage' | 'suburban' | 'ornate' | 'modern' | 'country' | 'mediterranean' | 'english';

/** How the windows of a floor under the roof stand out of it: with a roof of their own, or as glass in the slope. */
export type DormerKind = 'gable' | 'shed' | 'box' | 'skylight';

/** A floor built into the roof, with sloping ceilings, instead of a full story under it. */
export interface LoftStyle {
  /**
   * When the top floor goes under the roof: always, as in a story-and-a-half house; from the third
   * floor up, as in a taller one; or only when it is an attic.
   */
  when: 'always' | 'third' | 'attic';
  /** How far the outside walls rise above its floor before the roof begins, in meters. */
  knee: number;
  /** A roof with a floor under it is at least this steep. */
  pitch: number;
  dormer: DormerKind;
}

/** How the windows of a style look. */
export interface WindowStyle {
  /** Width and height relative to an ordinary window. */
  scale: [number, number];
  /** Panes across and down in each sash. */
  panes: [number, number];
  /** Glazing bars in the upper sash only, as on a bungalow. */
  topOnly?: boolean;
  /** Glass down to the floor. */
  low?: boolean;
  /** The sashes; the casing around them is the style's trim. */
  frame: RGB;
  /** Round-headed windows on the ground floor. */
  arched?: boolean;
  /** Boxes of flowers under the front windows. */
  boxes?: boolean;
}

/** One design of house: how it is roofed, clad and glazed, what stands at its door and what grows around it. */
export interface HouseStyle {
  wall: Paint;
  /** The stories above the ground floor, where they are clad differently. */
  upper?: Paint;
  /** The gable ends and dormers. */
  gable: Paint;
  /** A second cladding for the garage and the wall around the door, as modern houses mix materials. */
  accent?: Paint;
  trim: RGB;
  roof: Paint;
  roofForm: RoofForm;
  /** Rise over run of the main roof. */
  pitch: number;
  /** How far the roof overhangs the walls, in meters. */
  eave: number;
  /** A gable facing the front: over the door or at one end of the house. Width in meters. */
  crossGable?: { at: 'door' | 'left' | 'right'; width: number; pitch: number };
  /** The floor under the roof; a roof too flat to live under has none. */
  loft?: LoftStyle;
  /** Rafter ends showing under the eaves. */
  brackets?: boolean;
  foundation: Paint;
  door: RGB;
  /** A round-headed front door. */
  archedDoor?: boolean;
  garageDoor: RGB;
  /** Shutters beside the front windows, if the style has them. */
  shutters: RGB | null;
  chimney: Paint;
  chimneyPots?: boolean;
  window: WindowStyle;
  entry: EntryKind;
  column: ColumnKind;
  garden: GardenKind;
}

const WHITE: RGB = [248, 247, 243];
const CREAM: RGB = [240, 232, 212];
const BLACK: RGB = [36, 38, 42];

export const STYLES = {
  // Symmetrical, painted siding, shuttered windows, columns at the door.
  colonial: {
    wall: paint(MAT.siding, 226, 224, 214),
    gable: paint(MAT.siding, 226, 224, 214),
    trim: WHITE,
    roof: paint(MAT.shingle, 74, 76, 82),
    roofForm: 'gable',
    pitch: 0.72,
    eave: 0.45,
    loft: { when: 'third', knee: 0.6, pitch: 0.85, dormer: 'gable' },
    foundation: paint(MAT.concrete, 150, 146, 138),
    door: [54, 74, 100],
    garageDoor: [236, 235, 230],
    shutters: [50, 62, 80],
    chimney: paint(MAT.brick, 152, 84, 66),
    window: { scale: [1, 1], panes: [2, 2], frame: WHITE },
    entry: 'portico',
    column: 'round',
    garden: 'formal',
  },
  // Weathered shingles under a steep roof with dormers, behind a picket fence.
  capecod: {
    wall: paint(MAT.shake, 150, 148, 140),
    gable: paint(MAT.shake, 150, 148, 140),
    trim: WHITE,
    roof: paint(MAT.shingle, 86, 82, 78),
    roofForm: 'gable',
    pitch: 1,
    eave: 0.22,
    loft: { when: 'always', knee: 0.2, pitch: 1, dormer: 'gable' },
    foundation: paint(MAT.stone, 136, 132, 124),
    door: [150, 46, 44],
    garageDoor: [240, 239, 234],
    shutters: [44, 58, 74],
    chimney: paint(MAT.brick, 150, 86, 70),
    window: { scale: [0.95, 0.95], panes: [3, 2], frame: WHITE, boxes: true },
    entry: 'stoop',
    column: 'square',
    garden: 'cottage',
  },
  // Low and wide-eaved, in earth colors, with a deep porch on stout columns.
  bungalow: {
    wall: paint(MAT.siding, 150, 152, 122),
    gable: paint(MAT.shake, 132, 104, 78),
    trim: CREAM,
    roof: paint(MAT.shingle, 84, 74, 66),
    roofForm: 'gable',
    pitch: 0.46,
    eave: 0.85,
    loft: { when: 'always', knee: 0.8, pitch: 0.62, dormer: 'shed' },
    brackets: true,
    foundation: paint(MAT.stone, 128, 120, 108),
    door: [112, 62, 40],
    garageDoor: [204, 196, 172],
    shutters: null,
    chimney: paint(MAT.stone, 132, 124, 112),
    window: { scale: [1.05, 0.95], panes: [3, 1], topOnly: true, frame: CREAM },
    entry: 'porch',
    column: 'pier',
    garden: 'cottage',
  },
  // Long and low under a hipped roof, brick below picture windows.
  ranch: {
    wall: paint(MAT.brick, 176, 126, 100),
    gable: paint(MAT.siding, 232, 228, 216),
    trim: WHITE,
    roof: paint(MAT.shingle, 100, 92, 84),
    roofForm: 'hip',
    pitch: 0.36,
    eave: 0.75,
    loft: { when: 'attic', knee: 0.3, pitch: 0.5, dormer: 'skylight' },
    foundation: paint(MAT.concrete, 156, 152, 144),
    door: [58, 96, 92],
    garageDoor: [234, 232, 224],
    shutters: [236, 234, 226],
    chimney: paint(MAT.brick, 164, 116, 92),
    window: { scale: [1.45, 0.92], panes: [2, 1], frame: WHITE },
    entry: 'stoop',
    column: 'steel',
    garden: 'suburban',
  },
  // Wide eaves on brackets, shingled above siding, tapered columns on stone piers.
  craftsman: {
    wall: paint(MAT.siding, 122, 140, 118),
    upper: paint(MAT.shake, 140, 150, 124),
    gable: paint(MAT.shake, 154, 126, 92),
    trim: CREAM,
    roof: paint(MAT.shingle, 72, 64, 58),
    roofForm: 'gable',
    pitch: 0.52,
    eave: 0.8,
    crossGable: { at: 'door', width: 5, pitch: 0.52 },
    loft: { when: 'always', knee: 0.8, pitch: 0.62, dormer: 'shed' },
    brackets: true,
    foundation: paint(MAT.stone, 124, 116, 104),
    door: [120, 68, 42],
    garageDoor: [150, 112, 78],
    shutters: null,
    chimney: paint(MAT.stone, 128, 120, 108),
    window: { scale: [1, 1], panes: [3, 1], topOnly: true, frame: CREAM },
    entry: 'porch',
    column: 'pier',
    garden: 'english',
  },
  // Tall and ornate: steep gables, fancy shingles, a porch that wraps the corner, bold paint.
  victorian: {
    wall: paint(MAT.siding, 122, 152, 160),
    gable: paint(MAT.shake, 198, 146, 124),
    trim: [246, 238, 216],
    roof: paint(MAT.shingle, 74, 68, 80),
    roofForm: 'gable',
    pitch: 1.05,
    eave: 0.4,
    crossGable: { at: 'right', width: 4.4, pitch: 1.2 },
    loft: { when: 'third', knee: 0.5, pitch: 1.05, dormer: 'gable' },
    brackets: true,
    foundation: paint(MAT.brick, 124, 78, 64),
    door: [126, 44, 52],
    garageDoor: [236, 228, 208],
    shutters: null,
    chimney: paint(MAT.brick, 146, 82, 66),
    chimneyPots: true,
    window: { scale: [0.82, 1.1], panes: [2, 1], frame: [246, 238, 216] },
    entry: 'wrap',
    column: 'turned',
    garden: 'ornate',
  },
  // A low roof floating on deep eaves over walls of glass, wood and stone.
  midcentury: {
    wall: paint(MAT.boards, 176, 124, 80),
    gable: paint(MAT.boards, 176, 124, 80),
    accent: paint(MAT.stone, 152, 146, 136),
    trim: [240, 238, 232],
    roof: paint(MAT.gravel, 150, 148, 142),
    roofForm: 'shed',
    pitch: 0.11,
    eave: 1,
    foundation: paint(MAT.concrete, 160, 158, 152),
    door: [216, 112, 46],
    garageDoor: [176, 124, 80],
    shutters: null,
    chimney: paint(MAT.stone, 148, 142, 132),
    window: { scale: [1.6, 1.2], panes: [1, 1], low: true, frame: [52, 50, 48] },
    entry: 'canopy',
    column: 'steel',
    garden: 'modern',
  },
  // White boards and battens, black windows, a metal roof and a porch along the front.
  farmhouse: {
    wall: paint(MAT.battens, 242, 240, 234),
    gable: paint(MAT.battens, 242, 240, 234),
    trim: WHITE,
    roof: paint(MAT.seam, 60, 64, 68),
    roofForm: 'gable',
    pitch: 0.9,
    eave: 0.4,
    crossGable: { at: 'left', width: 4.6, pitch: 0.95 },
    loft: { when: 'third', knee: 0.8, pitch: 0.9, dormer: 'shed' },
    foundation: paint(MAT.stone, 140, 136, 128),
    door: [134, 92, 58],
    garageDoor: [240, 238, 232],
    shutters: null,
    chimney: paint(MAT.stone, 150, 146, 138),
    window: { scale: [0.95, 1.08], panes: [2, 1], frame: BLACK },
    entry: 'porch',
    column: 'square',
    garden: 'country',
  },
  // Warm render and arches under a low roof of clay tiles, with cypresses in the garden.
  mediterranean: {
    wall: paint(MAT.stucco, 240, 226, 200),
    gable: paint(MAT.stucco, 240, 226, 200),
    trim: [250, 246, 236],
    roof: paint(MAT.roofTile, 186, 100, 64),
    roofForm: 'hip',
    pitch: 0.4,
    eave: 0.55,
    loft: { when: 'attic', knee: 0.3, pitch: 0.5, dormer: 'skylight' },
    foundation: paint(MAT.stucco, 206, 188, 160),
    door: [98, 64, 44],
    archedDoor: true,
    garageDoor: [150, 108, 76],
    shutters: [70, 104, 100],
    chimney: paint(MAT.stucco, 236, 220, 192),
    window: { scale: [0.92, 1.02], panes: [1, 2], frame: [92, 66, 48], arched: true },
    entry: 'loggia',
    column: 'square',
    garden: 'mediterranean',
  },
  // Half-timbered above brick, with steep gables, leaded windows and tall chimney pots.
  tudor: {
    wall: paint(MAT.brick, 146, 88, 70),
    upper: paint(MAT.timber, 234, 224, 200),
    gable: paint(MAT.timber, 234, 224, 200),
    trim: [74, 54, 42],
    roof: paint(MAT.shingle, 74, 70, 72),
    roofForm: 'gable',
    pitch: 1.12,
    eave: 0.3,
    crossGable: { at: 'door', width: 4.2, pitch: 1.3 },
    loft: { when: 'third', knee: 0.4, pitch: 1.12, dormer: 'gable' },
    foundation: paint(MAT.stone, 126, 118, 108),
    door: [88, 58, 40],
    archedDoor: true,
    garageDoor: [96, 68, 48],
    shutters: null,
    chimney: paint(MAT.brick, 140, 82, 64),
    chimneyPots: true,
    window: { scale: [0.86, 1.06], panes: [3, 4], frame: [70, 52, 40] },
    entry: 'stoop',
    column: 'square',
    garden: 'english',
  },
  // Plain boxes in white and dark wood under flat roofs, with glass from floor to ceiling.
  contemporary: {
    wall: paint(MAT.stucco, 240, 240, 238),
    upper: paint(MAT.boards, 96, 74, 58),
    gable: paint(MAT.stucco, 240, 240, 238),
    accent: paint(MAT.boards, 62, 62, 66),
    trim: [46, 48, 52],
    roof: paint(MAT.gravel, 96, 96, 98),
    roofForm: 'flat',
    pitch: 0,
    eave: 0,
    foundation: paint(MAT.concrete, 150, 150, 150),
    door: [150, 104, 66],
    garageDoor: [62, 62, 66],
    shutters: null,
    chimney: paint(MAT.stucco, 232, 232, 230),
    window: { scale: [1.35, 1.2], panes: [1, 1], low: true, frame: BLACK },
    entry: 'canopy',
    column: 'steel',
    garden: 'modern',
  },
  // Brick under dark slates: Britain, Ireland, the Low Countries.
  brick: {
    wall: paint(MAT.brick, 158, 92, 70),
    gable: paint(MAT.brick, 158, 92, 70),
    trim: [244, 241, 232],
    roof: paint(MAT.shingle, 62, 62, 68),
    roofForm: 'gable',
    pitch: 0.9,
    eave: 0.3,
    loft: { when: 'third', knee: 0.5, pitch: 0.9, dormer: 'box' },
    foundation: paint(MAT.brick, 112, 70, 58),
    door: [38, 72, 60],
    garageDoor: [228, 226, 218],
    shutters: null,
    chimney: paint(MAT.brick, 142, 80, 62),
    chimneyPots: true,
    window: { scale: [1, 1], panes: [2, 3], frame: [244, 241, 232] },
    entry: 'stoop',
    column: 'square',
    garden: 'english',
  },
  // White render under steep clay tiles: central Europe.
  european: {
    wall: paint(MAT.stucco, 240, 236, 226),
    gable: paint(MAT.stucco, 240, 236, 226),
    trim: [250, 249, 245],
    roof: paint(MAT.roofTile, 164, 80, 56),
    roofForm: 'gable',
    pitch: 0.9,
    eave: 0.5,
    loft: { when: 'always', knee: 0.75, pitch: 0.95, dormer: 'gable' },
    foundation: paint(MAT.stucco, 168, 164, 156),
    door: [112, 76, 50],
    garageDoor: [222, 220, 212],
    shutters: null,
    chimney: paint(MAT.stucco, 232, 228, 218),
    window: { scale: [1.05, 1], panes: [1, 2], frame: [250, 249, 245], boxes: true },
    entry: 'stoop',
    column: 'square',
    garden: 'formal',
  },
} satisfies Record<string, HouseStyle>;

export type StyleName = keyof typeof STYLES;
export const STYLE_NAMES = Object.keys(STYLES) as StyleName[];

const BRICK = ['GB', 'IE', 'NL', 'BE', 'LU'];
const EUROPEAN = [
  ...['DE', 'AT', 'CH', 'LI', 'PL', 'CZ', 'SK', 'HU', 'SI', 'HR', 'FR', 'DK', 'RO', 'BG', 'RS', 'LT', 'LV', 'EE'],
  ...['UA', 'BY', 'RU', 'TR'],
];
const MEDITERRANEAN = [
  ...['ES', 'PT', 'IT', 'GR', 'MT', 'CY', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'UY', 'IL', 'MA', 'TN', 'EG'],
  ...['AE', 'SA', 'IN'],
];

/** The design most houses have in a country (ISO 3166-1 alpha-2); a colonial elsewhere. */
export function styleFor(country?: string | null): StyleName {
  const code = (country ?? '').toUpperCase();
  if (BRICK.includes(code)) return 'brick';
  if (EUROPEAN.includes(code)) return 'european';
  if (MEDITERRANEAN.includes(code)) return 'mediterranean';
  return 'colonial';
}
