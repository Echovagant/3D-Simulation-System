<template>
  <div id="particles-background">
    <VueParticles
      ref="particles"
      :options="currentParticlesOptions"
      :init="particlesInit"
    />
  </div>
</template>

<script>
import VueParticles from "@tsparticles/vue3";
import { loadFull } from "tsparticles";


export default {
  name: "DynamicParticlesBackground",
  components: { VueParticles },
  data() {
    return {
      // 一定要返回真实配置，不能被注释或占位符替代
      baseConfig: {
        opacity: { min: 0.3, max: 0.8 },
        size: { min: 1, max: 5 },
        color: "#3B82F6",
        shape: "circle",
        connect: true,
        particles: 120,
        speed: 3
      },
      pageConfigs: {
        overview: {
          color: "#3B82F6",
          shape: "circle",
          connect: true,
          particles: 120,
          speed: 3
          // opacity / size 可以省略，深合并会 fallback 到 baseConfig
        },
        "scene-editor": {
          color: "#10B981",
          shape: "polygon",
          connect: false,
          particles: 80,
          speed: 2,
          opacity: { min: 0.2, max: 0.7 },
          size: { min: 2, max: 6 }
        },
        "simulation-lab": {
          color: "#EF4444",
          shape: "star",
          connect: true,
          particles: 150,
          speed: 4,
          opacity: { min: 0.4, max: 0.9 },
          size: { min: 1, max: 4 }
        },
        "model-library": {
          color: "#8B5CF6",
          shape: "square",
          connect: true,
          particles: 100,
          speed: 2.5,
          opacity: { min: 0.3, max: 0.6 },
          size: { min: 2, max: 5 }
        },
        "ai-arena": {
          color: "#F59E0B",
          shape: "triangle",
          connect: false,
          particles: 200,
          speed: 5,
          opacity: { min: 0.2, max: 0.5 },
          size: { min: 1, max: 3 }
        },
        documentation: {
          color: "#06B6D4",
          shape: "circle",
          connect: true,
          particles: 60,
          speed: 1.5,
          opacity: { min: 0.5, max: 0.9 },
          size: { min: 3, max: 7 }
        }
      }
    };
  },
  computed: {
    currentParticlesOptions() {
      const routeName = this.$route?.name || "overview";
      const pageCfg = this.pageConfigs[routeName] || {};

      // 深合并 nested fields (避免被浅合并覆盖)
      const config = {
        ...this.baseConfig,
        ...pageCfg,
        opacity: {
          ...this.baseConfig.opacity,
          ...(pageCfg.opacity || {})
        },
        size: {
          ...this.baseConfig.size,
          ...(pageCfg.size || {})
        }
      };

      // 最后做一次兜底（防止意外缺失）
      config.opacity = config.opacity || { min: 0.3, max: 0.8 };
      config.size = config.size || { min: 1, max: 5 };

      return {
        background: { color: { value: "transparent" } },
        fullScreen: { enable: true, zIndex: -1 },
        fpsLimit: 60,
        interactivity: {
          events: {
            onClick: { enable: true, mode: "push" },
            onHover: { enable: true, mode: "repulse" },
            resize: true
          },
          modes: {
            push: { quantity: 4 },
            repulse: { distance: 100, duration: 0.4 }
          }
        },
        particles: {
          color: { value: config.color },
          links: {
            color: config.color,
            distance: 150,
            enable: config.connect,
            opacity: 0.5,
            width: 1
          },
          move: {
            direction: "none",
            enable: true,
            outModes: { default: "bounce" },
            random: false,
            speed: config.speed,
            straight: false
          },
          number: {
            density: { enable: true, area: 800 },
            value: config.particles
          },
          opacity: {
            // 保持你原来的行为：以 min 为基础并允许随机
            value: config.opacity.min,
            random: true,
            min: config.opacity.min,
            max: config.opacity.max
          },
          size: {
            value: config.size.min,
            random: true,
            min: config.size.min,
            max: config.size.max
          },
          shape: { type: config.shape }
        },
        detectRetina: true
      };
    }
  },
  methods: {
    async particlesInit(engine) {
      // 使用主包的一次加载，避免单独包名错误
      await loadFull(engine);
    }
  },
  watch: {
    "$route.name"() {
      // 当路由名改变时刷新粒子（注意：确保 VueParticles 实例提供 refresh 方法）
      this.$refs.particles?.refresh?.();
    }
  }
};
</script>

<style scoped>
#particles-background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
