import { componentsApi } from '@/api/components'

/** Vastbase 官方客户端工具组件包 ID。 */
export const VASTBASE_TOOLS_BUNDLE_ID = 'com.niuma.components.vastbase-tools'

/** @deprecated 使用 VASTBASE_TOOLS_BUNDLE_ID；保留别名以免外部引用断裂 */
export const POSTGRESQL_CLIENT_BUNDLE_ID = VASTBASE_TOOLS_BUNDLE_ID

function pathsFromBundle(bundle: { tools: { toolId: string; path?: string }[] }): Record<string, string> {
  const paths: Record<string, string> = {}
  for (const tool of bundle.tools) {
    if (tool.path) {
      paths[tool.toolId] = tool.path
    }
  }
  return paths
}

/** 从设置页组件注册表加载 vb_dump / vb_restore / vsql 路径。 */
export async function loadVastToolPaths(): Promise<Record<string, string>> {
  try {
    const result = await componentsApi.detect({ bundleId: VASTBASE_TOOLS_BUNDLE_ID })
    return pathsFromBundle(result.bundle)
  } catch {
    try {
      const result = await componentsApi.list({ bundleId: VASTBASE_TOOLS_BUNDLE_ID })
      const bundle = result.bundles[0]
      return bundle ? pathsFromBundle(bundle) : {}
    } catch {
      return {}
    }
  }
}
