import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import * as THREE from 'three'
import PropertyPanel from './PropertyPanel.vue'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import { MATERIAL_PRESETS, findMaterialPreset } from '@/data/materialPresets'

const makeMesh = (color = 0xa9703f) =>
  new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color }),
  )

const addSelectedCube = (store: ReturnType<typeof useSceneEditorStore>) => {
  store.addObject({
    uuid: 'u1',
    name: 'Cube',
    type: 'cube',
    color: 0xa9703f,
    material: { metalness: 0.2, roughness: 0.9 },
    position: { x: 0, y: 0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    threeObject: makeMesh(),
  })
  store.setSelectedObject('u1')
}

describe('PropertyPanel 的材质组', () => {
  let wrapper: VueWrapper
  let store: ReturnType<typeof useSceneEditorStore>
  let events: CustomEvent[]
  let handler: (event: Event) => void

  beforeEach(async () => {
    setActivePinia(createPinia())
    sessionStorage.clear()
    store = useSceneEditorStore()
    addSelectedCube(store)

    events = []
    handler = (event: Event) => events.push(event as CustomEvent)
    window.addEventListener('update-material', handler)

    wrapper = mount(PropertyPanel)
    await nextTick()
  })

  afterEach(() => {
    window.removeEventListener('update-material', handler)
    wrapper?.unmount()
  })

  it('显示材质组：颜色、金属度 / 粗糙度（滑杆 + 数字）与预设下拉', () => {
    expect(wrapper.find('.material-group').exists()).toBe(true)

    const color = wrapper.find<HTMLInputElement>('input[type="color"]')
    expect(color.element.value).toBe('#a9703f')

    expect(wrapper.findAll('input[type="range"]')).toHaveLength(2)
    const numbers = wrapper.findAll<HTMLInputElement>('.material-number')
    expect(numbers).toHaveLength(2)
    expect(numbers[0].element.value).toBe('0.2')
    expect(numbers[1].element.value).toBe('0.9')

    const options = wrapper.findAll('.material-preset select option')
    expect(options).toHaveLength(MATERIAL_PRESETS.length + 1)
    expect(options[0].text()).toBe('自定义')
  })

  it('修改金属度并提交后写回 store，并派发 update-material', async () => {
    const input = wrapper.findAll<HTMLInputElement>('.material-number')[0]
    input.element.value = '0.5'
    await input.trigger('input')
    await input.trigger('change')

    expect(store.objects[0].material).toEqual({ metalness: 0.5, roughness: 0.9 })
    expect(events).toHaveLength(1)
    expect(events[0].detail.uuid).toBe('u1')
    expect(events[0].detail.material).toEqual({ metalness: 0.5, roughness: 0.9 })
    expect(events[0].detail.color).toBe(0xa9703f)
  })

  it('越界的粗糙度收敛到 0~1', async () => {
    const input = wrapper.findAll<HTMLInputElement>('.material-number')[1]
    input.element.value = '3'
    await input.trigger('input')
    await input.trigger('change')

    expect(store.objects[0].material?.roughness).toBe(1)
    expect(wrapper.findAll<HTMLInputElement>('.material-number')[1].element.value).toBe('1')
  })

  it('选择预设后一次填好颜色 / 金属度 / 粗糙度并写回 store', async () => {
    const preset = findMaterialPreset('brushed-steel')!
    const select = wrapper.find<HTMLSelectElement>('.material-preset select')
    select.element.value = preset.id
    await select.trigger('change')

    expect(store.objects[0].color).toBe(preset.color)
    expect(store.objects[0].material).toEqual({
      metalness: preset.metalness,
      roughness: preset.roughness,
    })
    expect(wrapper.find<HTMLInputElement>('input[type="color"]').element.value).toBe('#b8bcc2')
  })
})

describe('PropertyPanel 的待应用材质横幅', () => {
  it('没有选中物体时显示横幅，但「应用到选中物体」不可用', async () => {
    setActivePinia(createPinia())
    sessionStorage.setItem('pending-material', 'brass')

    const wrapper = mount(PropertyPanel)
    await nextTick()

    expect(wrapper.find('.material-pending').exists()).toBe(true)
    expect(wrapper.text()).toContain('已载入材质：黄铜')
    expect(
      wrapper.find<HTMLButtonElement>('.material-pending-apply').element.disabled,
    ).toBe(true)

    wrapper.unmount()
  })

  it('选中物体后一键应用：写入颜色 / 材质，并清掉 pending', async () => {
    setActivePinia(createPinia())
    sessionStorage.setItem('pending-material', 'brass')

    // store 在首次使用时创建，此刻会从 sessionStorage 读到 pending
    const store = useSceneEditorStore()
    addSelectedCube(store)
    expect(store.pendingMaterialId).toBe('brass')

    const wrapper = mount(PropertyPanel)
    await nextTick()

    const button = wrapper.find<HTMLButtonElement>('.material-pending-apply')
    expect(button.element.disabled).toBe(false)
    await button.trigger('click')
    await nextTick()

    const preset = findMaterialPreset('brass')!
    expect(store.objects[0].color).toBe(preset.color)
    expect(store.objects[0].material).toEqual({
      metalness: preset.metalness,
      roughness: preset.roughness,
    })
    expect(store.pendingMaterialId).toBeNull()
    expect(sessionStorage.getItem('pending-material')).toBeNull()
    expect(wrapper.find('.material-pending').exists()).toBe(false)

    wrapper.unmount()
  })
})
