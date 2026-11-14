// The camera that looks at the house: where it stands, how it frames what it is shown, and where
// a point of the house lands on the screen.

import {
  add,
  cross,
  lookAt,
  multiply,
  normalize,
  perspective,
  scale,
  toWorld,
  transform,
  type Mat4,
  type Vec3,
} from './math.ts';

/** Where the camera is, as an orbit around a point: angles in radians, distance in meters. */
export interface Pose {
  /** Around the house: 0 is straight in front, positive toward its right side. */
  yaw: number;
  /** Above the horizon. */
  pitch: number;
  distance: number;
  /** The point looked at, in world space. */
  target: Vec3;
}

export interface Camera {
  view: Mat4;
  proj: Mat4;
  viewProj: Mat4;
  eye: Vec3;
}

/** A long lens: it flattens the perspective, as photographs of buildings do. */
export const FOV = (22 * Math.PI) / 180;

const RAD = Math.PI / 180;
/** The view from outside, and the steeper one into an opened floor. */
export const OUTSIDE = { yaw: 38 * RAD, pitch: 21 * RAD };
export const INSIDE = { yaw: 38 * RAD, pitch: 40 * RAD };

const axes = (pose: Pose): { back: Vec3; right: Vec3; up: Vec3 } => {
  const back: Vec3 = [
    Math.sin(pose.yaw) * Math.cos(pose.pitch),
    Math.sin(pose.pitch),
    Math.cos(pose.yaw) * Math.cos(pose.pitch),
  ];
  const right = normalize(cross([0, 1, 0], back));
  return { back, right, up: cross(back, right) };
};

export function cameraFor(pose: Pose, aspect: number, radius: number): Camera {
  const { back } = axes(pose);
  const eye = add(pose.target, scale(back, pose.distance));
  const view = lookAt(eye, pose.target, [0, 1, 0]);
  const near = Math.max(0.5, pose.distance - radius * 1.6);
  const proj = perspective(FOV, aspect, near, pose.distance + radius * 1.6);
  return { view, proj, viewProj: multiply(proj, view), eye };
}

/** Where a world point lands in a picture of the given size: x, y from the top left, and its depth. */
export function project(camera: Camera, p: Vec3, width: number, height: number): [number, number, number] {
  const c = transform(camera.viewProj, p);
  const w = c[3] || 1e-6;
  return [((c[0] / w) * 0.5 + 0.5) * width, (0.5 - (c[1] / w) * 0.5) * height, c[2] / w];
}

export interface Viewport {
  width: number;
  height: number;
  /** Space to keep clear at each edge, in pixels. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The pose from which `points` (plan space) fill the viewport, inside its margins. Perspective
 * makes this a matter of trying and correcting, which settles in a few rounds.
 */
export function fit(points: readonly Vec3[], yaw: number, pitch: number, viewport: Viewport, radius: number): Pose {
  const world = points.map((p) => toWorld(p[0], p[1], p[2]));
  const center: Vec3 = [0, 0, 0];
  for (const p of world) for (let i = 0; i < 3; i++) center[i] += p[i] / world.length;
  const pose: Pose = { yaw, pitch, distance: Math.max(20, radius * 3), target: center };
  const { width, height } = viewport;
  const aspect = width / Math.max(1, height);
  // The part of the picture left for the house, in the camera's own coordinates (-1 to 1).
  const x0 = -1 + (2 * viewport.left) / width;
  const x1 = 1 - (2 * viewport.right) / width;
  const y0 = -1 + (2 * viewport.bottom) / height;
  const y1 = 1 - (2 * viewport.top) / height;
  const tan = Math.tan(FOV / 2);
  for (let round = 0; round < 12; round++) {
    const camera = cameraFor(pose, aspect, radius);
    let left = Infinity;
    let right = -Infinity;
    let bottom = Infinity;
    let top = -Infinity;
    for (const p of world) {
      const c = transform(camera.viewProj, p);
      const w = Math.max(1e-4, c[3]);
      left = Math.min(left, c[0] / w);
      right = Math.max(right, c[0] / w);
      bottom = Math.min(bottom, c[1] / w);
      top = Math.max(top, c[1] / w);
    }
    const grow = Math.max((right - left) / Math.max(0.05, x1 - x0), (top - bottom) / Math.max(0.05, y1 - y0));
    const { right: rightAxis, up } = axes(pose);
    const dx = ((left + right) / 2 - (x0 + x1) / 2) * tan * aspect * pose.distance;
    const dy = ((bottom + top) / 2 - (y0 + y1) / 2) * tan * pose.distance;
    pose.target = add(pose.target, add(scale(rightAxis, dx), scale(up, dy)));
    pose.distance *= grow;
  }
  return pose;
}

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  const mix = (p: number, q: number) => p + (q - p) * t;
  return {
    yaw: mix(a.yaw, b.yaw),
    pitch: mix(a.pitch, b.pitch),
    distance: mix(a.distance, b.distance),
    target: [mix(a.target[0], b.target[0]), mix(a.target[1], b.target[1]), mix(a.target[2], b.target[2])],
  };
}

export const samePose = (a: Pose, b: Pose): boolean =>
  Math.abs(a.yaw - b.yaw) < 1e-4 &&
  Math.abs(a.pitch - b.pitch) < 1e-4 &&
  Math.abs(a.distance - b.distance) < 1e-3 &&
  Math.hypot(a.target[0] - b.target[0], a.target[1] - b.target[1], a.target[2] - b.target[2]) < 1e-3;

/** The compass direction the camera looks toward, in degrees, with the house's front facing south. */
export const viewAzimuth = (yaw: number): number => (((-yaw / RAD) % 360) + 360) % 360;

export interface SkyFrame {
  forward: Vec3;
  /** Right and up, scaled so that forward ± right ± up are the corners of the picture. */
  right: Vec3;
  up: Vec3;
  /** The angle one pixel covers, in radians. */
  pixel: number;
}

/**
 * The sky behind the house is seen as if looking out level, not down at the house: the horizon
 * runs along the bottom of the picture, and the sky rises above it. It turns with the camera, and
 * tips a little with it, so the two move as one.
 */
export function skyFrame(yaw: number, width: number, height: number, pitch = OUTSIDE.pitch): SkyFrame {
  const aspect = width / Math.max(1, height);
  const fov = Math.min(62 * RAD, Math.max(36 * RAD, 2 * Math.atan(Math.tan(44 * RAD) / aspect)));
  const tilt = -3 * RAD + fov / 2 - (pitch - OUTSIDE.pitch) * 0.22;
  const forward: Vec3 = [-Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), -Math.cos(yaw) * Math.cos(tilt)];
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tan = Math.tan(fov / 2);
  return { forward, right: scale(right, tan * aspect), up: scale(up, tan), pixel: fov / Math.max(1, height) };
}

/**
 * How much of each outside wall (front, right, back, left) stays standing when a floor is opened:
 * the walls between the camera and the rooms go, the ones behind the rooms stay.
 */
export function wallsKept(yaw: number): [number, number, number, number] {
  const keep = (toward: number) => {
    const t = Math.min(1, Math.max(0, (toward - 0.06) / 0.14));
    return 1 - t * t * (3 - 2 * t);
  };
  return [keep(Math.cos(yaw)), keep(Math.sin(yaw)), keep(-Math.cos(yaw)), keep(-Math.sin(yaw))];
}

/** Where a spot of the sky picture (x, y from -1 to 1) is in the sky: degrees right of the view, and up. */
export function skySpot(frame: SkyFrame, yaw: number, x: number, y: number): [number, number] {
  const d = normalize(add(frame.forward, add(scale(frame.right, x), scale(frame.up, y))));
  const azimuth = Math.atan2(d[0], -d[2]) / RAD;
  let turn = azimuth - viewAzimuth(yaw);
  turn = ((((turn + 180) % 360) + 360) % 360) - 180;
  return [turn, Math.asin(d[1]) / RAD];
}
