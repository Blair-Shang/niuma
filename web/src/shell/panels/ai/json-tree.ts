/** JSON 树：条目、预览与默认展开，供气泡内浏览大对象。 */

export const JSON_TREE_PAGE = 200
export const JSON_TREE_AUTO_OPEN_MAX = 80

export type JsonValueKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'other'

export type JsonEntry = { key: string; value: unknown }

/** 对象或数组视为可展开容器。 */
export function isJsonContainer(v: unknown): v is object {
  return v !== null && typeof v === 'object'
}

/** 识别渲染用的值类型。 */
export function jsonKind(v: unknown): JsonValueKind {
  if (v === null) {
    return 'null'
  }
  if (Array.isArray(v)) {
    return 'array'
  }
  switch (typeof v) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'object'
    default:
      return 'other'
  }
}

/** 容器大小或标量 JSON 字面量。 */
export function jsonPreview(v: unknown): string {
  switch (jsonKind(v)) {
    case 'null':
      return 'null'
    case 'array':
      return `Array(${(v as unknown[]).length})`
    case 'object':
      return `Object(${Object.keys(v as object).length})`
    case 'string':
    case 'number':
    case 'boolean':
      return JSON.stringify(v)
    default:
      return typeof v
  }
}

/** 对象按键、数组按下标展开为一层条目。 */
export function jsonEntries(v: unknown): JsonEntry[] {
  if (!isJsonContainer(v)) {
    return []
  }
  if (Array.isArray(v)) {
    return v.map((value, i) => ({ key: String(i), value }))
  }
  return Object.entries(v as Record<string, unknown>).map(([key, value]) => ({ key, value }))
}

/**
 * 根层与一层以内、条目不太多的容器默认展开，避免只看到 Object(n)。
 * 更深或超大集合保持折叠，由用户点开或「展开全部」。
 */
export function defaultNodeOpen(depth: number, value: unknown): boolean {
  if (depth <= 0) {
    return true
  }
  if (depth > 1 || !isJsonContainer(value)) {
    return false
  }
  const n = jsonEntries(value).length
  return n > 0 && n <= JSON_TREE_AUTO_OPEN_MAX
}

/** 格式化整段 JSON；失败时回退原文。 */
export function prettyJson(value: unknown, fallback: string): string {
  try {
    const text = JSON.stringify(value, null, 2)
    return text ?? fallback
  } catch {
    return fallback
  }
}
