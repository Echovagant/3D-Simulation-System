import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { library } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { faRobot } from "@fortawesome/free-solid-svg-icons";

import { createPinia } from "pinia";

import '@fortawesome/fontawesome-free/css/all.min.css'
import './assets/styles/global.css'
import './assets/styles/ai-panel-kit.css'

const pinia = createPinia();
const app = createApp(App);

library.add(faRobot);
app.component("font-awesome-icon", FontAwesomeIcon);

app.use(pinia);
app.use(router);

app.mount("#app");

export { app };
