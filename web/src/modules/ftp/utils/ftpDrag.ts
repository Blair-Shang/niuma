export const FTP_DRAG_MIME = 'application/x-niuma-ftp-drag'

export interface FtpDragEntry {
  name: string
  kind: 'file' | 'dir'
  path: string
}

export interface FtpDragPayload {
  side: 'local' | 'remote'
  entries: FtpDragEntry[]
}

export function ftpDragTypeForSide(side: 'local' | 'remote'): string {
  return `${FTP_DRAG_MIME}+${side}`
}

export function writeFtpDragData(event: DragEvent, payload: FtpDragPayload): void {
  event.dataTransfer?.setData(FTP_DRAG_MIME, JSON.stringify(payload))
  event.dataTransfer?.setData(ftpDragTypeForSide(payload.side), payload.side)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
  }
}

export function readFtpDragSideFromTypes(event: DragEvent): FtpDragPayload['side'] | null {
  const types = event.dataTransfer?.types ?? []
  if (types.includes(ftpDragTypeForSide('local'))) {
    return 'local'
  }
  if (types.includes(ftpDragTypeForSide('remote'))) {
    return 'remote'
  }
  return null
}

export function readFtpDragPayload(event: DragEvent): FtpDragPayload | null {
  const raw = event.dataTransfer?.getData(FTP_DRAG_MIME)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as FtpDragPayload
    if (!parsed?.side || !Array.isArray(parsed.entries) || parsed.entries.length === 0) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function isPathInside(parentPath: string, childPath: string): boolean {
  const sep = parentPath.includes('\\') || childPath.includes('\\') ? '\\' : '/'
  const normalize = (value: string) =>
    value.replace(/[/\\]+$/, '').replace(/[/\\]+/g, sep).toLowerCase()
  const parent = normalize(parentPath)
  const child = normalize(childPath)
  if (!parent || !child) {
    return false
  }
  return child === parent || child.startsWith(`${parent}${sep}`)
}
