import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { library } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { faRobot } from "@fortawesome/free-solid-svg-icons";

import { createPinia } from "pinia";

import { installTelemetryReporter } from "@/services/api/telemetry";

import '@fortawesome/fontawesome-free/css/all.min.css'
import './assets/styles/global.css'
import './assets/styles/ai-panel-kit.css'
// 浅色页面的工具层（仿真实验室右栏）：白底 + 靛紫，与 ai-* 那套深色 HUD 分开
import './assets/styles/simulation-panel-kit.css'

// 全局错误捕获：未捕获异常与未处理的 Promise 拒绝都会上报。
// 装一次就够——应用的生命周期就是页面的生命周期，不要在路由守卫里反复装。
installTelemetryReporter();

const pinia = createPinia();
const app = createApp(App);

library.add(faRobot);
app.component("font-awesome-icon", FontAwesomeIcon);

app.use(pinia);
app.use(router);

app.mount("#app");

export { app };
