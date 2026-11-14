// Lights outdoors, and what stands there for each. A light goes where its name says, or failing
// that its area's: lanterns either side of the front door, the garage door and the back door,
// floodlights high on the corners, spots in the beds along the house, bollards along the path and
// the driveway, a lamppost by the pavement, strings of bulbs over the patio or along the porch, a
// Christmas tree on the lawn, bulbs along the eaves, a pool lit from inside. A light whose name
// says nothing takes the next of the places outdoor lights usually are, so the lights of a house
// stand all round it, as they do round a real one, and never in a row.
//
// Each light is one row of the light table: the lamps that stand for it (a pair of lanterns, a row
// of bollards) glow from that row, and its light comes from one point or one line among them.

import type { RoomType } from '../../room-types.ts';
import { seeded } from '../math.ts';
import { MAT, PAINT } from '../materials.ts';
import { backDoor, type Rect } from '../plan.ts';
import type { Context, Fixture, Point, RoomInput } from './context.ts';
import { entryTop, wideEntry } from './entry.ts';
import { WING_FLOOR, wingHeight } from './massing.ts';
import { frontEaves, type RoofSpan } from './roof.ts';
import type { Site } from './site.ts';

/** What stands outdoors for a light. */
export type Fitting =
  'lantern' | 'flood' | 'landscape' | 'path' | 'driveway' | 'post' | 'string' | 'tree' | 'roofline' | 'pool';

/** Where round the house it stands. */
export type Place = 'door' | 'garage' | 'back' | 'side' | 'front' | 'yard' | 'garden';

/** What a name says about a light outdoors. */
export interface Aim {
  fitting: Fitting | null;
  place: Place | null;
  /** -1 for the left one of a pair, 1 for the right one, 0 for either or both. */
  hand: number;
}

// Words for the kinds of light outdoors, in the card's languages; the first that fits wins.
const FITTINGS: [Fitting, RegExp][] = [
  [
    'tree',
    /christmas ?tree|xmas ?tree|weihnachtsbaum|tannenbaum|christbaum|kerstboom|sapin|arbre de no[eë]l|[áa]rbol de navidad|albero di natale|choink|[áa]rvore de natal/i,
  ],
  [
    'roofline',
    /christmas|xmas|holiday|roof ?line|\beaves?\b|gutter|icicle|weihnacht|dachrinne|traufe|kerst|dakgoot|no[eë]l|goutti[èe]re|navid|alero|natale|grondaia|świą|swiat|rynn|natal|beiral|calha/i,
  ],
  [
    'string',
    /string|bistro|festoon|fairy|caf[eé] ?light|globe ?light|party ?light|lichterkette|lichtsnoer|feestverlichting|guirlande|guirnalda|ghirlanda|luci a catena|girland|łańcuch|cord[aã]o de luz|gambiarra/i,
  ],
  [
    'pool',
    /pool|\bspa\b|hot ?tub|jacuzzi|whirlpool|zwembad|piscin|basen|fountain|\bpond|brunnen|teich|vijver|fontein|fontaine|bassin|[ée]tang|fuente|estanque|fontana|laghetto|fontann|\bstaw|oczko|\bfonte\b|\blago\b/i,
  ],
  [
    'driveway',
    /drive ?way|\bdrive\b|einfahrt|auffahrt|oprit|all[ée]e de garage|entr[ée]e de garage|entrada de (?:coches|garaje|carros)|camino de entrada|vialetto d'accesso|passo carrabile|podjazd|acesso de carros/i,
  ],
  [
    'path',
    /path|walk|\bsteps?\b|stair|bollard|\bweg|weg\b|pfad|stufe|treppe|poller|\bpad\b|paadje|\btrap|chemin|marche|escalier|\bborne|sendero|camino|escal|baliza|sentier|sentiero|vialetto|gradin|paletto|ścież|sciez|schod|słupek|caminh|degrau|escada|balizador/i,
  ],
  [
    'post',
    /lamp ?post|lantern ?post|post ?light|\bpost\b|\bpole\b|pillar|column|\bgate\b|street ?light|mail ?box|letter ?box|laternenpfahl|laternenmast|\bmast\b|pfosten|s[äa]ule|\btor\b|briefkasten|lantaarnpaal|\bpaal\b|\bpoort|brievenbus|lampadaire|r[ée]verb[èe]re|poteau|pilier|portail|bo[îi]te aux lettres|farola|columna|port[óo]n|buz[óo]n|lampione|\bpalo\b|pilastro|cancello|cassetta delle lettere|latarni|słup|\bbrama|skrzynka|candeeiro de rua|port[ãa]o|caixa de correio/i,
  ],
  [
    'flood',
    /flood|security|motion|spot ?light|search ?light|strahler|fluter|bewegung|scheinwerfer|schijnwerper|bouwlamp|projecteur|d[ée]tecteur|\bfoco\b|proyector|reflector|riflettore|proiettore|\bfaro\b|naświetlacz|reflektor|halogen|holofote|projetor/i,
  ],
  [
    'landscape',
    /landscape|up ?light|accent|garden|\bbeds?\b|shrub|bush|hedge|tree|flower|plant|well ?light|garten|beet|strauch|busch|hecke|baum|blume|pflanz|tuin|struik|\bheg\b|boom|bloem|paysage|massif|arbuste|\bhaie|arbre|fleur|plante|paisaj|jard[ií]n|arbust|\bseto|[áa]rbol|\bflor|planta|giardin|aiuol|cespug|siepe|albero|fior|piant|ogr[óo]d|rabat|krzew|żywopłot|drzew|kwiat|rośl|jardim|canteiro|\bsebe\b|[áa]rvore/i,
  ],
];

// Words for where round the house, likewise.
const PLACES: [Place, RegExp][] = [
  [
    'door',
    /porch|door|entry|entrance|stoop|portico|veranda|foyer|haust[üu]r|eingang|t[üu]r\b|vordach|voordeur|ingang|\bdeur|porte|entr[ée]e|perron|porche|puerta|entrada|portal|ingresso|\bporta\b|portone|drzwi|wej[śs]cie|ganek|alpendre|soleira/i,
  ],
  ['garage', /garage|carport|garaje|garagem|gara[żz]/i],
  [
    'back',
    /back|rear|patio|\bdeck|terrace|hinten|r[üu]ck|hinterhof|terrasse|achter|terras|arri[èe]re|derri[èe]re|trasero|atr[áa]s|terraza|posterior|\bretro\b|dietro|terrazz|\bty[łl]|taras|traseir|fundos|terra[çc]o|quintal/i,
  ],
  // As a word of its own: "outside" is not a side.
  ['side', /\bside|\bseite|seitlich|\bzij|c[ôo]t[ée]|lateral|\bbok\b|boczn/i],
  [
    'front',
    /front|vorne|vorder|stra[ßs]en|\bvoor|devant|fa[çc]ade|delanter|frente|fachada|anterior|davanti|facciata|prz[óo]d|frontal/i,
  ],
  ['yard', /yard|lawn|rasen|wiese|gazon|pelouse|c[ée]sped|prato|trawnik|relvado|gramado/i],
  ['garden', /garden|garten|tuin|jardin|jard[ií]n|giardin|ogr[óo]d|jardim/i],
];

const LEFT = /left|links|gauche|izquierd|sinistr|\blew|esquerd/i;
const RIGHT = /right|rechts|droit|derech|destr|\bpraw|direit/i;

/** What a name says about where a light outdoors goes and what stands there. */
export function aimOf(name: string): Aim {
  return {
    fitting: FITTINGS.find(([, words]) => words.test(name))?.[0] ?? null,
    place: PLACES.find(([, words]) => words.test(name))?.[0] ?? null,
    hand: LEFT.test(name) ? -1 : RIGHT.test(name) ? 1 : 0,
  };
}

/** What an area of each kind has, when neither it nor its lights' names say. */
const BY_TYPE: Partial<Record<RoomType, Partial<Aim>>> = {
  porch: { fitting: 'lantern', place: 'door' },
  balcony: { fitting: 'lantern', place: 'back' },
  driveway: { fitting: 'driveway' },
  pool: { fitting: 'pool' },
};

/** Where a light goes: its own name first, then its area's name, then the kind of area. */
export function aimFor(light: string, area: { name?: string; type: RoomType }): Aim {
  const own = aimOf(light);
  const room = area.name ? aimOf(area.name) : { fitting: null, place: null, hand: 0 };
  const kind = BY_TYPE[area.type] ?? {};
  const place = own.place ?? room.place ?? kind.place ?? null;
  // A light named for a place has a lantern there, whatever its area is for.
  const fitting = own.fitting ?? (own.place ? null : (room.fitting ?? kind.fitting ?? null));
  return { fitting, place, hand: own.hand };
}

// ─── What stands there ───────────────────────────────────────────────────────

type Normal = [number, number];

/** A box along a wall: `u0`–`u1` along it, `t0`–`t1` out of it, from the point (x, y) on it. */
function wallBox(
  x: number,
  y: number,
  n: Normal,
  half: number,
  t0: number,
  t1: number,
): [number, number, number, number] {
  const xs = [x + n[0] * t0 - Math.abs(n[1]) * half, x + n[0] * t1 + Math.abs(n[1]) * half];
  const ys = [y + n[1] * t0 - Math.abs(n[0]) * half, y + n[1] * t1 + Math.abs(n[0]) * half];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** A lantern on a wall at (x, y), its top at z: a plate, an arm, a glowing box and its cap. */
function wallLantern(c: Context, x: number, y: number, z: number, n: Normal, slot: number, group: number): Point {
  const m = c.mesh;
  const w = 0.1;
  const cx = x + n[0] * 0.17;
  const cy = y + n[1] * 0.17;
  m.with({ group, room: 0, ...PAINT.lampPost }, () => {
    const [a, b, e, f] = wallBox(x, y, n, 0.055, 0, 0.025);
    m.box(a, b, z - 0.24, e, f, z + 0.04);
    const [g, h, i, j] = wallBox(x, y, n, 0.018, 0, 0.13);
    m.box(g, h, z - 0.015, i, j, z + 0.02);
  });
  m.with({ group, room: 0, emit: slot, ...PAINT.shade }, () =>
    m.box(cx - w, cy - w, z - 0.3, cx + w, cy + w, z - 0.05),
  );
  m.with({ group, room: 0, ...PAINT.lampPost }, () => {
    m.box(cx - w - 0.035, cy - w - 0.035, z - 0.05, cx + w + 0.035, cy + w + 0.035, z - 0.01);
    m.box(cx - w - 0.015, cy - w - 0.015, z - 0.33, cx + w + 0.015, cy + w + 0.015, z - 0.3);
    m.cylinder(cx, cy, z - 0.01, z + 0.09, w * 0.95, 0.01, 4, 0);
  });
  return [cx, cy, z - 0.17];
}

/** A floodlight high on a wall: a bracket and a dark head, its face aglow. */
function floodlight(c: Context, x: number, y: number, z: number, n: Normal, slot: number, group: number): Point {
  const m = c.mesh;
  m.with({ group, room: 0, ...PAINT.lampPost }, () => {
    const [a, b, e, f] = wallBox(x, y, n, 0.05, 0, 0.12);
    m.box(a, b, z - 0.04, e, f, z + 0.04);
    for (const s of [-1, 1]) {
      const along: Normal = [Math.abs(n[1]) * s * 0.11, Math.abs(n[0]) * s * 0.11];
      const [g, h, i, j] = wallBox(x + along[0], y + along[1], n, 0.08, 0.1, 0.22);
      m.box(g, h, z - 0.13, i, j, z - 0.01);
    }
  });
  m.with({ group, room: 0, emit: slot, ...PAINT.bulb }, () => {
    for (const s of [-1, 1]) {
      const along: Normal = [Math.abs(n[1]) * s * 0.11, Math.abs(n[0]) * s * 0.11];
      const [g, h, i, j] = wallBox(x + along[0], y + along[1], n, 0.065, 0.22, 0.23);
      m.box(g, h, z - 0.12, i, j, z - 0.02);
    }
  });
  return [x + n[0] * 0.5, y + n[1] * 0.5, z - 0.1];
}

/** A lamp standing on the ground: a lamppost with a lantern, or a low bollard. */
function standingLamp(c: Context, x: number, y: number, tall: boolean, slot: number, group: number): Point {
  const m = c.mesh;
  const h = tall ? 2.3 : 0.7;
  const w = tall ? 0.12 : 0.07;
  m.with({ group, room: 0, ...PAINT.lampPost }, () => {
    m.cylinder(x, y, 0, 0.06, tall ? 0.13 : 0.1, tall ? 0.09 : 0.07, 10);
    m.cylinder(x, y, 0.06, h - 0.3, tall ? 0.045 : 0.035, tall ? 0.035 : 0.03, 8, 0);
  });
  m.with({ group, room: 0, emit: slot, ...PAINT.shade }, () => m.box(x - w, y - w, h - 0.3, x + w, y + w, h - 0.04));
  m.with({ group, room: 0, ...PAINT.lampPost }, () => {
    m.box(x - w - 0.04, y - w - 0.04, h - 0.04, x + w + 0.04, y + w + 0.04, h);
    m.box(x - w - 0.015, y - w - 0.015, h - 0.33, x + w + 0.015, y + w + 0.015, h - 0.3);
    m.cylinder(x, y, h, h + (tall ? 0.14 : 0.08), w * 0.95, 0.01, 4, 0);
  });
  return [x, y, h - 0.17];
}

/** A spot in a bed, shining up at the house or a tree. */
function uplight(c: Context, x: number, y: number, slot: number, group: number): void {
  const m = c.mesh;
  m.with({ group, room: 0, ...PAINT.lampPost }, () => m.cylinder(x, y, 0, 0.12, 0.05, 0.045, 8, 0));
  m.with({ group, room: 0, emit: slot, ...PAINT.bulb }, () => m.cylinder(x, y, 0.12, 0.135, 0.04, 0.04, 8, 2));
}

/** A lantern hanging from the ceiling of a porch on a chain. */
function hangingLantern(c: Context, x: number, y: number, ceiling: number, slot: number, group: number): Point {
  const m = c.mesh;
  const w = 0.12;
  const top = ceiling - 0.22;
  m.with({ group, room: 0, ...PAINT.lampPost }, () => {
    m.cylinder(x, y, top, ceiling, 0.012, 0.012, 6, 0);
    m.box(x - w - 0.03, y - w - 0.03, top - 0.04, x + w + 0.03, y + w + 0.03, top);
    m.box(x - w - 0.02, y - w - 0.02, top - 0.4, x + w + 0.02, y + w + 0.02, top - 0.37);
  });
  m.with({ group, room: 0, emit: slot, ...PAINT.shade }, () =>
    m.box(x - w, y - w, top - 0.37, x + w, y + w, top - 0.04),
  );
  return [x, y, top - 0.2];
}

/** Bulbs on a wire from a to b, sagging between them, on poles where `poles` says. */
function strand(c: Context, a: Point, b: Point, slot: number, group: number, poles: boolean, sag = 0.45): void {
  const m = c.mesh;
  if (poles) {
    m.with({ group, room: 0, ...PAINT.lampPost }, () => {
      m.cylinder(a[0], a[1], 0, a[2], 0.03, 0.025, 6, 2);
      m.cylinder(b[0], b[1], 0, b[2], 0.03, 0.025, 6, 2);
    });
  }
  const bulbs = Math.max(5, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.55));
  let last: Point = a;
  for (let i = 1; i <= bulbs + 1; i++) {
    const t = i / (bulbs + 1);
    const p: Point = [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t - sag * 4 * t * (1 - t),
    ];
    m.with({ group, room: 0, ...PAINT.iron }, () =>
      m.quad(last, p, [p[0], p[1], p[2] - 0.012], [last[0], last[1], last[2] - 0.012], [b[1] - a[1], a[0] - b[0], 0]),
    );
    if (i <= bulbs) {
      m.with({ group, room: 0, emit: slot, ...PAINT.bulb }, () =>
        m.blob(p[0], p[1], p[2] - 0.06, 0.05, 0.05, 0.06, seeded(i), 0, 0),
      );
    }
    last = p;
  }
}

/** Colors for bulbs that keep their own: red, gold, blue, green and white. */
const BULBS: [number, number, number][] = [
  [230, 40, 36],
  [250, 190, 40],
  [40, 110, 240],
  [40, 200, 80],
  [250, 248, 240],
];

/** Small colored bulbs along a line, a little apart. */
function bulbLine(c: Context, points: Point[], slot: number, group: number, colored: boolean): void {
  const m = c.mesh;
  let n = 0;
  for (let k = 1; k < points.length; k++) {
    const [a, b] = [points[k - 1], points[k]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const count = Math.max(1, Math.round(length / 0.26));
    for (let i = k === 1 ? 0 : 1; i <= count; i++) {
      const t = i / count;
      const color = colored ? BULBS[n % BULBS.length] : ([255, 236, 200] as [number, number, number]);
      n++;
      m.with({ group, room: 0, emit: slot, material: MAT.bulbs, color }, () =>
        m.blob(
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
          0.035,
          0.035,
          0.045,
          seeded(n),
          0,
          0,
        ),
      );
    }
  }
}

/** A fir on the lawn, hung with bulbs in a spiral and a star on top. */
function christmasTree(c: Context, x: number, y: number, size: number, slot: number, group: number): number {
  const m = c.mesh;
  const rand = seeded(Math.round(x * 31 + y * 17));
  const height = 2.3 * size;
  const radius = 0.68 * size;
  m.with({ group, room: 0, ...PAINT.bark }, () => m.cylinder(x, y, 0, 0.3 * size, 0.07, 0.06, 8, 0));
  const tiers = 4;
  const shape = (z: number) => radius * (1 - (z - 0.25 * size) / (height - 0.25 * size));
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const z0 = 0.25 * size + t * (height - 0.45 * size);
    const z1 = Math.min(height, z0 + (height - 0.25 * size) * 0.42);
    m.with({ group, room: 0, ...(i % 2 ? PAINT.leafDark : PAINT.cypress) }, () =>
      m.leafCone(x, y, z0, z1, shape(z0) * 1.05, Math.max(0.02, shape(z1) * 0.5), rand),
    );
  }
  // The bulbs wind round it five times on the way up.
  const bulbs = Math.round(44 * size);
  for (let i = 0; i < bulbs; i++) {
    const t = (i + 0.5) / bulbs;
    const z = 0.32 * size + t * (height - 0.5 * size);
    const r = shape(z) * 0.96 + 0.03;
    const turn = t * Math.PI * 10;
    m.with({ group, room: 0, emit: slot, material: MAT.bulbs, color: BULBS[i % BULBS.length] }, () =>
      m.blob(x + Math.cos(turn) * r, y + Math.sin(turn) * r, z, 0.04, 0.04, 0.04, seeded(i + 7), 0, 0),
    );
  }
  m.with({ group, room: 0, emit: slot, material: MAT.bulbs, color: BULBS[1] }, () =>
    m.blob(x, y, height + 0.06, 0.09, 0.09, 0.11, rand, 0.3, 0),
  );
  return height;
}

// ─── Where it stands ─────────────────────────────────────────────────────────

/** Two lanterns either side of a door: each may go to a light of its own. */
interface Pair {
  at: [number, number][];
  n: Normal;
  z: number;
  group: number;
  taken: [boolean, boolean];
}

/** A light, and its aim. */
interface Wanted {
  room: RoomInput;
  light: { id: string; name: string };
  aim: Aim;
}

/** What has been used up of a kind of place, in order. */
type Runs<T> = { list: T[]; next: number };

/** Lamps in a row, and the line their light comes from: along them, or down the middle of a path between them. */
interface Row {
  spots: [number, number][];
  line?: [[number, number], [number, number]];
}

const runsOf = <T>(list: T[]): Runs<T> => ({ list, next: 0 });

/** The plot round the house and what stands in it, as the lights are placed one after another. */
class Grounds {
  private readonly c: Context;
  private readonly s: Site;
  private readonly W: number;
  private readonly D: number;
  /** Lamps that stand on the ground, and how much room each takes. */
  private readonly stands: [number, number, number][] = [];
  /** The pairs of lanterns by the doors. */
  private readonly pairs: Partial<Record<'door' | 'garage' | 'back' | 'corners' | 'outer', Pair>> = {};
  private readonly walls: Partial<Record<Place, Runs<{ x: number; y: number; z: number; n: Normal; group: number }>>> =
    {};
  private readonly floods: { key: string; x: number; y: number; z: number; n: Normal; group: number }[];
  private readonly used = new Set<string>();
  /** How many lights want each fitting, so a set of bollards or spots can be shared out. */
  private readonly counts = new Map<Fitting, number>();
  private readonly dealt = new Map<Fitting, number>();

  constructor(c: Context, s: Site, wanted: Wanted[]) {
    this.c = c;
    this.s = s;
    const plan = c.plan;
    const W = (this.W = plan.width);
    const D = (this.D = plan.depth);
    const base = plan.base;
    const ground = c.ground;
    const upper = ground ? c.groups.upper[ground.index] : c.groups.ground;
    const z = base + 1.95;
    const frontBay = W / plan.bays.front;
    const entry = s.entry;
    const pair = (x: number, dx: number, y: number, n: Normal, zz: number): Pair => ({
      at: [
        [x - dx, y],
        [x + dx, y],
      ],
      n,
      z: zz,
      group: upper,
      taken: [false, false],
    });
    if (entry) {
      this.pairs.door = pair(entry.door, Math.min(0.95, Math.max(0.8, frontBay / 2)), D, [0, 1], z);
      const outer = frontBay * 1.5;
      if (entry.door - outer > 0.5 && entry.door + outer < W - 0.5)
        this.pairs.outer = pair(entry.door, outer, D, [0, 1], z);
    }
    const wing = plan.wing;
    if (wing) {
      const r = wing.rect;
      const half = Math.min(1.3, (r.x1 - r.x0) / 2 - 0.45);
      this.pairs.garage = pair((r.x0 + r.x1) / 2, half + 0.42, r.y1, [0, 1], WING_FLOOR + 1.9);
    }
    const back = backDoor(plan);
    if (back) this.pairs.back = pair(back.x, 0.95, 0, [0, -1], z);
    this.pairs.corners = pair(W / 2, W / 2 - 0.45, 0, [0, -1], z);
    // Single lanterns down the sides, between the windows: the right side, then the left, where
    // the garage is not built against it.
    const sideBay = D / plan.bays.side;
    const piers = Array.from({ length: plan.bays.side - 1 }, (_, j) => (plan.bays.side - 1 - j) * sideBay);
    this.walls.side = runsOf([
      ...piers.map((y) => ({ x: W, y, z, n: [1, 0] as Normal, group: upper })),
      ...(wing ? [] : piers.map((y) => ({ x: 0, y, z, n: [-1, 0] as Normal, group: upper }))),
    ]);
    if (wing) {
      this.walls.garage = runsOf([
        { x: wing.rect.x0, y: (wing.rect.y0 + wing.rect.y1) / 2, z: WING_FLOOR + 1.9, n: [-1, 0], group: upper },
      ]);
    }
    // Floodlights high on the corners and over the garage door, the ones in view first.
    const high = base + 2.5;
    const flood = (key: string, x: number, y: number, zz: number, n: Normal) => ({ key, x, y, z: zz, n, group: upper });
    this.floods = [
      flood('front', W - 0.35, D, high, [0, 1]),
      ...(wing
        ? [
            flood(
              'garage',
              (wing.rect.x0 + wing.rect.x1) / 2,
              wing.rect.y1,
              WING_FLOOR + wingHeight(plan) - 0.2,
              [0, 1],
            ),
          ]
        : []),
      flood('back', W - 0.35, 0, high, [0, -1]),
      flood('side', W, D / 2, high, [1, 0]),
      flood('back', 0.35, 0, high, [0, -1]),
      flood('front', 0.35, D, high, [0, 1]),
    ];
    for (const w of wanted)
      if (w.aim.fitting) this.counts.set(w.aim.fitting, (this.counts.get(w.aim.fitting) ?? 0) + 1);
    // Keep clear of what is already on the ground: the paths, the porch, the areas, the mailbox.
    if (entry) this.stands.push([entry.door + 1.05, s.box.y1 - 1.72, 0.4]);
  }

  /** The group for something standing on the plot: the front right quarter lifts away with a basement's earth. */
  private groupAt(x: number, y: number): number {
    return x >= 0 && y >= 0 ? this.c.groups.ground : this.c.groups.base;
  }

  /** Whether something needing `room` meters fits at (x, y): on the plot, clear of the house and of what stands there. */
  private free(x: number, y: number, room: number): boolean {
    const { box: b, walk, drive, entry, zones } = this.s;
    if (x < b.x0 + 0.3 || x > b.x1 - 0.3 || y < b.y0 + 0.3 || y > this.s.fence - 0.25) return false;
    const inside = (r: Rect | null, pad: number) =>
      r !== null && x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad;
    const house: Rect = { x0: 0, y0: 0, x1: this.W, y1: this.D };
    if (inside(house, room + 0.1) || inside(this.c.plan.wing?.rect ?? null, room + 0.1)) return false;
    if (inside(walk, room) || inside(drive, room)) return false;
    if (entry && (inside(entry.deck, room) || inside(entry.side, room))) return false;
    for (const z of zones)
      if ((z.kind === 'patio' || z.kind === 'pool' || z.kind === 'porch') && inside(z.rect, room)) return false;
    return !this.stands.some(([sx, sy, r]) => Math.hypot(sx - x, sy - y) < r + room);
  }

  /** The first of these spots that is free, taken; or null. */
  private claim(spots: [number, number][], room: number): [number, number] | null {
    for (const [x, y] of spots) {
      if (!this.free(x, y, room)) continue;
      this.stands.push([x, y, room]);
      return [x, y];
    }
    return null;
  }

  /** One row of the light table, and the light coming from it. */
  private fixture(
    w: Wanted,
    slot: number,
    at: Point,
    reach: number,
    kind: Fixture['kind'] = 'ceiling',
    along?: Point,
  ): void {
    this.c.fixtures.push({ slot, roomId: w.room.id, lightId: w.light.id, kind, outdoor: true, at, along, reach });
  }

  place(w: Wanted): void {
    const slot = this.c.slot();
    if (!slot) return;
    const { fitting, place } = w.aim;
    const done =
      (fitting === 'tree' && this.tree(w, slot)) ||
      (fitting === 'roofline' && this.roofline(w, slot)) ||
      (fitting === 'string' && this.string(w, slot, place)) ||
      (fitting === 'pool' && (this.pool(w, slot) || this.landscape(w, slot, place))) ||
      (fitting === 'driveway' && (this.driveway(w, slot) || this.path(w, slot))) ||
      (fitting === 'path' && this.path(w, slot)) ||
      (fitting === 'post' && this.post(w, slot, place)) ||
      (fitting === 'flood' && this.flood(w, slot, place)) ||
      (fitting === 'landscape' && this.landscape(w, slot, place)) ||
      ((fitting === 'lantern' || (!fitting && place && place !== 'yard' && place !== 'garden')) &&
        this.lantern(w, slot, place)) ||
      (!fitting && place === 'yard' && this.post(w, slot, 'yard')) ||
      (!fitting && place === 'garden' && this.landscape(w, slot, 'garden'));
    if (!done) this.anywhere(w, slot);
  }

  /** The next of the places outdoor lights usually are, for a light whose name says nothing. */
  private anywhere(w: Wanted, slot: number): void {
    const tries: (() => boolean)[] = [
      () => this.pairFor(w, slot, 'door'),
      () => this.pairFor(w, slot, 'garage'),
      () => this.post(w, slot, 'front'),
      () => this.flood(w, slot, 'front'),
      () => this.single(w, slot, 'side'),
      () => this.pairFor(w, slot, 'back'),
      () => this.landscape(w, slot, null),
      () => this.flood(w, slot, null),
      () => this.post(w, slot, null),
      () => this.pairFor(w, slot, 'outer'),
      () => this.pairFor(w, slot, 'corners'),
    ];
    if (tries.some((t) => t())) return;
    // Out of the usual places: a post on the lawn wherever there is room, else beside the last one.
    this.scatter(w, slot);
  }

  /** A lamppost on the lawn where it is farthest from every other light, so they spread out evenly. */
  private scatter(w: Wanted, slot: number): void {
    const { box: b } = this.s;
    const lights = this.c.fixtures.filter((f) => f.outdoor).map((f): [number, number] => [f.at[0], f.at[1]]);
    const others = [...lights, ...this.stands.map(([x, y]): [number, number] => [x, y])];
    let best: [number, number] | null = null;
    let room = -1;
    for (let x = b.x0 + 0.7; x < b.x1 - 0.6; x += 0.6) {
      for (let y = b.y0 + 0.7; y < this.s.fence - 0.4; y += 0.6) {
        if (!this.free(x, y, 0.5)) continue;
        const gap = Math.min(Infinity, ...others.map(([ox, oy]) => Math.hypot(ox - x, oy - y)));
        if (gap > room + 1e-6) {
          room = gap;
          best = [x, y];
        }
      }
    }
    // A plot with no lawn left: by the front door.
    const at = best ?? [this.W / 2 + 1.5, this.D + 1.2];
    this.stands.push([at[0], at[1], 0.5]);
    this.fixture(w, slot, standingLamp(this.c, at[0], at[1], true, slot, this.groupAt(at[0], at[1])), 6.5);
  }

  // ── Lanterns on the walls ──

  /** Lanterns either side of a door: both for a light, or the one on its side for a light of a pair. */
  private pairFor(w: Wanted, slot: number, key: keyof Grounds['pairs']): boolean {
    const pair = this.pairs[key];
    if (!pair) return false;
    const hand = w.aim.hand;
    const sides = hand < 0 ? [0] : hand > 0 ? [1] : pair.taken[0] || pair.taken[1] ? [pair.taken[0] ? 1 : 0] : [0, 1];
    if (sides.some((i) => pair.taken[i])) return false;
    const lamps = sides.map((i) => {
      pair.taken[i] = true;
      const [x, y] = pair.at[i];
      const p = wallLantern(this.c, x, y, pair.z, pair.n, slot, pair.group);
      return [p[0] + pair.n[0] * 0.3, p[1] + pair.n[1] * 0.3, p[2]] as Point;
    });
    const [a, b] = [lamps[0], lamps[lamps.length - 1]];
    // A pair close together lights the door between them; one far apart, the wall all along.
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 2.5) {
      this.fixture(w, slot, a, 5.5, 'strip', [b[0] - a[0], b[1] - a[1], 0]);
    } else this.fixture(w, slot, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2]], lamps.length === 2 ? 6.5 : 5.5);
    return true;
  }

  private single(w: Wanted, slot: number, place: Place): boolean {
    const runs = this.walls[place];
    const spot = runs?.list[runs.next];
    if (!runs || !spot) return false;
    runs.next++;
    this.fixture(w, slot, wallLantern(this.c, spot.x, spot.y, spot.z, spot.n, slot, spot.group), 5.5);
    return true;
  }

  /** A lantern on the wall the name says: by the door, the garage, the back door, down a side. */
  private lantern(w: Wanted, slot: number, place: Place | null): boolean {
    switch (place) {
      case 'garage':
        return this.pairFor(w, slot, 'garage') || this.single(w, slot, 'garage') || this.flood(w, slot, 'garage');
      case 'back':
        return this.pairFor(w, slot, 'back') || this.pairFor(w, slot, 'corners') || this.flood(w, slot, 'back');
      case 'side':
        return this.single(w, slot, 'side');
      case 'front':
        return this.pairFor(w, slot, 'door') || this.pairFor(w, slot, 'outer') || this.flood(w, slot, 'front');
      default:
        return this.pairFor(w, slot, 'door') || this.porchLamp(w, slot) || this.pairFor(w, slot, 'outer');
    }
  }

  /** A lantern hanging in the porch, or a light in the canopy over the door. */
  private porchLamp(w: Wanted, slot: number): boolean {
    const entry = this.s.entry;
    const style = this.c.style;
    if (!entry || this.used.has('porch')) return false;
    const covered = wideEntry(style) || style.entry === 'portico' || style.entry === 'canopy';
    if (!covered) return false;
    this.used.add('porch');
    const ground = this.c.ground;
    const group = ground ? this.c.groups.upper[ground.index] : this.c.groups.ground;
    const { top } = entryTop(this.c);
    const y = this.D + (style.entry === 'portico' ? 0.6 : Math.min(1.1, (entry.deck.y1 - this.D) * 0.5));
    if (style.entry === 'canopy') {
      // A round light let into the underside of the canopy.
      this.c.mesh.with({ group, room: 0, emit: slot, ...PAINT.bulb }, () =>
        this.c.mesh.cylinder(entry.door, y, top - 0.02, top, 0.12, 0.12, 14, 1),
      );
      this.fixture(w, slot, [entry.door, y, top - 0.1], 5);
      return true;
    }
    this.fixture(
      w,
      slot,
      hangingLantern(this.c, entry.door, y, top + (style.entry === 'portico' ? 0 : 0.15), slot, group),
      5.5,
    );
    return true;
  }

  // ── Floodlights ──

  private flood(w: Wanted, slot: number, place: Place | null): boolean {
    const want = place === 'door' || place === 'yard' || place === 'garden' ? 'front' : place;
    const index = this.floods.findIndex((f, i) => !this.used.has(`flood${i}`) && (!want || f.key === want));
    if (index < 0) return false;
    this.used.add(`flood${index}`);
    const f = this.floods[index];
    this.fixture(w, slot, floodlight(this.c, f.x, f.y, f.z, f.n, slot, f.group), 8.5);
    return true;
  }

  // ── Sets along a line: spots in the beds, bollards by the path and the driveway ──

  /** Which of a fitting's lights this one is, counting from 0, and how many there are. */
  private turn(fitting: Fitting): { index: number; count: number } {
    const index = this.dealt.get(fitting) ?? 0;
    this.dealt.set(fitting, index + 1);
    return { index, count: Math.max(1, this.counts.get(fitting) ?? 1) };
  }

  /**
   * Rows of lamps that glow together, as one light. Its light comes from along the first row that
   * has room for its lamps, or from the one lamp there is.
   */
  private rows(
    w: Wanted,
    slot: number,
    rows: Row[],
    draw: (x: number, y: number, group: number) => void,
    height: number,
    reach: number,
  ): boolean {
    let best: { row: Row; spots: [number, number][] } | null = null;
    for (const row of rows) {
      const spots = row.spots.filter(([x, y]) => this.free(x, y, 0.25));
      for (const [x, y] of spots) {
        this.stands.push([x, y, 0.25]);
        draw(x, y, this.groupAt(x, y));
      }
      if (spots.length && !best) best = { row, spots };
    }
    if (!best) return false;
    const ends = best.row.line ?? [best.spots[0], best.spots[best.spots.length - 1]];
    const [a, b] = ends;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3) this.fixture(w, slot, [a[0], a[1], height], reach, 'lamp');
    else this.fixture(w, slot, [a[0], a[1], height], reach, 'strip', [b[0] - a[0], b[1] - a[1], 0]);
    return true;
  }

  /**
   * Spots in the beds along the front and the side of the house, round the trees, or along the back:
   * at the corners and between the windows, where they wash the walls.
   */
  private landscape(w: Wanted, slot: number, place: Place | null): boolean {
    const { W, D, s } = this;
    const plan = this.c.plan;
    const entry = s.entry;
    const between = (length: number, count: number) => [
      0.45,
      ...Array.from({ length: count - 1 }, (_, j) => ((j + 1) * length) / count),
      length - 0.45,
    ];
    const keep: [number, number][] = entry ? [[entry.deck.x0 - 0.45, entry.deck.x1 + 0.45]] : [];
    const front: [number, number][] = between(W, plan.bays.front)
      .filter((x) => !keep.some(([a, b]) => x > a && x < b))
      .map((x) => [x, D + 0.82]);
    const side: [number, number][] = between(D, plan.bays.side)
      .reverse()
      .map((y) => [W + 0.82, y]);
    const back: [number, number][] = between(W, plan.bays.front).map((x) => [x, -0.65]);
    const garden = s.zones.find((z) => z.kind === 'garden' || z.kind === 'yard');
    const trees: [number, number][] = garden
      ? [
          [garden.rect.x1 - 1.75, garden.rect.y0 + 1.3],
          [garden.rect.x1 - 1.55, garden.rect.y1 - 1.6],
          [garden.rect.x0 + 0.5, (garden.rect.y0 + garden.rect.y1) / 2],
        ]
      : [];
    const beds = [front, side, trees, back].filter((r) => r.length);
    const { index, count } = this.turn('landscape');
    // One set of them lights the beds along the front and the side; more share the beds out.
    const pick =
      place === 'back'
        ? [back]
        : place === 'side'
          ? [side]
          : place === 'garden' || place === 'yard'
            ? [trees.length ? trees : side]
            : count === 1
              ? beds.slice(0, 2)
              : index < beds.length
                ? [beds[index]]
                : [];
    return this.rows(
      w,
      slot,
      pick.filter((r) => r.length).map((spots) => ({ spots })),
      (x, y, g) => uplight(this.c, x, y, slot, g),
      0.3,
      3.6,
    );
  }

  /** Bollards along the path to the front door, either side of it, or along the side of the house. */
  private path(w: Wanted, slot: number): boolean {
    const walk = this.s.walk;
    const { index, count } = this.turn('path');
    const rows: Row[] = [];
    if (walk) {
      const left: [number, number][] = [];
      const right: [number, number][] = [];
      let i = 0;
      // Staggered: one side, then the other.
      for (let y = walk.y0 + 0.55; y < walk.y1 - 0.4; y += 0.8, i++) {
        (i % 2 ? right : left).push([i % 2 ? walk.x1 + 0.35 : walk.x0 - 0.35, y]);
      }
      const mid = (walk.x0 + walk.x1) / 2;
      const line: Row['line'] = [
        [mid, walk.y0 + 0.55],
        [mid, walk.y1 - 0.4],
      ];
      if (count >= 2) rows.push({ spots: left, line }, { spots: right, line });
      else rows.push({ spots: [...left, ...right], line });
    }
    // A further set lights a path down the side of the house, where no garden or pool is in its way.
    const beside = this.s.zones.some((z) => z.rect.x0 >= this.W && z.rect.y0 < this.D && z.kind !== 'porch');
    if (!beside) {
      const side: [number, number][] = [];
      for (let y = this.D - 0.6; y > 0.6; y -= 1.6) side.push([this.W + 1.3, y]);
      rows.push({ spots: side });
    }
    const row = rows[index];
    if (!row) return false;
    return this.rows(w, slot, [row], (x, y, g) => standingLamp(this.c, x, y, false, slot, g), 0.55, 3.4);
  }

  /** Bollards along the driveway: both sides of it for one light, a side each for two. */
  private driveway(w: Wanted, slot: number): boolean {
    const drive = this.s.drive;
    if (!drive) return false;
    const { index, count } = this.turn('driveway');
    const from = Math.max(drive.y0, this.D) + 0.6;
    const inner: [number, number][] = [];
    const outer: [number, number][] = [];
    for (let y = from; y < drive.y1 - 0.3; y += 1.7) {
      inner.push([drive.x1 + 0.35, y]);
      outer.push([drive.x0 - 0.35, y]);
    }
    const mid = (drive.x0 + drive.x1) / 2;
    const line: Row['line'] = [
      [mid, from],
      [mid, drive.y1 - 0.3],
    ];
    const rows: Row[] =
      count >= 2
        ? [
            { spots: inner, line },
            { spots: outer, line },
          ]
        : [{ spots: [...inner, ...outer], line }];
    const row = rows[index];
    if (!row) return false;
    return this.rows(w, slot, [row], (x, y, g) => standingLamp(this.c, x, y, false, slot, g), 0.55, 3.6);
  }

  // ── On the lawn ──

  /** A lamppost: by the path at the pavement, at the end of the driveway, in the garden or the yard behind. */
  private post(w: Wanted, slot: number, place: Place | null): boolean {
    const { W, D, s } = this;
    const near = s.fence - 0.55;
    const walk = s.walk;
    const drive = s.drive;
    const garden = s.zones.find((z) => z.kind === 'garden' || z.kind === 'yard');
    const front: [number, number][] = walk
      ? [
          [walk.x0 - 0.75, near],
          [walk.x1 + 0.75, near - 0.3],
        ]
      : [[W / 2, near]];
    const mouth: [number, number][] = drive ? [[drive.x1 + 0.6, near]] : [];
    const yard: [number, number][] = garden
      ? [
          [garden.rect.x0 + 0.7, garden.rect.y0 + 1.2],
          [garden.rect.x0 + 0.7, garden.rect.y1 - 1.0],
        ]
      : [];
    const corner: [number, number][] = [
      [W + 1.2, D + 1.4],
      [W - 0.8, near],
    ];
    const back: [number, number][] = [
      [W + 1.0, -1.6],
      [1.0, -2.0],
    ];
    const spots =
      place === 'back'
        ? back
        : place === 'yard' || place === 'garden' || place === 'side'
          ? [...yard, ...corner, ...back]
          : place === 'garage'
            ? [...mouth, ...front]
            : [...front, ...mouth, ...corner, ...yard, ...back];
    const at = this.claim(spots, 0.6);
    if (!at) return false;
    this.fixture(w, slot, standingLamp(this.c, at[0], at[1], true, slot, this.groupAt(at[0], at[1])), 7);
    return true;
  }

  /** A Christmas tree on the front lawn, where there is room for it. */
  private tree(w: Wanted, slot: number): boolean {
    const { W, D, s } = this;
    // As big as the lawn between the beds and the fence allows.
    const room = s.fence - 0.3 - (D + 1.1);
    const size = Math.min(1, Math.max(0.6, room / 1.6));
    const y = D + 1.1 + room / 2;
    const garden = s.zones.find((z) => z.kind === 'garden' || z.kind === 'yard');
    const spots: [number, number][] = [
      [W * 0.8, y],
      [W * 0.2, y],
      [W + 1.4, D + 1.5],
      ...(garden
        ? [[(garden.rect.x0 + garden.rect.x1) / 2, (garden.rect.y0 + garden.rect.y1) / 2] as [number, number]]
        : []),
    ];
    const at = this.claim(spots, 0.7 * size);
    if (!at) return false;
    const height = christmasTree(this.c, at[0], at[1], size, slot, this.groupAt(at[0], at[1]));
    this.fixture(w, slot, [at[0], at[1], height * 0.45], 4, 'lamp');
    return true;
  }

  /** Strings of bulbs: over the patio, along the porch, over the garden, behind the house. */
  private string(w: Wanted, slot: number, place: Place | null): boolean {
    const { W, D, s, c } = this;
    const patio = s.zones.find((z) => z.kind === 'patio');
    const garden = s.zones.find((z) => z.kind === 'garden' || z.kind === 'yard');
    const entry = s.entry;
    const options: { key: string; draw: () => [Point, Point] | null }[] = [];
    const across = (key: string, r: Rect, k: number) => ({
      key,
      draw: (): [Point, Point] | null => {
        if (r.x1 - r.x0 < 2 || r.y1 - r.y0 < 2) return null;
        const a: Point = [r.x0 + 0.5, r.y0 + 0.5 + k, 2.5];
        const b: Point = [r.x1 - 0.5, r.y1 - 0.5 - k, 2.5];
        strand(c, a, b, slot, this.groupAt(a[0], a[1]), true);
        return [a, b];
      },
    });
    const porch = {
      key: 'porch',
      draw: (): [Point, Point] | null => {
        if (!entry || !wideEntry(c.style)) return null;
        const ground = c.ground;
        const group = ground ? c.groups.upper[ground.index] : c.groups.ground;
        const { top } = entryTop(c);
        const y = entry.deck.y1 - 0.08;
        const a: Point = [entry.deck.x0 + 0.2, y, top - 0.02];
        const b: Point = [entry.deck.x1 - 0.2, y, top - 0.02];
        strand(c, a, b, slot, group, false, 0.18);
        return [a, b];
      },
    };
    const behind = (k: number) => ({
      key: `back${k}`,
      draw: (): [Point, Point] | null => {
        const y = -0.9 - k * 1.1;
        if (y < s.box.y0 + 0.9) return null;
        const a: Point = [0.6, y, 2.6];
        const b: Point = [W - 0.6, y, 2.6];
        strand(c, a, b, slot, c.groups.base, true);
        return [a, b];
      },
    });
    const sideYard = {
      key: 'side',
      draw: (): [Point, Point] | null => {
        const x1 = s.box.x1 - 0.8;
        if (x1 - (W + 0.9) < 2) return null;
        const a: Point = [W + 0.9, 0.7, 2.6];
        const b: Point = [x1, D - 0.7, 2.6];
        strand(c, a, b, slot, c.groups.ground, true);
        return [a, b];
      },
    };
    const patios = patio ? [across('patio0', patio.rect, 0), across('patio1', patio.rect, 0.9)] : [];
    const gardens = garden ? [across('garden0', garden.rect, 0.3), across('garden1', garden.rect, 1.3)] : [];
    if (place === 'door' || place === 'front') options.push(porch, ...patios, ...gardens);
    else if (place === 'back') options.push(behind(0), behind(1), ...patios);
    else if (place === 'side') options.push(sideYard, ...gardens);
    else if (place === 'garden' || place === 'yard') options.push(...gardens, sideYard, ...patios);
    options.push(...patios, ...gardens, porch, behind(0), sideYard, behind(1));
    for (const option of options) {
      if (this.used.has(option.key)) continue;
      const ends = option.draw();
      if (!ends) continue;
      this.used.add(option.key);
      const [a, b] = ends;
      this.fixture(w, slot, [a[0], a[1], (a[2] + b[2]) / 2 - 0.5], 5, 'strip', [b[0] - a[0], b[1] - a[1], 0]);
      return true;
    }
    return false;
  }

  /** Bulbs along the eaves of the house, and of the garage. */
  private roofline(w: Wanted, slot: number): boolean {
    const c = this.c;
    const plan = c.plan;
    if (!c.top) return false;
    const spans: { key: string; span: RoofSpan }[] = [
      {
        key: 'roof',
        span: {
          x0: 0,
          x1: this.W,
          y0: 0,
          y1: this.D,
          top: c.roof.top,
          pitch: c.roof.pitch,
          group: c.groups.roof,
          ends: { left: true, right: true },
          main: true,
        },
      },
    ];
    const wing = plan.wing;
    const ground = c.ground;
    if (wing && ground) {
      spans.push({
        key: 'wing',
        span: {
          x0: wing.rect.x0,
          x1: wing.rect.x1,
          y0: wing.rect.y0,
          y1: wing.rect.y1,
          top: WING_FLOOR + wingHeight(plan),
          pitch: c.roof.pitch,
          group: c.groups.upper[ground.index],
          ends: { left: true, right: false },
          main: false,
        },
      });
    }
    const free = spans.filter((s) => !this.used.has(s.key));
    if (!free.length) return false;
    // One string of them does both roofs; a second light takes the garage's.
    const mine = (this.counts.get('roofline') ?? 1) > 1 ? free.slice(0, 1) : free;
    for (const { key, span } of mine) {
      this.used.add(key);
      for (const line of frontEaves(c, span)) bulbLine(c, line, slot, span.group, true);
    }
    // Its light comes from along the whole front of the first roof.
    const lines = frontEaves(c, mine[0].span);
    const a = lines[0][0];
    const end = lines[lines.length - 1];
    const b = end[end.length - 1];
    this.fixture(w, slot, [a[0], a[1], a[2] - 0.2], 3.4, 'strip', [b[0] - a[0], b[1] - a[1], 0]);
    return true;
  }

  /** The water of the pool, lit from inside. */
  private pool(w: Wanted, slot: number): boolean {
    const zone = this.s.zones.find((z) => z.kind === 'pool');
    if (!zone || this.used.has('pool')) return false;
    this.used.add('pool');
    const r = zone.rect;
    const p = { x0: r.x0 + 0.65, y0: r.y0 + 0.65, x1: r.x1 - 0.65, y1: r.y1 - 0.65 };
    const m = this.c.mesh;
    m.with({ group: this.c.groups.ground, room: 0, emit: slot, ...PAINT.water }, () =>
      m.quad([p.x0, p.y0, 0.211], [p.x1, p.y0, 0.211], [p.x1, p.y1, 0.211], [p.x0, p.y1, 0.211], [0, 0, 1]),
    );
    this.fixture(w, slot, [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, 0.45], 4.5, 'lamp');
    return true;
  }
}

/**
 * Places every light outdoors. Lights whose names say what or where they are go first, a light of
 * a pair before one that takes both; the rest fill the places left.
 */
export function lightOutdoors(c: Context, s: Site): void {
  const wanted: Wanted[] = c.input.outdoor.flatMap((room) =>
    room.lights.map((light) => ({ room, light, aim: aimFor(light.name, room) })),
  );
  const said = (w: Wanted) => Boolean(w.aim.fitting || w.aim.place);
  const order = [
    ...wanted.filter((w) => said(w) && w.aim.hand !== 0),
    ...wanted.filter((w) => said(w) && w.aim.hand === 0),
    ...wanted.filter((w) => !said(w)),
  ];
  const grounds = new Grounds(c, s, wanted);
  for (const w of order) grounds.place(w);
}
