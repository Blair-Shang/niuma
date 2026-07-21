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

/** 专业级美化（sql-formatter）。失败时回退原文，避免打断编辑。 */
export function formatSql(sql: string, options: FormatSqlOptions = {}): string {
  const text = sql ?? ''
  if (!text.trim()) return text
  const dialect = options.dialect ?? 'generic'
  try {
    return sqlFormat(text, {
      language: formatterLanguage(dialect),
      keywordCase: options.keywordCase ?? 'upper',
      tabWidth: options.tabWidth ?? 2,
    })
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
