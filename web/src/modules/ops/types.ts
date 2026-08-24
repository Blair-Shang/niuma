import type { ConnectionProfile } from '@/api/types/connection'

/** 运维侧栏支持的连接类型（新增类型只改 CONN_KIND_DEFS） */
export const CONN_KIND_DEFS = [
  { kind: 'ssh' as const, label: 'SSH', icon: 'square-terminal', defaultPort: 22 },
  { kind: 'ftp' as const, label: 'FTP', icon: 'ftp', defaultPort: 21 },
  { kind: 'redis' as const, label: 'Redis', icon: 'redis', defaultPort: 6379 },
  { kind: 'mongodb' as const, label: 'MongoDB', icon: 'mongodb', defaultPort: 27017 },
  { kind: 'vastbase' as const, label: 'Vastbase', icon: 'vastbase', defaultPort: 5432 },
  { kind: 'mysql' as const, label: 'MySQL', icon: 'mysql', defaultPort: 3306 },
  { kind: 'sqlite' as const, label: 'SQLite', icon: 'sqlite', defaultPort: 0 },
  { kind: 'dameng' as const, label: 'Dameng', icon: 'dameng', defaultPort: 5236 },
  { kind: 'oracle' as const, label: 'Oracle', icon: 'oracle', defaultPort: 1521 },
  { kind: 'clickhouse' as const, label: 'ClickHouse', icon: 'clickhouse', defaultPort: 9000 },
  { kind: 'kingbase' as const, label: '人大金仓', icon: 'kingbase', defaultPort: 54321 },
  { kind: 'sqlserver' as const, label: 'SQL Server', icon: 'sqlserver', defaultPort: 1433 },
  { kind: 'postgres' as const, label: 'PostgreSQL', icon: 'postgres', defaultPort: 5432 },
] as const

/** macOS 标签色盘（Finder / Terminal 连接标记风格） */
export const CONN_ACCENT_COLORS = [
  '#007AFF',
  '#34C759',
  '#FF9500',
  '#FF3B30',
  '#AF52DE',
  '#5AC8FA',
  '#FF2D55',
  '#8E8E93',
] as const

export type ConnAccentColor = (typeof CONN_ACCENT_COLORS)[number]

export const DEFAULT_CONN_ACCENT: ConnAccentColor = CONN_ACCENT_COLORS[0]

/** 文件夹默认标签色（与原先侧栏文件夹图标橙色一致） */
export const DEFAULT_FOLDER_ACCENT: ConnAccentColor = '#FF9500'

export type ConnKind = (typeof CONN_KIND_DEFS)[number]['kind']

export interface ConnItem extends ConnectionProfile {
  kind: ConnKind
}

export function kindIcon(kind: ConnKind): string {
  return CONN_KIND_DEFS.find((k) => k.kind === kind)?.icon ?? 'monitor'
}

export function defaultPortForKind(kind: ConnKind): number {
  return CONN_KIND_DEFS.find((k) => k.kind === kind)?.defaultPort ?? 22
}

function parseAccentColor(raw: string | undefined, fallback: ConnAccentColor): ConnAccentColor {
  if (raw && (CONN_ACCENT_COLORS as readonly string[]).includes(raw)) {
    return raw as ConnAccentColor
  }
  return fallback
}

/** 从 connection_options JSON 读取标签色（非法值回退默认蓝） */
export function profileAccentColor(options: ConnectionProfile['connectionOptions'] | undefined): ConnAccentColor {
  return parseAccentColor(
    (options as { accentColor?: string } | undefined)?.accentColor,
    DEFAULT_CONN_ACCENT,
  )
}

/** 读取文件夹标签色（非法值回退默认橙） */
export function folderAccentColor(folder: { accentColor?: string } | undefined): ConnAccentColor {
  return parseAccentColor(folder?.accentColor, DEFAULT_FOLDER_ACCENT)
}
