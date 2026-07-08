import type { ExtensionActivateFn } from '@/extensions/api'
import { createExtensionActivateContext } from '@/extensions/api/create-extension-context'
import { resolvePluginAssetUrl } from '@/extensions/types/local-plugin'
import type { ExtensionManifest } from '@/extensions/types/manifest'

/** 已激活插件 id，避免重复 import */
const activatedIds = new Set<string>()

/**
 * 动态 import 插件 entry 并调用 activate（注册命令 handler 等）。
 *
 * @param pluginRoot - 相对 plugins/ 的路径
 * @param manifest - 插件 manifest
 */
export async function activatePluginEntry(
  pluginRoot: string,
  manifest: ExtensionManifest,
): Promise<void> {
  const uiEntry = manifest.module?.uiEntry
  if (!uiEntry || activatedIds.has(manifest.id)) {
    return
  }

  const url = resolvePluginAssetUrl(pluginRoot, uiEntry)
  const mod = (await import(/* @vite-ignore */ url)) as { activate?: ExtensionActivateFn }

  if (typeof mod.activate !== 'function') {
    activatedIds.add(manifest.id)
    return
  }

  const context = createExtensionActivateContext(manifest.id)
  await mod.activate(context)
  activatedIds.add(manifest.id)
}

/**
 * 重置激活缓存（测试或页面 reload 前无需调用）。
 */
export function resetPluginActivationCache(): void {
  activatedIds.clear()
}
