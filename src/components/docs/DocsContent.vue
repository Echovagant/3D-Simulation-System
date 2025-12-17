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
import { marked } from 'marked'
import { sanitizeHtml } from '@/utils/formatHelpers'

const props = defineProps<{
  section: string
}>()

const loading = ref(true)
const error = ref<string | null>(null)
const renderedContent = ref('')

const loadDocument = async (section: string) => {
  loading.value = true
  error.value = null

  try {
    // 修复：正确处理markdown导入，使用相对路径别名
    const response = await import(`@/docs/${section}.md`)
    const markdownContent: string = response.default

    // 转换Markdown为HTML并进行安全处理
    const htmlContent = await marked.parse(markdownContent)
    renderedContent.value = sanitizeHtml(htmlContent)
  } catch (err) {
    console.error('Failed to load document:', err)
    error.value = '请求的文档不存在或无法加载'
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
