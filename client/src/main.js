import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import './appearance.js';
import { initMobileViewport } from './mobile-viewport.js';

initMobileViewport();
createApp(App).mount('#app');
