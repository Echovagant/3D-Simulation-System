<template>
  <!-- 优化SVG以适应任何高度，增强动态效果 -->
  <svg class="svg-bg fixed inset-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice">
    <!-- 主背景路径 - 更流畅的动画 -->
    <path
      fill="url(#yellowBlackGradient)"
      fill-opacity="0.9"
      d="M0,320L48,320C96,320,192,320,288,309.3C384,299,480,277,576,250.7C672,224,768,192,864,181.3C960,171,1056,181,1152,197.3C1248,213,1344,235,1392,245.3L1440,256L1440,1000L1392,1000C1344,1000,1248,1000,1152,1000C1056,1000,960,1000,864,1000C768,1000,672,1000,576,1000C480,1000,384,1000,288,1000C192,1000,96,1000,48,1000L0,1000Z"
    >
      <animate
        attributeName="d"
        values="
          M0,320L48,320C96,320,192,320,288,309.3C384,299,480,277,576,250.7C672,224,768,192,864,181.3C960,171,1056,181,1152,197.3C1248,213,1344,235,1392,245.3L1440,256L1440,1000L1392,1000C1344,1000,1248,1000,1152,1000C1056,1000,960,1000,864,1000C768,1000,672,1000,576,1000C480,1000,384,1000,288,1000C192,1000,96,1000,48,1000L0,1000Z;
          M0,288L48,304C96,320,192,352,288,341.3C384,331,480,277,576,250.7C672,224,768,224,864,240C960,256,1056,288,1152,282.7C1248,277,1344,235,1392,213.3L1440,192L1440,1000L1392,1000C1344,1000,1248,1000,1152,1000C1056,1000,960,1000,864,1000C768,1000,672,1000,576,1000C480,1000,384,1000,288,1000C192,1000,96,1000,48,1000L0,1000Z;
          M0,320L48,320C96,320,192,320,288,309.3C384,299,480,277,576,250.7C672,224,768,192,864,181.3C960,171,1056,181,1152,197.3C1248,213,1344,235,1392,245.3L1440,256L1440,1000L1392,1000C1344,1000,1248,1000,1152,1000C1056,1000,960,1000,864,1000C768,1000,672,1000,576,1000C480,1000,384,1000,288,1000C192,1000,96,1000,48,1000L0,1000Z
        "
        dur="20s"
        repeatCount="indefinite"
      />
    </path>

    <!-- 动态装饰元素 - 增加更多层次和深度 -->
    <circle cx="200" cy="150" r="10" fill="#FFD700" opacity="0.8">
      <animate attributeName="cy" values="150;170;150" dur="4s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.6;0.9;0.6" dur="6s" repeatCount="indefinite" />
    </circle>
    <circle cx="400" cy="200" r="8" fill="#000000" opacity="0.7">
      <animate attributeName="cy" values="200;220;200" dur="6s" repeatCount="indefinite" />
    </circle>
    <circle cx="1000" cy="100" r="12" fill="#FFD700" opacity="0.9">
      <animate attributeName="cy" values="100;130;100" dur="5s" repeatCount="indefinite" />
      <animate attributeName="r" values="12;14;12" dur="8s" repeatCount="indefinite" />
    </circle>
    <circle cx="1200" cy="300" r="6" fill="#000000" opacity="0.6">
      <animate attributeName="cy" values="300;320;300" dur="7s" repeatCount="indefinite" />
    </circle>

    <!-- 新增装饰元素，增强视觉深度 -->
    <circle cx="700" cy="400" r="5" fill="#FFD700" opacity="0.5">
      <animate attributeName="cx" values="700;730;700" dur="10s" repeatCount="indefinite" />
    </circle>
    <circle cx="300" cy="600" r="7" fill="#FFD700" opacity="0.6">
      <animate attributeName="cx" values="300;280;300" dur="8s" repeatCount="indefinite" />
    </circle>

    <!-- 优化渐变效果 -->
    <defs>
      <linearGradient id="yellowBlackGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#111111" stop-opacity="0.95" />
        <stop offset="40%" stop-color="#222222" stop-opacity="0.9" />
        <stop offset="50%" stop-color="#FFD700" stop-opacity="0.15" />
        <stop offset="60%" stop-color="#222222" stop-opacity="0.9" />
        <stop offset="100%" stop-color="#111111" stop-opacity="0.95" />
      </linearGradient>

      <!-- 添加径向渐变作为点缀 -->
      <radialGradient id="yellowSpot" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
        <stop offset="0%" stop-color="#FFD700" stop-opacity="0.3" />
        <stop offset="100%" stop-color="#FFD700" stop-opacity="0" />
      </radialGradient>

      <!-- 点缀光斑 -->
      <circle cx="800" cy="200" r="200" fill="url(#yellowSpot)">
        <animate attributeName="opacity" values="0.3;0.5;0.3" dur="15s" repeatCount="indefinite" />
      </circle>
    </defs>
  </svg>
</template>

<style scoped>
.svg-bg {
  /* 关键：固定定位并覆盖整个视口 */
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: -1; /* 确保在所有内容下方 */

  /* 轻微模糊增加深度感 */
  filter: blur(0.5px);
}

/* 确保在移动设备上也能正确显示 */
@media (max-width: 768px) {
  .svg-bg {
    filter: blur(0.3px);
  }
}
</style>
