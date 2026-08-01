import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import { i18n } from '@/locale'

/**
 * 从资源路径解析 Redis 逻辑库编号（`segments` 中 `kind === 'db'`）。
 * 连接根节点双击时无 db 段，返回 `undefined`。
 */
export function redisDatabaseFromContext(ctx?: ConnOpenContext): number | undefined {
  const seg = ctx?.resourcePath?.segments.find((s) => s.kind === 'db')
  if (!seg) {
    return undefined
  }
  const db = Number.parseInt(seg.name, 10)
  return Number.isNaN(db) ? undefined : db
}

/**
 * 从资源路径解析 MongoDB 库 / 集合名。
 * segments 使用 `database` / `collection` kind（见 mongodb conn-tree-provider）。
 */
export function mongoResourceFromContext(ctx?: ConnOpenContext): {
  database?: string
  collection?: string
} {
  const segments = ctx?.resourcePath?.segments ?? []
  return {
    database: segments.find((s) => s.kind === 'database')?.name,
    collection: segments.find((s) => s.kind === 'collection')?.name,
  }
}

/** 按协议规则拼接 Tab 标题（主机名 + 库/集合后缀） */
export function buildConnectionTabTitle(
  profileName: string,
  database?: number,
  mongo?: { database?: string; collection?: string },
): string {
  if (mongo?.database) {
    if (mongo.collection) {
      return `${profileName} · ${mongo.database}.${mongo.collection}`
    }
    return `${profileName} · ${mongo.database}`
  }
  if (database === undefined) {
    return profileName
  }
  return `${profileName} · DB${database}`
}

/**
 * 同连接下下一个「查询」Tab 序号（1-based）。
 * 用于可多开的 SQL 编辑器标题：`库 · 查询 1`。
 */
export function nextQueryTabIndex(
  tabs: readonly { moduleId: string; props: Record<string, unknown> }[],
  moduleId: string,
  profileId: string,
  isQueryTab: (initialTab: unknown) => boolean,
): number {
  let n = 0
  for (const tab of tabs) {
    if (tab.moduleId !== moduleId) continue
    if (tab.props.profileId !== profileId) continue
    if (isQueryTab(tab.props.initialTab)) n += 1
  }
  return n + 1
}

/**
 * 构造 Tab 悬浮提示文本（完整连接信息 + 资源路径）。
 *
 * 当 Tab 标题被 CSS 截断（如 `datahub_dev.view_…`）时，tooltip 承载完整信息供悬浮查看。
 * 格式为换行分隔的多行文本，TabBar 会按行拆分渲染；每行带说明标签。
 *
 * @param resource 资源路径：字符串（如 `db.table`）或 Mongo `{ database, collection }`
 * @param feature 可选功能名（如「监控」「查询」），追加为「功能: …」行
 */
export function buildConnectionTabTooltip(
  profileName: string | null | undefined,
  hostAddress: string | null | undefined,
  resource?: string | { database?: string; collection?: string },
  feature?: string,
): string {
  const t = i18n.global.t.bind(i18n.global)
  // host_address 在库表可为空；侧栏 ConnItem 也可能缺字段，避免 .trim 抛错阻断开 Tab
  const lines = [
    `${t('workspace.tabTipName')}: ${profileName?.trim() || '—'}`,
    `${t('workspace.tabTipHost')}: ${hostAddress?.trim() || '—'}`,
  ]
  let resourceText: string | undefined
  if (typeof resource === 'string') {
    resourceText = resource.trim() || undefined
  } else if (resource?.database) {
    resourceText = resource.collection
      ? `${resource.database}.${resource.collection}`
      : resource.database
  }
  if (resourceText) {
    lines.push(`${t('workspace.tabTipResource')}: ${resourceText}`)
  }
  if (feature?.trim()) {
    lines.push(`${t('workspace.tabTipFeature')}: ${feature.trim()}`)
  }
  return lines.join('\n')
}
