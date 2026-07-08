/** 文件大小人类可读格式 */
export function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** 修改时间（ISO 8601 → 本地化短格式） */
export function formatModifiedAt(iso?: string): string {
  if (!iso) {
    return '—'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function kindLabel(kind: string, t: (key: string) => string): string {
  if (kind === 'dir') {
    return t('modules.ftp.session.kindDir')
  }
  if (kind === 'link') {
    return t('modules.ftp.session.kindLink')
  }
  return t('modules.ftp.session.kindFile')
}
