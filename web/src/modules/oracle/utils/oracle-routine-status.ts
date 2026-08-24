/**
 * 编译后核对 ALL_OBJECTS.STATUS / ALL_ERRORS。
 * Oracle ALTER/CREATE 常「成功返回」但对象仍为 INVALID（含 ORA-24344）。
 */

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function objectType(kind: 'procedure' | 'function'): 'PROCEDURE' | 'FUNCTION' {
  return kind === 'function' ? 'FUNCTION' : 'PROCEDURE'
}

/** 将 ALL_OBJECTS.STATUS 转为界面文案键后缀（valid / invalid）；未知值原样返回。 */
export function oracleObjectStatusI18nKey(
  status: string,
): 'statusValid' | 'statusInvalid' | null {
  const u = status.trim().toUpperCase()
  if (u === 'VALID') return 'statusValid'
  if (u === 'INVALID') return 'statusInvalid'
  return null
}

/** 解析字典中的 STATUS（VALID / INVALID）。 */
export function buildOracleRoutineStatusSql(
  schema: string,
  name: string,
  kind: 'procedure' | 'function',
): string {
  const owner = sqlStringLiteral(schema)
  const obj = sqlStringLiteral(name)
  const typ = objectType(kind)
  return (
    `SELECT STATUS FROM ALL_OBJECTS WHERE UPPER(OWNER) = UPPER(${owner}) ` +
    `AND OBJECT_NAME IN (${obj}, UPPER(${obj})) AND OBJECT_TYPE = '${typ}' ` +
    `ORDER BY CASE WHEN OBJECT_NAME = ${obj} THEN 0 ELSE 1 END ` +
    `FETCH FIRST 1 ROWS ONLY`
  )
}

/** 拉取编译错误行（最多 50 条）。 */
export function buildOracleRoutineErrorsSql(
  schema: string,
  name: string,
  kind: 'procedure' | 'function',
): string {
  const owner = sqlStringLiteral(schema)
  const obj = sqlStringLiteral(name)
  const typ = objectType(kind)
  return (
    `SELECT LINE, POSITION, TEXT FROM ALL_ERRORS WHERE UPPER(OWNER) = UPPER(${owner}) ` +
    `AND NAME IN (${obj}, UPPER(${obj})) AND TYPE = '${typ}' ` +
    `ORDER BY SEQUENCE FETCH FIRST 50 ROWS ONLY`
  )
}

export function cellText(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

export function formatOracleRoutineErrors(rows: unknown[][] | undefined): string {
  if (!rows?.length) return ''
  return rows
    .map((row) => {
      const line = cellText(row[0]) || '?'
      const pos = cellText(row[1]) || '?'
      const text = cellText(row[2]) || ''
      return `L${line}:C${pos} ${text}`
    })
    .filter(Boolean)
    .join('\n')
}

export function isOracleInvalidObjectError(msg: string): boolean {
  return /PLS-00905|ORA-0?406[35]|ORA-0?6508|ORA-0?24344|无效状态|object\s+\S+\s+is\s+invalid|invalid\s+(object|state)|compilation\s+error|has\s+errors/i.test(
    msg,
  )
}
