import type { OracleObjectKind } from '@/modules/oracle/types/object-script'

const IDENT = '(?:"([^"]+)"|\'([^\']+)\'|([a-zA-Z0-9_$\\u0080-\\uffff]+))'

function pick(...groups: Array<string | undefined>): string | null {
  return groups.find((group) => Boolean(group?.trim()))?.trim() ?? null
}

export function parseOracleObjectNameFromSql(sql: string, kind: OracleObjectKind): string | null {
  const type = kind === 'package' ? 'package(?:\\s+body)?' : kind
  const match = new RegExp(`^\\s*create\\s+(?:or\\s+replace\\s+)?${type}\\s+${IDENT}(?:\\s*\\.\\s*${IDENT})?`, 'i').exec(sql.trim())
  if (!match) return null
  return pick(match[4], match[5], match[6]) ?? pick(match[1], match[2], match[3])
}

export function toReplaceSql(sql: string): string {
  const value = sql.trim()
  return /^create\s+or\s+replace\s+/i.test(value) ? value : value.replace(/^create\s+/i, 'CREATE OR REPLACE ')
}

export function normalizeOracleObjectDdlForEdit(ddl: string): string {
  return toReplaceSql(ddl).replace(/^(.+)\n/, (line) => line.replace(/ {2,}/g, ' '))
}
