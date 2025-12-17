// src/types/tsparticles-vue3.d.ts
declare module '@tsparticles/vue3' {
  import { DefineComponent } from 'vue'
  // 声明组件类型
  const VueParticles: DefineComponent<{
    options: object
    init: (engine: any) => Promise<void>
  }>
  export default VueParticles
}

// 解决可能残留的旧包类型报错（如果还有）
declare module 'particles.vue3' {
  import { DefineComponent } from 'vue'
  const Particles: DefineComponent
  export default Particles
}
