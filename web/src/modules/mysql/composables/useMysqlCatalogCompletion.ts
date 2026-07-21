/**
 * MySQL 内置 `sql` / `mysql` 语言的轻量目录补全（P0 无 monaco-sql-languages 槽位时的兜底）。
 * 触发：`.` 与标识符输入；启发式识别 db. / table. / FROM|JOIN 上下文。
 */
import * as monaco from 'monaco-editor'
import { onUnmounted, watch, type Ref } from 'vue'
import { mysqlCatalogClient } from '@/modules/mysql/completion/catalog-client'
import {
  cachedColumns,
  cachedSchemas,
  cachedTables,
} from '@/modules/sql-editor/completion/cache'
import { catalogLimitForPrefix } from '@/modules/sql-editor/completion/catalog-limit'
import type { SqlSuggestScope } from '@/modules/sql-editor/completion/types'

function quoteMysqlIdent(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name
  return '`' + name.replace(/`/g, '``') + '`'
}

function stripIdent(raw: string): string {
  return raw.replace(/^[`"\[]+|[`"\]]+$/g, '').trim()
}

type SuggestKind = 'schemas' | 'tables' | 'columns'

function classifyContext(
  linePrefix: string,
  defaultDb: string,
): {
  kind: SuggestKind
  schema: string
  table?: string
  prefix: string
} {
  const m = linePrefix.match(/([`"'A-Za-z0-9_\.]+)$/)
  const token = m?.[1] ?? ''
  const parts = token.split('.').map(stripIdent).filter(Boolean)
  const prefix = token.endsWith('.') ? '' : (parts.at(-1) ?? '')

  if (token.includes('.')) {
    if (parts.length >= 2 && token.endsWith('.')) {
      const head = parts[0]!
      if (!defaultDb || head === defaultDb) {
        return { kind: 'tables', schema: head || defaultDb, prefix: '' }
      }
      return { kind: 'columns', schema: defaultDb, table: head, prefix: '' }
    }
    if (parts.length >= 3) {
      return {
        kind: 'columns',
        schema: parts[0]!,
        table: parts[1]!,
        prefix,
      }
    }
    if (parts.length === 2) {
      const head = parts[0]!
      if (head === defaultDb) {
        return { kind: 'tables', schema: head, prefix }
      }
      return { kind: 'columns', schema: defaultDb || head, table: head, prefix }
    }
  }

  const before = linePrefix.slice(0, Math.max(0, linePrefix.length - token.length))
  if (/\b(from|join|update|into|table)\s+$/i.test(before)) {
    return { kind: 'tables', schema: defaultDb, prefix }
  }
  if (/\b(use|database)\s+$/i.test(before)) {
    return { kind: 'schemas', schema: defaultDb, prefix }
  }
  if (!defaultDb) {
    return { kind: 'schemas', schema: '', prefix }
  }
  return { kind: 'tables', schema: defaultDb, prefix }
}

export function useMysqlCatalogCompletion(opts: {
  languageId: Ref<string>
  scope: Ref<SqlSuggestScope | null>
}): void {
  let disposable: monaco.IDisposable | null = null

  async function provide(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ): Promise<monaco.languages.CompletionList> {
    const scope = opts.scope.value
    if (!scope?.sessionId) return { suggestions: [] }

    const line = model.getLineContent(position.lineNumber)
    const linePrefix = line.slice(0, position.column - 1)
    const defaultDb = (scope.schema || scope.database || '').trim()
    const ctx = classifyContext(linePrefix, defaultDb)
    const limit = catalogLimitForPrefix(ctx.prefix)
    const suggestions: monaco.languages.CompletionItem[] = []
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: position.column - ctx.prefix.length,
      endColumn: position.column,
    }

    try {
      if (ctx.kind === 'schemas') {
        const key = `mysql:schemas:${scope.sessionId}:${ctx.prefix}:${limit}`
        const res = await cachedSchemas(key, () =>
          mysqlCatalogClient.listSchemas(scope, ctx.prefix, limit),
        )
        for (const s of res.schemas) {
          suggestions.push({
            label: s.name,
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: quoteMysqlIdent(s.name),
            range,
            detail: 'database',
          })
        }
      } else if (ctx.kind === 'tables' && ctx.schema) {
        const key = `mysql:tables:${scope.sessionId}:${ctx.schema}:${ctx.prefix}:${limit}`
        const res = await cachedTables(key, () =>
          mysqlCatalogClient.listTables(scope, ctx.schema, ctx.prefix, limit),
        )
        for (const tbl of res.tables) {
          suggestions.push({
            label: tbl.name,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: quoteMysqlIdent(tbl.name),
            range,
            detail: tbl.type || 'table',
          })
        }
      } else if (ctx.kind === 'columns' && ctx.schema && ctx.table) {
        const key = `mysql:cols:${scope.sessionId}:${ctx.schema}:${ctx.table}:${ctx.prefix}`
        const res = await cachedColumns(key, () =>
          mysqlCatalogClient.listColumns(scope, ctx.schema, ctx.table!, ctx.prefix),
        )
        for (const c of res.columns) {
          suggestions.push({
            label: c.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: quoteMysqlIdent(c.name),
            range,
            detail: c.dataType,
          })
        }
      }
    } catch {
      return { suggestions: [] }
    }

    return { suggestions }
  }

  function register(languageId: string): void {
    disposable?.dispose()
    disposable = null
    if (!languageId) return
    disposable = monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters: ['.', '`'],
      provideCompletionItems: (model, position) => provide(model, position),
    })
  }

  watch(
    () => opts.languageId.value,
    (id) => register(id),
    { immediate: true },
  )

  onUnmounted(() => {
    disposable?.dispose()
    disposable = null
  })
}
