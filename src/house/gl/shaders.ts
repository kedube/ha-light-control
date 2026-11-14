// GLSL for the 3D house. Everything is procedural: there are no image files to load, so the
// boards, bricks, shingles, grass and clouds are all drawn by these programs.

import { MAT } from '../materials.ts';
import { MIE_G } from '../sky.ts';

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DShadow;
`;

/** How many groups (parts that lift away together) a house can have. */
export const MAX_GROUPS = 24;
/** The most lamps that light any one room. */
export const MAX_ROOM_LIGHTS = 24;

const NOISE = `
const float PI = 3.14159265359;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
/** Interleaved gradient noise: a different, well-spread value for every pixel. */
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

/** The sky's brightness in a direction, from the two small textures the sky model fills. */
const SKY = `
uniform sampler2D uSkyAir;
uniform sampler2D uSkyHaze;
uniform vec3 uSunSim;
uniform vec3 uNightHorizon;
uniform vec3 uNightZenith;
uniform vec3 uGround;

float hazePhase(float mu) {
  const float g = ${MIE_G.toFixed(3)};
  const float g2 = g * g;
  return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}
vec3 skyAbove(vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 flat_ = normalize(vec3(d.x, up, d.z));
  vec2 uv = vec2(atan(flat_.x, -flat_.z) / (2.0 * PI) + 0.5, sqrt(asin(up) / (0.5 * PI)));
  vec3 c = texture(uSkyAir, uv).rgb + texture(uSkyHaze, uv).rgb * hazePhase(dot(flat_, uSunSim));
  return c + mix(uNightHorizon, uNightZenith, sqrt(up));
}
/** The surroundings as a mirror would show them: sky above, hazy ground below. */
vec3 skyAround(vec3 d) {
  vec3 sky = skyAbove(d);
  return mix(sky, uGround, smoothstep(0.0, -0.25, d.y));
}
`;

const VERTEX_INPUTS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec4 aNormalGroup;
layout(location = 3) in vec4 aColorMat;
layout(location = 4) in vec4 aRoomEmit;
uniform mat4 uViewProj;
uniform float uGroup[${MAX_GROUPS}];
uniform vec4 uSide;
uniform float uLift;
invariant gl_Position;

/**
 * How much of this part of the house is showing, 0 to 1. An outside wall above its sill belongs to
 * a side of the house: when its floor is opened it stays only if it is not between the viewer and
 * the rooms (uSide), so the house can be turned and looked into from any direction.
 */
float showing() {
  int g = int(aNormalGroup.w + 0.5);
  float v = uGroup[g];
  int side = int(aRoomEmit.w + 0.5);
  if (side > 0) v = max(v, uGroup[g - 1] * uSide[side - 1]);
  return v;
}
`;

/** Depth only: the shadow map, and the first pass of the picture (which also records normals). */
export const DEPTH_VERT = `${HEADER}${VERTEX_INPUTS}
uniform float uShadowPass;
out vec3 vNormal;
out float vVisible;
void main() {
  float visible = showing();
  int flags = int(aRoomEmit.z + 0.5);
  vVisible = visible;
  vNormal = aNormalGroup.xyz;
  vec3 p = aPos;
  p.y += (1.0 - visible) * uLift;
  bool hidden = visible <= 0.004 || (uShadowPass > 0.5 && ((flags & 1) != 0 || visible < 0.5));
  gl_Position = hidden ? vec4(0.0, 0.0, 2.0, 1.0) : uViewProj * vec4(p, 1.0);
}`;

export const DEPTH_FRAG = `${HEADER}${NOISE}
in vec3 vNormal;
in float vVisible;
uniform float uShadowPass;
out vec4 outColor;
void main() {
  if (uShadowPass < 0.5 && vVisible < 0.996 && vVisible < ign(gl_FragCoord.xy)) discard;
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  outColor = vec4(n * 0.5 + 0.5, 1.0);
}`;

export const SCENE_VERT = `${HEADER}${VERTEX_INPUTS}
uniform mat4 uShadowMat;
uniform vec3 uKeyDir;
out vec3 vPos;
out vec3 vNormal;
out vec2 vUv;
out vec3 vColor;
out vec4 vShadow;
out float vVisible;
flat out int vMat;
flat out int vRoom;
flat out int vEmit;
flat out int vFlags;
void main() {
  float visible = showing();
  vVisible = visible;
  vec3 p = aPos;
  p.y += (1.0 - visible) * uLift;
  vec3 n = normalize(aNormalGroup.xyz);
  vPos = p;
  vNormal = n;
  vUv = aUv;
  vColor = aColorMat.rgb / 255.0;
  vMat = int(aColorMat.a + 0.5);
  vRoom = int(aRoomEmit.x + 0.5);
  vEmit = int(aRoomEmit.y + 0.5);
  vFlags = int(aRoomEmit.z + 0.5);
  // Look the shadow up a little off the surface, more so where the light grazes it.
  float graze = 1.0 - abs(dot(n, uKeyDir));
  vShadow = uShadowMat * vec4(p + n * (0.02 + 0.05 * graze), 1.0);
  gl_Position = visible <= 0.004 ? vec4(0.0, 0.0, 2.0, 1.0) : uViewProj * vec4(p, 1.0);
}`;

const M = MAT;

export const SCENE_FRAG = `${HEADER}${NOISE}${SKY}
in vec3 vPos;
in vec3 vNormal;
in vec2 vUv;
in vec3 vColor;
in vec4 vShadow;
in float vVisible;
flat in int vMat;
flat in int vRoom;
flat in int vEmit;
flat in int vFlags;

uniform vec3 uEye;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uAmbient[6];
uniform sampler2DShadow uShadowMap;
uniform vec3 uShadowInfo;   // texel size, blur radius in texels, per-frame seed
uniform sampler2D uAo;
uniform vec2 uInvSize;
uniform sampler2D uLights;
uniform sampler2D uRooms;
uniform float uGlassPass;
uniform float uLamp;        // how strongly lamps show against the daylight
out vec4 outColor;

vec3 toLinear(vec3 c) { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }

vec3 ambientLight(vec3 n) {
  vec3 n2 = n * n;
  ivec3 neg = ivec3(lessThan(n, vec3(0.0)));
  return n2.x * uAmbient[neg.x] + n2.y * uAmbient[2 + neg.y] + n2.z * uAmbient[4 + neg.z];
}

float keyShadow() {
  vec3 sc = vShadow.xyz / vShadow.w;
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
  float angle = ign(gl_FragCoord.xy + uShadowInfo.z * 17.0) * 2.0 * PI;
  vec2 r = vec2(cos(angle), sin(angle)) * uShadowInfo.x * uShadowInfo.y;
  vec2 q = vec2(-r.y, r.x);
  float s = texture(uShadowMap, vec3(sc.xy + r * 0.9, sc.z));
  s += texture(uShadowMap, vec3(sc.xy - r * 0.55, sc.z));
  s += texture(uShadowMap, vec3(sc.xy + q * 0.35, sc.z));
  s += texture(uShadowMap, vec3(sc.xy - q * 0.75, sc.z));
  return s * 0.25;
}

/** 1 where a pattern of this size (in uv units) can be seen, 0 where it is too fine for the pixels. */
float visible(float period) {
  float w = max(fwidth(vUv.x), fwidth(vUv.y)) / period;
  return 1.0 - smoothstep(0.3, 0.8, w);
}

struct Surface {
  vec3 albedo;
  float rough;
  float spec;
  vec2 bump;    // tilt of the normal along u and v
  float wrap;   // how far light reaches around the surface (foliage, fabric)
};

Surface surface(vec3 base) {
  Surface s = Surface(base, 0.9, 0.04, vec2(0.0), 0.0);
  vec2 uv = vUv;
  if (vMat == ${M.siding}) {
    float row = uv.y / 0.17;
    float f = fract(row);
    float id = floor(row);
    float k = visible(0.17);
    float shade = (1.0 - 0.42 * smoothstep(0.82, 0.99, f)) * (1.0 + 0.07 * smoothstep(0.16, 0.0, f));
    s.albedo *= mix(0.94, shade, k) * (0.975 + 0.05 * hash12(vec2(id, 3.0)));
    s.albedo *= 0.96 + 0.08 * vnoise(vec2(uv.x * 2.0, uv.y * 30.0)) * k;
    s.bump.y = 0.18 * k;
    s.rough = 0.7;
    s.spec = 0.06;
  } else if (vMat == ${M.brick}) {
    vec2 b = uv / vec2(0.3, 0.1);
    float row = floor(b.y);
    b.x += 0.5 * mod(row, 2.0);
    vec2 id = floor(b);
    vec2 f = fract(b);
    float k = visible(0.1);
    float inside = smoothstep(0.0, 0.05, f.x) * smoothstep(1.0, 0.95, f.x) * smoothstep(0.0, 0.14, f.y) * smoothstep(1.0, 0.86, f.y);
    float tone = hash12(id);
    vec3 brick = base * (0.74 + 0.5 * tone);
    brick = mix(brick, brick * vec3(0.72, 0.7, 0.78), step(0.86, hash12(id + 7.0)));
    brick *= 0.92 + 0.16 * vnoise(uv * 40.0);
    vec3 mortar = mix(base, vec3(0.62, 0.6, 0.56), 0.75);
    s.albedo = mix(base * 0.95, mix(mortar, brick, inside), k);
    s.rough = 0.95;
  } else if (vMat == ${M.stucco}) {
    s.albedo *= 0.93 + 0.1 * fbm(uv * 1.3) + 0.05 * vnoise(uv * 60.0) * visible(0.04);
    s.rough = 0.95;
  } else if (vMat == ${M.shingle}) {
    vec2 q = uv / vec2(0.36, 0.2);
    float row = floor(q.y);
    q.x += hash12(vec2(row, 1.0));
    vec2 id = floor(q);
    vec2 f = fract(q);
    float k = visible(0.2);
    float tone = 0.78 + 0.4 * hash12(id);
    float shade = (1.0 - 0.4 * smoothstep(0.72, 1.0, f.y)) * mix(0.72, 1.0, smoothstep(0.0, 0.05, f.x));
    s.albedo *= mix(0.9, tone * shade, k) * (0.9 + 0.2 * vnoise(uv * 70.0) * visible(0.03));
    s.albedo *= 0.94 + 0.12 * fbm(uv * 0.6);
    s.rough = 0.95;
  } else if (vMat == ${M.shake}) {
    // Wooden shingles on a wall: rows of them, each a slightly different width and shade.
    vec2 q = uv / vec2(0.17, 0.19);
    float row = floor(q.y);
    q.x += hash12(vec2(row, 4.0));
    vec2 id = floor(q);
    vec2 f = fract(q);
    float k = visible(0.19);
    float tone = 0.76 + 0.46 * hash12(id);
    float shade = (1.0 - 0.36 * smoothstep(0.78, 1.0, f.y)) * mix(0.66, 1.0, smoothstep(0.0, 0.08, f.x));
    s.albedo *= mix(0.9, tone * shade, k) * (0.92 + 0.14 * vnoise(vec2(uv.x * 60.0, uv.y * 5.0)) * k);
    s.albedo *= 0.94 + 0.12 * fbm(uv * 0.7);
    s.bump.y = 0.14 * k;
    s.rough = 0.95;
  } else if (vMat == ${M.battens}) {
    // Wide boards, with a narrow strip standing proud over each joint and its shadow beside it.
    float f = fract(uv.x / 0.4);
    float k = visible(0.4);
    float strip = 1.0 - smoothstep(0.1, 0.115, f);
    float shadow = smoothstep(0.115, 0.125, f) * (1.0 - smoothstep(0.14, 0.2, f));
    s.albedo *= mix(0.97, 1.0 + 0.03 * strip - 0.26 * shadow, k);
    s.albedo *= 0.97 + 0.05 * vnoise(vec2(uv.x * 40.0, uv.y * 2.0)) * k;
    s.rough = 0.7;
    s.spec = 0.06;
  } else if (vMat == ${M.boards}) {
    // Narrow upright boards, each its own tone, with the grain running up them.
    float q = uv.x / 0.15;
    float id = floor(q);
    float f = fract(q);
    float k = visible(0.15);
    float tone = 0.82 + 0.34 * hash12(vec2(id, 9.0));
    float seam = smoothstep(0.0, 0.08, f);
    float grain = vnoise(vec2(uv.x * 70.0, uv.y * 3.0)) * 0.6 + vnoise(vec2(uv.x * 22.0, uv.y * 1.2)) * 0.4;
    s.albedo *= mix(0.95, tone * mix(0.55, 1.0, seam), k) * (0.88 + 0.22 * grain * k);
    s.rough = 0.6;
    s.spec = 0.09;
  } else if (vMat == ${M.timber}) {
    // Half-timbering: posts, rails and the odd brace of dark oak, with pale render between.
    vec2 g = uv / vec2(0.95, 1.5);
    vec2 id = floor(g);
    vec2 f = fract(g);
    float post = 1.0 - smoothstep(0.065, 0.08, min(f.x, 1.0 - f.x) * 0.95);
    float rail = 1.0 - smoothstep(0.06, 0.075, min(f.y, 1.0 - f.y) * 1.5);
    float pick = hash12(id + 3.0);
    float across = (pick > 0.6 ? f.x : 1.0 - f.x) * 0.95 - f.y * 1.5 * 0.633;
    float brace = step(0.3, pick) * (1.0 - smoothstep(0.045, 0.06, abs(across) * 0.85));
    float beam = max(max(post, rail), brace) * visible(0.25);
    vec3 oak = vec3(0.075, 0.052, 0.038) * (0.75 + 0.5 * vnoise(uv * vec2(50.0, 7.0)));
    s.albedo = mix(base * (0.92 + 0.1 * fbm(uv * 1.3)), oak, beam);
    s.rough = 0.95;
  } else if (vMat == ${M.stone}) {
    // Rough stone in courses: stones of different lengths, no two quite the same color.
    vec2 g = uv / vec2(0.5, 0.22);
    float row = floor(g.y);
    g.x += hash12(vec2(row, 2.0)) * 3.0;
    vec2 id = floor(g);
    vec2 f = fract(g);
    float split = 0.35 + 0.3 * hash12(id + 0.7);
    if (f.x > split) {
      id.x += 0.5;
      f.x = (f.x - split) / (1.0 - split);
    } else f.x /= split;
    float k = visible(0.22);
    float inside = smoothstep(0.0, 0.1, f.x) * smoothstep(1.0, 0.9, f.x) * smoothstep(0.0, 0.14, f.y) * smoothstep(1.0, 0.86, f.y);
    float tone = 0.68 + 0.56 * hash12(id * 1.7 + 4.0);
    vec3 stone = base * tone * mix(vec3(1.06, 1.0, 0.92), vec3(0.92, 0.98, 1.06), hash12(id + 9.0));
    stone *= 0.86 + 0.26 * vnoise(uv * 26.0);
    s.albedo = mix(base * 0.84, mix(base * 0.42, stone, inside), k);
    s.rough = 1.0;
  } else if (vMat == ${M.seam}) {
    // Sheet metal, folded into a standing seam every half meter.
    float f = fract(uv.x / 0.46);
    float k = visible(0.46);
    float edge = min(f, 1.0 - f) * 0.46;
    float seam = 1.0 - smoothstep(0.012, 0.022, edge);
    float shadow = smoothstep(0.022, 0.03, edge) * (1.0 - smoothstep(0.04, 0.07, edge)) * step(f, 0.5);
    s.albedo *= mix(1.0, 1.0 + 0.5 * seam - 0.3 * shadow, k) * (0.96 + 0.06 * fbm(uv * vec2(0.6, 0.2)));
    s.rough = 0.6;
    s.spec = 0.1;
  } else if (vMat == ${M.roofTile}) {
    vec2 q = uv / vec2(0.26, 0.36);
    vec2 id = floor(q);
    vec2 f = fract(q);
    float k = visible(0.26);
    float crown = sin(f.x * PI);
    float tone = 0.82 + 0.34 * hash12(id);
    float shade = (0.62 + 0.38 * crown) * (1.0 - 0.45 * smoothstep(0.84, 1.0, f.y));
    s.albedo *= mix(0.86, tone * shade, k);
    s.albedo *= 0.94 + 0.12 * fbm(uv * 0.7);
    s.bump.x = cos(f.x * PI) * 0.7 * k;
    s.rough = 0.8;
    s.spec = 0.05;
  } else if (vMat == ${M.wood}) {
    float grain = vnoise(vec2(uv.x * 2.5, uv.y * 48.0)) * 0.6 + vnoise(vec2(uv.x * 9.0, uv.y * 130.0)) * 0.4;
    s.albedo *= 0.86 + 0.26 * grain * visible(0.03);
    s.rough = 0.5;
    s.spec = 0.12;
  } else if (vMat == ${M.planks} || vMat == ${M.deck}) {
    bool deck = vMat == ${M.deck};
    vec2 q = uv / vec2(1.7, 0.14);
    float row = floor(q.y);
    q.x += hash12(vec2(row, 5.0));
    vec2 id = floor(q);
    vec2 f = fract(q);
    float k = visible(0.14);
    float tone = 0.84 + 0.3 * hash12(id);
    float seam = smoothstep(0.0, deck ? 0.09 : 0.045, f.y) * smoothstep(0.0, 0.006, f.x);
    float grain = vnoise(vec2(uv.x * 3.0, uv.y * 70.0));
    s.albedo *= mix(0.95, tone * mix(deck ? 0.3 : 0.6, 1.0, seam), k) * (0.92 + 0.16 * grain * k);
    s.rough = deck ? 0.8 : 0.34;
    s.spec = deck ? 0.05 : 0.22;
  } else if (vMat == ${M.floorTile}) {
    vec2 q = uv / 0.5;
    vec2 f = fract(q);
    float k = visible(0.5);
    float grout = smoothstep(0.0, 0.025, f.x) * smoothstep(0.0, 0.025, f.y);
    s.albedo *= mix(0.97, (0.95 + 0.07 * hash12(floor(q))) * mix(0.72, 1.0, grout), k);
    s.rough = 0.22;
    s.spec = 0.3;
  } else if (vMat == ${M.carpet}) {
    s.albedo *= (0.9 + 0.2 * vnoise(uv * 110.0) * visible(0.02)) * (0.94 + 0.12 * fbm(uv * 2.0));
    s.rough = 1.0;
    s.wrap = 0.25;
  } else if (vMat == ${M.concrete}) {
    vec2 f = fract(uv / 2.4);
    float joint = smoothstep(0.0, 0.012, f.x) * smoothstep(0.0, 0.012, f.y);
    s.albedo *= (0.88 + 0.2 * fbm(uv * 1.7)) * (0.96 + 0.08 * vnoise(uv * 50.0)) * mix(0.7, 1.0, mix(1.0, joint, visible(0.4)));
    s.rough = 0.9;
  } else if (vMat == ${M.grass}) {
    float big = fbm(uv * 0.3);
    float mid = fbm(uv * 1.9 + 5.0);
    float fine = vnoise(uv * 52.0) * 0.6 + vnoise(uv * 23.0) * 0.4;
    // Stripes left by the mower, and blades too fine to see one by one.
    float stripe = smoothstep(0.4, 0.6, fract((uv.x * 0.94 + uv.y * 0.34) / 1.7));
    s.albedo *= (0.7 + 0.42 * big + 0.2 * mid) * (0.82 + 0.36 * fine * visible(0.05)) * (0.94 + 0.12 * stripe);
    // Drier, yellower patches and a few darker ones.
    s.albedo = mix(s.albedo, s.albedo * vec3(1.3, 1.12, 0.6), smoothstep(0.52, 0.78, mid) * 0.34);
    s.albedo = mix(s.albedo, s.albedo * vec3(0.7, 0.86, 0.74), smoothstep(0.58, 0.3, big) * 0.4);
    s.rough = 1.0;
    s.wrap = 0.35;
  } else if (vMat == ${M.soil}) {
    if (abs(vNormal.y) > 0.5) {
      // Dug ground seen from above: plain earth, a little uneven.
      s.albedo *= 0.8 + 0.3 * fbm(uv * 1.4) + 0.1 * vnoise(uv * 30.0) * visible(0.06);
      s.albedo = mix(s.albedo, vec3(0.3, 0.29, 0.27), smoothstep(0.7, 0.8, vnoise(uv * 5.0 + 3.7)) * 0.4);
    } else {
      // A cut through the ground: dark topsoil, paler subsoil, then stony clay.
      float wobble = (fbm(vec2(uv.x * 0.6, 2.0)) - 0.5) * 0.36;
      float depth = -vPos.y + wobble;
      vec3 c = mix(base * 0.42, base * 0.95, smoothstep(0.18, 0.5, depth));
      c = mix(c, base * vec3(0.9, 0.9, 0.95) * 0.72, smoothstep(1.1, 2.0, depth));
      // Thin bands where the layers were laid down.
      float bands = vnoise(vec2(uv.x * 0.35, depth * 9.0)) * 0.7 + vnoise(vec2(uv.x * 1.3, depth * 23.0)) * 0.3;
      c *= 0.8 + 0.34 * bands;
      c *= 0.92 + 0.14 * vnoise(uv * 34.0) * visible(0.05);
      // A few stones, more of them deeper down.
      vec2 cell = uv * vec2(1.3, 1.7) + vec2(0.0, floor(uv.x * 1.3) * 0.37);
      vec2 id = floor(cell);
      vec2 rnd = hash22(id);
      vec2 f = fract(cell) - 0.25 - rnd * 0.5;
      float size = 0.07 + 0.2 * hash12(id + 5.0);
      float stone = 1.0 - smoothstep(size * 0.75, size, length(f * vec2(0.75, 1.25)));
      stone *= step(0.56, hash12(id + 11.0)) * smoothstep(0.3, 1.2, depth);
      vec3 rock = mix(vec3(0.3, 0.28, 0.26), vec3(0.46, 0.44, 0.41), hash12(id + 2.0)) * (0.8 + 0.4 * f.y / max(size, 1e-3));
      c = mix(c, rock, stone * 0.8);
      // The roots of the lawn at the very top.
      c = mix(vec3(0.13, 0.2, 0.08), c, smoothstep(0.02, 0.1, -vPos.y));
      s.albedo = c;
    }
    s.rough = 1.0;
  } else if (vMat == ${M.paving}) {
    vec2 q = uv / vec2(0.6, 0.3);
    float row = floor(q.y);
    q.x += 0.5 * mod(row, 2.0);
    vec2 f = fract(q);
    float k = visible(0.3);
    float joint = smoothstep(0.0, 0.03, f.x) * smoothstep(0.0, 0.06, f.y);
    s.albedo *= mix(0.94, (0.86 + 0.24 * hash12(floor(q))) * mix(0.62, 1.0, joint), k) * (0.95 + 0.1 * vnoise(uv * 30.0));
    s.rough = 0.9;
  } else if (vMat == ${M.asphalt}) {
    s.albedo *= (0.84 + 0.3 * vnoise(uv * 60.0) * visible(0.03)) * (0.9 + 0.2 * fbm(uv * 0.8));
    s.rough = 0.9;
  } else if (vMat == ${M.gravel}) {
    s.albedo *= 0.7 + 0.5 * vnoise(uv * 34.0) * visible(0.04) + 0.14 * fbm(uv * 3.0);
    s.rough = 1.0;
  } else if (vMat == ${M.fabric}) {
    s.albedo *= 0.93 + 0.1 * vnoise(uv * 140.0) * visible(0.015);
    s.rough = 1.0;
    s.wrap = 0.3;
  } else if (vMat == ${M.rug}) {
    vec2 e = min(uv, 1.0 - uv);
    float edge = min(e.x, e.y);
    s.albedo *= mix(0.68, 1.0, smoothstep(0.05, 0.06, edge)) * mix(1.14, 1.0, smoothstep(0.09, 0.1, edge));
    s.albedo *= 0.9 + 0.16 * vnoise(vPos.xz * 90.0) * (1.0 - smoothstep(0.3, 0.8, fwidth(vPos.x) * 90.0));
    s.rough = 1.0;
    s.wrap = 0.3;
  } else if (vMat == ${M.metal}) {
    s.rough = 0.32;
    s.spec = 0.85;
  } else if (vMat == ${M.gloss}) {
    s.rough = 0.16;
    s.spec = 0.32;
  } else if (vMat == ${M.water}) {
    vec2 w = uv * 2.6;
    float ridge = abs(vnoise(w * 1.6) - 0.5) + abs(vnoise(w * 3.1 + 9.0) - 0.5) * 0.5;
    s.albedo *= 0.7 + 0.9 * smoothstep(0.2, 0.0, ridge);
    s.bump = (vec2(vnoise(w * 2.2 + 3.0), vnoise(w * 2.2 + 11.0)) - 0.5) * 0.3;
    s.rough = 0.06;
    s.spec = 0.9;
  } else if (vMat == ${M.leaf} || vMat == ${M.flowers} || vMat == ${M.bloom}) {
    // Foliage: clumps of leaves, lighter where they catch the sky and darker in between.
    vec3 green = vMat == ${M.bloom} ? vec3(0.07, 0.16, 0.05) : s.albedo;
    vec3 q = vPos * 6.5;
    float clump = vnoise(q.xz + q.y * 0.7) * 0.6 + vnoise(q.xy * 2.3 + q.z * 1.9) * 0.4;
    float leaves = vnoise(vPos.xz * 31.0 + vPos.y * 23.0) * 0.5 + vnoise(vPos.xy * 47.0 - vPos.z * 29.0) * 0.5;
    float detail = 1.0 - smoothstep(0.3, 0.9, fwidth(vPos.x) * 40.0);
    green *= (0.42 + 0.72 * uv.x) * (0.62 + 0.76 * clump) * (0.8 + 0.4 * uv.y) * (0.74 + 0.52 * leaves * detail + 0.26 * (1.0 - detail));
    green = mix(green, green * vec3(1.3, 1.16, 0.55), smoothstep(0.55, 0.9, clump) * 0.4);
    s.albedo = green;
    if (vMat != ${M.leaf}) {
      // Petals: a mix of colors in a flower bed, one color on a shrub in bloom.
      vec2 cell = floor(vPos.xz * 12.0) + floor(vPos.y * 12.0) * 7.0;
      float pick = hash12(cell);
      vec3 mixed = pick > 0.93 ? vec3(0.9, 0.2, 0.28) : pick > 0.86 ? vec3(0.95, 0.8, 0.25) : pick > 0.8 ? vec3(0.86, 0.5, 0.86) : vec3(0.95);
      vec3 petal = vMat == ${M.bloom} ? base * (0.8 + 0.4 * hash12(cell + 5.0)) : mixed;
      float open = vMat == ${M.bloom} ? step(0.5, pick) * smoothstep(0.1, 0.6, uv.x) : step(0.74, pick) * smoothstep(0.2, 0.8, uv.x);
      s.albedo = mix(s.albedo, petal, open);
    }
    s.bump = (vec2(clump, leaves) - 0.5) * 2.2;
    s.rough = 0.85;
    s.wrap = 0.55;
  } else if (vMat == ${M.bark}) {
    s.albedo *= 0.72 + 0.5 * vnoise(vec2(uv.x * 34.0, uv.y * 3.5));
    s.rough = 1.0;
  } else if (vMat == ${M.screen}) {
    s.rough = 0.1;
    s.spec = 0.4;
  } else if (vMat == ${M.cut}) {
    s.rough = 1.0;
    s.spec = 0.0;
  }
  return s;
}

void main() {
  if (vVisible < 0.996 && vVisible < ign(gl_FragCoord.xy)) discard;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vPos);
  vec4 room = texelFetch(uRooms, ivec2(vRoom, 0), 0);
  vec3 bounce = texelFetch(uRooms, ivec2(vRoom, 1), 0).rgb;
  float open = room.z;   // how much daylight reaches this room: 1 outdoors or with the roof off

  if (uGlassPass > 0.5) {
    // Window glass: mostly a mirror for the sky, tipped up so it shows sky rather than lawn.
    vec3 R = reflect(-V, N);
    R = normalize(vec3(R.x, abs(R.y) * 0.55 + 0.1, R.z));
    float fresnel = 0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    float mirror = clamp(fresnel * 1.5 + 0.2, 0.0, 0.9);
    vec3 H = normalize(uKeyDir + V);
    float glint = pow(max(dot(N, H), 0.0), 900.0) * 30.0 * keyShadow();
    vec3 c = skyAbove(R) * mirror + uKeyColor * glint;
    // A lit room shows as a warm veil on its windows, even by day.
    c += bounce * 1.1;
    outColor = vec4(c, mirror * 0.75);
    return;
  }

  Surface s = surface(toLinear(vColor));

  // Tilt the normal by the pattern's relief, using the surface's own u and v directions.
  if (s.bump != vec2(0.0)) {
    vec3 dp1 = dFdx(vPos);
    vec3 dp2 = dFdy(vPos);
    vec2 du1 = dFdx(vUv);
    vec2 du2 = dFdy(vUv);
    vec3 p2 = cross(dp2, N);
    vec3 p1 = cross(N, dp1);
    vec3 T = p2 * du1.x + p1 * du2.x;
    vec3 B = p2 * du1.y + p1 * du2.y;
    float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
    if (vMat == ${M.leaf} || vMat == ${M.flowers} || vMat == ${M.bloom}) N = normalize(N + vec3(s.bump, s.bump.x - s.bump.y) * 0.5);
    else N = normalize(N + (T * s.bump.x + B * s.bump.y) * inv);
  }

  float ao = texture(uAo, gl_FragCoord.xy * uInvSize).r;
  float ndv = max(dot(N, V), 0.0);
  // Never zero: a power of zero is undefined where the base is zero too.
  float shine = max(2.0 / max(s.rough * s.rough, 0.002) - 2.0, 1.0);

  // The sun or the moon.
  float ndl = dot(N, uKeyDir);
  float lit = max((ndl + s.wrap) / (1.0 + s.wrap), 0.0);
  float shadow = lit > 0.0 ? keyShadow() : 0.0;
  vec3 diffuse = uKeyColor * lit * shadow / PI;
  vec3 H = normalize(uKeyDir + V);
  vec3 specular = uKeyColor * shadow * step(0.0, ndl) * pow(max(dot(N, H), 1e-4), shine) * (shine + 8.0) / (8.0 * PI) * max(ndl, 0.0);

  // The sky, from every side. Corners and crevices see less of it.
  vec3 sky = ambientLight(N) * open;
  diffuse += sky * ao;

  // The lamps of this room, and the light they bounce around it.
  int first = int(room.x + 0.5);
  int count = int(room.y + 0.5);
  for (int i = 0; i < ${MAX_ROOM_LIGHTS}; i++) {
    if (i >= count) break;
    vec4 color = texelFetch(uLights, ivec2(first + i, 1), 0);
    if (color.r + color.g + color.b <= 0.0) continue;
    vec4 place = texelFetch(uLights, ivec2(first + i, 0), 0);
    vec4 aux = texelFetch(uLights, ivec2(first + i, 2), 0);
    int kind = int(color.a + 0.5);
    vec3 at = place.xyz;
    // A strip is a line of light: the nearest point on it lights the surface.
    if (kind == 3) at += aux.xyz * clamp(dot(vPos - at, aux.xyz) / max(dot(aux.xyz, aux.xyz), 1e-6), 0.0, 1.0);
    vec3 toLight = at - vPos;
    float d2 = dot(toLight, toLight);
    float d = sqrt(d2);
    vec3 L = toLight / max(d, 1e-4);
    float fall = clamp(1.0 - pow(d / place.w, 4.0), 0.0, 1.0);
    float power = fall * fall / (d2 + 0.2);
    // Ceiling lights shine down in a cone; shaded lamps mostly up and down.
    if (kind == 1) power *= 0.14 + 0.86 * smoothstep(aux.x, aux.y, L.y);
    else if (kind == 2) power *= 0.5 + 0.5 * abs(L.y);
    float nl = max((dot(N, L) + 0.18 + s.wrap) / (1.18 + s.wrap), 0.0);
    diffuse += color.rgb * power * nl * mix(1.0, ao, 0.5);
    vec3 Hl = normalize(L + V);
    specular += color.rgb * power * pow(max(dot(N, Hl), 1e-4), shine) * (shine + 8.0) / 8.0 * max(dot(N, L), 0.0);
  }
  diffuse += bounce * ao;

  // Shiny surfaces mirror the sky a little.
  float fresnel = s.spec + (1.0 - s.spec) * pow(1.0 - ndv, 5.0);
  vec3 mirror = skyAround(reflect(-V, N)) * fresnel * (1.0 - s.rough) * (1.0 - s.rough) * open * mix(0.4, 1.0, ao);

  vec3 c = s.albedo * diffuse + (specular * s.spec + mirror);
  if (vMat == ${M.metal}) c = s.albedo * (diffuse * 0.35 + specular + skyAround(reflect(-V, N)) * open * 0.6 * mix(0.4, 1.0, ao));
  if (vMat == ${M.cut}) c = s.albedo * (diffuse * 0.6 + (ambientLight(vec3(0.0, 1.0, 0.0)) * open + bounce) * 0.5);

  // Things that give off light themselves.
  if (vEmit > 0) {
    vec3 glow = texelFetch(uLights, ivec2(vEmit, 3), 0).rgb;
    if (vMat == ${M.lamp}) c += glow * (0.55 + 0.45 * ndv);
    else if (vMat == ${M.strip}) c += glow * 2.2;
    else c += glow;
  }
  if (vMat == ${M.screen}) {
    // A screen that is on in a lit room: a soft picture, bluer at the top.
    float on = step(0.004, bounce.r + bounce.g + bounce.b);
    vec3 picture = mix(vec3(0.1, 0.22, 0.5), vec3(0.42, 0.5, 0.62), vnoise(vUv * 3.0 + 4.0)) * (0.5 + 0.5 * vnoise(vUv * 7.0));
    c += picture * on * uLamp * 0.9;
  }
  outColor = vec4(clamp(c, vec3(0.0), vec3(64.0)), 1.0);
}`;

/** A triangle that covers the whole picture, for passes that process every pixel. */
export const SCREEN_VERT = `${HEADER}
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FILM = `
vec3 film(vec3 x) {
  // A filmic curve (after Narkowicz's fit of ACES): gentle highlights, firm shadows.
  x *= 0.82;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 develop(vec3 c) {
  // Very bright colors drift toward white, as they do on film.
  float peak = max(c.r, max(c.g, c.b));
  c = mix(c, vec3(peak), smoothstep(1.5, 12.0, peak) * 0.6);
  return pow(film(c), vec3(1.0 / 2.2));
}
`;

/**
 * Clouds are drawn once into a texture that repeats in every direction; the sky then only has to
 * slide it along, which costs next to nothing per frame. Red holds the big shapes, green the
 * billows that eat into their edges.
 */
export const CLOUD_FRAG = `${HEADER}
in vec2 vUv;
out vec4 outColor;
float hash(vec2 p, float period) {
  p = mod(p, period);
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float tile(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i, period), hash(i + vec2(1.0, 0.0), period), f.x),
             mix(hash(i + vec2(0.0, 1.0), period), hash(i + vec2(1.0, 1.0), period), f.x), f.y);
}
float layers(vec2 uv, float period, float seed) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 6; i++) {
    s += a * tile(uv * period + seed, period);
    period *= 2.0;
    seed += 7.3;
    a *= 0.5;
  }
  return s;
}
void main() {
  outColor = vec4(layers(vUv, 8.0, 0.0), layers(vUv, 16.0, 31.7), 0.0, 1.0);
}`;

/** How much of the sky each visible point is hidden from by what is around it. */
export const AO_FRAG = `${HEADER}${NOISE}
in vec2 vUv;
uniform sampler2D uDepth;
uniform sampler2D uNormal;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform mat4 uView;
uniform float uRadius;
uniform float uSeed;
out vec4 outColor;
const int SAMPLES = 10;

vec3 viewPos(vec2 uv) {
  float z = texture(uDepth, uv).r;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

void main() {
  float depth = texture(uDepth, vUv).r;
  if (depth >= 1.0) {
    outColor = vec4(1.0);
    return;
  }
  vec3 P = viewPos(vUv);
  vec3 N = normalize(mat3(uView) * (texture(uNormal, vUv).xyz * 2.0 - 1.0));
  vec3 T = normalize(cross(N, abs(N.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 B = cross(N, T);
  float noise = ign(gl_FragCoord.xy + uSeed * 31.7);
  float hidden = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = (float(i) + noise) / float(SAMPLES);
    float angle = float(i) * 2.399963 + noise * 2.0 * PI + uSeed;
    float r = sqrt(fi);
    vec3 dir = T * (cos(angle) * r) + B * (sin(angle) * r) + N * sqrt(1.0 - fi);
    float reach = uRadius * mix(0.12, 1.0, fract(noise * 7.31 + float(i) * 0.618));
    vec3 S = P + dir * reach;
    vec4 clip = uProj * vec4(S, 1.0);
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    float there = viewPos(uv).z;
    // Only what is near counts: a far wall behind a chair does not shade the chair.
    float near = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - there), 1e-4));
    hidden += step(S.z + 0.025, there) * near;
  }
  outColor = vec4(vec3(1.0 - hidden / float(SAMPLES)), 1.0);
}`;

/** Halves the picture, keeping only what is bright enough to glow on the first step. */
export const BLOOM_DOWN_FRAG = `${HEADER}
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uFirst;
out vec4 outColor;
void main() {
  vec3 c = texture(uSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uSource, vUv + uTexel * vec2(1.0, -1.0)).rgb
    + texture(uSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uSource, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  if (uFirst > 0.5) {
    c = min(c, vec3(40.0));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c *= smoothstep(0.8, 2.2, l);
  }
  outColor = vec4(c, 1.0);
}`;

export const BLOOM_UP_FRAG = `${HEADER}
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  vec3 c = texture(uSource, vUv).rgb * 4.0;
  c += (texture(uSource, vUv + uTexel * vec2(1.0, 0.0)).rgb + texture(uSource, vUv - uTexel * vec2(1.0, 0.0)).rgb
    + texture(uSource, vUv + uTexel * vec2(0.0, 1.0)).rgb + texture(uSource, vUv - uTexel * vec2(0.0, 1.0)).rgb) * 2.0;
  c += texture(uSource, vUv + uTexel).rgb + texture(uSource, vUv - uTexel).rgb
    + texture(uSource, vUv + uTexel * vec2(1.0, -1.0)).rgb + texture(uSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  outColor = vec4(c / 16.0, 1.0);
}`;

/**
 * Turns the light of the house into the colors of a photograph. Where there is no house the
 * picture stays clear, apart from the glow of its lamps, so the sky can be put behind it.
 */
export const FINAL_FRAG = `${HEADER}${FILM}
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
out vec4 outColor;
void main() {
  vec4 scene = texture(uScene, vUv);
  outColor = vec4(develop(scene.rgb + texture(uBloom, vUv).rgb * uBloomStrength), scene.a);
}`;

/**
 * The picture on screen: the sky, alive, with the finished house laid over it. The sky is cheap
 * enough to draw afresh many times a second: air and haze from the sky model, the sun, the moon,
 * stars that twinkle and clouds that drift.
 */
export const PRESENT_FRAG = `${HEADER}${NOISE}${SKY}${FILM}
in vec2 vUv;
uniform sampler2D uHouse;
uniform float uHouseOn;
uniform sampler2D uClouds;
uniform vec3 uSkyForward;
uniform vec3 uSkyRight;
uniform vec3 uSkyUp;
uniform vec3 uSunDir;
uniform vec3 uSunDisc;
uniform vec3 uMoonDir;
uniform vec3 uMoonDisc;
uniform vec3 uMoonLight;
uniform float uMoonSize;
uniform float uStars;
uniform float uPixel;        // the angle one pixel covers, in radians
uniform float uCover;        // how much of the sky is cloud, 0 to 1
uniform vec4 uDrift;         // where the two cloud layers have drifted to
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uTime;
uniform vec4 uMeteor;        // a shooting star: from (xy) to (zw) across the picture
uniform float uMeteorAge;    // 0 to 1 while it falls, negative when there is none
out vec4 outColor;

/** How thick the cloud is at a point of the cloud layer: big shapes, with billows eaten out of their edges. */
float cloudAt(vec2 p) {
  float shape = texture(uClouds, p * 0.06875 + uDrift.xy).r;
  float billow = texture(uClouds, p * 0.14375 + uDrift.zw).g;
  return shape * 1.3 - (1.0 - billow) * 0.42 * (1.2 - shape);
}

vec3 starField(vec3 d) {
  if (uStars <= 0.0 || d.y <= 0.0) return vec3(0.0);
  vec2 grid = vec2(240.0, 76.0);
  vec2 g = vec2(atan(d.x, -d.z) / (2.0 * PI) + 0.5, d.y) * grid;
  vec2 cell = floor(g);
  vec2 h = hash22(cell);
  float pick = hash12(cell + 91.7);
  // Most of the sky is empty; faint stars are common, bright ones rare.
  if (pick < 0.62) pick = 0.0;
  float bright = pow(pick, 22.0) * 5.0 + pow(pick, 6.0) * 0.16 + step(0.62, pick) * 0.012;
  vec2 at = (cell + 0.12 + 0.76 * h) / grid;
  float az = (at.x - 0.5) * 2.0 * PI;
  float cy = sqrt(max(0.0, 1.0 - at.y * at.y));
  vec3 star = vec3(sin(az) * cy, at.y, -cos(az) * cy);
  float size = max(uPixel * 0.62, 0.0003);
  float dist = length(d - star);
  float spot = exp(-dist * dist / (size * size));
  vec3 tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.76, 0.86, 1.0), hash12(cell + 13.3));
  // Stars twinkle, each in its own time, and more the nearer they are to the horizon.
  float twinkle = 1.0 + (0.22 + 0.3 * (1.0 - d.y)) * sin(uTime * (1.4 + 3.2 * h.x) + 6.283 * h.y);
  // The air dims stars near the horizon.
  float air = smoothstep(0.0, 0.3, d.y);
  // A band of fainter stars, like the Milky Way.
  float band = exp(-pow(dot(d, normalize(vec3(0.5, 0.42, 0.76))) / 0.2, 2.0));
  float dust = (vnoise(g * 0.08) * 0.6 + vnoise(g * 0.31) * 0.4) * band;
  return (tint * spot * bright * twinkle * (1.0 + 2.0 * band) + vec3(0.5, 0.56, 0.7) * dust * 0.02) * air * uStars;
}

vec3 sky(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 d = normalize(uSkyForward + ndc.x * uSkyRight + ndc.y * uSkyUp);
  vec3 c = skyAbove(d);
  // Below the horizon lies a bank of haze, a little dimmer than the horizon itself.
  c *= mix(1.0, 0.8, smoothstep(0.0, -0.12, d.y));

  float sunCos = dot(d, uSunDir);
  float sunAngle = acos(clamp(sunCos, -1.0, 1.0));
  vec3 behind = starField(d);
  // The sun: a small, very bright disc, and the glare around it.
  float disc = 1.0 - smoothstep(0.0075, 0.0095, sunAngle);
  behind += uSunDisc * disc * (0.6 + 0.4 * sqrt(max(0.0, 1.0 - pow(sunAngle / 0.0095, 2.0))));
  behind += uSunDisc * (0.05 * exp(-pow(sunAngle / 0.022, 2.0)) + 0.008 * exp(-pow(sunAngle / 0.09, 2.0)));
  behind *= smoothstep(-0.012, 0.004, d.y);

  // A shooting star: a short streak, brightest at its head.
  if (uMeteorAge >= 0.0) {
    vec2 head = mix(uMeteor.xy, uMeteor.zw, uMeteorAge);
    vec2 along = uMeteor.zw - uMeteor.xy;
    vec2 tail = head - along * 0.22 * smoothstep(0.0, 0.25, uMeteorAge);
    vec2 pa = ndc - tail;
    vec2 ba = head - tail;
    float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float away = length(pa - ba * t) / (uPixel * 60.0);
    behind += vec3(0.9, 0.95, 1.0) * exp(-away * away) * t * t * sin(uMeteorAge * PI) * 1.6 * uStars;
  }

  // The moon, lit from the side the sun is on.
  float moonAngle = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
  if (uMoonDisc.r > 0.0 && moonAngle < uMoonSize * 1.5) {
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
    vec3 up = cross(uMoonDir, right);
    vec2 q = vec2(dot(d, right), dot(d, up)) / sin(uMoonSize);
    float r2 = dot(q, q);
    float edge = 1.0 - smoothstep(1.0 - 2.5 * uPixel / uMoonSize, 1.0, sqrt(r2));
    if (r2 < 1.0) {
      vec3 n = vec3(q, sqrt(1.0 - r2));
      float day = smoothstep(-0.06, 0.16, dot(n, uMoonLight));
      // Dark seas on the surface.
      float seas = smoothstep(0.42, 0.62, vnoise(q * 2.3 + 7.0) * 0.65 + vnoise(q * 5.5) * 0.35);
      vec3 face = uMoonDisc * (0.94 - 0.3 * seas) * (0.82 + 0.18 * n.z);
      behind = mix(behind, face * (day + 0.012), edge);
    }
  }
  // A soft glow around it, as thin haze gives a bright moon.
  if (uMoonDisc.r > 0.0) behind += uMoonDisc * 0.02 * exp(-pow(moonAngle / (uMoonSize * 3.2), 2.0));

  // Clouds on a layer overhead, seen in perspective; they hide what is behind them.
  float cover = 0.0;
  vec3 cloud = vec3(0.0);
  if (uCover > 0.0 && d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.22) * 2.9;
    float n = cloudAt(p);
    float edge0 = mix(0.74, 0.22, uCover);
    cover = smoothstep(edge0, edge0 + 0.13, n);
    if (cover > 0.0) {
      // More cloud between here and the sun means less light gets through.
      vec2 toSun = normalize(uSunDir.xz + 1e-4);
      float towardSun = max(cloudAt(p + toSun * 0.2) - edge0, 0.0) + max(cloudAt(p + toSun * 0.55) - edge0, 0.0) * 0.6;
      float light = exp(-towardSun * 4.0);
      float body = smoothstep(edge0, edge0 + 0.55, n);
      cloud = mix(uCloudDark, uCloudLit, light * (1.0 - 0.4 * body) + 0.12);
      // A bright rim where the sun is behind thin cloud.
      cloud += uSunDisc * 0.02 * pow(max(sunCos, 0.0), 32.0) * (1.0 - body);
      // Far clouds sink into the haze.
      cloud = mix(c, cloud, smoothstep(0.0, 0.3, d.y) * 0.92 + 0.08);
      cover *= smoothstep(0.0, 0.06, d.y);
    }
  }
  c += behind * (1.0 - cover);
  return mix(c, cloud, cover);
}

void main() {
  vec4 house = texture(uHouse, vUv) * uHouseOn;
  vec3 c = house.rgb;
  if (house.a < 0.998) c += develop(sky(vUv)) * (1.0 - house.a);
  // A slight darkening toward the corners, and a little noise so gradients don't band.
  vec2 v = vUv - 0.5;
  c *= 1.0 - dot(v, v) * 0.22;
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}`;
