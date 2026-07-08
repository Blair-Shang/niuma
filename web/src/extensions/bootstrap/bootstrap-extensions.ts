import type { Router, RouteRecordRaw } from 'vue-router'
import { pluginApi } from '@/api'
import { activatePluginEntry } from '@/extensions/bootstrap/activate-plugin-entry'
import ExtensionModuleView from '@/extensions/host/ExtensionModuleView.vue'
import { registerCommandContributions } from '@/extensions/contributions/command-registry'
import {
  moduleDescriptorFromManifest,
  registerExtensionModule,
  routeNameFromModuleId,
} from '@/extensions/registry/extension-registry'
import type { ExtensionManifest } from '@/extensions/types/manifest'
import { useModuleStore } from '@/stores/module'

/**
 * 拉取已启用插件 manifest，注册路由、SideNav 与命令贡献点。
 *
 * @param router - 已创建的 Vue Router；父路由须具名 `shell`
 * @returns 成功注册的插件 id 列表
 */
export async function bootstrapExtensions(router: Router): Promise<string[]> {
  const registered: string[] = []

  let payload
  try {
    payload = await pluginApi.listEnabledForBootstrap()
  } catch {
    return registered
  }

  if (!payload?.plugins?.length) {
    return registered
  }

  const moduleStore = useModuleStore()

  for (const item of payload.plugins) {
    const manifest = normalizeManifest(item.manifest, item.root)
    const descriptor = moduleDescriptorFromManifest(manifest)
    if (!descriptor) {
      continue
    }

    registerExtensionModule(descriptor, item.root, manifest.module?.uiEntry)
    registerCommandContributions(manifest.id, manifest.contributions?.commands)
    registered.push(descriptor.id)

    const childRoute: RouteRecordRaw = {
      path: descriptor.routePath.replace(/^\//, ''),
      name: routeNameFromModuleId(descriptor.id),
      component: ExtensionModuleView,
      meta: {
        moduleId: descriptor.id,
        source: descriptor.source,
        pluginRoot: item.root,
        pluginUiEntry: manifest.module?.uiEntry,
      },
    }

    router.addRoute('shell', childRoute)

    try {
      await activatePluginEntry(item.root, manifest)
    } catch (e) {
      console.warn(`[bootstrap] activate failed for ${manifest.id}`, e)
    }
  }

  if (registered.length) {
    moduleStore.refreshNav()
  }

  return registered
}

/**
 * Bridge 可能返回已解析对象，统一为 ExtensionManifest。
 *
 * @param raw - manifest 字段原始值
 * @param root - 插件根路径，用于错误信息
 * @returns 规范化后的 manifest
 */
function normalizeManifest(
  raw: ExtensionManifest | string,
  root: string,
): ExtensionManifest {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as ExtensionManifest
    } catch {
      throw new Error(`Invalid manifest JSON for plugin root: ${root}`)
    }
  }
  return raw
}
