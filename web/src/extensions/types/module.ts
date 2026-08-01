import type { RouteRecordRaw } from 'vue-router'

/** 模块来源：第一方内置 vs 外部插件 */
export type ModuleSource = 'builtin' | 'extension'

/**
 * SideNav 分组领域 — 全能型桌面 App 的一级分类。
 * 后续运维 / 数据库 / API / 视频等模块挂载到对应 category。
 */
export type ModuleCategory =
  | 'explorer'
  | 'ops'
  | 'data'
  | 'devtools'
  | 'ai'
  | 'media'
  | 'extensions'

/** SideNav 分组展示顺序 */
export const MODULE_CATEGORY_ORDER: readonly ModuleCategory[] = [
  'explorer',
  'data',
  'ops',
  'devtools',
  'ai',
  'media',
  'extensions',
] as const

type RouteComponent = NonNullable<RouteRecordRaw['component']>

/**
 * 统一模块描述符 — 内置 modules 与 plugins manifest 共用。
 */
export interface ModuleDescriptor {
  id: string
  source: ModuleSource
  labelKey: string
  icon: string
  routePath: string
  order: number
  /** SideNav 分组；插件默认 extensions */
  category: ModuleCategory
  /** 懒加载路由组件 */
  load: RouteComponent
}

/** SideNav / moduleStore 使用的导航项（无 load） */
export interface ModuleNavItem {
  moduleId: string
  labelKey: string
  icon: string
  routePath: string
  order: number
  source: ModuleSource
  category: ModuleCategory
}

/** 按 category 分组后的 SideNav 结构 */
export interface ModuleNavGroup {
  category: ModuleCategory
  labelKey: string
  items: ModuleNavItem[]
}

export function toNavItem(module: ModuleDescriptor): ModuleNavItem {
  return {
    moduleId: module.id,
    labelKey: module.labelKey,
    icon: module.icon,
    routePath: module.routePath,
    order: module.order,
    source: module.source,
    category: module.category,
  }
}

/**
 * 将扁平模块列表按 category 分组并排序。
 *
 * @param items - 导航项
 * @returns 有序分组；空 category 自动省略
 */
export function groupNavItems(items: readonly ModuleNavItem[]): ModuleNavGroup[] {
  const buckets = new Map<ModuleCategory, ModuleNavItem[]>()

  for (const item of items) {
    const list = buckets.get(item.category) ?? []
    list.push(item)
    buckets.set(item.category, list)
  }

  return MODULE_CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => ({
    category,
    labelKey: `nav.category.${category}`,
    items: [...(buckets.get(category) ?? [])].sort((a, b) => a.order - b.order),
  }))
}
