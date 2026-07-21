/**
 * Catalog 前缀解析（docs/23）：方言无关。
 *
 * 标准来源优先级：
 * 1. monaco-sql-languages wordRanges（schema.table / alias.col 分段）
 * 2. Monaco 当前词（依赖语言 wordPattern 含 `_` 的 SQL 标识符）
 *
 * 禁止：无 prefix 拉前 N 条再靠 Monaco 模糊分「碰」目标对象。
 */
import type { WordRange } from 'monaco-sql-languages'

export type CatalogPrefix = {
  /** 正在输入的末段标识符（catalog `prefix`） */
  prefix: string
  /** 点号前限定符（schema / 表 / 别名） */
  qualifier?: string
}

type TextModel = {
  getWordUntilPosition(position: {
    lineNumber: number
    column: number
  }): { word: string }
}

type TextPosition = { lineNumber: number; column: number }

function wordTexts(ranges: readonly WordRange[] | undefined): string[] {
  if (!ranges?.length) return []
  return ranges.map((w) => w.text).filter((t) => t.length > 0)
}

/**
 * 解析补全请求用的 qualifier + prefix。
 * `wordRanges` 来自当前槽位的 syntax 项；缺省时退回 Monaco 词。
 */
export function resolveCatalogPrefix(
  model: TextModel,
  position: TextPosition,
  wordRanges?: readonly WordRange[],
): CatalogPrefix {
  const words = wordTexts(wordRanges)
  const caretWord = model.getWordUntilPosition(position).word.trim()

  if (words.length >= 2) {
    return {
      qualifier: words[0],
      prefix: (words.at(-1) ?? caretWord).trim(),
    }
  }

  // 单段：以 Monaco 词为准（wordPattern 已保证 `_` 属标识符）
  const prefix = caretWord || words[0] || ''
  return { prefix }
}

/**
 * 未加引号的 SQL 标识符词法（字母/`_` 开头，后续字母数字/`_`/`$`）。
 * 供 monaco `wordPattern`；带引号标识符分段由 parser `wordRanges` 负责。
 */
export const SQL_IDENT_WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_$]*/g
