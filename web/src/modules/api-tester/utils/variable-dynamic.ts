/**
 * 动态变量。值仍是字符串，发送插值时按 kind 展开。
 * datetime 用 now:*；number 用 random:*；uuid 用 uuid:each。
 */
import type { ApiVariableKind } from '../types'

export const DATETIME_PRESETS = ['now:date', 'now:time', 'now:datetime', 'now:iso', 'now:unix', 'now:unixMs'] as const

export type DatetimePreset = (typeof DATETIME_PRESETS)[number]

const RANDOM_VALUE = /^random:(int|float):(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/

export function isDatetimePreset(value: string): value is DatetimePreset {
  return (DATETIME_PRESETS as readonly string[]).includes(value)
}

/** 按类型把存储值展开成发送时的字符串。普通文本原样返回。 */
export function materializeVariableValue(kind: ApiVariableKind, raw: string, now = new Date()): string {
  if (kind === 'datetime') return materializeDatetime(raw, now)
  if (kind === 'number') return materializeNumber(raw)
  if (kind === 'uuid' && raw === 'uuid:each') return crypto.randomUUID()
  return raw
}

function materializeDatetime(raw: string, now: Date): string {
  switch (raw) {
    case 'now:date':
      return formatDate(now)
    case 'now:time':
      return formatTime(now)
    case 'now:datetime':
      return `${formatDate(now)} ${formatTime(now)}`
    case 'now:iso':
      return now.toISOString()
    case 'now:unix':
      return String(Math.floor(now.getTime() / 1000))
    case 'now:unixMs':
      return String(now.getTime())
    default:
      return raw
  }
}

function materializeNumber(raw: string): string {
  const match = RANDOM_VALUE.exec(raw.trim())
  if (!match) return raw
  const min = Number(match[2])
  const max = Number(match[3])
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return raw
  if (match[1] === 'int') {
    const low = Math.ceil(min)
    const high = Math.floor(max)
    if (high < low) return raw
    return String(low + Math.floor(Math.random() * (high - low + 1)))
  }
  const value = min + Math.random() * (max - min)
  return String(Math.round(value * 1000) / 1000)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function formatTime(now: Date): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}
