export function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
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
