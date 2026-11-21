<template>
  <div class="welcome-container">
    <div class="content-wrapper">
      <div class="title-container">
        <h1>{{ typedText }}</h1>
        <div class="subtitle">
          <p>场景编辑 · 刚体仿真 · 智能体演武，全部跑在同一套物理引擎上</p>
        </div>
      </div>

      <!-- 双入口：总览是主门，演武场给想直接上手的人 -->
      <div class="cta-row">
        <button @click="goToOverview" class="start-button">
          <i class="fa-solid fa-play"></i> 进入总览
        </button>
        <button @click="goToArena" class="ghost-button">
          <i class="fa-solid fa-robot"></i> 直接开演武场
        </button>
      </div>

      <!-- 产品支撑条：一句话说清这套工具有什么，替代纯口号 -->
      <ul class="support-strip">
        <li><i class="fa-solid fa-cubes" aria-hidden="true"></i>场景编辑</li>
        <li><i class="fa-solid fa-atom" aria-hidden="true"></i>刚体仿真</li>
        <li><i class="fa-solid fa-robot" aria-hidden="true"></i>智能体演武</li>
        <li><i class="fa-solid fa-video" aria-hidden="true"></i>服务端渲染</li>
      </ul>

      <div class="footer-text">
        <p>© 2026 仿真系统</p>
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
      typingSpeed: 130,
      timer: null
    }
  },
  mounted() {
    this.startTyping();
  },
  beforeUnmount() {
    // 打字是单次的：打完就停。定时器句柄存下来，卸载时清干净——
    // 旧版递归循环不清（还打完又删光重来），这里一并修掉。
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },
  methods: {
    // 打字机效果：逐字打出，打完停格，不循环删除
    startTyping() {
      this.typedText = this.text.substring(0, this.index + 1);
      this.index += 1;
      if (this.index >= this.text.length) return;
      this.timer = setTimeout(this.startTyping, this.typingSpeed);
    },
    goToOverview() {
      this.$router.push('/overview');
    },
    goToArena() {
      this.$router.push('/ai-playground');
    }
  }
}
</script>

<style scoped>
.welcome-container {
  /* 宽度用 100%（容器已在导航轨内），不用 100vw——100vw 含滚动条与轨宽会横向溢出 */
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: calc(100vh - 60px);
  width: 100%;
  padding: 20px;
  box-sizing: border-box;
}

.content-wrapper {
  text-align: center;
  padding: 30px;
  max-width: 760px;
}

.title-container {
  margin-bottom: 36px;
}

h1 {
  font-size: 3rem;
  color: var(--text-1);
  margin-bottom: 16px;
  min-height: 4rem; /* 防止文字打出时布局跳动 */
}

.subtitle {
  color: var(--text-2);
  font-size: 1.05rem;
  line-height: 1.8;
}

.cta-row {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 44px;
}

.start-button {
  padding: 13px 30px;
  font-size: 1.05rem;
  background-color: var(--accent-strong);
  color: var(--accent-on);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color 0.25s ease, transform 0.25s ease;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.start-button:hover {
  background-color: var(--accent-strong-hover);
  transform: translateY(-2px);
}

.start-button:focus-visible,
.ghost-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.ghost-button {
  padding: 13px 26px;
  font-size: 1.05rem;
  background-color: transparent;
  color: var(--text-1);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color 0.25s ease, border-color 0.25s ease;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ghost-button:hover {
  background-color: var(--bg-hover);
  border-color: var(--accent);
  color: var(--accent);
}

/* 产品支撑条：四条一排，分隔竖线，克制不抢戏 */
.support-strip {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 0;
  margin-bottom: 60px;
  padding: 0;
}

.support-strip li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  font-size: var(--text-sm);
  color: var(--text-2);
  border-right: 1px solid var(--border-subtle);
}

.support-strip li:last-child {
  border-right: none;
}

.support-strip li i {
  color: var(--accent);
  font-size: 0.9rem;
}

.footer-text {
  margin-top: 40px;
  color: var(--text-3);
  font-size: 0.9rem;
}

/* 打字光标效果 */
h1::after {
  content: "|";
  animation: blink 1s step-end infinite;
  color: var(--accent);
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

  .cta-row {
    flex-direction: column;
  }
}

@media (max-width: 480px) {
  h1 {
    font-size: 1.8rem;
  }

  .content-wrapper {
    padding: 15px;
  }

  .support-strip {
    flex-direction: column;
    gap: 8px;
  }

  .support-strip li {
    border-right: none;
  }
}
</style>
