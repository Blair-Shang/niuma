/**
 * 按 FTP profile 记住上次本地/远程目录（localStorage）。
 * Key：`niuma.ftp.lastLocalPath.{profileId}` / `niuma.ftp.lastRemotePath.{profileId}`
 */

const LOCAL_PREFIX = 'niuma.ftp.lastLocalPath.'
const REMOTE_PREFIX = 'niuma.ftp.lastRemotePath.'

function storageKey(prefix: string, profileId: string): string {
  return prefix + profileId
}

function loadPath(prefix: string, profileId: string): string | null {
  if (!profileId || typeof localStorage === 'undefined') {
    return null
  }
  try {
    const raw = localStorage.getItem(storageKey(prefix, profileId))
    const trimmed = raw?.trim()
    return trimmed || null
  } catch {
    return null
  }
}

function savePath(prefix: string, profileId: string, path: string): void {
  const trimmed = path.trim()
  if (!profileId || !trimmed || typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.setItem(storageKey(prefix, profileId), trimmed)
  } catch {
    // quota — ignore
  }
}

function clearPath(prefix: string, profileId: string): void {
  if (!profileId || typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.removeItem(storageKey(prefix, profileId))
  } catch {
    // ignore
  }
}

export function loadLastLocalPath(profileId: string): string | null {
  return loadPath(LOCAL_PREFIX, profileId)
}

export function saveLastLocalPath(profileId: string, path: string): void {
  savePath(LOCAL_PREFIX, profileId, path)
}

export function clearLastLocalPath(profileId: string): void {
  clearPath(LOCAL_PREFIX, profileId)
}

export function loadLastRemotePath(profileId: string): string | null {
  return loadPath(REMOTE_PREFIX, profileId)
}

export function saveLastRemotePath(profileId: string, path: string): void {
  savePath(REMOTE_PREFIX, profileId, path)
}

export function clearLastRemotePath(profileId: string): void {
  clearPath(REMOTE_PREFIX, profileId)
}
