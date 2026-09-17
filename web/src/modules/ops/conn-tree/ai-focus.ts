import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnTreeNode } from '@/modules/ops/composables/useConnTree'
import { parseConnTreeKey } from '@/modules/ops/conn-tree/keys'

/** 连接树路径段（协议自定 kind，如 database / collection / db）。 */
export interface ConnTreePathSeg {
  kind: string
  name: string
}

/**
 * 连接树当前焦点：通用对象（path），不是树协议本身。
 * database / schema / table / collection 只从 path 派生，供 SQL 工具注入。
 */
export interface ConnTreeAiFocus {
  key: string
  profileId: string
  moduleId: string
  label: string
  path: ConnTreePathSeg[]
}

/** catalog 槽位：SQL 用 database/schema/table；Mongo 用 database/collection；Redis 用 database。 */
export interface CatalogHint {
  database?: string
  schema?: string
  table?: string
  collection?: string
}

const TABLE_KINDS = new Set([
  'table',
  'view',
  'object',
  'materializedView',
  'materialized_view',
  'dictionary',
  'routine',
  'procedure',
  'function',
  'sequence',
  'trigger',
  'synonym',
  'index',
  'package',
])

/** 去掉分组/截断提示后的对象路径。 */
export function objectPathFromResource(path: ConnResourcePath | undefined): ConnTreePathSeg[] {
  const out: ConnTreePathSeg[] = []
  for (const seg of path?.segments ?? []) {
    const kind = seg.kind.trim()
    const name = seg.name.trim()
    if (!name) {
      continue
    }
    const lower = kind.toLowerCase()
    if (lower === 'category' || lower === 'hint') {
      continue
    }
    out.push({ kind, name })
  }
  return out
}

/** 从通用 path 派生 catalog（Mongo 集合不进 table）。 */
export function catalogFromPath(moduleId: string, path: readonly ConnTreePathSeg[]): CatalogHint {
  const out: CatalogHint = {}
  for (const seg of path) {
    const kind = seg.kind.trim().toLowerCase()
    const name = seg.name.trim()
    if (!name) {
      continue
    }
    if (kind === 'db' || kind === 'database') {
      out.database = name
      continue
    }
    if (kind === 'schema') {
      out.schema = name
      continue
    }
    if (kind === 'collection') {
      out.collection = name
      continue
    }
    if (TABLE_KINDS.has(seg.kind) || TABLE_KINDS.has(kind)) {
      out.table = name
    }
  }
  if (moduleId === 'redis' && out.database && !out.schema && !out.table && !out.collection) {
    return { database: out.database }
  }
  return out
}

/** 兼容旧调用：资源路径 → catalog。 */
export function catalogFromResourcePath(
  moduleId: string,
  path: ConnResourcePath | undefined,
): CatalogHint {
  return catalogFromPath(moduleId, objectPathFromResource(path))
}

/** 树焦点是否带有可定向对象（有 path 即可，不要求 catalog 三槽）。 */
export function hasObjectHint(focus: ConnTreeAiFocus | null | undefined): boolean {
  return Boolean(focus?.path.length)
}

/** @deprecated 使用 hasObjectHint */
export function hasCatalogObject(focus: ConnTreeAiFocus | null | undefined): boolean {
  return hasObjectHint(focus)
}

export function objectLabel(
  moduleId: string,
  path: readonly ConnTreePathSeg[],
  fallback?: string,
): string {
  if (moduleId === 'redis') {
    const db = path.find((s) => {
      const k = s.kind.toLowerCase()
      return k === 'db' || k === 'database'
    })
    if (db) {
      return `DB ${db.name}`
    }
  }
  const names = path.map((s) => s.name).filter(Boolean)
  if (names.length) {
    return names.join('.')
  }
  return fallback?.trim() || ''
}

function snapshotFromPath(
  key: string,
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  label?: string,
): ConnTreeAiFocus {
  const segs = objectPathFromResource(path)
  return {
    key,
    profileId: conn.profileId,
    moduleId: conn.kind,
    path: segs,
    label: objectLabel(conn.kind, segs, label || conn.profileName),
  }
}

/** 从树节点生成 AI 焦点；文件夹返回 null（保留上一焦点）。 */
export function snapshotFromTreeNode(node: ConnTreeNode): ConnTreeAiFocus | null {
  if (node._type === 'folder') {
    return null
  }
  if (node._type === 'conn') {
    return {
      key: node.key || `conn:${node._conn.profileId}`,
      profileId: node._conn.profileId,
      moduleId: node._conn.kind,
      label: (typeof node.label === 'string' && node.label.trim()) || node._conn.profileName,
      path: [],
    }
  }
  if (node._type === 'resource') {
    return snapshotFromPath(
      node.key || '',
      node._conn,
      node._path,
      typeof node.label === 'string' ? node.label : undefined,
    )
  }
  return null
}

/** 从树 key + 已加载连接快照生成 AI 焦点（Tab / requestFocus 路径）。 */
export function snapshotFromTreeKey(
  key: string,
  profiles: readonly ConnItem[],
  label?: string,
): ConnTreeAiFocus | null {
  const trimmed = key.trim()
  if (!trimmed) {
    return null
  }
  const parsed = parseConnTreeKey(trimmed)
  if (parsed.type === 'folder') {
    return null
  }
  const profileId = parsed.type === 'conn' ? parsed.id : parsed.profileId
  const conn = profiles.find((p) => p.profileId === profileId)
  if (!conn) {
    return null
  }
  if (parsed.type === 'conn') {
    return {
      key: trimmed,
      profileId,
      moduleId: conn.kind,
      label: label?.trim() || conn.profileName,
      path: [],
    }
  }
  return snapshotFromPath(trimmed, conn, parsed.path, label)
}
