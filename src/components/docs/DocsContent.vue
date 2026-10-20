<template>
  <div class="docs-content p-6 max-w-4xl mx-auto">
    <div v-if="loading" class="flex justify-center items-center h-64">
      <div class="loading-spinner"></div>
    </div>

    <div v-else-if="error" class="bg-red-50 border border-red-200 text-red-700 p-4 rounded-md">
      <p>⚠️ 无法加载文档内容: {{ error }}</p>
    </div>

    <div v-else class="prose dark:prose-invert max-w-none">
      <div v-html="renderedContent"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { renderMarkdown } from '@/utils/markdownRenderer'
import { docFiles, resolveDocPath } from '@/utils/docSections'

const props = defineProps<{
  section: string
}>()

const loading = ref(true)
const error = ref<string | null>(null)
const renderedContent = ref('')

const loadDocument = async (section: string) => {
  loading.value = true
  error.value = null
  renderedContent.value = ''

  // 章节必须是白名单内的文档路径，否则一律视为未知章节
  const key = resolveDocPath(section)
  if (!key) {
    error.value = `未知文档章节：${section}`
    loading.value = false
    return
  }

  try {
    const markdownContent = docFiles[key]
    if (!markdownContent || markdownContent.trim() === '') {
      error.value = `该章节尚未编写内容：${section}`
      loading.value = false
      return
    }
    renderedContent.value = await renderMarkdown(markdownContent)
  } catch (err) {
    console.error('[DocsContent] 文档渲染失败', err)
    error.value = `文档渲染失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadDocument(props.section)
})

watch(
  () => props.section,
  (newSection) => {
    loadDocument(newSection)
  },
)
</script>

<style scoped>
.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-left-color: #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
