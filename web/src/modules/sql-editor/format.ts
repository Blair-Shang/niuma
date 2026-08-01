/**
 * SQL 格式化 / 压缩统一入口（sql-formatter）。
 * 仅依赖 SqlDialect，后续换库或加 Oracle/达梦规则只改 dialect 映射。
 */
import { format as sqlFormat, type SqlLanguage } from 'sql-formatter'
import { resolveSqlDialectProfile, type SqlDialect } from './dialect'

export type { SqlDialect }

export interface FormatSqlOptions {
  dialect?: SqlDialect
  /** 关键字大小写；默认 upper */
  keywordCase?: 'preserve' | 'upper' | 'lower'
  tabWidth?: number
}

function formatterLanguage(dialect: SqlDialect): SqlLanguage {
  return resolveSqlDialectProfile(dialect).formatterLanguage as SqlLanguage
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatCore(sql: string, options: FormatSqlOptions, dialect: SqlDialect): string {
  return sqlFormat(sql, {
    language: formatterLanguage(dialect),
    keywordCase: options.keywordCase ?? 'upper',
    tabWidth: options.tabWidth ?? 2,
  })
}

/**
 * MySQL 客户端 DELIMITER 块：先按指令切段，格式化过程体后再拼回，
 * 避免 sql-formatter 把 `//` 拆成 `/ /`、把 `DELIMITER ;` 粘坏。
 */
function formatMysqlWithDelimiter(sql: string, options: FormatSqlOptions): string {
  const newline = sql.includes('\r\n') ? '\r\n' : '\n'
  const lines = sql.split(/\r?\n/)
  let delimiter = ';'
  const out: string[] = []
  let buffer: string[] = []

  const flush = (): void => {
    if (buffer.length === 0) return
    let chunk = buffer.join(newline)
    buffer = []
    const trimmed = chunk.trim()
    if (!trimmed) {
      out.push(chunk)
      return
    }

    let trailing = ''
    if (delimiter !== ';') {
      const re = new RegExp(`\\s*${escapeRegExp(delimiter)}\\s*$`)
      if (re.test(chunk)) {
        trailing = delimiter
        chunk = chunk.replace(re, '')
      }
    }

    let formatted: string
    try {
      formatted = formatCore(chunk, options, 'mysql')
    } catch {
      formatted = chunk
    }

    if (trailing) {
      formatted = formatted.replace(/\s*;?\s*$/, '')
      // 与模板一致：结束符跟在最后一行（如 END //）
      formatted = `${formatted} ${trailing}`
    }
    out.push(formatted)
  }

  for (const line of lines) {
    const directive = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i)
    if (directive) {
      flush()
      delimiter = directive[1] ?? ';'
      out.push(line)
      continue
    }
    buffer.push(line)
  }
  flush()
  return out.join(newline)
}

/** 专业级美化（sql-formatter）。失败时回退原文，避免打断编辑。 */
export function formatSql(sql: string, options: FormatSqlOptions = {}): string {
  const text = sql ?? ''
  if (!text.trim()) return text
  const dialect = options.dialect ?? 'generic'
  try {
    if (dialect === 'mysql' && /^\s*DELIMITER\b/im.test(text)) {
      return formatMysqlWithDelimiter(text, options)
    }
    return formatCore(text, options, dialect)
  } catch {
    return text
  }
}

/**
 * 压缩空白（保留引号内原文与 SQL 引号转义）。
 * 与格式化对称：压缩不走 formatter 的「再展开」，避免无意义往返。
 */
export function compressSql(sql: string): string {
  let out = ''
  let quote: "'" | '"' | null = null
  let pendingSpace = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!
    if (quote) {
      out += ch
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          out += quote
          i++
        } else {
          quote = null
        }
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      if (pendingSpace && out.length > 0) {
        out += ' '
        pendingSpace = false
      }
      quote = ch
      out += ch
      continue
    }
    if (/\s/.test(ch)) {
      pendingSpace = true
      continue
    }
    if (pendingSpace && out.length > 0) {
      out += ' '
      pendingSpace = false
    }
    out += ch
  }
  return out.trim()
}

/** @deprecated 兼容旧名；请用 formatSql / compressSql */
export const formatSqlText = (sql: string, dialect: SqlDialect = 'vastbase') =>
  formatSql(sql, { dialect })

/** @deprecated */
export const compressSqlText = compressSql
