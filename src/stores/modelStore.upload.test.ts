import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useModelStore } from './modelStore'
import { useSceneEditorStore } from './sceneEditorStore'

/**
 * 计划 018：模型上传必须是**真的**。
 *
 * 以前 uploadModel 把文件丢掉，写死 `modelUrl: '#'`（modelLoader 明确拒绝它），
 * 还编造随机多边形数与 1.5 秒假延迟。
 *
 * jsdom 没有实现 URL.createObjectURL，这里用桩替代浏览器 API，
 * 被测的是 store 与浏览器 API 之间的契约（用哪个地址、什么时候回收）。
 */

/** 构造一个最小可用的 GLB：一个三角形 */
const buildMinimalGlb = (): ArrayBuffer => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const bin = positions.buffer as ArrayBuffer

  const gltf = {
    asset: { version: '2.0', generator: 'plan-018-test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }],
    buffers: [{ byteLength: bin.byteLength }],
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf))
  const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4
  const jsonLength = jsonBytes.byteLength + jsonPadding
  const binPadding = (4 - (bin.byteLength % 4)) % 4
  const binLength = bin.byteLength + binPadding

  const total = 12 + 8 + jsonLength + 8 + binLength
  const out = new ArrayBuffer(total)
  const view = new DataView(out)
  const bytes = new Uint8Array(out)

  bytes.set([0x67, 0x6c, 0x54, 0x46], 0) // 'glTF'
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)

  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true) // 'JSON'
  bytes.set(jsonBytes, 20)
  for (let i = 0; i < jsonPadding; i++) bytes[20 + jsonBytes.byteLength + i] = 0x20

  const binStart = 20 + jsonLength
  view.setUint32(binStart, binLength, true)
  view.setUint32(binStart + 4, 0x004e4942, true) // 'BIN\0'
  bytes.set(new Uint8Array(bin), binStart + 8)

  return out
}

describe('模型上传', () => {
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    createObjectURL = vi.fn(() => 'blob:http://localhost/mock-blob')
    revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    vi.restoreAllMocks()
  })

  const uploadSample = async () => {
    const store = useModelStore()
    const file = new File([buildMinimalGlb()], 'triangle.glb', { type: 'model/gltf-binary' })
    const model = await store.uploadModel({ name: '测试三角', category: 'props', file })
    return { store, file, model }
  }

  it('上传产生 blob: 开头的 modelUrl，而不是占位的 "#"', async () => {
    const { store, file, model } = await uploadSample()

    expect(model.modelUrl).toBe('blob:http://localhost/mock-blob')
    expect(model.modelUrl.startsWith('blob:')).toBe(true)
    expect(model.modelUrl).not.toBe('#')
    expect(createObjectURL).toHaveBeenCalledWith(file)
    expect(store.models[0].id).toBe(model.id)
  })

  it('上传的模型被标记为「仅本次会话有效」，并且不编造模型数据', async () => {
    const { model } = await uploadSample()

    expect(model.sessionOnly).toBe(true)
    expect(model.polyCount).toBe(0)
    expect(model.materialCount).toBe(0)
    expect(model.hasAnimation).toBe(false)
    expect(model.format).toBe('GLB')
  })

  it('上传不再插入 1.5 秒假延迟', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    await uploadSample()

    const hasFakeDelay = timeoutSpy.mock.calls.some((call) => call[1] === 1500)
    expect(hasFakeDelay).toBe(false)
  })

  it('删除模型时回收对象 URL', async () => {
    const { store, model } = await uploadSample()

    store.deleteModel(model.id)

    expect(revokeObjectURL).toHaveBeenCalledWith(model.modelUrl)
    expect(store.getModelById(model.id)).toBeUndefined()
  })

  it('上传的模型能被真正加载出来（走 File 解析，而不是 URL 解析）', async () => {
    const { store, model } = await uploadSample()

    const object = await store.loadModelById(model.id)

    expect(object).not.toBeNull()
    expect(object?.isObject3D).toBe(true)
    expect(object?.children.length).toBeGreaterThan(0)
  })

  it('上传的模型能添加到场景（不再报「模型加载失败」）', async () => {
    const { store, model } = await uploadSample()
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    await store.addModelToScene(model.id)

    expect(alertSpy).not.toHaveBeenCalled()

    const sceneStore = useSceneEditorStore()
    expect(sceneStore.objects).toHaveLength(1)
    expect(sceneStore.objects[0].modelId).toBe(model.id)
    expect(sceneStore.objects[0].threeObject?.isObject3D).toBe(true)
  })
})
