declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  // 使用object代替{}以满足ESLint规则，保留any以兼容所有组件类型
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<object, object, any>;
  export default component;
}

