// Draws the 3D house with WebGL 2.
//
// The house stands still most of the time, so it is only drawn when something about it changes.
// When it does, the picture is built up over a few dozen frames, each from a slightly different
// point within a pixel and with the sun in a slightly different spot. Averaged together they give
// smooth edges and soft, natural shadows, without the cost of doing it all at once.
//
// Each of those frames: the shadow map; depth and normals; how hidden every point is from the sky;
// the house itself; then glass, glow, and the film curve. The result is a picture of the house
// alone, clear where there is no house. The sky goes behind it in a separate, much cheaper step,
// which is what lets the clouds drift and the stars twinkle without drawing the house again.

import { halton, invert, lookAt, multiply, normalize, orthographic, cross, type Mat4, type Vec3 } from '../math.ts';
import { VERTEX_BYTES, type Mesh } from '../mesh.ts';
import { LIGHT_ROWS, ROOM_ROWS, TABLE_WIDTH } from '../model.ts';
import { ENV_HEIGHT, ENV_WIDTH, type Sky } from '../sky.ts';
import {
  AO_FRAG,
  BLOOM_DOWN_FRAG,
  BLOOM_UP_FRAG,
  CLOUD_FRAG,
  DEPTH_FRAG,
  DEPTH_VERT,
  FINAL_FRAG,
  MAX_GROUPS,
  PRESENT_FRAG,
  SCENE_FRAG,
  SCENE_VERT,
  SCREEN_VERT,
} from './shaders.ts';

/** How many frames go into a finished picture. */
export const SAMPLES = 32;

export interface View {
  view: Mat4;
  proj: Mat4;
  eye: Vec3;
  /** How visible each group is, 0–1; hidden groups have lifted away by `lift` meters. */
  groups: Float32Array;
  lift: number;
  /** How much of each outside wall (front, right, back, left) stays when its floor is opened. */
  sides: [number, number, number, number];
  /** A sphere around everything that casts a shadow. */
  center: Vec3;
  radius: number;
  /** The frame of the sky behind the house: forward, and right and up scaled to the picture's edges. */
  skyForward: Vec3;
  skyRight: Vec3;
  skyUp: Vec3;
  /** The angle one pixel of sky covers, in radians. */
  pixelAngle: number;
}

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

const UNIT = {
  shadow: 0,
  ao: 1,
  lights: 2,
  rooms: 3,
  air: 4,
  haze: 5,
  depth: 6,
  normal: 7,
  source: 8,
  bloom: 9,
  clouds: 10,
};

/** What moves in the sky from one frame to the next. */
export interface Weather {
  /** Seconds, for the drift of the clouds and the twinkling of the stars. */
  time: number;
  /** A shooting star across the picture, from (x0, y0) to (x1, y1), and how far along it is (0–1). */
  meteor?: { from: [number, number]; to: [number, number]; age: number };
}

const CLOUD_SIZE = 1024;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  /** Whether colors brighter than white can be stored, for glow and a film-like response. */
  private readonly hdr: boolean;
  private readonly shadowSize: number;
  private programs!: {
    depth: Program;
    scene: Program;
    ao: Program;
    down: Program;
    up: Program;
    final: Program;
    present: Program;
  };
  private vao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private mesh?: Mesh;
  private sky?: Sky;
  private width = 0;
  private height = 0;
  private shadow!: { framebuffer: WebGLFramebuffer; texture: WebGLTexture };
  private lightTexture!: WebGLTexture;
  private roomTexture!: WebGLTexture;
  private airTexture!: WebGLTexture;
  private hazeTexture!: WebGLTexture;
  private depthTexture: WebGLTexture | null = null;
  private normal?: Target;
  private ao?: Target;
  private scene?: Target;
  private accum?: Target;
  private bloom: Target[] = [];
  private cloudTexture!: WebGLTexture;
  /** Whether a picture of the house is ready to lay over the sky. */
  private houseReady = false;
  private lightData?: Float32Array;
  private roomData?: Float32Array;
  lost = false;
  /** Called when the browser has given the graphics context back after taking it away. */
  onRestore?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL 2 is not available');
    this.gl = gl;
    this.hdr = Boolean(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.shadowSize = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.setup();
  }

  private onLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
  };

  private onRestored = (): void => {
    this.lost = false;
    this.width = 0;
    this.height = 0;
    this.setup();
    if (this.mesh) this.setMesh(this.mesh);
    if (this.sky) this.setSky(this.sky);
    if (this.lightData && this.roomData) this.setLights(this.lightData, this.roomData);
    this.onRestore?.();
  };

  // ─── Setup ─────────────────────────────────────────────────────────────────

  private setup(): void {
    const gl = this.gl;
    this.programs = {
      depth: this.program(DEPTH_VERT, DEPTH_FRAG),
      scene: this.program(SCENE_VERT, SCENE_FRAG),
      ao: this.program(SCREEN_VERT, AO_FRAG),
      down: this.program(SCREEN_VERT, BLOOM_DOWN_FRAG),
      up: this.program(SCREEN_VERT, BLOOM_UP_FRAG),
      final: this.program(SCREEN_VERT, FINAL_FRAG),
      present: this.program(SCREEN_VERT, PRESENT_FRAG),
    };
    this.houseReady = false;

    // The shadow map: how far the sun sees in every direction.
    const size = this.shadowSize;
    const shadowTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const shadowBuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTexture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    this.shadow = { framebuffer: shadowBuffer, texture: shadowTexture };

    const table = (rows: number) => {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, TABLE_WIDTH, rows);
      this.nearest();
      return texture;
    };
    this.lightTexture = table(LIGHT_ROWS);
    this.roomTexture = table(ROOM_ROWS);

    const env = () => {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, ENV_WIDTH, ENV_HEIGHT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    };
    this.airTexture = env();
    this.hazeTexture = env();

    // The clouds: drawn once into a texture that repeats, with smaller copies for far away.
    const clouds = this.target(CLOUD_SIZE, CLOUD_SIZE, gl.RGBA8, gl.LINEAR, true);
    gl.viewport(0, 0, CLOUD_SIZE, CLOUD_SIZE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const cloudProgram = this.program(SCREEN_VERT, CLOUD_FRAG);
    gl.useProgram(cloudProgram.program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.deleteProgram(cloudProgram.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(clouds.framebuffer);
    this.cloudTexture = clouds.texture;
    gl.bindTexture(gl.TEXTURE_2D, this.cloudTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.disable(gl.CULL_FACE);
  }

  private nearest(): void {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private program(vertex: string, fragment: string): Program {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = [gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs), gl.getProgramInfoLog(program)]
        .filter(Boolean)
        .join('\n');
      throw new Error(`The house's shaders did not compile:\n${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { program, uniforms: new Map() };
  }

  private use(p: Program): (name: string) => WebGLUniformLocation | null {
    const gl = this.gl;
    gl.useProgram(p.program);
    return (name) => {
      let location = p.uniforms.get(name);
      if (location === undefined) {
        location = gl.getUniformLocation(p.program, name);
        p.uniforms.set(name, location);
      }
      return location;
    };
  }

  private bind(unit: number, texture: WebGLTexture | null): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  private target(width: number, height: number, format: number, filter: number, mips = false): Target {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const levels = mips ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { framebuffer, texture, width, height };
  }

  private release(target?: Target): void {
    if (!target) return;
    this.gl.deleteFramebuffer(target.framebuffer);
    this.gl.deleteTexture(target.texture);
  }

  /** Sets the size of the picture, in device pixels. Returns whether it changed. */
  resize(width: number, height: number): boolean {
    width = Math.max(2, Math.round(width));
    height = Math.max(2, Math.round(height));
    if (width === this.width && height === this.height) return false;
    const gl = this.gl;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    for (const t of [this.normal, this.ao, this.scene, this.accum, ...this.bloom]) this.release(t);
    this.houseReady = false;
    if (this.depthTexture) gl.deleteTexture(this.depthTexture);
    const color = this.hdr ? gl.RGBA16F : gl.RGBA8;

    this.depthTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, width, height);
    this.nearest();

    this.normal = this.target(width, height, gl.RGBA8, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
    this.ao = this.target(width, height, gl.RGBA8, gl.LINEAR);
    this.scene = this.target(width, height, color, gl.LINEAR);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
    this.accum = this.target(width, height, color, gl.LINEAR);
    this.bloom = [];
    if (this.hdr) {
      let w = width;
      let h = height;
      for (let i = 0; i < 6; i++) {
        w = Math.max(2, w >> 1);
        h = Math.max(2, h >> 1);
        this.bloom.push(this.target(w, h, gl.RGBA16F, gl.LINEAR));
        if (w <= 8 || h <= 8) break;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  setMesh(mesh: Mesh): void {
    const gl = this.gl;
    this.mesh = mesh;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    const attribute = (index: number, size: number, type: number, offset: number) => {
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, type, false, VERTEX_BYTES, offset);
    };
    attribute(0, 3, gl.FLOAT, 0);
    attribute(1, 2, gl.FLOAT, 12);
    attribute(2, 4, gl.BYTE, 20);
    attribute(3, 4, gl.UNSIGNED_BYTE, 24);
    attribute(4, 4, gl.UNSIGNED_BYTE, 28);
    gl.bindVertexArray(null);
  }

  setSky(sky: Sky): void {
    const gl = this.gl;
    this.sky = sky;
    this.bind(UNIT.air, this.airTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ENV_WIDTH, ENV_HEIGHT, gl.RGBA, gl.FLOAT, sky.air);
    this.bind(UNIT.haze, this.hazeTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ENV_WIDTH, ENV_HEIGHT, gl.RGBA, gl.FLOAT, sky.haze);
  }

  /** The lamps (TABLE_WIDTH × LIGHT_ROWS RGBA) and the rooms they light (TABLE_WIDTH × ROOM_ROWS). */
  setLights(lights: Float32Array, rooms: Float32Array): void {
    const gl = this.gl;
    this.lightData = lights;
    this.roomData = rooms;
    this.bind(UNIT.lights, this.lightTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TABLE_WIDTH, LIGHT_ROWS, gl.RGBA, gl.FLOAT, lights);
    this.bind(UNIT.rooms, this.roomTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TABLE_WIDTH, ROOM_ROWS, gl.RGBA, gl.FLOAT, rooms);
  }

  // ─── Drawing ───────────────────────────────────────────────────────────────

  private screen(): void {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private skyUniforms(u: (name: string) => WebGLUniformLocation | null, sky: Sky): void {
    const gl = this.gl;
    this.bind(UNIT.air, this.airTexture);
    this.bind(UNIT.haze, this.hazeTexture);
    gl.uniform1i(u('uSkyAir'), UNIT.air);
    gl.uniform1i(u('uSkyHaze'), UNIT.haze);
    const lowest = Math.sin((-4 * Math.PI) / 180);
    // The sun as the sky model saw it: never far below the horizon.
    const sim: Vec3 =
      sky.sunDir[1] >= lowest
        ? sky.sunDir
        : normalize([
            (sky.sunDir[0] / Math.hypot(sky.sunDir[0], sky.sunDir[2])) * Math.sqrt(1 - lowest * lowest),
            lowest,
            (sky.sunDir[2] / Math.hypot(sky.sunDir[0], sky.sunDir[2])) * Math.sqrt(1 - lowest * lowest),
          ]);
    gl.uniform3fv(u('uSunSim'), sim);
    gl.uniform3fv(u('uNightHorizon'), sky.nightGlow[0]);
    gl.uniform3fv(u('uNightZenith'), sky.nightGlow[1]);
    gl.uniform3fv(u('uGround'), sky.ground);
  }

  /**
   * Draws one frame toward the finished picture of the house. `sample` counts from 0, which starts
   * the picture over; each later sample refines it. With `timed`, it waits for the graphics card to
   * finish and returns how long the frame took, in milliseconds.
   */
  draw(view: View, sample: number, timed = false): number {
    const gl = this.gl;
    const mesh = this.mesh;
    const sky = this.sky;
    if (this.lost || !mesh || !sky || !this.width || !this.scene || !this.normal || !this.ao || !this.accum) return 0;
    const started = timed ? performance.now() : 0;
    const { width, height } = this;

    // A different spot within the pixel each frame.
    const jx = sample ? halton(sample, 2) - 0.5 : 0;
    const jy = sample ? halton(sample, 3) - 0.5 : 0;
    const proj = new Float32Array(view.proj);
    proj[8] += (jx * 2) / width;
    proj[9] += (jy * 2) / height;
    const viewProj = multiply(proj, view.view);

    // And a different spot on the sun's face, which is what softens the shadows.
    const key = sky.keyDir;
    const side = normalize(cross(key, Math.abs(key[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0]));
    const over = cross(key, side);
    const angle = halton(sample + 1, 5) * 2 * Math.PI;
    const spread = sample ? Math.sqrt(halton(sample + 1, 7)) * sky.keySize : 0;
    const light = normalize([
      key[0] + (side[0] * Math.cos(angle) + over[0] * Math.sin(angle)) * spread,
      key[1] + (side[1] * Math.cos(angle) + over[1] * Math.sin(angle)) * spread,
      key[2] + (side[2] * Math.cos(angle) + over[2] * Math.sin(angle)) * spread,
    ]);
    const r = view.radius;
    const from: Vec3 = [
      view.center[0] + light[0] * r * 2,
      view.center[1] + light[1] * r * 2,
      view.center[2] + light[2] * r * 2,
    ];
    const lightViewProj = multiply(orthographic(-r, r, -r, r, 0.1, r * 4), lookAt(from, view.center, [0, 1, 0]));
    const bias = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1]);
    const shadowMat = multiply(bias, lightViewProj);

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);

    // 1. What the sun can see.
    let u = this.use(this.programs.depth);
    gl.uniform1fv(u('uGroup[0]'), view.groups);
    gl.uniform4fv(u('uSide'), view.sides);
    gl.uniform1f(u('uLift'), view.lift);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.framebuffer);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (sky.keyColor[0] + sky.keyColor[1] + sky.keyColor[2] > 0) {
      gl.uniformMatrix4fv(u('uViewProj'), false, lightViewProj);
      gl.uniform1f(u('uShadowPass'), 1);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 3);
      gl.drawElements(gl.TRIANGLES, mesh.opaque.count, gl.UNSIGNED_INT, mesh.opaque.start * 4);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    // 2. Depth and normals of what the viewer can see.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.normal.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.5, 0.5, 1, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(u('uViewProj'), false, viewProj);
    gl.uniform1f(u('uShadowPass'), 0);
    gl.drawElements(gl.TRIANGLES, mesh.opaque.count, gl.UNSIGNED_INT, mesh.opaque.start * 4);

    // 3. How hidden each point is from the sky.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ao.framebuffer);
    u = this.use(this.programs.ao);
    this.bind(UNIT.depth, this.depthTexture);
    this.bind(UNIT.normal, this.normal.texture);
    gl.uniform1i(u('uDepth'), UNIT.depth);
    gl.uniform1i(u('uNormal'), UNIT.normal);
    gl.uniformMatrix4fv(u('uProj'), false, proj);
    gl.uniformMatrix4fv(u('uInvProj'), false, invert(proj));
    gl.uniformMatrix4fv(u('uView'), false, view.view);
    gl.uniform1f(u('uRadius'), 0.9);
    gl.uniform1f(u('uSeed'), sample * 1.618);
    this.screen();
    this.bind(UNIT.depth, null);

    // 4. The house, on a clear background.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.DEPTH_TEST);
    u = this.use(this.programs.scene);
    this.skyUniforms(u, sky);
    gl.uniformMatrix4fv(u('uViewProj'), false, viewProj);
    gl.uniformMatrix4fv(u('uShadowMat'), false, shadowMat);
    gl.uniform1fv(u('uGroup[0]'), view.groups);
    gl.uniform4fv(u('uSide'), view.sides);
    gl.uniform1f(u('uLift'), view.lift);
    gl.uniform3fv(u('uEye'), view.eye);
    gl.uniform3fv(u('uKeyDir'), light);
    gl.uniform3fv(u('uKeyColor'), sky.keyColor);
    gl.uniform3fv(u('uAmbient[0]'), new Float32Array(sky.ambient.flat()));
    gl.uniform3f(u('uShadowInfo'), 1 / this.shadowSize, sample ? 1.1 : 2.2, sample);
    gl.uniform2f(u('uInvSize'), 1 / width, 1 / height);
    gl.uniform1f(u('uLamp'), sky.lamp);
    this.bind(UNIT.shadow, this.shadow.texture);
    this.bind(UNIT.ao, this.ao.texture);
    this.bind(UNIT.lights, this.lightTexture);
    this.bind(UNIT.rooms, this.roomTexture);
    gl.uniform1i(u('uShadowMap'), UNIT.shadow);
    gl.uniform1i(u('uAo'), UNIT.ao);
    gl.uniform1i(u('uLights'), UNIT.lights);
    gl.uniform1i(u('uRooms'), UNIT.rooms);
    gl.uniform1f(u('uGlassPass'), 0);
    gl.drawElements(gl.TRIANGLES, mesh.opaque.count, gl.UNSIGNED_INT, mesh.opaque.start * 4);
    if (mesh.blended.count) {
      // Glass goes on last, over whatever is behind it; over nothing, it stays see-through.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(u('uGlassPass'), 1);
      gl.drawElements(gl.TRIANGLES, mesh.blended.count, gl.UNSIGNED_INT, mesh.blended.start * 4);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);

    // 5. Glow around what is very bright.
    if (this.bloom.length) {
      u = this.use(this.programs.down);
      gl.uniform1i(u('uSource'), UNIT.source);
      let source: Target = this.scene;
      this.bloom.forEach((level, i) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, level.framebuffer);
        gl.viewport(0, 0, level.width, level.height);
        this.bind(UNIT.source, source.texture);
        gl.uniform2f(u('uTexel'), 0.5 / source.width, 0.5 / source.height);
        gl.uniform1f(u('uFirst'), i === 0 ? 1 : 0);
        this.screen();
        source = level;
      });
      u = this.use(this.programs.up);
      gl.uniform1i(u('uSource'), UNIT.source);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.bloom.length - 1; i > 0; i--) {
        const level = this.bloom[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, level.framebuffer);
        gl.viewport(0, 0, level.width, level.height);
        this.bind(UNIT.source, this.bloom[i].texture);
        gl.uniform2f(u('uTexel'), 1 / this.bloom[i].width, 1 / this.bloom[i].height);
        this.screen();
      }
      gl.disable(gl.BLEND);
    }

    // 6. Develop it, and average it into the picture so far.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accum.framebuffer);
    gl.viewport(0, 0, width, height);
    u = this.use(this.programs.final);
    this.bind(UNIT.source, this.scene.texture);
    this.bind(UNIT.bloom, this.bloom.length ? this.bloom[0].texture : this.scene.texture);
    gl.uniform1i(u('uScene'), UNIT.source);
    gl.uniform1i(u('uBloom'), UNIT.bloom);
    gl.uniform1f(u('uBloomStrength'), this.bloom.length ? 0.09 : 0);
    if (sample > 0) {
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, 1 / (sample + 1));
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    }
    this.screen();
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.houseReady = true;
    if (!timed) return 0;
    // Reading a pixel back is the one thing that waits for the graphics card to catch up.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ao.framebuffer);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return performance.now() - started;
  }

  /** Puts the picture on screen: the sky as it is at this moment, and the house over it. */
  present(view: View, weather: Weather): void {
    const gl = this.gl;
    const sky = this.sky;
    if (this.lost || !sky || !this.width || !this.accum) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const u = this.use(this.programs.present);
    this.skyUniforms(u, sky);
    this.bind(UNIT.source, this.accum.texture);
    this.bind(UNIT.clouds, this.cloudTexture);
    gl.uniform1i(u('uHouse'), UNIT.source);
    gl.uniform1f(u('uHouseOn'), this.houseReady ? 1 : 0);
    gl.uniform1i(u('uClouds'), UNIT.clouds);
    gl.uniform3fv(u('uSkyForward'), view.skyForward);
    gl.uniform3fv(u('uSkyRight'), view.skyRight);
    gl.uniform3fv(u('uSkyUp'), view.skyUp);
    gl.uniform3fv(u('uSunDir'), sky.sunDir);
    gl.uniform3fv(u('uSunDisc'), sky.sunDisc);
    gl.uniform3fv(u('uMoonDir'), sky.moonDir);
    gl.uniform3fv(u('uMoonDisc'), sky.moonDisc);
    // Which side of the moon is lit: the sun is to its lower right while it waxes.
    const turn = 2 * Math.PI * sky.moonPhase;
    gl.uniform3f(u('uMoonLight'), Math.sin(turn) * 0.9, Math.sin(turn) * -0.42, -Math.cos(turn));
    gl.uniform1f(u('uMoonSize'), 0.021);
    gl.uniform1f(u('uStars'), sky.stars);
    gl.uniform1f(u('uPixel'), view.pixelAngle);
    gl.uniform1f(u('uCover'), sky.clouds);
    // Two layers of cloud slide at different speeds, so the shapes change as they go.
    const t = weather.time;
    const wrap = (v: number) => v - Math.floor(v);
    gl.uniform4f(
      u('uDrift'),
      wrap(sky.cloudShift * 0.37 + t * 0.0021),
      wrap(sky.cloudShift * 0.11 + t * 0.0006),
      wrap(sky.cloudShift * 0.23 + t * 0.0034),
      wrap(sky.cloudShift * 0.41 - t * 0.0011),
    );
    // Clouds are lit by the sun or the moon on one side and by the rest of the sky on the other. At
    // night they are barely lighter than the sky, so they show as shapes that hide the stars.
    const up = sky.ambient[2];
    const dim = 1.5 - 1.1 * sky.stars;
    gl.uniform3f(
      u('uCloudLit'),
      sky.keyColor[0] * 0.3 + up[0] * dim,
      sky.keyColor[1] * 0.3 + up[1] * dim,
      sky.keyColor[2] * 0.3 + up[2] * dim,
    );
    gl.uniform3f(u('uCloudDark'), up[0] * dim, up[1] * dim, up[2] * dim);
    gl.uniform1f(u('uTime'), t % 4096);
    const meteor = weather.meteor;
    gl.uniform4f(u('uMeteor'), meteor?.from[0] ?? 0, meteor?.from[1] ?? 0, meteor?.to[0] ?? 0, meteor?.to[1] ?? 0);
    gl.uniform1f(u('uMeteorAge'), meteor ? meteor.age : -1);
    this.screen();
  }

  /** How many groups the shaders can hide. */
  static readonly groups = MAX_GROUPS;

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    // Give the graphics memory back now rather than whenever the browser collects it.
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.lost = true;
  }
}
