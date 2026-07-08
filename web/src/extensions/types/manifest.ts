/**
 * 插件 manifest.json 类型 — 对应 plugins/<id>/manifest.json
 * @see docs/04-plugin-system.md
 */
export interface ExtensionEngine {
  niuma: string
}

export interface ExtensionModuleRef {
  routePath: string
  labelKey: string
  icon: string
  order: number
  /** SideNav 分组，默认 extensions */
  category?: import('./module').ModuleCategory
  /** 相对插件根目录，如 ui/entry.js */
  uiEntry: string
}

export interface ExtensionManifest {
  id: string
  name: string
  version: string
  engine: ExtensionEngine
  source: 'extension'
  level: 'L1' | 'L2' | 'L3'
  permissions: string[]
  module?: ExtensionModuleRef
  contributions?: import('./contribution').ExtensionContributions
  activationEvents?: string[]
}
