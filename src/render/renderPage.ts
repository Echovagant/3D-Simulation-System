/**
 * 服务端渲染页（backend-04）的核心逻辑。
 *
 * 这个文件是「渲染页」与「录制器」之间的契约实现：
 * 渲染页把它挂到 `window.__RENDER__`，录制器（`scripts/record-scene.mjs`）
 * 通过 CDP 逐帧调用它。
 *
 * 两条硬约束贯穿整个文件：
 *
 * 1. **确定性**——物理推进只能由外部显式调用 `step()` 触发，
 *    页面自己**不跑 requestAnimationFrame**。物体的颜色、材质、创建顺序
 *    全部由输入决定，不掺任何随机数（场景编辑器用随机色是给交互用的，
 *    渲染页不能这样：同一个场景重跑必须得到同一段视频）。
 * 2. **一帧一步**——`step()` = 推进一个物理步 + 画一帧。
 *    「抓到的第 N 帧」严格对应「物理的第 N 步」，这是重跑帧数一致的前提。
 */
import * as THREE from 'three'
import type * as RapierModule from '@dimforge/rapier3d'

type Rapier = typeof RapierModule

export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * 渲染页的固定物理参数。
 *
 * 与前端仿真实验室（`src/config/simulation.ts`）和后端批量仿真对齐：
 * 重力 -9.81、固定步长 1/60 秒。步长**不随显示帧率变化**，
 * 否则同一个场景在不同机器上会落到不同位置。
 */
export const RENDER_PHYSICS = {
  gravity: { x: 0, y: -9.81, z: 0 } as Vec3,
  fixedTimeStep: 1 / 60,
  minSpeed: 0.1,
  maxSpeed: 5,
} as const

/**
 * 地面。
 *
 * 刚体比可见地面往下挪 0.1：可见地面是 PlaneGeometry，平面在 y=0；
 * 而 cuboid(5, 0.1, 5) 建在原点时顶面在 y=+0.1，物体就会悬在半空。
 * 下移之后碰撞体顶面与可见地面齐平。
 */
export const RENDER_GROUND = {
  halfExtents: { x: 5, y: 0.1, z: 5 } as Vec3,
  bodyY: -0.1,
} as const

/** 动作类型——**只有这四种**，新增一种就要多一条测试与一条实现 */
export const RENDER_ACTION_TYPES = ['addCube', 'addSphere', 'setCamera', 'setSpeed'] as const

export type RenderActionType = (typeof RENDER_ACTION_TYPES)[number]

export interface AddCubeParams {
  /** 立方体中心位置 */
  position: Vec3
  /** 边长（默认 1） */
  size: number
}

export interface AddSphereParams {
  /** 球体中心位置 */
  position: Vec3
  /** 半径（默认 0.5） */
  radius: number
}

export interface SetCameraParams {
  position: Vec3
  lookAt: Vec3
}

export interface SetSpeedParams {
  value: number
}

export type RenderAction =
  | { atFrame: number; type: 'addCube'; params: AddCubeParams }
  | { atFrame: number; type: 'addSphere'; params: AddSphereParams }
  | { atFrame: number; type: 'setCamera'; params: SetCameraParams }
  | { atFrame: number; type: 'setSpeed'; params: SetSpeedParams }

/**
 * 挂到 `window.__RENDER__` 的驱动 API。
 *
 * 形状是**对外契约**，录制器与后端都按这五个成员调用，不要随手加成员。
 */
export interface RenderApi {
  /** 场景是否搭好 */
  ready: boolean
  /** 推进一个物理步（1/60 秒）并渲染一帧 */
  step(): void
  /** 已经推进了多少步 */
  frames(): number
  /** 执行一个动作 */
  apply(action: RenderAction): void
  /** 当前是否已经可以截图（至少画过一帧） */
  screenshotReady(): boolean
}

declare global {
  interface Window {
    /** 录制器在打开页面前注入的场景 JSON */
    __RENDER_SCENE__?: unknown
    /** 渲染页暴露给录制器的驱动 API */
    __RENDER__?: RenderApi
  }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** 把任意输入读成 {x,y,z}；缺字段或是非有限数字都直接报错，不做静默兜底 */
const parseVec3 = (raw: unknown, field: string): Vec3 => {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${field} 必须是 {x, y, z} 对象`)
  }
  const obj = raw as Record<string, unknown>
  if (!isFiniteNumber(obj.x) || !isFiniteNumber(obj.y) || !isFiniteNumber(obj.z)) {
    throw new Error(`${field} 的 x / y / z 必须是有限数字`)
  }
  return { x: obj.x, y: obj.y, z: obj.z }
}

/**
 * 解析并归一化一个动作。
 *
 * 动作来自外部（录制器读的文件、后端转发的请求），因此**必须在运行时校验**：
 * 类型不在四种之内、参数缺字段，都要立刻抛出可读的错误，
 * 而不是让页面渲染出一段错误的视频。
 */
export const parseRenderAction = (raw: unknown): RenderAction => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('动作必须是对象')
  }
  const obj = raw as Record<string, unknown>
  const type = obj.type
  if (typeof type !== 'string' || !(RENDER_ACTION_TYPES as readonly string[]).includes(type)) {
    throw new Error(
      `未知的动作类型：${JSON.stringify(type)}（只支持 ${RENDER_ACTION_TYPES.join(' / ')}）`,
    )
  }

  const rawAtFrame = obj.atFrame === undefined ? 0 : obj.atFrame
  if (!isFiniteNumber(rawAtFrame) || rawAtFrame < 0) {
    throw new Error('动作的 atFrame 必须是非负数')
  }
  const atFrame = Math.floor(rawAtFrame)

  const params = (obj.params ?? {}) as Record<string, unknown>

  switch (type as RenderActionType) {
    case 'addCube': {
      const size = params.size === undefined ? 1 : params.size
      if (!isFiniteNumber(size) || size <= 0) {
        throw new Error('addCube 的 size 必须是正数')
      }
      return {
        atFrame,
        type: 'addCube',
        params: { position: parseVec3(params.position, 'addCube.params.position'), size },
      }
    }
    case 'addSphere': {
      const radius = params.radius === undefined ? 0.5 : params.radius
      if (!isFiniteNumber(radius) || radius <= 0) {
        throw new Error('addSphere 的 radius 必须是正数')
      }
      return {
        atFrame,
        type: 'addSphere',
        params: { position: parseVec3(params.position, 'addSphere.params.position'), radius },
      }
    }
    case 'setCamera': {
      return {
        atFrame,
        type: 'setCamera',
        params: {
          position: parseVec3(params.position, 'setCamera.params.position'),
          lookAt: parseVec3(params.lookAt, 'setCamera.params.lookAt'),
        },
      }
    }
    case 'setSpeed': {
      if (!isFiniteNumber(params.value) || params.value <= 0) {
        throw new Error('setSpeed 的 value 必须是正数')
      }
      return { atFrame, type: 'setSpeed', params: { value: params.value } }
    }
  }
}

/** 场景文档里能被渲染页还原的物体（模型需要 GLTF 加载器，不在渲染页范围内） */
export interface RenderObjectSpec {
  kind: 'cube' | 'sphere'
  position: Vec3
  rotation: Vec3
  scale: Vec3
  bodyType: 'dynamic' | 'fixed' | 'kinematic'
}

const isCubeOrSphere = (type: unknown): type is 'cube' | 'sphere' =>
  type === 'cube' || type === 'sphere'

/**
 * 把场景文档读成一组可渲染的物体。
 *
 * 读不出来的东西（缺位置、类型不认识）直接跳过而不是报错：
 * 场景文档里可能有模型这种渲染页还原不了的类型，跳过它们仍然能出一段视频，
 * 但**位置这类渲染必需的字段缺失就是数据坏了**，要报错。
 */
export const normalizeRenderScene = (raw: unknown): RenderObjectSpec[] => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('场景必须是一个对象')
  }
  const objects = (raw as { objects?: unknown }).objects
  if (!Array.isArray(objects)) {
    throw new Error('场景缺少 objects 数组')
  }

  const specs: RenderObjectSpec[] = []
  for (const entry of objects) {
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    if (!isCubeOrSphere(obj.type)) continue
    if (!obj.position) {
      throw new Error(`场景物体 ${JSON.stringify(obj.name ?? obj.uuid ?? '')} 缺少 position`)
    }
    const rotation = (obj.rotation ?? {}) as Record<string, unknown>
    const scale = (obj.scale ?? {}) as Record<string, unknown>
    const physics = (obj.physics ?? {}) as Record<string, unknown>
    const rawType = physics.type
    const bodyType: RenderObjectSpec['bodyType'] =
      rawType === 'static' ? 'fixed' : rawType === 'kinematic' ? 'kinematic' : 'dynamic'

    specs.push({
      kind: obj.type,
      position: parseVec3(obj.position, '场景物体 position'),
      rotation: {
        x: isFiniteNumber(rotation.x) ? rotation.x : 0,
        y: isFiniteNumber(rotation.y) ? rotation.y : 0,
        z: isFiniteNumber(rotation.z) ? rotation.z : 0,
      },
      scale: {
        x: isFiniteNumber(scale.x) ? scale.x : 1,
        y: isFiniteNumber(scale.y) ? scale.y : 1,
        z: isFiniteNumber(scale.z) ? scale.z : 1,
      },
      bodyType,
    })
  }
  return specs
}

/**
 * 物体的配色。
 *
 * 场景编辑器给新物体随机取色（那是给交互用的），
 * 渲染页必须用固定调色板：颜色随机会让同一个场景重跑出不同画面。
 */
const OBJECT_COLORS = [0x4f9dff, 0xff7043, 0x66bb6a, 0xffc107, 0xab47bc, 0x26c6da] as const

export interface RenderControllerOptions {
  /** Rapier 模块（与前端用的是同一份引擎） */
  rapier: Rapier
  /** Three.js 场景 */
  scene: THREE.Scene
  /** 相机（setCamera 动作改的就是它） */
  camera: THREE.PerspectiveCamera
  /** 画一帧 */
  draw: () => void
  /** 场景文档（SceneDocument） */
  sceneDocument?: unknown
}

export interface RenderController {
  ready: boolean
  step(): void
  /** 只画一帧，**不推进物理**（页面初始绘制用） */
  paint(): void
  frames(): number
  apply(action: RenderAction): void
  screenshotReady(): boolean
  /** 已创建的物体数（摘要与排查用） */
  objectCount(): number
}

interface RenderItem {
  mesh: THREE.Mesh
  body: RapierModule.RigidBody
}

/**
 * 创建渲染页的驱动器。
 *
 * 物理世界、地面、物体都在这里建；Three.js 的相机与灯光由页面负责
 * （`src/render/main.ts`），两边通过 `scene` / `camera` / `draw` 接起来。
 */
export const createRenderController = (options: RenderControllerOptions): RenderController => {
  const { rapier, scene, camera, draw } = options

  const world = new rapier.World({
    x: RENDER_PHYSICS.gravity.x,
    y: RENDER_PHYSICS.gravity.y,
    z: RENDER_PHYSICS.gravity.z,
  })
  world.integrationParameters.dt = RENDER_PHYSICS.fixedTimeStep
  const eventQueue = new rapier.EventQueue(true)

  // 地面：固定刚体 + cuboid(5, 0.1, 5)
  const groundBody = world.createRigidBody(
    rapier.RigidBodyDesc.fixed().setTranslation(0, RENDER_GROUND.bodyY, 0),
  )
  world.createCollider(
    rapier.ColliderDesc.cuboid(
      RENDER_GROUND.halfExtents.x,
      RENDER_GROUND.halfExtents.y,
      RENDER_GROUND.halfExtents.z,
    ),
    groundBody,
  )

  const items: RenderItem[] = []

  const createItem = (spec: {
    kind: 'cube' | 'sphere'
    position: Vec3
    rotation?: Vec3
    scale: Vec3
    bodyType: RenderObjectSpec['bodyType']
  }): RenderItem => {
    // 几何体基准尺寸与场景编辑器一致：
    // 立方体是 BoxGeometry(1,1,1)（半长 0.5），球体是 SphereGeometry(0.5)（半径 0.5）。
    // 缩放走 mesh.scale，碰撞体按同一套基准换算，视觉与碰撞才不会脱节。
    const geometry =
      spec.kind === 'cube'
        ? new THREE.BoxGeometry(1, 1, 1)
        : new THREE.SphereGeometry(0.5, 32, 32)
    const material = new THREE.MeshStandardMaterial({
      color: OBJECT_COLORS[items.length % OBJECT_COLORS.length],
      metalness: 0.3,
      roughness: 0.4,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.position.set(spec.position.x, spec.position.y, spec.position.z)
    mesh.scale.set(spec.scale.x, spec.scale.y, spec.scale.z)

    const rotation = spec.rotation ?? { x: 0, y: 0, z: 0 }
    mesh.rotation.set(rotation.x, rotation.y, rotation.z)

    const desc =
      spec.bodyType === 'fixed'
        ? rapier.RigidBodyDesc.fixed()
        : spec.bodyType === 'kinematic'
          ? rapier.RigidBodyDesc.kinematicPositionBased()
          : rapier.RigidBodyDesc.dynamic()
    desc.setTranslation(spec.position.x, spec.position.y, spec.position.z)

    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation.x, rotation.y, rotation.z),
    )
    desc.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w })

    const body = world.createRigidBody(desc)

    const sx = Math.abs(spec.scale.x) || 1
    const sy = Math.abs(spec.scale.y) || 1
    const sz = Math.abs(spec.scale.z) || 1
    if (spec.kind === 'cube') {
      world.createCollider(rapier.ColliderDesc.cuboid(0.5 * sx, 0.5 * sy, 0.5 * sz), body)
    } else {
      // Rapier 没有椭球碰撞体：球体的非等比缩放用三轴均值近似半径
      world.createCollider(rapier.ColliderDesc.ball(0.5 * ((sx + sy + sz) / 3)), body)
    }

    scene.add(mesh)
    const item: RenderItem = { mesh, body }
    items.push(item)
    return item
  }

  // 场景文档里的物体
  const specs = normalizeRenderScene(options.sceneDocument ?? { objects: [] })
  for (const spec of specs) {
    createItem(spec)
  }

  let frameCount = 0
  let speed = 1
  let hasDrawn = false

  /** 物理 → 画面：刚体是位置的唯一权威，每一步都把 mesh 对齐过去 */
  const syncMeshes = (): void => {
    for (const item of items) {
      const translation = item.body.translation()
      item.mesh.position.set(translation.x, translation.y, translation.z)
      const rotation = item.body.rotation()
      item.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
    }
  }

  const paint = (): void => {
    draw()
    hasDrawn = true
  }

  const step = (): void => {
    // 速度倍率作用在步长上，而不是「一帧几步」上：
    // 一帧一步是硬约束（抓到的第 N 帧 = 物理的第 N 步），
    // 改步长才能在不动这个约束的前提下让画面里的快慢真的变掉。
    world.integrationParameters.dt = RENDER_PHYSICS.fixedTimeStep * speed
    world.step(eventQueue)
    syncMeshes()
    paint()
    frameCount += 1
  }

  const apply = (raw: RenderAction): void => {
    const action = parseRenderAction(raw)
    switch (action.type) {
      case 'addCube': {
        const { position, size } = action.params
        createItem({
          kind: 'cube',
          position,
          scale: { x: size, y: size, z: size },
          bodyType: 'dynamic',
        })
        break
      }
      case 'addSphere': {
        const { position, radius } = action.params
        // 基准球半径是 0.5，缩放 2R 之后实际半径正好是 R
        createItem({
          kind: 'sphere',
          position,
          scale: { x: radius * 2, y: radius * 2, z: radius * 2 },
          bodyType: 'dynamic',
        })
        break
      }
      case 'setCamera': {
        const { position, lookAt } = action.params
        camera.position.set(position.x, position.y, position.z)
        camera.lookAt(lookAt.x, lookAt.y, lookAt.z)
        break
      }
      case 'setSpeed': {
        speed = Math.min(
          RENDER_PHYSICS.maxSpeed,
          Math.max(RENDER_PHYSICS.minSpeed, action.params.value),
        )
        break
      }
    }
  }

  return {
    ready: true,
    step,
    paint,
    frames: () => frameCount,
    apply,
    screenshotReady: () => hasDrawn,
    objectCount: () => items.length,
  }
}
