import type { RouteRecordRaw } from 'vue-router'
import ExtensionModuleView from '../host/ExtensionModuleView.vue'
import type { ExtensionManifest } from '../types/manifest'
import type { ModuleDescriptor, ModuleNavItem } from '../types/module'
import { toNavItem } from '../types/module'
import { builtinModules } from './builtin-modules'

/** 动态注册的扩展模块（P1：Shell 扫描；P2：Platform 裁决后注册） */
const extensionModules: ModuleDescriptor[] = []

/** 插件 id → plugins/ 下相对根路径 */
const extensionRootById = new Map<string, string>()

/** 插件 id → manifest.module.uiEntry（相对插件根，如 ui/entry.js） */
const extensionUiEntryById = new Map<string, string>()

/**
 * 由模块 id 生成 Vue Router 路由 name。
 *
 * @param moduleId - 插件或内置模块 id
 * @returns 形如 `module:com.niuma.example.hello` 的路由名
 */
export function routeNameFromModuleId(moduleId: string): string {
  return `module:${moduleId}`
}

function pathSegment(routePath: string): string {
  return routePath.replace(/^\//, '')
}

/**
 * 合并内置与已注册扩展，生成 SideNav 导航项。
 *
 * @returns 按 order 排序的导航项
 */
export function getModuleNavItems(): ModuleNavItem[] {
  return [...builtinModules, ...extensionModules]
    .map(toNavItem)
    .sort((a, b) => a.order - b.order)
}

/**
 * 生成 AppShell 下挂载的模块子路由（不含 settings）。
 * 动态插件路由由 bootstrapExtensions 在运行时 addRoute。
 *
 * @returns Vue Router children 配置
 */
export function createModuleRoutes(): RouteRecordRaw[] {
  return [...builtinModules, ...extensionModules].map((module) => ({
    path: pathSegment(module.routePath),
    name: routeNameFromModuleId(module.id),
    component: module.load,
    meta: { moduleId: module.id, source: module.source },
  }))
}

/**
 * 注册外部插件模块描述符。
 *
 * @param descriptor - 模块描述符
 * @param pluginRoot - 相对 plugins/ 的路径，可选
 * @param uiEntry - manifest.module.uiEntry，供 Tab 工作区直接挂载插件 UI，可选
 */
export function registerExtensionModule(
  descriptor: ModuleDescriptor,
  pluginRoot?: string,
  uiEntry?: string,
): void {
  if (extensionModules.some((m) => m.id === descriptor.id)) {
    return
  }
  extensionModules.push(descriptor)
  if (pluginRoot) {
    extensionRootById.set(descriptor.id, pluginRoot)
  }
  if (uiEntry) {
    extensionUiEntryById.set(descriptor.id, uiEntry)
  }
}

/**
 * 从 manifest 构建 ModuleDescriptor。
 *
 * @param manifest - 插件 manifest
 * @returns 可注册描述符；缺少 module 段时返回 null
 */
export function moduleDescriptorFromManifest(manifest: ExtensionManifest): ModuleDescriptor | null {
  if (!manifest.module?.routePath || !manifest.module.uiEntry) {
    return null
  }

  return {
    id: manifest.id,
    source: 'extension',
    labelKey: manifest.module.labelKey,
    icon: manifest.module.icon,
    routePath: manifest.module.routePath,
    order: manifest.module.order,
    category: manifest.module.category ?? 'extensions',
    load: () => Promise.resolve(ExtensionModuleView),
  }
}

/**
 * 返回当前已知的全部模块（内置 + 已注册扩展）。
 */
export function getAllModules(): readonly ModuleDescriptor[] {
  return [...builtinModules, ...extensionModules]
}

/**
 * 按模块 id 查询描述符（内置或扩展）。
 *
 * @param moduleId - 模块 id
 * @returns 描述符；未注册时 undefined
 */
export function getModuleById(moduleId: string): ModuleDescriptor | undefined {
  return getAllModules().find((m) => m.id === moduleId)
}

/**
 * 按路由路径反查模块（`/ssh` 或其子路径 `/ssh/x` 均命中）。
 *
 * @param routePath - 当前 route.path
 * @returns 命中的模块描述符；无匹配时 undefined
 */
export function getModuleByRoutePath(routePath: string): ModuleDescriptor | undefined {
  return getAllModules().find(
    (m) => routePath === m.routePath || routePath.startsWith(`${m.routePath}/`),
  )
}

/**
 * 查询已注册扩展的 plugins/ 相对根路径。
 *
 * @param moduleId - 插件 id
 */
export function getExtensionRoot(moduleId: string): string | undefined {
  return extensionRootById.get(moduleId)
}

/**
 * 查询已注册扩展的 UI 入口（manifest.module.uiEntry）。
 *
 * @param moduleId - 插件 id
 */
export function getExtensionUiEntry(moduleId: string): string | undefined {
  return extensionUiEntryById.get(moduleId)
}
