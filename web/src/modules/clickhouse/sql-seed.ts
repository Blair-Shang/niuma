export function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

/** ClickHouse 字符串字面量（单引号；内部 ' 写成 ''）。 */
export function quoteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function qualifiedName(database: string, name: string): string {
  return `${quoteIdent(database)}.${quoteIdent(name)}`
}

export function clickhouseSelectSeed(
  database: string | undefined,
  table: string,
  limit = 100,
): string {
  const target = database ? qualifiedName(database, table) : quoteIdent(table)
  return `SELECT *\nFROM ${target}\nLIMIT ${limit};\n`
}

export const selectSeed = clickhouseSelectSeed
