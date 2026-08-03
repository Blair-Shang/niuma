/**
 * 方言词表（关键字 + 内置函数）：后端 lsp.lexicon 为唯一源，前端生成 Monarch。
 * 拉取失败时用 fallback，保证编辑器仍可着色。
 */
import type * as Monaco from 'monaco-editor'

export type SqlDialect = 'mysql' | 'dameng' | 'kingbase' | 'clickhouse' | 'sqlite'

export type SqlLexicon = {
  keywords: string[]
  functions: string[]
  /** 达梦/金仓兼容模式，如 oracle / mysql / pg；缓存键用 */
  compat?: string
}

export type FetchSqlLexicon = (opts?: {
  sessionId?: string
  compat?: string
}) => Promise<SqlLexicon>

const lexiconCache = new Map<string, SqlLexicon>()

function cacheKey(dialect: SqlDialect, lex: SqlLexicon, opts?: { sessionId?: string; compat?: string }): string {
  const compat = (lex.compat || opts?.compat || '').trim().toLowerCase() || 'default'
  // session 仅影响首次解析 compat；缓存按方言+compat，避免同兼容模式重复请求
  return `${dialect}:${compat}`
}

/** 规范化并去重（大小写不敏感）。 */
export function normalizeLexicon(raw: Partial<SqlLexicon> | null | undefined): SqlLexicon | null {
  if (!raw) return null
  const keywords = uniqWords(raw.keywords)
  const functions = uniqWords(raw.functions)
  if (keywords.length === 0 && functions.length === 0) return null
  return {
    keywords,
    functions,
    compat: typeof raw.compat === 'string' ? raw.compat : undefined,
  }
}

function uniqWords(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const w = item.trim()
    if (!w) continue
    const key = w.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(w)
  }
  return out
}

/**
 * 拉取词表（带缓存）；失败或空结果回退 fallback。
 */
export async function loadSqlLexicon(
  dialect: SqlDialect,
  fetch: FetchSqlLexicon,
  fallback: SqlLexicon,
  opts?: { sessionId?: string; compat?: string },
): Promise<SqlLexicon> {
  const sessionKey = opts?.sessionId
    ? `${dialect}:session:${opts.sessionId}`
    : null
  if (sessionKey) {
    const hit = lexiconCache.get(sessionKey)
    if (hit) return hit
  }
  if (opts?.compat) {
    const hit = lexiconCache.get(`${dialect}:${opts.compat.trim().toLowerCase()}`)
    if (hit) return hit
  }
  if (!opts?.sessionId && !opts?.compat) {
    const hit = lexiconCache.get(`${dialect}:default`)
    if (hit) return hit
  }

  const hint = sessionKey || `${dialect}:${(opts?.compat || 'default').toLowerCase()}`
  try {
    const raw = await fetch(opts)
    const lex = normalizeLexicon(raw)
    if (lex && (lex.keywords.length > 0 || lex.functions.length > 0)) {
      const key = cacheKey(dialect, lex, opts)
      lexiconCache.set(key, lex)
      if (!opts?.sessionId && !opts?.compat) {
        lexiconCache.set(`${dialect}:default`, lex)
      }
      if (lex.compat) {
        lexiconCache.set(`${dialect}:${lex.compat.trim().toLowerCase() || 'default'}`, lex)
      }
      if (sessionKey) {
        lexiconCache.set(sessionKey, lex)
      }
      return lex
    }
    console.warn(
      `[sql-lsp] lexicon empty from backend (${hint}), using fallback`,
      { keywords: raw?.keywords?.length ?? 0, functions: raw?.functions?.length ?? 0 },
    )
  } catch (err) {
    console.warn(`[sql-lsp] lexicon fetch failed (${hint}), using fallback`, err)
  }
  // 失败不写入缓存，便于服务就绪后重试
  return normalizeLexicon(fallback) ?? fallback
}

/** 供测试或热更新清空缓存。 */
export function clearSqlLexiconCache(): void {
  lexiconCache.clear()
}

const WORD_CHUNK = 80

function escapeRegexWord(w: string): string {
  return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 将词表拆成多条 Monarch 规则，避免单条正则过长。 */
export function wordRules(
  words: string[],
  token: string,
): Array<[RegExp, string]> {
  const list = uniqWords(words)
  if (list.length === 0) return []
  const rules: Array<[RegExp, string]> = []
  for (let i = 0; i < list.length; i += WORD_CHUNK) {
    const chunk = list.slice(i, i + WORD_CHUNK).map(escapeRegexWord).join('|')
    rules.push([new RegExp(`\\b(?:${chunk})\\b`), token])
  }
  return rules
}

/**
 * 由后端词表生成方言 Monarch（结构与原先手写规则一致）。
 */
export function buildSqlMonarch(
  dialect: SqlDialect,
  lexicon: SqlLexicon,
): Monaco.languages.IMonarchLanguage {
  const keywordRules = wordRules(lexicon.keywords, 'keyword')
  const functionRules = wordRules(lexicon.functions, 'predefined')

  const root: Monaco.languages.IMonarchLanguageRule[] = [
    [/--.*$/, 'comment'],
    [/\/\*/, 'comment', '@comment'],
  ]

  if (dialect === 'mysql') {
    root.push([/#[^\n]*/, 'comment'])
  }

  root.push(...keywordRules, ...functionRules)

  if (dialect === 'kingbase') {
    root.push([/\$[a-zA-Z_][\w]*\$/, 'string.quote'], [/\$\$/, 'string.quote'])
  }

  if (dialect === 'mysql' || dialect === 'clickhouse') {
    root.push(
      [/'([^'\\]|\\.)*'/, 'string'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/`[^`]*`/, 'identifier'],
    )
  } else {
    root.push(
      [/'([^']|'')*'/, 'string'],
      [/"([^"]|"")*"/, 'identifier'],
    )
  }

  root.push(
    [/[0-9]+(\.[0-9]+)?/, 'number'],
    [/[a-zA-Z_][\w$]*/, 'identifier'],
    [/[{}()\[\]]/, '@brackets'],
    [dialect === 'mysql' || dialect === 'clickhouse' ? /[;,.]/ : /[;,./]/, 'delimiter'],
    [/[<>=!+\-*/%]/, 'operator'],
  )

  return {
    defaultToken: '',
    ignoreCase: true,
    // 与 monaco 内置 sql 一致：predefined → predefined.sql，主题才有品红高亮
    tokenPostfix: '.sql',
    tokenizer: {
      root,
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  }
}
