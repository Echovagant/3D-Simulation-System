<template>
  <div></div>
</template>

<script lang="ts" setup>
// 目前是个空占位：模板只渲染一个空 div，挂在 App 布局里 main 的顶部
// 占住位置，各页面的标题由页面自己出。以后要加全局头部
// （用户信息、项目名之类）就写在这个组件里。
// 使用defineOptions定义组件名称，这是Vue 3.3+推荐的方式
defineOptions({
  // eslint-disable-next-line vue/no-reserved-component-names
  name: 'Header'
});

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
