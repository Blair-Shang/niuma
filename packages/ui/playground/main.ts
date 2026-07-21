import { setupMonacoWorkers } from '@niuma/ui'
setupMonacoWorkers()

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import '@ruoshui/ui/styles.css'
import './style.css'
import './theme-brand.css'

createApp(App).use(router).mount('#app')
