/** @deprecated 使用 `@/api/types` 的 `PluginRecord` */
export type { PluginRecord as LocalPluginRecord } from '@/api/types/plugin'

/** @deprecated 使用 `@/api/types` 的 `PluginListResult` */
export type { PluginListResult as LocalPluginListResponse } from '@/api/types/plugin'

/**
 * 解析插件静态资源 URL（开发 Vite `/plugins` 或 CEF `app://niuma/plugins`）。
 *
 * @param pluginRoot - 相对 plugins/ 的路径
 * @param relativePath - manifest.module.uiEntry 等相对路径
 * @returns 可用于 dynamic import 的 URL
 */
export function resolvePluginAssetUrl(pluginRoot: string, relativePath: string): string {
  const normalized = `${pluginRoot}/${relativePath}`.replace(/\\/g, '/').replace(/\/+/g, '/')
  // DEV 优先：dev:hot 模式下 CEF 加载 Vite URL（http://localhost:5173），
  // cefQuery 存在但跨 origin import app:// 会被 CORS 拦截，须走 Vite 代理路径。
  if (import.meta.env.DEV) {
    return `/plugins/${normalized}`
  }
  if (globalThis.cefQuery) {
    return `app://niuma/plugins/${normalized}`
  }
  return `app://niuma/plugins/${normalized}`
}
