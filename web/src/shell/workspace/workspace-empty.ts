import { CONN_KIND_DEFS, type ConnItem, type ConnKind } from '@/modules/ops/types'

const KIND_BY_ID = new Map(CONN_KIND_DEFS.map((def) => [def.kind, def]))

export function isConnKind(value: string): value is ConnKind {
  return KIND_BY_ID.has(value as ConnKind)
}

/** 宽欢迎页可多列几条最近连接。 */
export const WORKSPACE_RECENT_LIMIT = 8

/** 按最近更新排列，供关光标签后从已有站点继续。 */
export function sortRecentProfiles(items: readonly ConnItem[], limit = WORKSPACE_RECENT_LIMIT): ConnItem[] {
  return [...items]
    .sort((a, b) => {
      const byUpdated = (b.updatedAt || '').localeCompare(a.updatedAt || '')
      if (byUpdated !== 0) {
        return byUpdated
      }
      return (b.createdAt || '').localeCompare(a.createdAt || '')
    })
    .slice(0, limit)
}

export function kindLabel(kind: ConnKind): string {
  return KIND_BY_ID.get(kind)?.label ?? kind
}

export function profileHostLabel(item: ConnItem): string {
  const host = (item.hostAddress || '').trim()
  if (item.kind === 'sqlite') {
    return host || item.profileName
  }
  if (!host) {
    return item.profileName
  }
  if (!item.portNumber) {
    return host
  }
  return `${host}:${item.portNumber}`
}

export function isMacShortcutPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
}

/** VS Code 水印用的按键粒，如 `['Ctrl', 'K']` / `['⌘', 'K']`。 */
export function chordKeys(key: string): string[] {
  return [isMacShortcutPlatform() ? '⌘' : 'Ctrl', key]
}
