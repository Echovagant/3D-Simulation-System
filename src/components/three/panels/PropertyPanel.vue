<template>
  <div class="property-panel">
    <!-- 选中物体时显示属性编辑表单 -->
    <template v-if="selectedObject">
      <h3>
        属性编辑
      </h3>
      <div class="property-group">
        <label>名称:</label>
        <input
          type="text"
          :value="objectName"
          @input="handleNameInput"
          @change="commit(updateName)"
          @focus="startEditing"
          @blur="stopEditing"
          placeholder="对象名称"
        />
      </div>
      <!-- 位置：组标题一行 + 三轴一行（3 列网格），替代原先 9 行逐轴堆叠 -->
      <div class="transform-group">
        <span class="group-title">位置</span>
        <div class="axis-grid">
          <label class="axis-field">
            <span class="axis-name">X</span>
            <input
              type="number"
              step="0.1"
              :value="positionX"
              @input="handlePositionXInput"
              @change="commit(updatePosition)"
              @focus="startEditing"
              @blur="stopEditing"
              placeholder="X坐标"
            />
          </label>
          <label class="axis-field">
            <span class="axis-name">Y</span>
            <input
              type="number"
              step="0.1"
              :value="positionY"
              @input="handlePositionYInput"
              @change="commit(updatePosition)"
              @focus="startEditing"
              @blur="stopEditing"
              placeholder="Y坐标"
            />
          </label>
          <label class="axis-field">
            <span class="axis-name">Z</span>
            <input
              type="number"
              step="0.1"
              :value="positionZ"
              @input="handlePositionZInput"
              @change="commit(updatePosition)"
              @focus="startEditing"
              @blur="stopEditing"
              placeholder="Z坐标"
            />
          </label>
        </div>
      </div>

      <!-- 旋转（单位：度） -->
      <div class="transform-group">
        <span class="group-title">旋转 · 度</span>
        <div class="axis-grid">
          <label class="axis-field">
            <span class="axis-name">X</span>
            <input
              type="number"
              step="1"
              :value="rotationX"
              @input="handleRotationXInput"
              @change="commit(updateRotation)"
              @focus="startEditing"
              @blur="stopEditing"
              placeholder="X轴旋转"
            />
          </label>
          <label class="axis-field">
            <span class="axis-name">Y</span>
            <input
              type="number"
              step="1"
              :value="rotationY"
              @input="handleRotationYInput"
              @change="commit(updateRotation)"
              @focus="startEditing"
              @blur="stopEditing"
              placeholder="Y轴旋转"
            />
          </label>
          <label class="axis-field">
            <span class="axis-name">Z</span>
            <input
              type="number"
              step="1"
              :value="rotationZ"
              @input="handleRotationZInput"
              @change="commit(updateRotation)"
              @focus="startEditing"
              @blur="stopEditing"
              placeholder="Z轴旋转"
            />
          </label>
        </div>
      </div>

      <!-- 缩放 -->
      <div class="transform-group">
        <span class="group-title">缩放</span>
        <div class="axis-grid">
          <label class="axis-field">
            <span class="axis-name">X</span>
            <input
              type="number"
              step="0.1"
              :value="scaleX"
              @input="handleScaleXInput"
              @change="commit(updateScale)"
              @focus="startEditing"
              @blur="stopEditing"
              placeholder="X轴缩放"
              min="0.1"
            />
          </label>
          <label class="axis-field">
            <span class="axis-name">Y</span>
            <input
              type="number"
              step="0.1"
              :value="scaleY"
              @input="handleScaleYInput"
              @change="commit(updateScale)"
              @focus="startEditing"
              @blur="stopEditing"
              placeholder="Y轴缩放"
              min="0.1"
            />
          </label>
          <label class="axis-field">
            <span class="axis-name">Z</span>
            <input
              type="number"
              step="0.1"
              :value="scaleZ"
              @input="handleScaleZInput"
              @change="commit(updateScale)"
              @focus="startEditing"
              @blur="stopEditing"
              placeholder="Z轴缩放"
              min="0.1"
            />
          </label>
        </div>
      </div>
    </template>

    <!-- 未选中物体时：空场景给引导，有物体时给「对象列表」，不重复工具栏的添加功能 -->
    <template v-else>
      <EmptyState
        v-if="store.objects.length === 0"
        icon="fa-solid fa-cubes"
        title="场景还是空的"
        description="用顶部工具栏添加立方体 / 球体 / 斜面，或到「场景」tab 载入精选场景。"
      />

      <div v-else class="object-browser">
        <div class="object-browser-head">
          <h3>对象列表</h3>
          <span class="object-count">{{ store.objects.length }} 个</span>
        </div>
        <p class="object-browser-hint">
          点击对象即可选中，属性表单会显示完整变换；也可以直接点 3D 视图里的物体。
        </p>

        <ul class="object-list">
          <li v-for="obj in store.objects" :key="obj.uuid">
            <button class="object-row" type="button" @click="store.setSelectedObject(obj.uuid)">
              <i class="fas" :class="iconFor(obj.type)" aria-hidden="true"></i>
              <span class="object-row-name">{{ obj.name }}</span>
              <span class="object-row-type">{{ typeLabel(obj.type) }}</span>
              <span v-if="obj.visible === false" class="object-row-hidden">已隐藏</span>
            </button>
          </li>
        </ul>

        <div class="scene-summary">
          <span>场地 {{ store.worldSize }} × {{ store.worldSize }}</span>
          <span>物理 {{ simulationLabel }}</span>
        </div>
        <p class="object-browser-tip">
          拖动时按住 Shift 吸附 0.5 米网格；Ctrl+Z 撤销，Ctrl+Y 重做。
        </p>
      </div>
    </template>
  </div>
</template>

<script setup>
import * as THREE from 'three'
import { computed, watch, ref } from 'vue'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import EmptyState from '@/components/common/EmptyState.vue'

// 获取场景编辑器状态
const store = useSceneEditorStore()

// 从store中获取当前选中的物体
const selectedObject = computed(() => store.selectedObject)

/** 对象列表的图标：与工具栏的基本体图标保持一致 */
const iconFor = (type) => {
  if (type === 'cube') return 'fa-cube'
  if (type === 'sphere') return 'fa-circle'
  if (type === 'ramp') return 'fa-mountain'
  return 'fa-box'
}

const typeLabel = (type) => {
  if (type === 'cube') return '立方体'
  if (type === 'sphere') return '球体'
  if (type === 'ramp') return '斜面'
  if (type === 'model') return '模型'
  return type
}

const simulationLabel = computed(() => {
  // 工具栏的播放/暂停切换的是 isPlaying：按钮叫「暂停模拟」，状态就写「已暂停」
  if (!store.simulationState.isPlaying || store.simulationState.isPaused) return '已暂停'
  return '运行中'
})

// 使用ref来存储属性值，避免计算属性的setter循环
const objectName = ref('')
const positionX = ref(0)
const positionY = ref(0)
const positionZ = ref(0)
const rotationX = ref(0)
const rotationY = ref(0)
const rotationZ = ref(0)
const scaleX = ref(1)
const scaleY = ref(1)
const scaleZ = ref(1)

// 输入处理函数

/**
 * 用户是否正在编辑表单。
 *
 * 仿真运行时，物理同步每帧都在改 mesh 的位置，面板必须跟着刷新；
 * 但如果用户正在输入框里打字，这份刷新就会把用户刚输入的值冲掉
 * （实测：输入 "5"，120ms 后被改回实时 meshY "1.7135…"）。
 *
 * 因此编辑期间**不做回填**，提交或失焦后再恢复同步。
 */
const isEditing = ref(false)

const startEditing = () => {
  isEditing.value = true
}

const stopEditing = () => {
  isEditing.value = false
}

/**
 * 提交：先结束编辑态（恢复与物理同步的实时刷新），再把值写回 store。
 */
const commit = (apply) => {
  stopEditing()
  apply()
}

const handleNameInput = (event) => {
  startEditing()
  objectName.value = event.target.value
}

const handlePositionXInput = (event) => {
  startEditing()
  positionX.value = Number(event.target.value)
}
const handlePositionYInput = (event) => {
  startEditing()
  positionY.value = Number(event.target.value)
}
const handlePositionZInput = (event) => {
  startEditing()
  positionZ.value = Number(event.target.value)
}

const handleRotationXInput = (event) => {
  startEditing()
  rotationX.value = Number(event.target.value)
}
const handleRotationYInput = (event) => {
  startEditing()
  rotationY.value = Number(event.target.value)
}
const handleRotationZInput = (event) => {
  startEditing()
  rotationZ.value = Number(event.target.value)
}

const handleScaleXInput = (event) => {
  startEditing()
  scaleX.value = Number(event.target.value)
}
const handleScaleYInput = (event) => {
  startEditing()
  scaleY.value = Number(event.target.value)
}
const handleScaleZInput = (event) => {
  startEditing()
  scaleZ.value = Number(event.target.value)
}

// 监听store中的selectedObjectUuid变化
watch(
  () => store.selectedObjectUuid,
  () => {
    // 自动响应变化，无需日志
  },
  { immediate: true },
)

// 上一次同步过的是哪个对象。
// 选中对象变了就必须无条件重新同步（并清掉编辑态），否则新对象会显示上一个对象的残值。
let syncedUuid = null

/**
 * 把选中物体的实时状态回填到表单。
 *
 * `force` 为 true 表示「选中对象变了」，此时无条件同步。
 */
const syncFormFromObject = (force = false) => {
  const newObj = selectedObject.value

  if (!newObj?.threeObject) {
    // 清除属性值
    objectName.value = ''
    positionX.value = 0
    positionY.value = 0
    positionZ.value = 0
    rotationX.value = 0
    rotationY.value = 0
    rotationZ.value = 0
    scaleX.value = 1
    scaleY.value = 1
    scaleZ.value = 1
    syncedUuid = null
    isEditing.value = false
    return
  }

  // 正在编辑时不回填：物理同步每帧都在跑，回填会把用户刚输入的值冲掉
  if (!force && isEditing.value) return

  // 同步位置
  positionX.value = newObj.threeObject.position.x
  positionY.value = newObj.threeObject.position.y
  positionZ.value = newObj.threeObject.position.z

  // 同步旋转（转为角度）
  rotationX.value = THREE.MathUtils.radToDeg(newObj.threeObject.rotation.x)
  rotationY.value = THREE.MathUtils.radToDeg(newObj.threeObject.rotation.y)
  rotationZ.value = THREE.MathUtils.radToDeg(newObj.threeObject.rotation.z)

  // 同步缩放
  scaleX.value = newObj.threeObject.scale.x
  scaleY.value = newObj.threeObject.scale.y
  scaleZ.value = newObj.threeObject.scale.z

  // 同步名称
  objectName.value = newObj.name || ''

  syncedUuid = newObj.uuid
}

/**
 * 显式依赖：不再对选中的 three 对象做深度遍历。
 *
 * 触发源是 `simulationState.frameCount`——它是一个原始数字，每帧只读一次，
 * 不触碰对象图；它与 mesh 的移动同源（物理循环推进时递增），
 * 因此仿真运行时面板照样实时刷新，却不再每帧把整棵 mesh 图遍历一遍。
 *
 * 另外两个依赖项覆盖「选中对象变了」和「对象改名了」两种情况。
 */
watch(
  () => [store.selectedObject?.uuid, store.selectedObject?.name, store.simulationState.frameCount],
  () => {
    const uuid = store.selectedObject?.uuid ?? null
    const selectionChanged = uuid !== syncedUuid
    if (selectionChanged) isEditing.value = false
    syncFormFromObject(selectionChanged)
  },
  { immediate: true },
)

// 更新名称
const updateName = () => {
  if (!selectedObject.value) return
  store.updateObject(selectedObject.value.uuid, {
    name: objectName.value,
  })
}

// 更新位置
const updatePosition = () => {
  if (!selectedObject.value?.threeObject) return

  const { uuid, threeObject } = selectedObject.value
  // 更新Three.js物体位置
  threeObject.position.set(positionX.value, positionY.value, positionZ.value)

  // 同步到store
  store.updateObject(uuid, {
    position: {
      x: threeObject.position.x,
      y: threeObject.position.y,
      z: threeObject.position.z,
    },
  })
}

// 更新旋转
const updateRotation = () => {
  if (!selectedObject.value?.threeObject) return

  const { uuid, threeObject } = selectedObject.value
  // 转换角度为弧度，更新Three.js物体旋转
  threeObject.rotation.set(
    THREE.MathUtils.degToRad(rotationX.value),
    THREE.MathUtils.degToRad(rotationY.value),
    THREE.MathUtils.degToRad(rotationZ.value),
  )

  // 同步到store
  store.updateObject(uuid, {
    rotation: {
      x: threeObject.rotation.x,
      y: threeObject.rotation.y,
      z: threeObject.rotation.z,
    },
  })
}

// 更新缩放
const updateScale = () => {
  if (!selectedObject.value?.threeObject) return

  const { uuid, threeObject } = selectedObject.value
  // 更新Three.js物体缩放
  threeObject.scale.set(scaleX.value, scaleY.value, scaleZ.value)

  // 同步到store
  store.updateObject(uuid, {
    scale: {
      x: threeObject.scale.x,
      y: threeObject.scale.y,
      z: threeObject.scale.z,
    },
  })
}

// 删除选中对象 - 移除重复功能
// const handleRemoveObject = () => {
//   if (selectedObject.value?.uuid) {
//     store.removeObject(selectedObject.value.uuid)
//   }
// }
</script>

<style scoped>
/*
 * 底色、左边框与滚动口径由工作台骨架类 .ws-side（挂在外层 .editor-side 上）
 * 统一提供；本组件只负责内容排版。
 */
.property-panel {
  width: 100%;
  padding: 15px;
  box-sizing: border-box;
}

h3 {
  margin: 0 0 14px 0;
  font-size: 16px;
  color: var(--text-1);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle);
}

/* 名称字段：保持「label 上、input 下」的单字段结构 */
.property-group {
  margin-bottom: 14px;
}

.property-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--text-2);
  font-weight: 500;
}

/* 位置 / 旋转 / 缩放：组标题一行 + 三轴一行（3 列网格） */
.transform-group {
  margin-bottom: 12px;
}

.group-title {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--text-3);
  font-weight: 600;
  letter-spacing: 0.04em;
}

.axis-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.axis-field {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.axis-name {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--text-3);
  font-weight: 600;
}

.axis-field input {
  width: 100%;
  min-width: 0;
  padding: 6px 7px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-1);
  background-color: var(--bg-inset);
  color-scheme: dark;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.axis-field input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

/* 共用输入框规格：名称字段与轴字段保持一致 */
.property-group input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-1);
  background-color: var(--bg-inset);
  color-scheme: dark;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.property-group input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

/* 未选中时：对象列表承担「选择对象」职责，而不是重复工具栏的添加按钮 */
.object-browser {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.object-browser-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.object-browser-head h3 {
  margin: 0;
  font-size: 14px;
  color: var(--text-1);
}

.object-count {
  color: var(--text-3);
  font-size: 12px;
}

.object-browser-hint {
  margin: 0;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.6;
}

.object-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 46vh;
  overflow-y: auto;
}

.object-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background-color: transparent;
  color: var(--text-1);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s, border-color 0.2s;
}

.object-row:hover {
  background-color: var(--bg-hover);
  border-color: var(--border-strong);
}

.object-row i {
  width: 14px;
  color: var(--text-3);
  text-align: center;
}

.object-row-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.object-row-type,
.object-row-hidden {
  flex: 0 0 auto;
  color: var(--text-3);
  font-size: 11px;
}

.object-row-hidden {
  color: var(--danger);
}

.scene-summary {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background-color: var(--bg-inset);
  color: var(--text-2);
  font-size: 11px;
}

.object-browser-tip {
  margin: 0;
  color: var(--text-3);
  font-size: 11px;
  line-height: 1.5;
}
</style>
