<template>
  <div class="welcome-container">
    <div class="content-wrapper">
      <div class="title-container">
        <h1>{{ typedText }}</h1>
        <div class="subtitle">
          <p>沉浸式体验 · 精准模拟 · 直观展示</p>
          <p>探索更多可能性，开启您的仿真之旅</p>
        </div>
      </div>
      <button @click="goToOverview" class="start-button">
        <i class="fa fa-play-circle mr-2"></i>开始体验
      </button>
      <div class="footer-text">
        <p>© 2025 仿真系统 | 为您提供专业的模拟体验</p>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Welcome',
  data() {
    return {
      text: '欢迎体验仿真系统',
      typedText: '',
      index: 0,
      typingSpeed: 150, // 打字速度，毫秒
      deletingSpeed: 75, // 删除速度，毫秒
      pauseDuration: 2000, // 完成一次后的停顿时间，毫秒
      isDeleting: false // 是否处于删除状态
    }
  },
  mounted() {
    this.startTyping();
  },
  methods: {
    startTyping() {
      const { text, index, isDeleting } = this;

      // 控制打字和删除状态
      if (isDeleting) {
        // 删除文字
        this.typedText = text.substring(0, index - 1);
        this.index = index - 1;
      } else {
        // 输入文字
        this.typedText = text.substring(0, index + 1);
        this.index = index + 1;
      }

      // 计算下一次执行的延迟时间
      let timeout = isDeleting ? this.deletingSpeed : this.typingSpeed;

      // 如果打字完成，切换到删除状态
      if (!isDeleting && index === text.length - 1) {
        timeout = this.pauseDuration;
        this.isDeleting = true;
      }
      // 如果删除完成，切换到打字状态
      else if (isDeleting && index === 0) {
        timeout = this.pauseDuration;
        this.isDeleting = false;
      }

      // 递归调用，实现循环效果
      setTimeout(this.startTyping, timeout);
    },
    goToOverview() {
      // 导航到Overview页面
      this.$router.push('/overview');
    }
  }
}
</script>

<style scoped>
.welcome-container {
  /* 透明背景 */
  background-color: transparent;
  /* 让内容居中显示 */
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100vw;
  padding: 20px;
  box-sizing: border-box;
}

.content-wrapper {
  text-align: center;
  padding: 30px;
  border-radius: 10px;
  background-color: transparent;
  max-width: 800px;
}

.title-container {
  margin-bottom: 40px;
}

h1 {
  font-size: 3rem;
  color: #fff;
  margin-bottom: 20px;
  min-height: 4rem; /* 防止文字变化时布局跳动 */
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.subtitle {
  color: #f0f0f0;
  font-size: 1.1rem;
  line-height: 1.8;
  margin-bottom: 10px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.start-button {
  padding: 14px 36px;
  font-size: 1.3rem;
  background-color: transparent;
  color: white;
  border: none;
  border-radius: 50px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.start-button:hover {
  background-color: rgba(66, 185, 131, 0.9);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}

.footer-text {
  margin-top: 60px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.9rem;
}

/* 打字光标效果 */
h1::after {
  content: "|";
  animation: blink 1s step-end infinite;
  color: #fff;
}

@keyframes blink {
  from, to { opacity: 1; }
  50% { opacity: 0; }
}

/* 响应式调整 */
@media (max-width: 768px) {
  h1 {
    font-size: 2.2rem;
    min-height: 3rem;
  }

  .subtitle {
    font-size: 1rem;
  }

  .start-button {
    font-size: 1.1rem;
    padding: 12px 30px;
  }
}

@media (max-width: 480px) {
  h1 {
    font-size: 1.8rem;
  }

  .content-wrapper {
    padding: 15px;
  }
}
</style>
