import type { Component } from 'vue'
import { FtpIcon } from './custom/ftp'
import { MongodbIcon } from './custom/mongodb'
import { RedisIcon } from './custom/redis'

export const LUCIDE_LICENSE = 'ISC'
export const LUCIDE_ATTRIBUTION =
  'Icons by Lucide (https://lucide.dev) — ISC License, free for commercial use'

/** NiuMa 业务扩展图标（kebab-case，与 Lucide 同名查找） */
const customIconMap = new Map<string, Component>([
  ['ftp', FtpIcon],
  ['mongodb', MongodbIcon],
  ['redis', RedisIcon],
])

/** Vite 构建时收集全部 Lucide 图标，运行时按名称 O(1) 查找 */
const iconModules = import.meta.glob<{ default: Component }>(
  '../../node_modules/lucide-vue-next/dist/esm/icons/*.js',
  { eager: true },
)

const iconMap = new Map<string, Component>(customIconMap)
const iconPathPattern = /[/\\]icons[/\\]([^/\\]+)\.js$/

for (const [path, mod] of Object.entries(iconModules)) {
  const match = iconPathPattern.exec(path)
  if (match) iconMap.set(match[1], mod.default)
}

const iconCache = new Map<string, Component>()

export function isRsIconName(name: string): boolean {
  return iconMap.has(name)
}

export function resolveLucideIcon(name: string): Component | undefined {
  const cached = iconCache.get(name)
  if (cached) return cached

  const icon = iconMap.get(name)
  if (icon) iconCache.set(name, icon)
  return icon
}

/** Lucide 库中可用图标数量 */
export const lucideIconCount = iconMap.size
