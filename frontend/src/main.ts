import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index';
import { vuetify } from './plugins/vuetify';
import './assets/main.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(vuetify);

// Wait for the initial navigation before mounting. Otherwise App.vue briefly
// renders DefaultLayout for /login or /setup, which fires authenticated API
// requests and can trigger a hard-reload loop on 401 responses.
router.isReady().then(() => {
  app.mount('#app');
});
