/**
 * 注册 Monaco language + LSP completion / diagnostics（不启 sql-languages Worker）。
 */
import type * as Monaco from 'monaco-editor'
import {
  FALLBACK_CLICKHOUSE_LEXICON,
  FALLBACK_DAMENG_LEXICON,
  FALLBACK_KINGBASE_LEXICON,
  FALLBACK_MYSQL_LEXICON,
  FALLBACK_SQLITE_LEXICON,
  FALLBACK_SQLSERVER_LEXICON,
} from './fallback-lexicon'
import {
  CLICKHOUSE_MONACO_LANGUAGE_ID,
  DAMENG_MONACO_LANGUAGE_ID,
  KINGBASE_MONACO_LANGUAGE_ID,
  MYSQL_MONACO_LANGUAGE_ID,
  SQLITE_MONACO_LANGUAGE_ID,
  SQLSERVER_MONACO_LANGUAGE_ID,
} from './language-ids'
import {
  buildSqlMonarch,
  loadSqlLexicon,
  type FetchSqlLexicon,
  type SqlDialect,
  type SqlLexicon,
} from './lexicon'
import {
  buildSqlDocumentUri,
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspLocation,
  type SqlLspBridgeApi,
} from './types'
import { SqlLspClient } from './sql-lsp-client'

const MARKER_OWNER = 'sqllsp'

type AttachedDoc = {
  uri: string
  sessionId: string
  client: SqlLspClient
  version: number
  /** 已推送到服务端的全文；补全/悬停前若不一致则先 flush didChange */
  lastSyncedText: string
  changeDisposable: { dispose: () => void }
  offNotify: () => void
  debounceTimer: ReturnType<typeof setTimeout> | null
}

/**
 * 补全/悬停依赖服务端文档快照。didChange 有防抖时，敲 `.` 会立刻触发补全，
 * 若未先同步，服务端仍是 `on a`（无点），前缀被当成 `a`，列提示要再敲几个字母才出现。
 */
async function ensureDocSynced(
  doc: AttachedDoc,
  model: Monaco.editor.ITextModel,
): Promise<void> {
  const text = model.getValue()
  if (text === doc.lastSyncedText) return
  if (doc.debounceTimer) {
    clearTimeout(doc.debounceTimer)
    doc.debounceTimer = null
  }
  doc.version += 1
  doc.lastSyncedText = text
  await doc.client.didChange(doc.uri, text, doc.version)
}

const attachedByModel = new WeakMap<Monaco.editor.ITextModel, AttachedDoc>()
const clientsBySession = new Map<string, { client: SqlLspClient; refCount: number }>()
/** 同一 model 上的 attach 串行，避免并行 acquire 导致 refCount/dispose 错乱 */
const attachChainByModel = new WeakMap<Monaco.editor.ITextModel, Promise<unknown>>()

const registeredLanguages = new Set<string>()
let monacoRef: typeof Monaco | null = null

async function withModelAttachLock<T>(
  model: Monaco.editor.ITextModel,
  run: () => Promise<T>,
): Promise<T> {
  const prev = attachChainByModel.get(model) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  attachChainByModel.set(
    model,
    prev.then(
      () => gate,
      () => gate,
    ),
  )
  await prev.catch(() => undefined)
  try {
    return await run()
  } finally {
    release()
  }
}
function lspKindToMonaco(
  monaco: typeof Monaco,
  kind: number | undefined,
): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind
  switch (kind) {
    case 2:
      return K.Method
    case 3:
      return K.Function
    case 14:
      return K.Keyword
    case 9:
      return K.Module
    case 7:
      return K.Class
    case 6:
      return K.Variable
    case 5:
      return K.Field
    case 15:
      return K.Snippet
    default:
      return K.Text
  }
}

/** 片段占位（${1:…}）需按 Snippet 插入，内置函数也常用。 */
function insertAsSnippet(
  monaco: typeof Monaco,
  kind: Monaco.languages.CompletionItemKind,
  insertText: string,
): boolean {
  if (kind === monaco.languages.CompletionItemKind.Snippet) return true
  return /\$\{\d/.test(insertText)
}

function applyDiagnostics(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  diagnostics: LspDiagnostic[],
): void {
  const markers: Monaco.editor.IMarkerData[] = diagnostics.map((d) => ({
    severity: toSeverity(monaco, d.severity),
    message: d.message,
    startLineNumber: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    endLineNumber: d.range.end.line + 1,
    endColumn: Math.max(d.range.end.character + 1, d.range.start.character + 2),
    source: d.source || 'sqllsp',
  }))
  monaco.editor.setModelMarkers(model, MARKER_OWNER, markers)
}

function toSeverity(monaco: typeof Monaco, severity: number | undefined): Monaco.MarkerSeverity {
  const S = monaco.MarkerSeverity
  switch (severity) {
    case 1:
      return S.Error
    case 2:
      return S.Warning
    case 3:
      return S.Info
    case 4:
      return S.Hint
    default:
      return S.Error
  }
}

export type EnsureSqlLspLanguageOptions = {
  /** 达梦/金仓：按会话兼容模式刷新词表 */
  sessionId?: string
  compat?: string
  /** 覆盖默认 bridge 拉词表（测试用） */
  fetchLexicon?: FetchSqlLexicon
}

type RegisterLspLanguageOptions = {
  languageId: string
  aliases: string[]
  formatDialect: SqlDialect
  triggerCharacters: string[]
  fetchLexicon: FetchSqlLexicon
  fallbackLexicon: SqlLexicon
  ensureOpts?: EnsureSqlLspLanguageOptions
}

/**
 * 注册方言 Monaco 语言（Monarch 高亮 + 格式化 + LSP 补全）。按 languageId 幂等。
 * Monarch 词表来自后端 lsp.lexicon（失败则 fallback）。
 */
async function ensureSqlLspLanguage(opts: RegisterLspLanguageOptions): Promise<string> {
  const monaco = await import('monaco-editor')
  monacoRef = monaco
  const { languageId } = opts

  const lexicon = await loadSqlLexicon(
    opts.formatDialect,
    opts.ensureOpts?.fetchLexicon ?? opts.fetchLexicon,
    opts.fallbackLexicon,
    { sessionId: opts.ensureOpts?.sessionId, compat: opts.ensureOpts?.compat },
  )

  if (!registeredLanguages.has(languageId)) {
    const existing = monaco.languages.getLanguages().some((l) => l.id === languageId)
    if (!existing) {
      monaco.languages.register({ id: languageId, extensions: ['.sql'], aliases: opts.aliases })
    }
    const { SQL_IDENT_WORD_PATTERN } = await import('@/modules/sql-editor/completion/prefix')
    monaco.languages.setLanguageConfiguration(languageId, {
      wordPattern: SQL_IDENT_WORD_PATTERN,
      comments: { lineComment: '--', blockComment: ['/*', '*/'] },
      brackets: [
        ['(', ')'],
        ['[', ']'],
        ['{', '}'],
      ],
      autoClosingPairs: [
        { open: '(', close: ')' },
        { open: '`', close: '`' },
        { open: "'", close: "'" },
        { open: '"', close: '"' },
      ],
    })

    async function formatText(text: string): Promise<string> {
      const { formatSql } = await import('@/modules/sql-editor/format')
      return formatSql(text, { dialect: opts.formatDialect })
    }

    monaco.languages.registerDocumentFormattingEditProvider(languageId, {
      async provideDocumentFormattingEdits(model) {
        return [{ range: model.getFullModelRange(), text: await formatText(model.getValue()) }]
      },
    })
    monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, {
      async provideDocumentRangeFormattingEdits(model, range) {
        return [{ range, text: await formatText(model.getValueInRange(range)) }]
      },
    })

    monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters: opts.triggerCharacters,
      async provideCompletionItems(model, position) {
        const doc = attachedByModel.get(model)
        if (!doc) {
          return { suggestions: [] }
        }
        try {
          await ensureDocSynced(doc, model)
          const list = await doc.client.completion(doc.uri, {
            line: position.lineNumber - 1,
            character: position.column - 1,
          })
          const word = model.getWordUntilPosition(position)
          const range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          )
          const suggestions = list.items.map((item: LspCompletionItem) => {
            const kind = lspKindToMonaco(monaco, item.kind)
            const insertText = item.insertText || item.label
            const asSnippet = insertAsSnippet(monaco, kind, insertText)
            return {
              label: item.label,
              kind,
              insertText,
              insertTextRules: asSnippet
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              detail: item.detail,
              documentation: item.documentation,
              sortText: item.sortText,
              // 前缀匹配：避免 filterGraceful 把 active 误匹配成 ac
              filterText: item.label,
              range,
            }
          })
          // 目录补全必须 incomplete：敲字后按最新前缀重查，禁止沿用空前缀的前 100 条做本地模糊过滤
          return { suggestions, incomplete: true }
        } catch (err) {
          console.warn('[sql-lsp] completion failed', err)
          return { suggestions: [] }
        }
      },
    })

    monaco.languages.registerHoverProvider(languageId, {
      async provideHover(model, position) {
        const doc = attachedByModel.get(model)
        if (!doc) return null
        try {
          await ensureDocSynced(doc, model)
          const hover = await doc.client.hover(doc.uri, {
            line: position.lineNumber - 1,
            character: position.column - 1,
          })
          if (!hover) return null
          const value = hoverContentsToMarkdown(hover)
          if (!value) return null
          const range = hover.range
            ? new monaco.Range(
                hover.range.start.line + 1,
                hover.range.start.character + 1,
                hover.range.end.line + 1,
                hover.range.end.character + 1,
              )
            : undefined
          return {
            contents: [{ value }],
            range,
          }
        } catch (err) {
          console.warn('[sql-lsp] hover failed', err)
          return null
        }
      },
    })

    monaco.languages.registerDocumentSymbolProvider(languageId, {
      async provideDocumentSymbols(model) {
        const doc = attachedByModel.get(model)
        if (!doc) return []
        try {
          await ensureDocSynced(doc, model)
          const symbols = await doc.client.documentSymbol(doc.uri)
          return symbols.map((s) => toMonacoSymbol(monaco, s))
        } catch (err) {
          console.warn('[sql-lsp] documentSymbol failed', err)
          return []
        }
      },
    })

    monaco.languages.registerDefinitionProvider(languageId, {
      async provideDefinition(model, position) {
        const doc = attachedByModel.get(model)
        if (!doc) return null
        try {
          await ensureDocSynced(doc, model)
          const loc = await doc.client.definition(doc.uri, {
            line: position.lineNumber - 1,
            character: position.column - 1,
          })
          if (!loc) return null
          return locationToMonaco(monaco, model, loc)
        } catch (err) {
          console.warn('[sql-lsp] definition failed', err)
          return null
        }
      },
    })

    monaco.languages.registerSignatureHelpProvider(languageId, {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [','],
      async provideSignatureHelp(model, position) {
        const doc = attachedByModel.get(model)
        if (!doc) return null
        try {
          await ensureDocSynced(doc, model)
          const help = await doc.client.signatureHelp(doc.uri, {
            line: position.lineNumber - 1,
            character: position.column - 1,
          })
          if (!help?.signatures?.length) return null
          return {
            value: {
              signatures: help.signatures.map((s) => ({
                label: s.label,
                documentation: signatureDocToMonaco(s.documentation),
                parameters: (s.parameters || []).map((p) => ({
                  label: p.label,
                  documentation: signatureDocToMonaco(p.documentation),
                })),
              })),
              activeSignature: help.activeSignature ?? 0,
              activeParameter: help.activeParameter ?? 0,
            },
            dispose() {},
          }
        } catch (err) {
          console.warn('[sql-lsp] signatureHelp failed', err)
          return null
        }
      },
    })

    registeredLanguages.add(languageId)
  }

  // 每次确保语言时刷新 Monarch（词表可能随 compat/session 更新；provider 仍只注册一次）
  monaco.languages.setMonarchTokensProvider(languageId, buildSqlMonarch(opts.formatDialect, lexicon))

  return languageId
}

function signatureDocToMonaco(
  doc: string | { kind?: string; value: string } | undefined,
): string | Monaco.IMarkdownString | undefined {
  if (!doc) return undefined
  if (typeof doc === 'string') return doc
  if (doc.value) return { value: doc.value }
  return undefined
}

type LexiconFetcher = FetchSqlLexicon

let mysqlLexiconFetcher: LexiconFetcher | null = null
let damengLexiconFetcher: LexiconFetcher | null = null
let kingbaseLexiconFetcher: LexiconFetcher | null = null
let clickhouseLexiconFetcher: LexiconFetcher | null = null
let sqliteLexiconFetcher: LexiconFetcher | null = null
let sqlserverLexiconFetcher: LexiconFetcher | null = null

/** 由方言 bootstrap 注入 bridge 拉词表实现。 */
export function setMysqlLexiconFetcher(fn: LexiconFetcher): void {
  mysqlLexiconFetcher = fn
}
export function setDamengLexiconFetcher(fn: LexiconFetcher): void {
  damengLexiconFetcher = fn
}
export function setKingbaseLexiconFetcher(fn: LexiconFetcher): void {
  kingbaseLexiconFetcher = fn
}
export function setClickHouseLexiconFetcher(fn: LexiconFetcher): void {
  clickhouseLexiconFetcher = fn
}
export function setSqliteLexiconFetcher(fn: LexiconFetcher): void {
  sqliteLexiconFetcher = fn
}
export function setSqlServerLexiconFetcher(fn: LexiconFetcher): void {
  sqlserverLexiconFetcher = fn
}

function requireFetcher(
  name: string,
  get: () => LexiconFetcher | null,
): LexiconFetcher {
  return async (opts) => {
    const fn = get()
    if (!fn) throw new Error(`${name} lexicon fetcher not set; call set*LexiconFetcher from bootstrap`)
    return fn(opts)
  }
}

/**
 * 注册 `mysql` 语言（Monarch 高亮 + 格式化 + LSP 补全）。幂等。
 */
export async function ensureMysqlLspLanguage(
  ensureOpts?: EnsureSqlLspLanguageOptions,
): Promise<string> {
  return ensureSqlLspLanguage({
    languageId: MYSQL_MONACO_LANGUAGE_ID,
    aliases: ['MySQL'],
    formatDialect: 'mysql',
    triggerCharacters: ['.', ' ', '`'],
    fetchLexicon: ensureOpts?.fetchLexicon ?? requireFetcher('mysql', () => mysqlLexiconFetcher),
    fallbackLexicon: FALLBACK_MYSQL_LEXICON,
    ensureOpts,
  })
}

/**
 * 注册 `dameng` 语言（Monarch 高亮 + 格式化 + LSP 补全）。幂等。
 */
export async function ensureDamengLspLanguage(
  ensureOpts?: EnsureSqlLspLanguageOptions,
): Promise<string> {
  return ensureSqlLspLanguage({
    languageId: DAMENG_MONACO_LANGUAGE_ID,
    aliases: ['Dameng', 'DM'],
    formatDialect: 'dameng',
    triggerCharacters: ['.', ' ', '"'],
    fetchLexicon: ensureOpts?.fetchLexicon ?? requireFetcher('dameng', () => damengLexiconFetcher),
    fallbackLexicon: FALLBACK_DAMENG_LEXICON,
    ensureOpts,
  })
}

/**
 * 注册 `kingbase` 语言（Monarch 高亮 + 格式化 + LSP 补全）。幂等。
 */
export async function ensureKingbaseLspLanguage(
  ensureOpts?: EnsureSqlLspLanguageOptions,
): Promise<string> {
  return ensureSqlLspLanguage({
    languageId: KINGBASE_MONACO_LANGUAGE_ID,
    aliases: ['Kingbase', 'KingbaseES'],
    formatDialect: 'kingbase',
    triggerCharacters: ['.', ' ', '"', '_'],
    fetchLexicon: ensureOpts?.fetchLexicon ?? requireFetcher('kingbase', () => kingbaseLexiconFetcher),
    fallbackLexicon: FALLBACK_KINGBASE_LEXICON,
    ensureOpts,
  })
}

/**
 * 注册 `clickhouse` 语言（Monarch 高亮 + 格式化 + LSP 补全）。幂等。
 */
export async function ensureClickHouseLspLanguage(
  ensureOpts?: EnsureSqlLspLanguageOptions,
): Promise<string> {
  return ensureSqlLspLanguage({
    languageId: CLICKHOUSE_MONACO_LANGUAGE_ID,
    aliases: ['ClickHouse'],
    formatDialect: 'clickhouse',
    triggerCharacters: ['.', ' ', '`', '_'],
    fetchLexicon: ensureOpts?.fetchLexicon ?? requireFetcher('clickhouse', () => clickhouseLexiconFetcher),
    fallbackLexicon: FALLBACK_CLICKHOUSE_LEXICON,
    ensureOpts,
  })
}

/**
 * 注册 `sqlite` 语言（Monarch 高亮 + 格式化 + LSP 补全）。幂等。
 */
export async function ensureSqliteLspLanguage(
  ensureOpts?: EnsureSqlLspLanguageOptions,
): Promise<string> {
  return ensureSqlLspLanguage({
    languageId: SQLITE_MONACO_LANGUAGE_ID,
    aliases: ['SQLite'],
    formatDialect: 'sqlite',
    triggerCharacters: ['.', ' ', '"', '[', '_'],
    fetchLexicon: ensureOpts?.fetchLexicon ?? requireFetcher('sqlite', () => sqliteLexiconFetcher),
    fallbackLexicon: FALLBACK_SQLITE_LEXICON,
    ensureOpts,
  })
}

/**
 * 注册 `sqlserver` 语言（Monarch 高亮 + 格式化 + LSP 补全）。幂等。
 */
export async function ensureSqlServerLspLanguage(
  ensureOpts?: EnsureSqlLspLanguageOptions,
): Promise<string> {
  return ensureSqlLspLanguage({
    languageId: SQLSERVER_MONACO_LANGUAGE_ID,
    aliases: ['SQL Server', 'T-SQL', 'TSQL'],
    formatDialect: 'sqlserver',
    triggerCharacters: ['.', ' ', '[', '@', '_'],
    fetchLexicon: ensureOpts?.fetchLexicon ?? requireFetcher('sqlserver', () => sqlserverLexiconFetcher),
    fallbackLexicon: FALLBACK_SQLSERVER_LEXICON,
    ensureOpts,
  })
}

function hoverContentsToMarkdown(hover: LspHover): string {
  const c = hover.contents
  if (typeof c === 'string') return c
  if (c && typeof c === 'object' && typeof c.value === 'string') return c.value
  return ''
}

function toMonacoSymbol(
  monaco: typeof Monaco,
  s: LspDocumentSymbol,
): Monaco.languages.DocumentSymbol {
  return {
    name: s.name,
    detail: s.detail || '',
    kind: lspSymbolKindToMonaco(monaco, s.kind),
    range: new monaco.Range(
      s.range.start.line + 1,
      s.range.start.character + 1,
      s.range.end.line + 1,
      s.range.end.character + 1,
    ),
    selectionRange: new monaco.Range(
      s.selectionRange.start.line + 1,
      s.selectionRange.start.character + 1,
      s.selectionRange.end.line + 1,
      s.selectionRange.end.character + 1,
    ),
    tags: [],
    children: (s.children || []).map((c) => toMonacoSymbol(monaco, c)),
  }
}

function lspSymbolKindToMonaco(
  monaco: typeof Monaco,
  kind: number,
): Monaco.languages.SymbolKind {
  const K = monaco.languages.SymbolKind
  switch (kind) {
    case 5:
      return K.Class
    case 6:
      return K.Method
    case 12:
      return K.Function
    case 13:
      return K.Variable
    case 24:
      return K.Event
    default:
      return K.Object
  }
}

function locationToMonaco(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  loc: LspLocation,
): Monaco.languages.Location {
  return {
    uri: model.uri,
    range: new monaco.Range(
      loc.range.start.line + 1,
      loc.range.start.character + 1,
      loc.range.end.line + 1,
      loc.range.end.character + 1,
    ),
  }
}

async function acquireClient(
  namespace: string,
  sessionId: string,
  api: SqlLspBridgeApi,
  _database?: string,
): Promise<SqlLspClient> {
  const key = `${namespace}:${sessionId}`
  let entry = clientsBySession.get(key)
  if (!entry) {
    const client = new SqlLspClient(namespace, api)
    await client.connect(sessionId)
    entry = { client, refCount: 0 }
    clientsBySession.set(key, entry)
  }
  // 默认库按文档 uri 设置，避免同 session 多编辑器互相覆盖
  entry.refCount += 1
  return entry.client
}

async function releaseClient(namespace: string, sessionId: string): Promise<void> {
  const key = `${namespace}:${sessionId}`
  const entry = clientsBySession.get(key)
  if (!entry) return
  entry.refCount -= 1
  if (entry.refCount > 0) return
  clientsBySession.delete(key)
  await entry.client.disconnect()
}

export type AttachSqlLspOptions = {
  model: Monaco.editor.ITextModel
  namespace: string
  sessionId: string
  editorId: string
  api: SqlLspBridgeApi
  /** 编辑器当前库（MySQL=库；金仓=PG database；达梦=schema） */
  database?: string
  /** 金仓/PG 系默认 schema；MySQL 可省略 */
  schema?: string
  /** didChange 防抖 ms */
  debounceMs?: number
  /** 注册方言语言；默认 ensureMysqlLspLanguage（可带 session 刷新词表） */
  ensureLanguage?: (opts?: EnsureSqlLspLanguageOptions) => Promise<string>
}

/**
 * 将 Monaco model 绑定到 LSP 文档；返回 dispose。
 */
export async function attachSqlLsp(options: AttachSqlLspOptions): Promise<() => void> {
  const monaco = monacoRef ?? (await import('monaco-editor'))
  monacoRef = monaco
  await (options.ensureLanguage ?? ensureMysqlLspLanguage)({
    sessionId: options.sessionId,
  })

  return withModelAttachLock(options.model, async () => {
    const existing = attachedByModel.get(options.model)
    if (existing) {
      existing.changeDisposable.dispose()
      existing.offNotify()
      if (existing.debounceTimer) clearTimeout(existing.debounceTimer)
      try {
        await existing.client.didClose(existing.uri)
      } catch {
        /* ignore */
      }
      await releaseClient(options.namespace, existing.sessionId)
      attachedByModel.delete(options.model)
    }

    const client = await acquireClient(
      options.namespace,
      options.sessionId,
      options.api,
      options.database,
    )
    const uri = buildSqlDocumentUri(options.namespace, options.sessionId, options.editorId)
    console.info(
      `[sql-lsp] attach dialect=${options.namespace} editorId=${options.editorId} uri=${uri} database=${options.database ?? ''} schema=${options.schema ?? ''}`,
    )
    let version = 1
    const initialText = options.model.getValue()
    const debounceMs = options.debounceMs ?? 200
    const doc: AttachedDoc = {
      uri,
      sessionId: options.sessionId,
      client,
      version,
      lastSyncedText: initialText,
      changeDisposable: { dispose() {} },
      offNotify: () => {},
      debounceTimer: null,
    }

    // 必须先订阅通知，再 didOpen，否则同步推送的首诊会丢失
    doc.offNotify = client.onNotification((method, params) => {
      if (method !== 'textDocument/publishDiagnostics') return
      const p = params as { uri?: string; diagnostics?: LspDiagnostic[] }
      if (p.uri !== uri) return
      applyDiagnostics(monaco, options.model, p.diagnostics ?? [])
    })

    if (options.database !== undefined || options.schema !== undefined) {
      try {
        await client.setSuggestDatabase(
          options.database ?? '',
          uri,
          options.schema,
        )
      } catch (err) {
        console.warn('[sql-lsp] setSuggestDatabase failed', err)
      }
    }

    await client.didOpen(uri, initialText, version)

    // 诊断可防抖；补全/悬停走 ensureDocSynced 即时 flush
    doc.changeDisposable = options.model.onDidChangeContent(() => {
      if (doc.debounceTimer) clearTimeout(doc.debounceTimer)
      doc.debounceTimer = setTimeout(() => {
        const text = options.model.getValue()
        if (text === doc.lastSyncedText) return
        doc.version += 1
        doc.lastSyncedText = text
        void client.didChange(uri, text, doc.version).catch(() => undefined)
      }, debounceMs)
    })

    attachedByModel.set(options.model, doc)

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (doc.debounceTimer) clearTimeout(doc.debounceTimer)
      doc.changeDisposable.dispose()
      doc.offNotify()
      monaco.editor.setModelMarkers(options.model, MARKER_OWNER, [])
      attachedByModel.delete(options.model)
      // 与后续 attach 共用锁，避免 refCount 与 disconnect 交错
      void withModelAttachLock(options.model, async () => {
        try {
          await client.didClose(uri)
        } catch {
          /* ignore */
        }
        await releaseClient(options.namespace, options.sessionId)
      })
    }
  })
}
