import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'

export function folderTreeKey(id: string): string {
  return `folder:${id}`
}

export function connTreeKey(profileId: string): string {
  return `conn:${profileId}`
}

/** 资源节点 key：`res:{profileId}:db:0` */
export function resourceTreeKey(profileId: string, path: ConnResourcePath): string {
  const tail = path.segments.map((s) => `${s.kind}:${s.name}`).join(':')
  return `res:${profileId}:${tail}`
}

export type ParsedTreeKey =
  | { type: 'folder'; id: string }
  | { type: 'conn'; id: string }
  | { type: 'res'; profileId: string; path: ConnResourcePath }

/**
 * 解析树节点 key。
 * 兼容历史 `parseTreeKey` 仅 folder/conn 的调用方。
 */
export function parseConnTreeKey(key: string): ParsedTreeKey {
  if (key.startsWith('folder:')) {
    return { type: 'folder', id: key.slice('folder:'.length) }
  }
  if (key.startsWith('conn:')) {
    return { type: 'conn', id: key.slice('conn:'.length) }
  }
  if (key.startsWith('res:')) {
    const parts = key.slice('res:'.length).split(':')
    const profileId = parts[0] ?? ''
    const segments: ConnResourcePath['segments'] = []
    for (let i = 1; i + 1 < parts.length; i += 2) {
      segments.push({ kind: parts[i], name: parts[i + 1] })
    }
    return { type: 'res', profileId, path: { segments } }
  }
  return { type: 'conn', id: key }
}

/** @deprecated 使用 parseConnTreeKey；保留 folder/conn 二元结果供拖放逻辑使用。 */
export function parseTreeKey(key: string): { type: 'folder' | 'conn'; id: string } {
  const parsed = parseConnTreeKey(key)
  if (parsed.type === 'folder') {
    return parsed
  }
  if (parsed.type === 'conn') {
    return parsed
  }
  return { type: 'conn', id: parsed.profileId }
}
