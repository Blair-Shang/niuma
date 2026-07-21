import type { ToolComponentBundle } from '@/api/types/components'
import type { ComponentBundleHandler } from './types'

function bundleSlug(bundleId: string): string {
  const parts = bundleId.split('.')
  return parts[parts.length - 1] ?? bundleId
}

function bundleLocaleKey(bundleId: string): string {
  return bundleId.replaceAll('.', '_')
}

function defaultIcon(module?: string): string {
  switch (module) {
    case 'mongodb':
      return 'database'
    case 'vastbase':
      return 'vastbase'
    case 'redis':
      return 'hard-drive'
    default:
      return 'wrench'
  }
}

/** 未注册包时的回退处理器 */
export function createDefaultHandler(bundle: ToolComponentBundle): ComponentBundleHandler {
  return {
    slug: bundleSlug(bundle.bundleId),
    bundleId: bundle.bundleId,
    icon: defaultIcon(bundle.module),
    localeKey: bundleLocaleKey(bundle.bundleId),
    browseAccept: ['.exe', '.cmd', '.bat', ''],
  }
}
