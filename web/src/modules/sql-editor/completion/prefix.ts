/**
 * Catalog 前缀解析（docs/23）：方言无关。
 *
 * 标准来源优先级：
 * 1. wordRanges（schema.table / alias.col 分段，LSP 或遗留 parser）
 * 2. Monaco 当前词（依赖语言 wordPattern 含 `_` 的 SQL 标识符）
 *
 * 禁止：无 prefix 拉前 N 条再靠 Monaco 模糊分「碰」目标对象。
 */

export type CatalogPrefix = {
  /** 正在输入的末段标识符（catalog `prefix`） */
  prefix: string
  /** 点号前限定符（schema / 表 / 别名） */
  qualifier?: string
}

/** 与历史 monaco-sql-languages WordRange 对齐的最小形状 */
export type WordRange = { text: string }

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
 * 供 monaco `wordPattern`；带引号标识符分段由 parser `wordRanges` 负责。
 */
export const SQL_IDENT_WORD_PATTERN =
  /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g

/**
 * 从 wordRanges + Monaco 当前词解析 catalog 前缀。
 */
export function resolveCatalogPrefix(
  model: TextModel,
  position: TextPosition,
  wordRanges?: readonly WordRange[],
): CatalogPrefix {
  const texts = wordTexts(wordRanges)
  if (texts.length >= 2) {
    return {
      qualifier: texts[texts.length - 2],
      prefix: texts[texts.length - 1] ?? '',
    }
  }
  if (texts.length === 1) {
    return { prefix: texts[0] ?? '' }
  }
  const word = model.getWordUntilPosition(position).word
  return { prefix: word }
}
