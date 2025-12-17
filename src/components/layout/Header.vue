<template>
  <div></div>
</template>

<script lang="ts" setup>
// 使用defineOptions定义组件名称，这是Vue 3.3+推荐的方式
defineOptions({
  // eslint-disable-next-line vue/no-reserved-component-names
  name: 'Header'
});

// 可添加头部逻辑（如用户信息、项目名称等）
</script>

<style>
.title {
  text-align: center;
  word-spacing: 5px;
  margin: 30px 0;
  height: 70px;
  line-height: 70px;
  background-image: linear-gradient(45deg, gray, white);
  border-radius: 10px;
  box-shadow: 0 0 2px;
  font-size: 30px;
}
</style>
