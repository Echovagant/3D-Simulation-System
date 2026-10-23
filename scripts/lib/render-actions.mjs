/**
 * 录制器输入的校验与归一化。
 *
 * 渲染页（`src/render/renderPage.ts`）里也有一份动作校验：
 * 那份管的是「动作真的被执行时」不能炸；这份管的是「文件还没打开浏览器就报错」。
 * 后者能把错误提前到秒级，而不是等 Chrome 起来、页面加载完才失败。
 */

export const RENDER_ACTION_TYPES = ['addCube', 'addSphere', 'setCamera', 'setSpeed']

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const requireVec3 = (value, field) => {
  if (!value || typeof value !== 'object') {
    throw new Error(`${field} 必须是 {x, y, z} 对象`)
  }
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.z)) {
    throw new Error(`${field} 的 x / y / z 必须是有限数字`)
  }
  return { x: value.x, y: value.y, z: value.z }
}

/** 校验并归一化单个动作 */
export const normalizeRenderAction = (raw, index) => {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`actions[${index}] 必须是对象`)
  }
  if (typeof raw.type !== 'string' || !RENDER_ACTION_TYPES.includes(raw.type)) {
    throw new Error(
      `actions[${index}].type 必须是 ${RENDER_ACTION_TYPES.join(' / ')} 之一，实际是 ${JSON.stringify(raw.type)}`,
    )
  }
  const atFrame = raw.atFrame === undefined ? 0 : raw.atFrame
  if (!isFiniteNumber(atFrame) || atFrame < 0) {
    throw new Error(`actions[${index}].atFrame 必须是非负数`)
  }
  const params = raw.params ?? {}

  switch (raw.type) {
    case 'addCube': {
      const size = params.size === undefined ? 1 : params.size
      if (!isFiniteNumber(size) || size <= 0) {
        throw new Error(`actions[${index}].params.size 必须是正数`)
      }
      return {
        atFrame: Math.floor(atFrame),
        type: 'addCube',
        params: { position: requireVec3(params.position, `actions[${index}].params.position`), size },
      }
    }
    case 'addSphere': {
      const radius = params.radius === undefined ? 0.5 : params.radius
      if (!isFiniteNumber(radius) || radius <= 0) {
        throw new Error(`actions[${index}].params.radius 必须是正数`)
      }
      return {
        atFrame: Math.floor(atFrame),
        type: 'addSphere',
        params: {
          position: requireVec3(params.position, `actions[${index}].params.position`),
          radius,
        },
      }
    }
    case 'setCamera':
      return {
        atFrame: Math.floor(atFrame),
        type: 'setCamera',
        params: {
          position: requireVec3(params.position, `actions[${index}].params.position`),
          lookAt: requireVec3(params.lookAt, `actions[${index}].params.lookAt`),
        },
      }
    case 'setSpeed': {
      if (!isFiniteNumber(params.value) || params.value <= 0) {
        throw new Error(`actions[${index}].params.value 必须是正数`)
      }
      return { atFrame: Math.floor(atFrame), type: 'setSpeed', params: { value: params.value } }
    }
    default:
      // 上面的白名单已经拦住了，这里只是让类型检查闭嘴
      throw new Error(`actions[${index}].type 不受支持`)
  }
}

/**
 * 校验并归一化整份渲染请求。
 *
 * @returns {{scene: object, actions: object[], frames: number, fps: number, width: number, height: number}}
 */
export const normalizeRenderRequest = (raw) => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('输入 JSON 必须是一个对象')
  }

  const scene = raw.scene
  if (!scene || typeof scene !== 'object') {
    throw new Error('输入 JSON 缺少 scene')
  }
  if (!Array.isArray(scene.objects)) {
    throw new Error('scene.objects 必须是数组')
  }

  if (!isFiniteNumber(raw.frames) || raw.frames <= 0) {
    throw new Error('frames 必须是正数')
  }
  const frames = Math.floor(raw.frames)

  const fps = raw.fps === undefined ? 30 : raw.fps
  if (!isFiniteNumber(fps) || fps <= 0) {
    throw new Error('fps 必须是正数')
  }

  const width = raw.width === undefined ? 1280 : raw.width
  const height = raw.height === undefined ? 720 : raw.height
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) {
    throw new Error('width / height 必须是正数')
  }
  // H.264 的 yuv420p 要求宽高都是偶数
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new Error(`width / height 必须是偶数（yuv420p 要求），实际是 ${width}×${height}`)
  }

  const rawActions = raw.actions === undefined ? [] : raw.actions
  if (!Array.isArray(rawActions)) {
    throw new Error('actions 必须是数组')
  }
  const actions = rawActions.map((action, index) => normalizeRenderAction(action, index))
  // 按 atFrame 排序；同一帧内保持文件里的先后顺序（V8 的 sort 是稳定的）
  actions.sort((a, b) => a.atFrame - b.atFrame)

  return {
    scene,
    actions,
    frames,
    fps: Math.floor(fps),
    width: Math.floor(width),
    height: Math.floor(height),
  }
}
