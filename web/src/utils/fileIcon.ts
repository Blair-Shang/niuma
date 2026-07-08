/** 文件/目录条目在资源管理器风格列表中的图标色调 */
export type FileIconTone =
  | 'dir'
  | 'parent'
  | 'link'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'config'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'database'
  | 'executable'
  | 'font'
  | 'file'

export interface FileIconDescriptor {
  icon: string
  tone: FileIconTone
}

interface FileIconGroup {
  icon: string
  tone: FileIconTone
  extensions: readonly string[]
}

const FILE_ICON_GROUPS: readonly FileIconGroup[] = [
  {
    icon: 'file-image',
    tone: 'image',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tif', 'tiff', 'heic', 'avif', 'psd'],
  },
  {
    icon: 'file-video-camera',
    tone: 'video',
    extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'webm', 'flv', 'm4v', 'mpg', 'mpeg', '3gp'],
  },
  {
    icon: 'file-music',
    tone: 'audio',
    extensions: ['mp3', 'wav', 'flac', 'ogg', 'aac', 'wma', 'm4a', 'aiff', 'opus', 'mid', 'midi'],
  },
  {
    icon: 'file-archive',
    tone: 'archive',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'cab', 'iso', 'dmg'],
  },
  {
    icon: 'file-code',
    tone: 'code',
    extensions: [
      'js', 'jsx', 'ts', 'tsx', 'vue', 'py', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cc', 'cxx',
      'cs', 'rb', 'php', 'swift', 'kt', 'kts', 'scala', 'lua', 'r', 'dart', 'zig', 'sh', 'bash',
      'ps1', 'bat', 'cmd', 'html', 'htm', 'css', 'scss', 'less', 'sass', 'sql',
    ],
  },
  {
    icon: 'file-braces',
    tone: 'config',
    extensions: ['json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg', 'conf', 'env', 'properties'],
  },
  {
    icon: 'file-text',
    tone: 'document',
    extensions: ['txt', 'md', 'markdown', 'rtf', 'log', 'doc', 'docx', 'odt', 'pages'],
  },
  {
    icon: 'file-spreadsheet',
    tone: 'spreadsheet',
    extensions: ['xls', 'xlsx', 'csv', 'ods', 'numbers'],
  },
  {
    icon: 'presentation',
    tone: 'presentation',
    extensions: ['ppt', 'pptx', 'odp', 'key'],
  },
  {
    icon: 'file-type',
    tone: 'pdf',
    extensions: ['pdf'],
  },
  {
    icon: 'database',
    tone: 'database',
    extensions: ['db', 'sqlite', 'sqlite3', 'mdb', 'accdb'],
  },
  {
    icon: 'terminal',
    tone: 'executable',
    extensions: ['exe', 'msi', 'app', 'deb', 'rpm', 'apk', 'dll', 'so', 'dylib'],
  },
  {
    icon: 'type',
    tone: 'font',
    extensions: ['ttf', 'otf', 'woff', 'woff2', 'eot'],
  },
] as const

const COMPOUND_EXTENSIONS: Record<string, FileIconDescriptor> = {
  'tar.gz': { icon: 'file-archive', tone: 'archive' },
  'tar.bz2': { icon: 'file-archive', tone: 'archive' },
  'tar.xz': { icon: 'file-archive', tone: 'archive' },
}

const EXTENSION_ICON_MAP = new Map<string, FileIconDescriptor>(
  FILE_ICON_GROUPS.flatMap((group) =>
    group.extensions.map((ext) => [ext, { icon: group.icon, tone: group.tone } satisfies FileIconDescriptor]),
  ),
)

const DEFAULT_FILE_ICON: FileIconDescriptor = { icon: 'file', tone: 'file' }

/** 从文件名提取小写扩展名（无点）；无扩展名返回空字符串 */
export function getFileExtension(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return ''
  }
  return base.slice(dot + 1).toLowerCase()
}

/** 按文件名扩展名解析图标（仅普通文件） */
export function resolveFileIconByName(filename: string): FileIconDescriptor {
  const base = filename.split(/[/\\]/).pop() ?? filename
  const lower = base.toLowerCase()

  for (const [compound, descriptor] of Object.entries(COMPOUND_EXTENSIONS)) {
    if (lower.endsWith(`.${compound}`)) {
      return descriptor
    }
  }

  const ext = getFileExtension(base)
  if (!ext) {
    return DEFAULT_FILE_ICON
  }
  return EXTENSION_ICON_MAP.get(ext) ?? DEFAULT_FILE_ICON
}

export type FileEntryKind = 'file' | 'dir' | 'link' | 'parent'

/** 按 FTP/文件列表条目类型与名称解析图标 */
export function resolveEntryIcon(kind: FileEntryKind, name: string): FileIconDescriptor {
  if (kind === 'parent') {
    return { icon: 'corner-left-up', tone: 'parent' }
  }
  if (kind === 'dir') {
    return { icon: 'folder', tone: 'dir' }
  }
  if (kind === 'link') {
    return { icon: 'link', tone: 'link' }
  }
  return resolveFileIconByName(name)
}
