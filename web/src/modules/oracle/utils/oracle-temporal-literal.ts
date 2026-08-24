/**
 * Oracle DATE / TIMESTAMP 字面量：避免依赖 NLS_DATE_FORMAT 的裸字符串（ORA-01861）。
 * 对齐 services/oracle-service dataio CSV 导入的 TO_DATE / TO_TIMESTAMP。
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
/** ODPI / 选择器常见形态：`YYYY-MM-DD[T ]HH:mm:ss[.fff][Z|±hh:mm]` */
const DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function baseOracleType(dataType?: string): string {
  const raw = (dataType ?? '').trim()
  if (!raw) return ''
  const m = /^([A-Za-z_][\w$#]*)/.exec(raw)
  return (m?.[1] ?? raw).toUpperCase()
}

function isOracleDateType(dataType?: string): boolean {
  return baseOracleType(dataType) === 'DATE'
}

function isOracleTimestampType(dataType?: string): boolean {
  const t = (dataType ?? '').trim().toUpperCase()
  return t.startsWith('TIMESTAMP') || baseOracleType(dataType) === 'TIMESTAMP'
}

function hasTimeZone(dataType?: string): boolean {
  return /TIME\s*ZONE/i.test(dataType ?? '')
}

type TemporalParts = { date: string; time?: string; frac?: string }

function parseTemporalParts(text: string): TemporalParts | null {
  const trimmed = text.trim()
  if (DATE_ONLY_RE.test(trimmed)) return { date: trimmed }
  const m = DATETIME_RE.exec(trimmed)
  if (!m) return null
  return { date: m[1]!, time: m[2]!, frac: m[3] || undefined }
}

function timestampFormat(hasFrac: boolean): string {
  return hasFrac ? 'YYYY-MM-DD HH24:MI:SS.FF' : 'YYYY-MM-DD HH24:MI:SS'
}

/**
 * 将日期/时间字符串转为 Oracle 安全字面量；非时间形态返回 null。
 * @param dataType 列类型（DATE / TIMESTAMP…）；缺省时仅对带时分秒的值做 TO_DATE（ODPI DATE 形态）。
 */
export function toOracleTemporalLiteral(text: string, dataType?: string): string | null {
  const parts = parseTemporalParts(text)
  if (!parts) return null

  const isDate = isOracleDateType(dataType)
  const isTs = isOracleTimestampType(dataType)

  // 无类型提示：仅转换带时间的值，避免把 VARCHAR2 里的纯日期误包成 DATE
  if (!isDate && !isTs) {
    if (!parts.time) return null
    const norm = `${parts.date} ${parts.time}`
    return `TO_DATE(${quoteSqlString(norm)}, 'YYYY-MM-DD HH24:MI:SS')`
  }

  if (isDate) {
    if (!parts.time) return `DATE ${quoteSqlString(parts.date)}`
    const norm = `${parts.date} ${parts.time}`
    return `TO_DATE(${quoteSqlString(norm)}, 'YYYY-MM-DD HH24:MI:SS')`
  }

  // TIMESTAMP / TIMESTAMP WITH [LOCAL] TIME ZONE
  if (!parts.time) {
    return `TIMESTAMP ${quoteSqlString(`${parts.date} 00:00:00`)}`
  }
  const withFrac = `${parts.date} ${parts.time}${parts.frac ?? ''}`
  const fmt = timestampFormat(Boolean(parts.frac))
  if (hasTimeZone(dataType) && /(Z|[+-]\d{2}:?\d{2})$/i.test(text.trim())) {
    const tzFmt = parts.frac
      ? 'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM'
      : 'YYYY-MM-DD HH24:MI:SS TZH:TZM'
    return `TO_TIMESTAMP_TZ(${quoteSqlString(withFrac)}, '${tzFmt}')`
  }
  return `TO_TIMESTAMP(${quoteSqlString(withFrac)}, '${fmt}')`
}
