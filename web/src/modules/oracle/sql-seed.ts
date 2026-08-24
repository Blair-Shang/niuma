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

/** 序列取值种子。 */
export function sequenceNextvalSeed(schema: string, name: string): string {
  const qn = qualifiedName(schema, name)
  return `-- Sequence ${qn}\nSELECT ${qn}.NEXTVAL AS ${quoteIdent('next_val')} FROM DUAL;\n`
}

/** 当前会话上次 NEXTVAL 之后可用；未调用 NEXTVAL 时会报错。 */
export function sequenceCurrvalSeed(schema: string, name: string): string {
  const qn = qualifiedName(schema, name)
  return (
    `-- Sequence ${qn} (requires NEXTVAL in this session first)\n` +
    `SELECT ${qn}.CURRVAL AS ${quoteIdent('curr_val')} FROM DUAL;\n`
  )
}

/** 无参元数据时的回退调用模板。Oracle 禁止空 DECLARE 段。 */
export function callRoutineSeed(schema: string, name: string, isFunction: boolean): string {
  const q = qualifiedName(schema, name)
  if (isFunction) {
    return `-- Call function ${q}\nSELECT ${q}() AS ${quoteIdent('result')} FROM DUAL;\n`
  }
  return (
    `-- Call procedure ${q}\n` +
    `BEGIN\n` +
    `  ${q}();\n` +
    `END;\n` +
    `/\n`
  )
}
