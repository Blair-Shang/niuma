import type { RedisReplyValue } from '@/api/types/redis'

/**
 * 把命令行文本切分为参数数组，支持单/双引号与双引号内的反斜杠转义。
 *
 * 语义上对齐常见 shell / `redis-cli` 的输入习惯，足以覆盖控制台日常使用；未闭合的引号会把
 * 剩余文本整体作为最后一个参数，不抛错、不吞字符。
 */
export function splitCommandLine(line: string): string[] {
  const args: string[] = []
  let current = ''
  let hasCurrent = false
  let quote: '"' | "'" | null = null
  let i = 0

  while (i < line.length) {
    const ch = line[i]
    if (quote) {
      if (quote === '"' && ch === '\\' && i + 1 < line.length) {
        current += line[i + 1]
        i += 2
        continue
      }
      if (ch === quote) {
        quote = null
        i += 1
        continue
      }
      current += ch
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      hasCurrent = true
      i += 1
      continue
    }
    if (/\s/.test(ch)) {
      if (hasCurrent) {
        args.push(current)
        current = ''
        hasCurrent = false
      }
      i += 1
      continue
    }
    current += ch
    hasCurrent = true
    i += 1
  }
  if (hasCurrent) {
    args.push(current)
  }
  return args
}

/** 二进制/超长 bulk string 的包装形状（对应后端 `bulk_string_to_json`）。 */
function isWrappedBulkString(
  value: unknown,
): value is { text: string; isUtf8: boolean; truncated: boolean; byteLength: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    'isUtf8' in value &&
    'truncated' in value &&
    'byteLength' in value
  )
}

function formatStringReply(reply: string): string {
  if (reply === 'OK') {
    return 'OK'
  }
  // INFO / CONFIG GET 等命令返回多行 bulk string，直接输出原文保留换行。
  // 单行短字符串用引号包裹与整数/nil 等区分，和 redis-cli 的 --no-auth-warning 模式保持一致。
  return reply.includes('\n') || reply.includes('\r') ? reply : JSON.stringify(reply)
}

function formatArrayReply(reply: RedisReplyValue[], depth: number): string {
  if (reply.length === 0) {
    return '(empty array)'
  }
  const indent = '   '.repeat(depth)
  return reply.map((item, idx) => `${indent}${idx + 1}) ${formatRedisReply(item, depth + 1)}`).join('\n')
}

function formatWrappedBulkReply(reply: {
  text: string
  isUtf8: boolean
  truncated: boolean
  byteLength: number
}): string {
  const notes: string[] = []
  if (!reply.isUtf8) {
    notes.push('binary')
  }
  if (reply.truncated) {
    notes.push(`truncated, ${reply.byteLength} bytes`)
  }
  const suffix = notes.length > 0 ? ` [${notes.join(', ')}]` : ''
  return `${JSON.stringify(reply.text)}${suffix}`
}

function formatMapReply(reply: Record<string, RedisReplyValue>, depth: number): string {
  const entries = Object.entries(reply)
  if (entries.length === 0) {
    return '(empty map)'
  }
  const indent = '   '.repeat(depth)
  return entries.map(([key, val]) => `${indent}${key}: ${formatRedisReply(val, depth + 1)}`).join('\n')
}

/** 标量类型（null / boolean / number / string）格式化；非标量返回 null 交由后续分支处理。 */
function formatScalarReply(reply: RedisReplyValue): string | null {
  if (reply === null) {
    return '(nil)'
  }
  if (typeof reply === 'boolean') {
    return reply ? '(true)' : '(false)'
  }
  if (typeof reply === 'number') {
    return Number.isInteger(reply) ? `(integer) ${reply}` : String(reply)
  }
  if (typeof reply === 'string') {
    return formatStringReply(reply)
  }
  return null
}

/**
 * 把 Redis 回复格式化为 `redis-cli` 风格的多行文本（数组用 `1) ...` 编号，嵌套结构缩进）。
 */
export function formatRedisReply(reply: RedisReplyValue, depth = 0): string {
  const scalar = formatScalarReply(reply)
  if (scalar !== null) {
    return scalar
  }
  if (Array.isArray(reply)) {
    return formatArrayReply(reply, depth)
  }
  if (isWrappedBulkString(reply)) {
    return formatWrappedBulkReply(reply)
  }
  return formatMapReply(reply as Record<string, RedisReplyValue>, depth)
}

/** 格式化字节数为易读单位（1.0 KB / 2.3 MB …）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

/** 格式化毫秒 TTL 为易读文本；`-1` 表示无过期，`-2` 表示 key 不存在。 */
export function formatTtl(ttlMs: number): string {
  if (ttlMs === -1) {
    return 'persist'
  }
  if (ttlMs < 0) {
    return '-'
  }
  if (ttlMs < 1000) {
    return `${ttlMs}ms`
  }
  const seconds = ttlMs / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const minutes = seconds / 60
  if (minutes < 60) {
    return `${minutes.toFixed(1)}m`
  }
  const hours = minutes / 60
  if (hours < 24) {
    return `${hours.toFixed(1)}h`
  }
  return `${(hours / 24).toFixed(1)}d`
}

/** 格式化运行时长（秒）为 `1d 02:03:04` 风格文本。 */
export function formatUptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
}
