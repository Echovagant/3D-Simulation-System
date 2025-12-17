<template>
  <div class="docs-page flex h-screen overflow-hidden">
    <!-- 侧边栏导航 -->
    <DocsSidebar
      :current-section="currentSection"
      @change-section="handleSectionChange"
    />

    <!-- 主内容区 -->
    <div class="flex-1 overflow-y-auto bg-white dark:bg-gray-800">
      <div class="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
          {{ getPageTitle }} <!-- 修复：移除函数调用括号 -->
        </h1>
      </div>

      <DocsContent :section="currentSection" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DocsSidebar from '@/components/docs/DocsSidebar.vue';
import DocsContent from '@/components/docs/DocsContent.vue';

const route = useRoute();
const router = useRouter();

// 获取当前文档章节，默认为介绍页
const currentSection = ref(route.query.section as string || 'guide/introduction');

// 处理章节变更
const handleSectionChange = (section: string) => {
  currentSection.value = section;
  // 更新URL参数，保持导航状态
  router.push({
    path: '/docs',
    query: { ...route.query, section }
  });
};

// 根据当前章节获取页面标题
const getPageTitle = computed(() => {
  const titles: Record<string, string> = {
    'guide/introduction': '系统介绍',
    'guide/scene-editor': '场景编辑器使用指南',
    'guide/simulation-lab': '仿真实验室使用指南',
    'guide/model-library': '模型库使用指南',
    'guide/ai-playground': 'AI演武场使用指南',
    'api/three-integration': 'Three.js集成API',
    'api/physics-engine': '物理引擎API',
    'api/ai-api': 'AI接口API',
    'examples/basic-scene': '基础场景示例',
    'examples/physics-simulation': '物理仿真示例',
    'examples/ai-interaction': 'AI交互示例'
  };

  return titles[currentSection.value] || '系统文档';
});
</script>

<style scoped>
.docs-page {
  display: flex;
  height: 100vh;
}
</style>
