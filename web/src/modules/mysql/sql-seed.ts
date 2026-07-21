/**
 * MySQL 连接树右键 / 双击打开 Query 时的 SQL 种子。
 */

/** 生成安全的反引号限定名（段内反引号加倍）。 */
export function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

export function qualifiedName(database: string, name: string): string {
  return `${quoteIdent(database)}.${quoteIdent(name)}`
}

export function selectSeed(database: string, table: string, limit = 100): string {
  return `SELECT *\nFROM ${qualifiedName(database, table)}\nLIMIT ${limit};\n`
}

export function callRoutineSeed(database: string, name: string, isFunction: boolean): string {
  const q = qualifiedName(database, name)
  if (isFunction) {
    return `SELECT ${q}(/* args */);\n`
  }
  return `CALL ${q}(/* args */);\n`
}
