<template>
  <div class="not-found-container">
    <div class="error-content">
      <h1 class="error-code">404</h1>
      <p class="error-message">页面未找到</p>
      <p class="error-description">
        抱歉，您访问的页面不存在或已被移动
      </p>
      <RouterLink to="/" class="back-home-btn">
        返回首页
      </RouterLink>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { RouterLink } from 'vue-router'
</script>

<style scoped>
.not-found-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background-color: transparent;
  padding: 20px;
}

.error-content {
  text-align: center;
  max-width: 500px;
  width: 100%;
  padding: 40px 20px;
  background-color: rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
}

.error-code {
  font-size: 8rem;
  font-weight: 700;
  margin: 0 0 20px;
  background: linear-gradient(135deg, #3498db, #9b59b6);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  line-height: 1;
}

.error-message {
  font-size: 1.5rem;
  font-weight: 500;
  color: #333;
  margin: 0 0 10px;
}

.error-description {
  color: #666;
  margin: 0 0 30px;
  font-size: 1rem;
  line-height: 1.5;
}

.back-home-btn {
  display: inline-block;
  padding: 12px 24px;
  background-color: #3498db;
  color: white;
  text-decoration: none;
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.3s ease;
}

.back-home-btn:hover {
  background-color: #2980b9;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
}
</style>
