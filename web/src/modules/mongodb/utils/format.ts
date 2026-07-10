import type { MongoDocument } from '@/api/types/mongodb'

/** 将 MongoDB _id 格式化为表格展示文本。 */
export function formatMongoId(id: unknown): string {
  if (id == null) {
    return ''
  }
  if (typeof id === 'object' && id !== null && '$oid' in id) {
    return String((id as { $oid: string }).$oid)
  }
  if (typeof id === 'string' || typeof id === 'number') {
    return String(id)
  }
  return JSON.stringify(id)
}

/** 文档 JSON 预览（截断过长字段）。 */
export function previewMongoDocument(doc: MongoDocument, maxLen = 120): string {
  const text = JSON.stringify(doc)
  if (text.length <= maxLen) {
    return text
  }
  return `${text.slice(0, maxLen)}…`
}

/** 美化 JSON 字符串。 */
export function formatMongoJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

/** 解析用户编辑的 JSON 文本。 */
export function parseMongoJson(text: string): MongoDocument {
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('document must be a JSON object')
  }
  return parsed as MongoDocument
}
