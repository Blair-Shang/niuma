import { createRouter, createWebHashHistory } from 'vue-router'
import { createModuleRoutes } from '@/extensions/registry/extension-registry'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/file-workbench',
      name: 'file-workbench',
      component: () => import('@/modules/file-editor/views/FileWorkbenchView.vue'),
    },
    {
      path: '/',
      name: 'shell',
      component: () => import('@/shell/AppShell.vue'),
      children: [
        { path: '', name: 'shell-index', redirect: '/ssh' },
        ...createModuleRoutes(),
      ],
    },
  ],
})
