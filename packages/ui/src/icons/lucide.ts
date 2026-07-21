import type { Component } from 'vue'
import { FtpIcon } from './custom/ftp'
import { MongodbIcon } from './custom/mongodb'
import { MysqlIcon } from './custom/mysql'
import { RedisIcon } from './custom/redis'
import { VastbaseIcon } from './custom/vastbase'

export const LUCIDE_LICENSE = 'ISC'
export const LUCIDE_ATTRIBUTION =
  'Icons by Lucide (https://lucide.dev) — ISC License, free for commercial use'

/** NiuMa 业务扩展图标（kebab-case，与 Lucide 同名查找） */
const customIconMap = new Map<string, Component>([
  ['ftp', FtpIcon],
  ['mongodb', MongodbIcon],
  ['mysql', MysqlIcon],
  ['redis', RedisIcon],
  ['vastbase', VastbaseIcon],
])

/** Vite 构建时收集全部 Lucide 图标，运行时按名称 O(1) 查找 */
const iconModules = import.meta.glob<{ default: Component }>(
  '../../node_modules/lucide-vue-next/dist/esm/icons/*.js',
  { eager: true },
)

const iconMap = new Map<string, Component>(customIconMap)
const iconPathPattern = /[/\\]icons[/\\]([^/\\]+)\.js$/

/** Lucide 更名兼容：旧 kebab 名 → 新图标文件名 */
const iconAliases = new Map<string, string>([
  ['code-2', 'code-xml'],
])

for (const [path, mod] of Object.entries(iconModules)) {
  const match = iconPathPattern.exec(path)
  if (match) iconMap.set(match[1], mod.default)
}

const iconCache = new Map<string, Component>()

function resolveIconName(name: string): string {
  return iconAliases.get(name) ?? name
}

export function isRsIconName(name: string): boolean {
  return iconMap.has(resolveIconName(name))
}

export function resolveLucideIcon(name: string): Component | undefined {
  const resolvedName = resolveIconName(name)
  const cached = iconCache.get(resolvedName)
  if (cached) return cached

  const icon = iconMap.get(resolvedName)
  if (icon) iconCache.set(resolvedName, icon)
  return icon
}

/** Lucide 库中可用图标数量 */
export const lucideIconCount = iconMap.size
