// Isometric projection and painter's-algorithm ordering for the 3D house.
//
// World axes, in meters: x runs to the right and back, y to the left and back... seen from the
// viewer at the front right: x grows toward the lower right of the picture, y toward the lower
// left, z up. The faces that can be seen are the tops, the +x faces ("right") and the +y faces
// ("left"). Anything with larger x, y or z is nearer the viewer.

export type Vec3 = readonly [number, number, number];

export const ISO_X = Math.sqrt(3) / 2;
export const ISO_Y = 0.5;

export function project(x: number, y: number, z: number): [number, number] {
  return [(x - y) * ISO_X, (x + y) * ISO_Y - z];
}

const num = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** SVG path data for a closed polygon through world points. */
export function polygon(points: readonly Vec3[]): string {
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const [sx, sy] = project(points[i][0], points[i][1], points[i][2]);
    d += `${i ? 'L' : 'M'}${num(sx)} ${num(sy)}`;
  }
  return `${d}Z`;
}

/** SVG path data for an open polyline through world points. */
export function polyline(points: readonly Vec3[]): string {
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const [sx, sy] = project(points[i][0], points[i][1], points[i][2]);
    d += `${i ? 'L' : 'M'}${num(sx)} ${num(sy)}`;
  }
  return d;
}

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

export const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => ({
  x0: Math.min(x0, x1),
  y0: Math.min(y0, y1),
  z0: Math.min(z0, z1),
  x1: Math.max(x0, x1),
  y1: Math.max(y0, y1),
  z1: Math.max(z0, z1),
});

export function topFace(b: Box): Vec3[] {
  return [
    [b.x0, b.y0, b.z1],
    [b.x1, b.y0, b.z1],
    [b.x1, b.y1, b.z1],
    [b.x0, b.y1, b.z1],
  ];
}

/** The +x face, on the lower right of the picture. */
export function rightFace(b: Box): Vec3[] {
  return [
    [b.x1, b.y0, b.z1],
    [b.x1, b.y1, b.z1],
    [b.x1, b.y1, b.z0],
    [b.x1, b.y0, b.z0],
  ];
}

/** The +y face, on the lower left of the picture. */
export function leftFace(b: Box): Vec3[] {
  return [
    [b.x0, b.y1, b.z1],
    [b.x1, b.y1, b.z1],
    [b.x1, b.y1, b.z0],
    [b.x0, b.y1, b.z0],
  ];
}

/** The outline of a box as seen by the viewer: a hexagon. */
export function silhouette(b: Box): Vec3[] {
  return [
    [b.x0, b.y0, b.z1],
    [b.x1, b.y0, b.z1],
    [b.x1, b.y0, b.z0],
    [b.x1, b.y1, b.z0],
    [b.x0, b.y1, b.z0],
    [b.x0, b.y1, b.z1],
  ];
}

/** An ellipse lying flat at height z: a circle on the floor seen in isometric view. */
export function floorEllipse(
  cx: number,
  cy: number,
  z: number,
  r: number,
): { cx: number; cy: number; rx: number; ry: number } {
  const [sx, sy] = project(cx, cy, z);
  // A circle of radius r on the floor projects to an ellipse with these radii.
  return { cx: sx, cy: sy, rx: r * ISO_X * Math.SQRT2, ry: r * ISO_Y * Math.SQRT2 };
}

export interface ScreenBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function screenBounds(b: Box): ScreenBounds {
  return {
    left: (b.x0 - b.y1) * ISO_X,
    right: (b.x1 - b.y0) * ISO_X,
    top: (b.x0 + b.y0) * ISO_Y - b.z1,
    bottom: (b.x1 + b.y1) * ISO_Y - b.z0,
  };
}

export function unionBounds(list: ScreenBounds[]): ScreenBounds {
  return list.reduce(
    (acc, b) => ({
      left: Math.min(acc.left, b.left),
      top: Math.min(acc.top, b.top),
      right: Math.max(acc.right, b.right),
      bottom: Math.max(acc.bottom, b.bottom),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

const EPS = 1e-3;

/**
 * Whether `a` has to be painted before `b`. Boxes that don't intersect are always separated along
 * some axis, and along that axis the one with the smaller coordinates is farther from the viewer.
 */
export function paintsBefore(a: Box, b: Box): boolean {
  if (a.x1 <= b.x0 + EPS) return true;
  if (b.x1 <= a.x0 + EPS) return false;
  if (a.y1 <= b.y0 + EPS) return true;
  if (b.y1 <= a.y0 + EPS) return false;
  if (a.z1 <= b.z0 + EPS) return true;
  if (b.z1 <= a.z0 + EPS) return false;
  return depthOf(a) < depthOf(b);
}

const depthOf = (b: Box) => b.x0 + b.x1 + b.y0 + b.y1 + b.z0 + b.z1;

const overlaps = (a: ScreenBounds, b: ScreenBounds) =>
  a.left < b.right - EPS && b.left < a.right - EPS && a.top < b.bottom - EPS && b.top < a.bottom - EPS;

/**
 * Orders items back to front. Only items whose outlines overlap on screen constrain each other;
 * among the rest, farther items come first. Cycles (which isometric boxes can form in rare
 * arrangements) are broken by depth.
 */
export function paintOrder<T extends { box: Box }>(items: readonly T[]): T[] {
  const n = items.length;
  const bounds = items.map((item) => screenBounds(item.box));
  const after: number[][] = items.map(() => []);
  const blockers = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!overlaps(bounds[i], bounds[j])) continue;
      if (paintsBefore(items[i].box, items[j].box)) {
        after[i].push(j);
        blockers[j]++;
      } else {
        after[j].push(i);
        blockers[i]++;
      }
    }
  }
  const depth = items.map((item) => depthOf(item.box));
  const done = new Array<boolean>(n).fill(false);
  const order: T[] = [];
  const ready = new Set<number>();
  for (let i = 0; i < n; i++) if (!blockers[i]) ready.add(i);
  while (order.length < n) {
    let pick = -1;
    for (const i of ready) if (pick < 0 || depth[i] < depth[pick] || (depth[i] === depth[pick] && i < pick)) pick = i;
    if (pick < 0) {
      // A cycle: take the farthest item that is left.
      for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || depth[i] < depth[pick])) pick = i;
    }
    ready.delete(pick);
    done[pick] = true;
    order.push(items[pick]);
    for (const j of after[pick]) {
      if (done[j]) continue;
      if (--blockers[j] <= 0) ready.add(j);
    }
  }
  return order;
}
