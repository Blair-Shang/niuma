import { setupMonacoWorkers } from '@niuma/ui'
// Monaco Worker 环境必须在任何编辑器实例创建前初始化
setupMonacoWorkers()

import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import '@niuma/ui/styles.css'
import '@/styles/tokens.css'
import '@/styles/brand.css'

import App from './App.vue'
import { bootstrapExtensions } from '@/extensions/bootstrap/bootstrap-extensions'
import { registerBuiltinFileProviders } from '@/modules/file-editor'
import { registerBuiltinCommands } from '@/extensions/contributions/builtin-commands'
import { registerBuiltinConnKindLoaders } from '@/modules/ops/register-builtin-conn-kinds'
import { getModuleById } from '@/extensions/registry/extension-registry'
import { useTabStore } from '@/stores/tab'
import { router } from './router'
import { i18n } from './locale'
import { isBridgeAvailable } from '@/api/client'
import { ensureBridgeEventBus } from '@/api/event-bus'
import { windowApi } from '@/api/window'
import { waitForPaint } from '@/utils/wait-for-paint'
import { dismissBootLoader } from '@/utils/dismiss-boot-loader'

/** 辅助 CEF 窗口（文件工作台）入口：跳过主工作台 hydrate / 插件预热 */
function isFileWorkbenchEntry(): boolean {
  return globalThis.location.hash.includes('/file-workbench')
}

if (import.meta.env.DEV) {
  globalThis.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    const g = globalThis as typeof globalThis & { __niumaVitePreloadReload?: boolean }
    if (g.__niumaVitePreloadReload) {
      // 依赖重优化连续失败时仍 reveal，避免 CEF 热重载后窗口一直 Conceal
      if (isBridgeAvailable()) {
        void windowApi.reveal()
      }
      return
    }
    g.__niumaVitePreloadReload = true
    globalThis.location.reload()
  })
}

/**
 * 预热各编辑组活跃 Tab 对应的模块 chunk。
 * 在 Vue 挂载前提前触发懒加载，使浏览器缓存模块文件；挂载后 defineAsyncComponent
 * 调用同一 loader 时命中缓存，消除首显时内容区短暂白屏（loading 占位可见时间趋近于零）。
 */
async function prewarmActiveModules(): Promise<void> {
  const tabStore = useTabStore()
  const moduleIds = new Set<string>()
  for (const group of tabStore.groups) {
    const activeTab = group.tabs.find((t) => t.tabId === group.activeTabId)
    if (activeTab?.moduleId) moduleIds.add(activeTab.moduleId)
  }
  await Promise.all(
    [...moduleIds].map(async (moduleId) => {
      const descriptor = getModuleById(moduleId)
      if (descriptor?.load && typeof descriptor.load === 'function') {
        await (descriptor.load as () => Promise<unknown>)().catch(() => {})
      }
    }),
  )
}

/**
 * 应用入口：在挂载 Vue 前完成 Pinia 激活与插件路由注册。
 *
 * 顺序不可颠倒：
 * 1. Pinia 须先于 bootstrap（bootstrap 内会调用 store / bridge）
 * 2. bootstrap 须先于 hydrate（恢复 Tab 时需按已注册模块过滤，插件模块须先就位）
 * 3. hydrate 须先于 prewarm（需已知活跃 Tab 的 moduleId）
 * 4. prewarm 须先于 mount（确保挂载时 chunk 已在浏览器缓存中）
 * 5. router.isReady → mount → nextTick → 双 rAF 后再 reveal（CEF 首显须等首帧已绘制）
 */
async function main() {
  // Dev 兜底：仅在 Vue 长时间未走到下方正式 reveal 时触发。
  // 须先 dismissBootLoader，且超时要长——短超时会关掉 Splash 后只剩主窗「加载中…」。
  if (import.meta.env.DEV && isBridgeAvailable() && !isFileWorkbenchEntry()) {
    globalThis.setTimeout(() => {
      dismissBootLoader()
      void windowApi.reveal()
    }, 20000)
  }

  const pinia = createPinia()
  // bootstrapExtensions 在组件外使用 useModuleStore()，须先激活 Pinia 实例
  setActivePinia(pinia)

  // 注册文件工作台内置 Provider（local / ftp）
  registerBuiltinFileProviders()

  // 登记内置连接协议懒加载入口（首次打开表单/展开树时再拉取各协议模块）
  registerBuiltinConnKindLoaders()

  const workbenchEntry = isFileWorkbenchEntry()

  // 辅助窗首进：尽早并行拉取工作台 chunk（与下方同步逻辑复用同一模块图）
  if (workbenchEntry) {
    void import('@/modules/file-editor/utils/prewarm-workbench')
      .then((m) => m.prewarmFileWorkbenchChunks())
      .catch(() => {})
  }

  if (!workbenchEntry) {
    // platform.plugin.list → 动态路由、SideNav、命令贡献点（依赖 cefQuery / Shell）
    await bootstrapExtensions(router)

    // 内置命令须在扩展模块注册之后登记，以便「打开模块」命令覆盖插件模块
    registerBuiltinCommands()

    // 从 Platform（SQLite）恢复工作区 Tab/分屏；桌面端 Platform 由壳层自动拉起
    await useTabStore().hydrate()

    // 预热已恢复的活跃 Tab 模块 chunk，挂载时直接命中缓存无需 loading 占位
    await prewarmActiveModules()
  }

  const app = createApp(App).use(pinia).use(router).use(i18n)
  await router.isReady()
  app.mount('#app')
  ensureBridgeEventBus()

  // CEF 首显：辅助窗 Shell 已在 index.html 起显；此处 mount 后淡出启动层并 Activate
  if (isBridgeAvailable()) {
    await nextTick()
    if (!workbenchEntry) {
      await waitForPaint()
    }
    dismissBootLoader()
    windowApi.reveal().catch(() => {})
    // 主窗口 reveal 后闲时预热，缩短用户首次打开文件工作台的 JS 加载
    if (!workbenchEntry) {
      void import('@/modules/file-editor/utils/prewarm-workbench')
        .then((m) => m.prewarmFileWorkbenchChunks())
        .catch(() => {})
    }
  }
}

// 满足 no-floating-promises；bootstrap 失败时仍由 unhandledrejection 暴露
void main()
