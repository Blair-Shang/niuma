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

/** @deprecated 无参元数据时的回退；有参请用 buildMysqlRoutineCallSql */
export function callRoutineSeed(database: string, name: string, isFunction: boolean): string {
  const q = qualifiedName(database, name)
  if (isFunction) {
    return `-- Call function ${q}\nSELECT ${q}() AS \`result\`;\n`
  }
  return `-- Call procedure ${q}\nCALL ${q}();\n`
}
