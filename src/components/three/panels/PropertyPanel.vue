<template>
  <div class="property-panel">
    <!-- 选中物体时显示属性编辑表单 -->
    <template v-if="selectedObject">
      <h3>属性编辑</h3>
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
      <div class="property-group">
        <label>位置 X:</label>
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
      </div>
      <div class="property-group">
        <label>位置 Y:</label>
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
      </div>
      <div class="property-group">
        <label>位置 Z:</label>
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
      </div>

      <!-- 旋转属性编辑 -->
      <div class="property-group">
        <label>旋转 X (度):</label>
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
      </div>
      <div class="property-group">
        <label>旋转 Y (度):</label>
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
      </div>
      <div class="property-group">
        <label>旋转 Z (度):</label>
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
      </div>

      <!-- 缩放属性编辑 -->
      <div class="property-group">
        <label>缩放 X:</label>
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
      </div>
      <div class="property-group">
        <label>缩放 Y:</label>
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
      </div>
      <div class="property-group">
        <label>缩放 Z:</label>
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
      </div>

      <!-- 删除按钮 - 移除重复的删除功能，保留在Toolbar中即可 -->
      <!-- <button
        class="delete-btn"
        @click="handleRemoveObject"
      >
        删除选中对象
      </button> -->
    </template>

    <!-- 未选中物体时显示提示 -->
    <template v-else>
      <div class="empty-state">
        <p>未选择任何对象</p>
        <p class="hint">点击3D视图中的物体进行编辑</p>
      </div>
    </template>

    <!-- 我的场景：已保存的场景在这里列出、打开、删除 -->
    <SceneList />
  </div>
</template>

<script setup>
import * as THREE from 'three'
import { computed, watch, ref } from 'vue'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import SceneList from '@/components/three/panels/SceneList.vue'

// 获取场景编辑器状态
const store = useSceneEditorStore()

// 从store中获取当前选中的物体
const selectedObject = computed(() => store.selectedObject)

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
/* 保留原有样式并添加新样式 */
.property-panel {
  width: 100%;
  padding: 15px;
  background-color: #f5f5f5;
  border-left: 1px solid #ddd;
  overflow-y: auto;
  height: 100%;
  box-sizing: border-box;
}

h3 {
  margin: 0 0 20px 0;
  font-size: 16px;
  color: #333;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
}

.property-group {
  margin-bottom: 16px;
}

.property-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #666;
  font-weight: 500;
}

.property-group input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.property-group input:focus {
  outline: none;
  border-color: #3498db;
  box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.1);
}

.empty-state {
  text-align: center;
  padding: 30px 10px;
  color: #888;
}

.empty-state .hint {
  margin-top: 10px;
  font-size: 12px;
  color: #aaa;
}

.delete-btn {
  width: 100%;
  padding: 10px;
  background-color: #e53e3e;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  margin-top: 20px;
  transition: background-color 0.2s;
}

.delete-btn:hover {
  background-color: #c53030;
}
</style>
