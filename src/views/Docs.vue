<template>
  <div class="docs-page flex h-screen overflow-hidden">
    <!-- 侧边栏导航 -->
    <DocsSidebar
      :current-section="currentSection"
      @change-section="handleSectionChange"
    />

    <!-- 主内容区 -->
    <div class="flex-1 overflow-y-auto bg-white dark:bg-gray-800">
      <!--
        标题只有一处：Markdown 自带的 H1。
        曾经这里还挂过一个同名的粘性标题，于是每篇都显示两遍标题。
      -->
      <DocsContent :section="currentSection" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DocsSidebar from '@/components/docs/DocsSidebar.vue';
import DocsContent from '@/components/docs/DocsContent.vue';

const route = useRoute();
const router = useRouter();

// 获取当前文档章节，默认为介绍页
const currentSection = ref(route.query.section as string || 'guide/overview');

// 处理章节变更
const handleSectionChange = (section: string) => {
  currentSection.value = section;
  // 更新URL参数，保持导航状态
  router.push({
    path: '/docs',
    query: { ...route.query, section }
  });
};
</script>

<style scoped>
.docs-page {
  display: flex;
  height: 100vh;
}
</style>
