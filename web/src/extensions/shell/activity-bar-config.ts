import type { ModuleCategory, ModuleNavItem } from '@/extensions/types/module'
import { MODULE_CATEGORY_ORDER } from '@/extensions/types/module'
import type { ConnKind } from '@/modules/ops/types'
import { CONN_KIND_DEFS } from '@/modules/ops/types'

/** Activity Bar 条目（VS Code 左侧图标栏） */
export interface ActivityBarItem {
  category: ModuleCategory
  icon: string
  labelKey: string
}

/**
 * 领域 → Activity Bar 图标（Lucide kebab-case）。
 * 与 VS Code 的 Explorer / Search / SCM 类比，此处为 NiuMa 领域切换。
 */
// Activity Bar 固定四项大分类，仅驱动 SideNav 视图切换（资源管理 / 运维 / 数据库 / API）。
// 领域图标须与模块内工具图标区分，避免在活动栏、侧栏、Tab 三处重复。
export const ACTIVITY_BAR_ITEMS: readonly ActivityBarItem[] = [
  { category: 'explorer', icon: 'files', labelKey: 'nav.category.explorer' },
  { category: 'ops', icon: 'wrench', labelKey: 'nav.category.ops' },
  { category: 'data', icon: 'database', labelKey: 'nav.category.data' },
  { category: 'devtools', icon: 'webhook', labelKey: 'nav.category.api' },
] as const

/**
 * 返回 Activity Bar 固定四项（不随模块挂载动态增减）。
 */
export function visibleActivityBarItems(
  _items: readonly ModuleNavItem[],
): ActivityBarItem[] {
  return [...ACTIVITY_BAR_ITEMS]
}

/**
 * 按 category 过滤导航项。
 *
 * @param items - 全部导航项
 * @param category - 当前 Activity Bar 选中领域
 */
export function filterNavItemsByCategory(
  items: readonly ModuleNavItem[],
  category: ModuleCategory,
): ModuleNavItem[] {
  if (category === 'explorer') {
    return []
  }
  return items.filter((i) => i.category === category).sort((a, b) => a.order - b.order)
}

const CONN_KIND_SET = new Set<ConnKind>(CONN_KIND_DEFS.map((k) => k.kind))

/**
 * Activity 分类对应的连接 kind 过滤；`null` 表示资源管理全量展示。
 */
export function connectionKindsForCategory(category: ModuleCategory): ConnKind[] | null {
  if (category === 'explorer') {
    return null
  }
  if (category === 'ops') {
    return CONN_KIND_DEFS.map((k) => k.kind)
  }
  return []
}

/** 当前分类下可新建的连接 kind（驱动右键「新建」菜单）。 */
export function creatableConnKindsForCategory(category: ModuleCategory): ConnKind[] {
  if (category === 'explorer' || category === 'ops') {
    return CONN_KIND_DEFS.map((k) => k.kind)
  }
  return []
}

/** 当前分类是否支持连接文件夹（空树时仍保留右键「新建文件夹」）。 */
export function supportsConnFolders(category: ModuleCategory): boolean {
  return category === 'explorer' || category === 'ops' || category === 'data' || category === 'devtools'
}

/** 尚无独立连接 kind 时，分类对应的模块入口（如数据库 / API）。 */
export interface CategoryModuleAction {
  key: string
  labelKey: string
  icon: string
  moduleId: string
}

export function categoryModuleActions(category: ModuleCategory): CategoryModuleAction[] {
  if (category === 'data') {
    return [{ key: 'open-module:database', labelKey: 'opsNav.addDatabase', icon: 'database', moduleId: 'database' }]
  }
  if (category === 'devtools') {
    return [{ key: 'open-module:api', labelKey: 'opsNav.addApi', icon: 'send', moduleId: 'api' }]
  }
  return []
}

/** 模块 id 是否对应当前分类下的连接 kind（如 ssh / ftp）。 */
export function moduleIdAsConnKind(moduleId: string): ConnKind | null {
  return CONN_KIND_SET.has(moduleId as ConnKind) ? (moduleId as ConnKind) : null
}

/**
 * 根据路由路径推断模块 category。
 *
 * @param items - 全部导航项
 * @param path - 当前 route.path
 */
export function categoryForRoute(
  items: readonly ModuleNavItem[],
  path: string,
): ModuleCategory | null {
  const hit = items.find((i) => path === i.routePath || path.startsWith(`${i.routePath}/`))
  return hit?.category ?? null
}

/**
 * 某 category 的默认模块路由（order 最小项）。
 */
export function defaultRouteForCategory(
  items: readonly ModuleNavItem[],
  category: ModuleCategory,
): string | null {
  const list = filterNavItemsByCategory(items, category)
  return list[0]?.routePath ?? null
}

/** 确保 activeCategory 在有模块的 category 集合内 */
export function normalizeActiveCategory(
  items: readonly ModuleNavItem[],
  preferred: ModuleCategory,
): ModuleCategory {
  const visible = visibleActivityBarItems(items)
  if (visible.some((v) => v.category === preferred)) {
    return preferred
  }
  return visible[0]?.category ?? MODULE_CATEGORY_ORDER[0]
}
