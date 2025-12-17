import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { library } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { faRobot } from "@fortawesome/free-solid-svg-icons";

import { createPinia } from "pinia";

import "./assets/styles/global.css";

// 👇 Particles 是组件，不是插件
import Particles from "@tsparticles/vue3";

const pinia = createPinia();
const app = createApp(App);

library.add(faRobot);
app.component("font-awesome-icon", FontAwesomeIcon);
app.component("Particles", Particles);

app.use(pinia);
app.use(router);

app.mount("#app");

export { app };
