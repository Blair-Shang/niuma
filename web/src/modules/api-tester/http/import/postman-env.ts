/**
 * Postman Environment JSON → 环境变量。关闭的变量跳过。
 */
export interface ImportedEnvironment {
  name: string
  vars: Record<string, string>
}

/** 是 Postman 环境文件，而不是集合或 OpenAPI。 */
export function isPostmanEnvironment(root: Record<string, unknown>): boolean {
  if (!Array.isArray(root.values)) return false
  if (root.info || root.openapi || root.swagger) return false
  return root.values.every((row) => !row || typeof row !== 'object' || 'key' in (row as object))
}

/** 解析环境。不是该格式时返回 null。 */
export function importPostmanEnvironment(root: Record<string, unknown>): ImportedEnvironment | null {
  if (!isPostmanEnvironment(root)) return null
  const vars: Record<string, string> = {}
  for (const row of root.values as unknown[]) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (item.enabled === false) continue
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    if (!key) continue
    vars[key] = item.value == null ? '' : String(item.value)
  }
  const name = typeof root.name === 'string' && root.name.trim() ? root.name.trim() : 'Postman'
  return { name, vars }
}
