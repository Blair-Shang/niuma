/**
 * MySQL 连接字符集 / 排序规则目录。
 *
 * 对齐 Navicat「客户端字符集」与 DBeaver Driver Properties（characterEncoding /
 * connectionCollation）的常见取值；空 collation 表示仅 SET NAMES <charset>，
 * 使用该字符集在服务器上的默认排序规则。
 */

/** 连接表单常用字符集（顺序：现代默认 → 兼容 → 区域）。 */
export const MYSQL_CHARSET_VALUES = [
  'utf8mb4',
  'utf8mb3',
  'utf8',
  'latin1',
  'ascii',
  'gbk',
  'gb2312',
  'big5',
  'binary',
] as const

export type MysqlCharsetValue = (typeof MYSQL_CHARSET_VALUES)[number]

/** 各字符集下常见排序规则（含 MySQL 5.7 / 8.0 常用项）。 */
export const MYSQL_COLLATIONS_BY_CHARSET: Record<string, readonly string[]> = {
  utf8mb4: [
    'utf8mb4_general_ci',
    'utf8mb4_unicode_ci',
    'utf8mb4_unicode_520_ci',
    'utf8mb4_0900_ai_ci',
    'utf8mb4_0900_as_ci',
    'utf8mb4_bin',
  ],
  utf8mb3: ['utf8mb3_general_ci', 'utf8mb3_unicode_ci', 'utf8mb3_bin'],
  utf8: ['utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
  latin1: ['latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin'],
  ascii: ['ascii_general_ci', 'ascii_bin'],
  gbk: ['gbk_chinese_ci', 'gbk_bin'],
  gb2312: ['gb2312_chinese_ci', 'gb2312_bin'],
  big5: ['big5_chinese_ci', 'big5_bin'],
  binary: ['binary'],
}

/** 规范化字符集；空则回退默认。 */
export function normalizeMysqlCharset(raw: string | undefined, fallback = 'utf8mb4'): string {
  const v = (raw ?? '').trim()
  return v || fallback
}

/** 规范化排序规则；不匹配字符集前缀时清空（跟随字符集默认）。 */
export function normalizeMysqlCollation(charset: string, raw: string | undefined): string {
  const coll = (raw ?? '').trim()
  if (!coll) return ''
  const cs = charset.trim().toLowerCase()
  if (!cs) return coll
  // utf8 / utf8mb3 历史别名互认
  const prefixes = cs === 'utf8' || cs === 'utf8mb3' ? ['utf8_', 'utf8mb3_'] : [`${cs}_`, cs]
  const lower = coll.toLowerCase()
  if (prefixes.some((p) => lower === p.replace(/_$/, '') || lower.startsWith(p))) {
    return coll
  }
  return ''
}

/** 某字符集可选排序规则列表。 */
export function collationsForCharset(charset: string): readonly string[] {
  const cs = charset.trim()
  if (!cs) return []
  return MYSQL_COLLATIONS_BY_CHARSET[cs] ?? MYSQL_COLLATIONS_BY_CHARSET[cs.toLowerCase()] ?? []
}
