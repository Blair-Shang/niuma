export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function qualifiedName(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

export function oracleSelectSeed(
  schema: string | undefined,
  table: string,
  limit = 100,
): string {
  const target = schema ? qualifiedName(schema, table) : quoteIdent(table)
  return `SELECT *\nFROM ${target}\nFETCH FIRST ${limit} ROWS ONLY;\n`
}

export const selectSeed = oracleSelectSeed
