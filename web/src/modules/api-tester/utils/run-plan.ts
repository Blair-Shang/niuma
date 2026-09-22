import { MAX_FOLDER_DEPTH, materializeCollectionRequests, materializeFolderRequests, requestByIdInFolders } from './folder-tree'
import type { ApiFolder, ApiRequest, ApiRunProfile } from '../types'

/** 校验 runProfile；合法返回 null，否则返回错误文案。 */
export function validateRunProfile(profile: ApiRunProfile, folders: readonly ApiFolder[]): string | null {
  const name = profile.name.trim()
  if (!name) return 'name required'
  if (profile.concurrency < 1) return 'concurrency must be >= 1'
  if (profile.iterations < 1) return 'iterations must be >= 1'
  if (!profile.targetIds.length) return 'targetIds required'
  if (profile.kind === 'request') {
    for (const id of profile.targetIds) {
      if (!requestByIdInFolders(folders, id)) return `unknown request: ${id}`
    }
    return null
  }
  if (profile.kind === 'folder') {
    for (const id of profile.targetIds) {
      const folder = folders.find((item) => item.id === id)
      if (!folder) return `unknown folder: ${id}`
      if (folderDepthExceeded(folders, id)) return 'folder depth exceeds limit'
    }
    return null
  }
  if (profile.kind === 'collection') {
    if (folders.some((folder) => folderDepthExceeded(folders, folder.id))) {
      return 'folder depth exceeds limit'
    }
    return null
  }
  return 'unknown kind'
}

/** 把 runProfile 展开为请求列表（去重保序）。 */
export function materializeTargets(folders: readonly ApiFolder[], profile: ApiRunProfile): ApiRequest[] {
  const out: ApiRequest[] = []
  const seen = new Set<string>()
  const push = (req: ApiRequest | undefined): void => {
    if (!req || seen.has(req.id)) return
    seen.add(req.id)
    out.push(req)
  }
  if (profile.kind === 'request') {
    for (const id of profile.targetIds) {
      push(requestByIdInFolders(folders, id))
    }
    return out
  }
  if (profile.kind === 'folder') {
    for (const id of profile.targetIds) {
      for (const req of materializeFolderRequests(folders, id)) {
        push(req)
      }
    }
    return out
  }
  for (const req of materializeCollectionRequests(folders)) {
    push(req)
  }
  return out
}

function folderDepthExceeded(folders: readonly ApiFolder[], folderId: string): boolean {
  let depth = 0
  let current = folders.find((item) => item.id === folderId)
  while (current) {
    depth += 1
    if (depth > MAX_FOLDER_DEPTH) return true
    current = current.parentId ? folders.find((item) => item.id === current!.parentId) : undefined
  }
  return false
}
