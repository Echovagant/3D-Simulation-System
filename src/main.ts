import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";

import { createPinia } from "pinia";

import { installTelemetryReporter } from "@/services/api/telemetry";

// 图标走 Font Awesome 的 webfont 通道：fontawesome.css 提供基类/动画/图标映射，
// solid.css 只补 solid 字重的 @font-face。不用 all.min.css——它还会把
// regular / brands / v4compatibility 三套用不到的字体文件带进构建产物。
import '@fortawesome/fontawesome-free/css/fontawesome.min.css'
import '@fortawesome/fontawesome-free/css/solid.min.css'
// 设计令牌必须最先加载：后面的 kit / 页面样式全部引用它定义的 --bg-* / --text-* 变量
import './assets/styles/tokens.css'
import './assets/styles/global.css'
import './assets/styles/ai-panel-kit.css'
// 工具层（仿真实验室右栏面板）。深色统一后与 ai-* 用同一套令牌，只是类名前缀不同
import './assets/styles/simulation-panel-kit.css'

// DevTools 悬浮按钮的观感：默认几乎看不见，鼠标移上去才显形。
// 只在开发模式引入——生产构建里根本没有这个元素（见 devtools-anchor.css）。
if (import.meta.env.DEV) {
  import('./assets/styles/devtools-anchor.css')
}

// 全局错误捕获：未捕获异常与未处理的 Promise 拒绝都会上报。
// 装一次就够——应用的生命周期就是页面的生命周期，不要在路由守卫里反复装。
installTelemetryReporter();

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.use(router);

app.mount("#app");

export { app };
