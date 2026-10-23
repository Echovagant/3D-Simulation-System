<template>
  <span class="info-tip" ref="root">
    <button
      type="button"
      class="info-tip__trigger"
      :aria-label="label"
      :aria-expanded="visible"
      aria-haspopup="true"
      @click="toggle"
      @mouseenter="show"
      @mouseleave="hide"
      @focus="show"
      @blur="hide"
      @keydown.esc="hide"
    >
      ?
    </button>
    <span v-if="visible" class="info-tip__bubble" role="tooltip">{{ text }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * 轻量说明提示。
 *
 * 用在**界面就地**：那些用户点不出来、又绕不过去的限制
 * （「这个预设其实只是自由落体」「上传的模型刷新就没」），挂在对应控件旁，
 * 撞上问题时正好在那个位置——比让人去翻文档有用得多。
 *
 * 悬停展开、点击切换（触屏与键盘可用），Esc 或点外部收起。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 提示正文 */
    text: string
    /** 无障碍名称：说明这个提示是关于什么的 */
    label?: string
  }>(),
  { label: '说明' },
)

const visible = ref(false)
const root = ref<HTMLElement | null>(null)

const show = (): void => {
  visible.value = true
}
const hide = (): void => {
  visible.value = false
}
const toggle = (): void => {
  visible.value = !visible.value
}

const onPointerDown = (event: MouseEvent): void => {
  if (!root.value) return
  if (!root.value.contains(event.target as Node)) hide()
}

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') hide()
}

onMounted(() => {
  document.addEventListener('mousedown', onPointerDown)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.info-tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}

.info-tip__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  margin-left: 5px;
  padding: 0;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  color: #6e5af0;
  background: transparent;
  border: 1px solid rgba(110, 90, 240, 0.45);
  border-radius: 50%;
  cursor: help;
  transition: background-color 0.15s ease;
}

.info-tip__trigger:hover,
.info-tip__trigger:focus-visible {
  background: rgba(110, 90, 240, 0.12);
  outline: none;
}

.info-tip__bubble {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  width: max-content;
  max-width: 260px;
  padding: 8px 10px;
  font-size: 0.75rem;
  line-height: 1.55;
  color: #333333;
  background: #ffffff;
  border: 1px solid rgba(110, 90, 240, 0.28);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
  text-align: left;
  white-space: normal;
}
</style>
