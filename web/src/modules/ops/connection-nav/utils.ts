import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'

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
 * 构造 Tab 悬浮提示文本（完整连接信息 + 资源路径）。
 *
 * 当 Tab 标题被缩短（如只显示库名）时，tooltip 承载完整信息供鼠标悬浮查看。
 * 格式为换行分隔的多行文本，TabBar 会按行拆分渲染。
 *
 * 第 1 行：profileName（连接名）
 * 第 2 行：hostAddress（主机地址）
 * 第 3 行（可选）：database[.collection]（资源路径）
 */
export function buildConnectionTabTooltip(
  profileName: string,
  hostAddress: string,
  mongo?: { database?: string; collection?: string },
): string {
  const lines = [profileName, hostAddress]
  if (mongo?.database) {
    lines.push(mongo.collection ? `${mongo.database}.${mongo.collection}` : mongo.database)
  }
  return lines.join('\n')
}
