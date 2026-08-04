import type { Composer } from 'vue-i18n'
import type { ToolComponentBundle, ToolComponentEntry, ToolComponentStatus } from '@/api/types/components'
import { resolveBundleHandler } from '../bundles'

export function bundleDisplayName(t: Composer['t'], te: Composer['te'], bundle: ToolComponentBundle): string {
  const handler = resolveBundleHandler(bundle)
  const key = `settings.componentBundles.${handler.localeKey}.name`
  return te(key) ? t(key) : bundle.name
}

export function toolDisplayName(
  t: Composer['t'],
  te: Composer['te'],
  bundle: ToolComponentBundle,
  tool: ToolComponentEntry,
): string {
  const handler = resolveBundleHandler(bundle)
  const key = `settings.componentBundles.${handler.localeKey}.tools.${tool.toolId}`
  return te(key) ? t(key) : tool.displayName
}

export function bundleIcon(bundle: ToolComponentBundle): string {
  return resolveBundleHandler(bundle).icon
}

export function browseAccept(bundle: ToolComponentBundle): string[] {
  return resolveBundleHandler(bundle).browseAccept
}

export function browseMode(bundle: ToolComponentBundle): 'file' | 'folder' {
  return resolveBundleHandler(bundle).browseMode === 'folder' ? 'folder' : 'file'
}

export function libraryNames(bundle: ToolComponentBundle): string[] {
  return resolveBundleHandler(bundle).libraryNames ?? []
}

/** 组件包说明（`settings.componentBundles.<localeKey>.tip`） */
export function bundleTip(t: Composer['t'], te: Composer['te'], bundle: ToolComponentBundle): string | null {
  const handler = resolveBundleHandler(bundle)
  const key = `settings.componentBundles.${handler.localeKey}.tip`
  return te(key) ? t(key) : null
}

/** 官方下载按钮旁说明（`…downloadTip`） */
export function bundleDownloadTip(
  t: Composer['t'],
  te: Composer['te'],
  bundle: ToolComponentBundle,
): string | null {
  const handler = resolveBundleHandler(bundle)
  const key = `settings.componentBundles.${handler.localeKey}.downloadTip`
  return te(key) ? t(key) : null
}

export function statusLabel(t: Composer['t'], status: ToolComponentStatus): string {
  return t(`settings.componentsStatus.${status}`)
}

export function statusBadgeVariant(status: ToolComponentStatus): 'success' | 'warning' | 'default' {
  if (status === 'missing') {
    return 'warning'
  }
  if (status === 'detected' || status === 'configured' || status === 'bundled') {
    return 'success'
  }
  return 'default'
}

export function isToolReady(status: ToolComponentStatus): boolean {
  return status !== 'missing'
}

export function bundleSummary(bundle: ToolComponentBundle): { ready: number; total: number } {
  const total = bundle.tools.length
  const ready = bundle.tools.filter((tool) => isToolReady(tool.status)).length
  return { ready, total }
}

export function bundleHealthClass(bundle: ToolComponentBundle): string {
  const { ready, total } = bundleSummary(bundle)
  if (total === 0 || ready === 0) {
    return 'nm-components__health--none'
  }
  if (ready === total) {
    return 'nm-components__health--full'
  }
  return 'nm-components__health--partial'
}

export function pathSummary(t: Composer['t'], tool: ToolComponentEntry): string {
  if (tool.path) {
    return tool.path
  }
  return t('settings.componentsPathEmpty')
}

export function rowKey(bundleId: string, toolId: string): string {
  return `${bundleId}:${toolId}`
}
