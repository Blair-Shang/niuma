/**
 * SQLite 连接树右键 / 双击打开 Query 时的 SQL 种子。
 * SQLite 标识符用双引号（ANSI 标准，亦被 SQLite 接受）。
 */

/** 生成双引号限定名（段内双引号加倍）。 */
export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

export function qualifiedName(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

export function selectSeed(schema: string | undefined, table: string, limit = 100): string {
  const from = schema ? qualifiedName(schema, table) : quoteIdent(table)
  return `SELECT *\nFROM ${from}\nLIMIT ${limit};\n`
}
