/** `platform.components.*` 工具组件 Bridge 类型 */

export type ToolComponentStatus = 'missing' | 'detected' | 'configured' | 'bundled'

export interface ToolComponentEntry {
  toolId: string
  displayName: string
  status: ToolComponentStatus
  path?: string
  version?: string
  downloadPage?: string
}

export interface ToolComponentBundle {
  bundleId: string
  name: string
  module?: string
  installable?: boolean
  tools: ToolComponentEntry[]
}

export interface ComponentsListParams {
  bundleId?: string
}

export interface ComponentsListResult {
  bundles: ToolComponentBundle[]
}

export interface ComponentsDetectParams {
  bundleId: string
}

export interface ComponentsDetectResult {
  bundle: ToolComponentBundle
}

export interface ComponentsSetPathParams {
  bundleId: string
  toolId: string
  /** 空字符串表示清除用户覆盖 */
  path: string
}

export interface ComponentsSetPathResult {
  updated: boolean
}

export interface ComponentsGetDownloadParams {
  bundleId: string
  toolId: string
}

export interface ComponentsGetDownloadResult {
  url: string
}

export interface ComponentsInstallParams {
  bundleId: string
}

export interface ComponentsInstallResult {
  bundle: ToolComponentBundle
  installed: boolean
}
