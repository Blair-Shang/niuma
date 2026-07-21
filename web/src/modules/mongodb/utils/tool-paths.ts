import { componentsApi } from '@/api/components'

/** MongoDB 工具组件包 ID（与 components/mongodb-tools/manifest.yaml 一致）。 */
export const MONGODB_TOOLS_BUNDLE_ID = 'com.niuma.components.mongodb-tools'

function pathsFromBundle(bundle: { tools: { toolId: string; path?: string }[] }): Record<string, string> {
  const paths: Record<string, string> = {}
  for (const tool of bundle.tools) {
    if (tool.path) {
      paths[tool.toolId] = tool.path
    }
  }
  return paths
}

/** 从设置页组件注册表加载有效工具路径，供 mongodb.shell/tools 请求附带。 */
export async function loadMongoToolPaths(): Promise<Record<string, string>> {
  try {
    const result = await componentsApi.detect({ bundleId: MONGODB_TOOLS_BUNDLE_ID })
    return pathsFromBundle(result.bundle)
  } catch {
    try {
      const result = await componentsApi.list({ bundleId: MONGODB_TOOLS_BUNDLE_ID })
      const bundle = result.bundles[0]
      return bundle ? pathsFromBundle(bundle) : {}
    } catch {
      return {}
    }
  }
}
