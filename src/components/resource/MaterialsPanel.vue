<template>
  <div class="materials-panel">
    <PageHeader
      title="材质"
      lead="一组可直接套用的表面参数（颜色 / 金属度 / 粗糙度）。选一套带到场景编辑器，套到选中的物体上。"
    />

    <ul class="material-grid">
      <li v-for="preset in presets" :key="preset.id" class="material-card">
        <div
          class="material-swatch"
          :style="{ backgroundColor: toHexColorString(preset.color) }"
          aria-hidden="true"
        ></div>
        <div class="material-body">
          <h2 class="material-name">{{ preset.name }}</h2>
          <p class="material-desc">{{ preset.description }}</p>
          <dl class="material-values">
            <div>
              <dt>金属度</dt>
              <dd>{{ preset.metalness }}</dd>
            </div>
            <div>
              <dt>粗糙度</dt>
              <dd>{{ preset.roughness }}</dd>
            </div>
            <div>
              <dt>颜色</dt>
              <dd class="material-hex">{{ toHexColorString(preset.color) }}</dd>
            </div>
          </dl>
        </div>
        <button type="button" class="material-apply" @click="applyInEditor(preset)">
          在编辑器中应用
        </button>
      </li>
    </ul>

    <p class="materials-note">
      预设只改表面的颜色与反射感，不改物理属性；到了编辑器还要选中一个物体，再点「应用到选中物体」。
    </p>
  </div>
</template>

<script lang="ts" setup name="MaterialsPanel">
import { useRouter } from 'vue-router'
import PageHeader from '@/components/common/PageHeader.vue'
import { MATERIAL_PRESETS, toHexColorString, type MaterialPreset } from '@/data/materialPresets'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'

const presets = MATERIAL_PRESETS
const router = useRouter()
const store = useSceneEditorStore()

/**
 * 记住要应用的材质（store 同步写 sessionStorage 兜底），再跳到场景编辑器。
 * 编辑器里的属性面板会显示「已载入材质」横幅，等用户选中物体后一键套用。
 */
const applyInEditor = (preset: MaterialPreset) => {
  store.setPendingMaterialId(preset.id)
  Promise.resolve(router.push('/scene-editor')).catch(() => {})
}
</script>

<style scoped>
.materials-panel {
  width: 100%;
  min-width: 0;
}

.material-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--grid-min), 1fr));
  gap: var(--grid-gap);
  margin: 0;
  padding: 0;
  list-style: none;
}

.material-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 16px;
  background-color: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.material-swatch {
  height: 76px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
}

.material-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.material-name {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-1);
  line-height: 1.35;
}

.material-desc {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--text-2);
}

.material-values {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-3);
  font-family: var(--font-mono);
}

.material-values div {
  display: flex;
  gap: 4px;
}

.material-values dt {
  margin: 0;
}

.material-values dd {
  margin: 0;
  color: var(--text-2);
}

.material-apply {
  align-self: flex-start;
  margin-top: auto;
  padding: 7px 14px;
  font-size: var(--text-sm);
  color: var(--accent);
  background-color: transparent;
  border: 1px solid rgba(var(--accent-rgb), 0.5);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.material-apply:hover {
  background-color: var(--accent-soft);
  border-color: rgba(var(--accent-rgb), 0.7);
}

.materials-note {
  margin: 18px 0 0;
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--text-3);
}
</style>
