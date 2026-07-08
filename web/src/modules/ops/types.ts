import type { ConnectionProfile } from '@/api/types/connection'

/** 运维侧栏支持的连接类型（新增类型只改 CONN_KIND_DEFS） */
export const CONN_KIND_DEFS = [
  { kind: 'ssh' as const, label: 'SSH', icon: 'terminal', defaultPort: 22 },
  { kind: 'ftp' as const, label: 'FTP', icon: 'ftp', defaultPort: 21 },
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

/** 从 connection_options JSON 读取标签色（非法值回退默认蓝） */
export function profileAccentColor(options: ConnectionProfile['connectionOptions'] | undefined): ConnAccentColor {
  const raw = (options as { accentColor?: string } | undefined)?.accentColor
  if (raw && (CONN_ACCENT_COLORS as readonly string[]).includes(raw)) {
    return raw as ConnAccentColor
  }
  return DEFAULT_CONN_ACCENT
}
