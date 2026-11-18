/**
 * WebGL 动态背景：黑金花瓣飘落（用户指定参考 codepen.io/FrankFitzGerald/pen/nrOwPL，
 * 2026-11-19）。效果等价、结构独立：原 pen 是樱花粉粒子 + FBO 后处理链，
 * 这里按黑金主题适配为金色花瓣——花瓣形 point sprite（椭圆双凸轮廓 + 旋转），
 * CPU 粒子漂落回绕，近大远小淡出替代 DOF，柔和渐变替代 bloom 链。
 * mode = 'frozen'：AI 演武场路由的冻结观感（近黑底 + teal/玫红流体光场），
 * 色板与该页根类令牌快照同源。
 *
 * 用户裁定解除轻量化限制：不计渲染损耗；只保留两样免费优化——
 * tab 隐藏时暂停、prefers-reduced-motion 静止单帧。
 */

export type BackgroundMode = 'blackgold' | 'frozen'

const VERT_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

/* 黑金底：深灰径向渐变（左下暗右上微亮），替代原 pen 的 bg_fsh 思路 */
const BG_FRAG_SRC = `
precision mediump float;
uniform vec2 u_res;
uniform vec3 u_base;
uniform vec3 u_base_hi;

void main() {
  vec2 p = gl_FragCoord.xy / u_res;
  float d = distance(p, vec2(0.85, 0.75));
  vec3 col = mix(u_base_hi, u_base, smoothstep(0.0, 1.1, d));
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (grain - 0.5) * 0.02;
  gl_FragColor = vec4(col, 1.0);
}
`

/* 花瓣 point sprite：椭圆双凸轮廓随粒子自转，中心亮、柔边、随深度淡出 */
const PETAL_VERT_SRC = `
attribute vec3 a_pos;
attribute float a_size;
attribute float a_rot;
uniform vec2 u_res;
uniform float u_time;
varying float v_rot;
varying float v_fade;

void main() {
  float depth = a_pos.z; /* 0 近 → 1 远 */
  vec2 screen = (a_pos.xy / u_res) * 2.0 - 1.0;
  gl_Position = vec4(screen, 0.0, 1.0);
  gl_PointSize = a_size * (1.0 - depth * 0.55);
  v_rot = a_rot + u_time * (0.25 + a_size * 0.004);
  v_fade = 1.0 - depth * 0.55;
}
`

const PETAL_FRAG_SRC = `
precision mediump float;
uniform vec3 u_gold;
uniform vec3 u_gold_hi;
varying float v_rot;
varying float v_fade;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float c = cos(v_rot);
  float s = sin(v_rot);
  uv = mat2(c, -s, s, c) * uv;
  float r = length(uv);
  float ang = atan(uv.y, uv.x);
  /* 双凸花瓣轮廓：半径随 2 倍角起伏，加旋转相位让每片形状各异 */
  float w = 0.50 + 0.16 * cos(ang * 2.0 + v_rot);
  float body = smoothstep(w, w - 0.22, r);
  float alpha = body * v_fade;
  if (alpha < 0.01) discard;
  vec3 col = mix(u_gold_hi, u_gold, smoothstep(0.12, 0.65, r));
  /* 中心提亮（伪 bloom：柔边渐变代替 FBO 后处理链） */
  col += u_gold_hi * (1.0 - smoothstep(0.0, 0.5, r)) * 0.35;
  gl_FragColor = vec4(col, alpha);
}
`

/* AI 页冻结流体：近黑底 + teal/玫红 domain-warped 光场（与该页令牌同源） */
const FLUID_FRAG_SRC = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_f_base;
uniform vec3 u_f_hi;
uniform vec3 u_f_cloud;
uniform vec3 u_f_ember;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187, 0.788675134594773,
    -0.577350269189626, 1.0
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * snoise(p);
    p = p * 2.0 + vec2(31.7, -17.3);
    a *= 0.5;
  }
  return v * 0.5 + 0.5;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float t = u_time * 0.05;

  vec2 q = vec2(fbm(p * 1.6 + t * 0.35), fbm(p * 1.6 - t * 0.28 + vec2(5.2, 1.3)));
  vec2 r = vec2(
    fbm(p * 1.6 + q * 1.9 + vec2(1.7, 9.2) + t * 0.22),
    fbm(p * 1.6 + q * 1.9 + vec2(8.3, 2.8) - t * 0.18)
  );
  float v = fbm(p * 1.5 + r * 1.7);

  vec3 col = mix(u_f_base, u_f_hi, smoothstep(0.15, 0.85, v));
  float cloud = smoothstep(0.52, 0.86, fbm(p * 1.1 + q * 1.4 - t * 0.15 + vec2(2.6, 4.1)));
  col = mix(col, u_f_cloud, cloud * 0.20);
  float pulse = 0.72 + 0.28 * sin(t * 0.30 + v * 6.2831);
  float ember = smoothstep(0.66, 0.82, fbm(p * 1.25 + r * 1.5 + vec2(4.4, 0.7) + t * 0.30)) * pulse;
  col = mix(col, u_f_ember, ember * 0.80);
  float vig = smoothstep(1.35, 0.25, length(p));
  col = mix(u_f_base, col, 0.55 + 0.45 * vig);

  float grain = fract(sin(dot(gl_FragCoord.xy + vec2(t * 61.0, t * 83.0), vec2(12.9898, 78.233))) * 43758.5453);
  col += (grain - 0.5) * 0.028;
  gl_FragColor = vec4(col, 1.0);
}
`

/* 黑金色板：与 tokens.css 黑金主题同源 */
const GOLD = [1.0, 212 / 255, 0.0] as const
const GOLD_HI = [1.0, 236 / 255, 140 / 255] as const
const CHARCOAL = [42 / 255, 42 / 255, 41 / 255] as const
const CHARCOAL_HI = [64 / 255, 64 / 255, 62 / 255] as const
/* AI 页冻结色板 */
const FROZEN = {
  base: [11 / 255, 13 / 255, 14 / 255],
  hi: [21 / 255, 24 / 255, 26 / 255],
  cloud: [45 / 255, 212 / 255, 191 / 255],
  ember: [244 / 255, 63 / 255, 94 / 255],
} as const

/* 花瓣粒子数：背景克制，不到原 pen（1600）的一半 */
const PETAL_COUNT = 620

export interface WebGLBackgroundHandle {
  setMode(mode: BackgroundMode): void
  dispose(): void
}

interface Program {
  program: WebGLProgram
  uniform: (name: string) => WebGLUniformLocation | null
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[webgl-background] shader 编译失败:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function link(
  gl: WebGLRenderingContext,
  vertSrc: string,
  fragSrc: string,
  label: string,
): Program | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc)
  if (!vs || !fs) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(`[webgl-background] ${label} 链接失败:`, gl.getProgramInfoLog(program))
    return null
  }
  gl.useProgram(program)
  const cache = new Map<string, WebGLUniformLocation | null>()
  return {
    program,
    uniform(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name))
      return cache.get(name) ?? null
    },
  }
}

/* 花瓣粒子 CPU 状态：pos(x,y,z 像素/深度) + size + rot + 速度 */
interface Petal {
  x: number
  y: number
  z: number
  size: number
  rot: number
  fall: number
  sway: number
  swayPhase: number
  rotSpeed: number
}

export function mountWebGLBackground(
  canvas: HTMLCanvasElement,
  initialMode: BackgroundMode,
): WebGLBackgroundHandle | null {
  const gl = (canvas.getContext('webgl', {
    alpha: false,
    antialias: true,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  }) || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
  if (!gl) return null // WebGL 不可用：调用方回退 CSS 底色

  const bg = link(gl, VERT_SRC, BG_FRAG_SRC, 'bg')
  const fluid = link(gl, VERT_SRC, FLUID_FRAG_SRC, 'fluid')
  const petal = link(gl, PETAL_VERT_SRC, PETAL_FRAG_SRC, 'petal')
  if (!bg || !fluid || !petal) return null

  /* 全屏三角形 */
  const quadBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const quadLoc = gl.getAttribLocation(bg.program, 'a_pos')

  /* 花瓣粒子：interleaved [x, y, z, size, rot] */
  const petals: Petal[] = []
  const stride = 5
  const petalData = new Float32Array(PETAL_COUNT * stride)
  const petalBuf = gl.createBuffer()
  let viewW = 1
  let viewH = 1

  const seedPetal = (p: Petal, scatter: boolean) => {
    p.x = (Math.random() * 1.2 - 0.1) * viewW
    p.y = (scatter ? Math.random() * 1.2 - 0.1 : 1.05 + Math.random() * 0.1) * viewH
    p.z = Math.random()
    p.size = 26 + Math.random() * 46
    p.rot = Math.random() * Math.PI * 2
    p.fall = (26 + Math.random() * 42) * (0.55 + p.z * 0.75) // 远的慢 → 视差
    p.sway = 14 + Math.random() * 30
    p.swayPhase = Math.random() * Math.PI * 2
    p.rotSpeed = (Math.random() - 0.5) * 1.4
  }

  for (let i = 0; i < PETAL_COUNT; i++) {
    petals.push({ x: 0, y: 0, z: 0, size: 0, rot: 0, fall: 0, sway: 0, swayPhase: 0, rotSpeed: 0 })
    seedPetal(petals[i], true)
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  /* 实际渲染分辨率独立于 dpr：帧预算自适应降档时只降它（见 frame） */
  let renderDpr = dpr
  let slowFrames = 0
  const resizeAt = (d: number) => {
    const w = Math.round(window.innerWidth * d)
    const h = Math.round(window.innerHeight * d)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      viewW = w
      viewH = h
      gl.viewport(0, 0, w, h)
      /* 尺寸变化后按新可视区重播粒子（首次 resize 前播种用的是 1×1 占位尺寸） */
      for (const p of petals) seedPetal(p, true)
    }
    for (const prog of [bg, fluid]) {
      gl.useProgram(prog.program)
      gl.uniform2f(prog.uniform('u_res'), canvas.width, canvas.height)
    }
    gl.useProgram(petal.program)
    gl.uniform2f(petal.uniform('u_res'), canvas.width, canvas.height)
  }
  const resize = () => resizeAt(renderDpr)

  /* CPU 粒子推进 + 回绕（wrap-around，参考 pen 的 repeatPos 思路） */
  const step = (dt: number, t: number) => {
    for (let i = 0; i < PETAL_COUNT; i++) {
      const p = petals[i]
      p.y -= p.fall * dt
      p.x += Math.sin(t * 0.6 + p.swayPhase) * p.sway * dt
      p.rot += p.rotSpeed * dt
      if (p.y < -0.08 * viewH) seedPetal(p, false)
      if (p.x < -0.15 * viewW) p.x += 1.3 * viewW
      else if (p.x > 1.15 * viewW) p.x -= 1.3 * viewW
      const o = i * stride
      petalData[o] = p.x
      petalData[o + 1] = p.y
      petalData[o + 2] = p.z
      petalData[o + 3] = p.size * dpr
      petalData[o + 4] = p.rot
    }
  }

  const drawBg = () => {
    gl.useProgram(bg.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.enableVertexAttribArray(quadLoc)
    gl.vertexAttribPointer(quadLoc, 2, gl.FLOAT, false, 0, 0)
    gl.disable(gl.BLEND)
    gl.uniform3f(bg.uniform('u_base'), CHARCOAL[0], CHARCOAL[1], CHARCOAL[2])
    gl.uniform3f(bg.uniform('u_base_hi'), CHARCOAL_HI[0], CHARCOAL_HI[1], CHARCOAL_HI[2])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const drawPetals = () => {
    gl.useProgram(petal.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, petalBuf)
    gl.bufferData(gl.ARRAY_BUFFER, petalData, gl.DYNAMIC_DRAW)
    const aPos = gl.getAttribLocation(petal.program, 'a_pos')
    const aSize = gl.getAttribLocation(petal.program, 'a_size')
    const aRot = gl.getAttribLocation(petal.program, 'a_rot')
    gl.enableVertexAttribArray(aPos)
    gl.enableVertexAttribArray(aSize)
    gl.enableVertexAttribArray(aRot)
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride * 4, 0)
    gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, stride * 4, 12)
    gl.vertexAttribPointer(aRot, 1, gl.FLOAT, false, stride * 4, 16)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.uniform3f(petal.uniform('u_gold'), GOLD[0], GOLD[1], GOLD[2])
    gl.uniform3f(petal.uniform('u_gold_hi'), GOLD_HI[0], GOLD_HI[1], GOLD_HI[2])
    gl.drawArrays(gl.POINTS, 0, PETAL_COUNT)
    gl.disable(gl.BLEND)
  }

  const drawFluid = (time: number) => {
    gl.useProgram(fluid.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
    gl.enableVertexAttribArray(quadLoc)
    gl.vertexAttribPointer(quadLoc, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1f(fluid.uniform('u_time'), time)
    gl.uniform3f(fluid.uniform('u_f_base'), FROZEN.base[0], FROZEN.base[1], FROZEN.base[2])
    gl.uniform3f(fluid.uniform('u_f_hi'), FROZEN.hi[0], FROZEN.hi[1], FROZEN.hi[2])
    gl.uniform3f(fluid.uniform('u_f_cloud'), FROZEN.cloud[0], FROZEN.cloud[1], FROZEN.cloud[2])
    gl.uniform3f(fluid.uniform('u_f_ember'), FROZEN.ember[0], FROZEN.ember[1], FROZEN.ember[2])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let mode: BackgroundMode = initialMode
  let raf = 0
  let running = false
  let lastT = 0
  const t0 = performance.now()

  const frame = (now: number) => {
    const time = (now - t0) / 1000
    const dt = Math.min((now - lastT) / 1000, 0.05)
    lastT = now
    if (mode === 'blackgold') {
      step(dt, time)
      drawBg()
      drawPetals()
    } else {
      drawFluid(time)
    }
    const frameCost = performance.now() - now
    if (frameCost > 50) {
      slowFrames += 1
      if (slowFrames >= 3 && renderDpr > 0.5) {
        renderDpr = Math.max(0.5, renderDpr / 2)
        slowFrames = 0
        resizeAt(renderDpr)
      }
    } else {
      slowFrames = 0
    }
    if (running) raf = requestAnimationFrame(frame)
  }

  const start = () => {
    if (running || reducedMotion) return
    running = true
    lastT = performance.now()
    raf = requestAnimationFrame(frame)
  }
  const stop = () => {
    running = false
    cancelAnimationFrame(raf)
  }

  resize()
  /* 首帧：reduced-motion 或刚起时先画一帧静态（花瓣静止分布） */
  step(0, 12)
  drawBg()
  drawPetals()
  if (!reducedMotion) start()

  const onResize = () => {
    resize()
    if (reducedMotion) {
      drawBg()
      drawPetals()
    }
  }
  const onVisibility = () => {
    if (document.hidden) stop()
    else start()
  }
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)

  return {
    setMode(next) {
      mode = next
      if (reducedMotion) {
        /* 静态模式切页后重画对应内容 */
        if (next === 'blackgold') {
          drawBg()
          drawPetals()
        } else {
          drawFluid(12)
        }
      }
    },
    dispose() {
      stop()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      gl.deleteBuffer(quadBuf)
      gl.deleteBuffer(petalBuf)
      for (const prog of [bg, fluid, petal]) gl.deleteProgram(prog.program)
    },
  }
}
