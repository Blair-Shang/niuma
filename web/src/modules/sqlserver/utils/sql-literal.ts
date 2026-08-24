/** SQL Server 浏览行编辑 / INSERT / WHERE 字面量。字符串用 N'…'。 */

export function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') {
    return `N'${JSON.stringify(value).replaceAll("'", "''")}'`
  }
  const text = String(value)
  if (text.toUpperCase() === 'NULL') return 'NULL'
  return `N'${text.replaceAll("'", "''")}'`
}
