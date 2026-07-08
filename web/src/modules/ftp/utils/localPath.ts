interface LocalPathParts {
  root: string
  parts: string[]
}

/** 拆分 Windows / POSIX 本地路径，保留盘符或 UNC 根目录 */
export function splitLocalPath(path: string): LocalPathParts {
  const trimmed = path.trim()
  if (!trimmed) {
    return { root: '', parts: [] }
  }

  const winDrive = /^([A-Za-z]:)([/\\]|$)(.*)$/.exec(trimmed)
  if (winDrive) {
    const rest = winDrive[3] ?? ''
    return {
      root: `${winDrive[1]}\\`,
      parts: rest.split(/[/\\]/).filter(Boolean),
    }
  }

  if (trimmed.startsWith('\\\\')) {
    const segments = trimmed.slice(2).split(/[/\\]/).filter(Boolean)
    if (segments.length >= 2) {
      return {
        root: `\\\\${segments[0]}\\${segments[1]}\\`,
        parts: segments.slice(2),
      }
    }
  }

  const isAbsolute = trimmed.startsWith('/')
  return {
    root: isAbsolute ? '/' : '',
    parts: trimmed.split(/[/\\]/).filter(Boolean),
  }
}

function isWindowsDriveRoot(root: string): boolean {
  return /^[A-Za-z]:\\$/.test(root)
}

function isUncRoot(root: string): boolean {
  return /^\\\\[^\\]+\\[^\\]+\\$/.test(root)
}

/** 规范化本地路径，Windows 盘符根目录统一为 E:\\ 形式 */
export function normalizeLocalPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) {
    return trimmed
  }

  const driveOnly = /^([A-Za-z]:)[/\\]?$/.exec(trimmed)
  if (driveOnly) {
    return `${driveOnly[1]}\\`
  }

  const { root, parts } = splitLocalPath(trimmed)
  return joinLocalPathParts(root, parts)
}

function joinLocalPathParts(root: string, parts: string[]): string {
  if (parts.length === 0) {
    if (isWindowsDriveRoot(root) || isUncRoot(root)) {
      return root
    }
    return root.replace(/[/\\]+$/, '') || root
  }
  const sep = root.includes('\\') ? '\\' : '/'
  const base = root.replace(/[/\\]+$/, '')
  return `${base}${sep}${parts.join(sep)}`
}

export function joinLocalPath(base: string, name: string): string {
  const { root, parts } = splitLocalPath(base)
  return joinLocalPathParts(root, [...parts, name])
}

export function parentLocalPath(path: string): string {
  const { root, parts } = splitLocalPath(path)
  if (parts.length === 0) {
    return normalizeLocalPath(root)
  }
  return joinLocalPathParts(root, parts.slice(0, -1))
}

export function canGoUpLocalPath(path: string): boolean {
  return splitLocalPath(path).parts.length > 0
}
