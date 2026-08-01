/**
 * 按 parser 槽位调用 CatalogClient，合并关键字/snippets（docs/23）。
 * 前缀解析见 completion/prefix.ts — 各 SQL 方言共用。
 */
import type {
  CompletionService,
  EntityContext,
  ICompletionItem,
  Suggestions,
} from 'monaco-sql-languages'
import type { WordRange } from '@/modules/sql-editor/completion/prefix'
import {
  cachedColumns,
  cachedSchemas,
  cachedTables,
} from '@/modules/sql-editor/completion/cache'
import { resolveCatalogPrefix } from '@/modules/sql-editor/completion/prefix'
import { catalogLimitForPrefix } from '@/modules/sql-editor/completion/catalog-limit'
import type {
  CatalogClient,
  SqlSuggestScope,
} from '@/modules/sql-editor/completion/types'
import {
  extractUpdateTargetRelation,
  isUpdateSetColumnSlot,
  stripSqlIdentQuotes,
} from '@/modules/sql-editor/completion/update-set-heuristic'

let activeScope: SqlSuggestScope | null = null
let scopeEpoch = 0
let scopeOwner: symbol | null = null

export function claimSuggestScope(owner: symbol, scope: SqlSuggestScope | null): void {
  scopeOwner = owner
  activeScope = scope
  scopeEpoch += 1
}

export function clearSuggestScopeIfOwned(owner: symbol): void {
  if (scopeOwner !== owner) return
  scopeOwner = null
  activeScope = null
  scopeEpoch += 1
}

export function getActiveSuggestScope(): SqlSuggestScope | null {
  return activeScope
}

export function quoteSqlIdent(name: string): string {
  if (/^[a-z_][a-z0-9_]*$/.test(name)) return name
  return `"${name.replaceAll('"', '""')}"`
}

/** MySQL 标识符：优先裸名，否则反引号。 */
export function quoteMysqlIdent(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name
  return '`' + name.replaceAll('`', '``') + '`'
}

function isTableLike(type: string): boolean {
  return type === 'table' || type === 'tableCreate' || type === 'view' || type === 'viewCreate'
}

function isColumnCtx(type: string): boolean {
  return type === 'column' || type === 'columnCreate'
}

function isSchemaCtx(type: string): boolean {
  return type === 'database' || type === 'databaseCreate' || type === 'catalog'
}

type Relation = { schema: string; table: string; alias?: string }

function defaultSchema(scope: SqlSuggestScope, fallback = 'public'): string {
  // MySQL：schema 槽 = database；未选库时勿回落 PG 的 public
  // SQLite：未选库时回落 main（ATTACH 命名空间）
  const raw = (scope.schema ?? scope.database ?? '').trim()
  return raw || fallback
}

function parseRelation(text: string, fallbackSchema: string, database?: string): Relation | null {
  const raw = text
    .split('.')
    .map((p) => stripSqlIdentQuotes(p))
    .filter(Boolean)
    .join('.')
  if (!raw) return null
  const parts = raw.split('.').filter(Boolean)
  if (parts.length >= 3) {
    const db = database?.trim()
    if (db && parts[0] === db) {
      return { schema: parts.at(-2)!, table: parts.at(-1)! }
    }
    return { schema: parts.at(-2)!, table: parts.at(-1)! }
  }
  if (parts.length >= 2) {
    return { schema: parts.at(-2)!, table: parts.at(-1)! }
  }
  if (parts.length === 1) {
    return { schema: fallbackSchema, table: parts[0]! }
  }
  return null
}

function entityAlias(ent: EntityContext): string | undefined {
  const alias = (ent as { _alias?: WordRange | null })._alias
  const text = alias?.text?.trim()
  return text || undefined
}

function collectRelations(
  entities: EntityContext[] | null | undefined,
  scope: SqlSuggestScope,
  schemaFallback = 'public',
): Relation[] {
  const fb = defaultSchema(scope, schemaFallback)
  const out: Relation[] = []
  const seen = new Set<string>()
  const push = (r: Relation) => {
    const key = `${r.schema}\0${r.table}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(r)
  }
  for (const ent of entities ?? []) {
    if (ent.entityContextType !== 'table' && ent.entityContextType !== 'view') continue
    if (ent.isAccessible === false) continue
    const parsed = parseRelation(ent.text, fb, scope.database)
    if (!parsed) continue
    push({ ...parsed, alias: entityAlias(ent) })
  }
  if (scope.table?.trim()) {
    push({ schema: fb, table: scope.table.trim() })
  }
  return out
}

function resolveColumnRelations(
  scope: SqlSuggestScope,
  qualifier: string | undefined,
  entities: EntityContext[] | null | undefined,
  sqlBeforeCaret?: string,
  schemaFallback = 'public',
): Relation[] {
  const relations = collectRelations(entities, scope, schemaFallback)
  const q = qualifier?.trim()
  if (q) {
    const narrowed = relations.filter(
      (r) =>
        r.alias === q || r.table === q || `${r.schema}.${r.table}` === q,
    )
    if (narrowed.length > 0) return narrowed
    return [{ schema: defaultSchema(scope, schemaFallback), table: stripSqlIdentQuotes(q) }]
  }
  if (relations.length > 0) return relations
  // UPDATE 半成品常无 table entity：从 `UPDATE <table> SET` 启发式抽目标表
  if (sqlBeforeCaret) {
    const target = extractUpdateTargetRelation(sqlBeforeCaret)
    if (target) {
      const parsed = parseRelation(target, defaultSchema(scope, schemaFallback), scope.database)
      if (parsed) return [parsed]
    }
  }
  return relations
}

/**
 * 表槽 schema / prefix（docs/23 §5）：
 * - `sch.`     → schema=sch, prefix=叶, 不并列提示 schema
 * - 叶恰为 schema 名 → 列出该 schema 下表（prefix 空）
 * - 否则       → schema=默认, prefix=叶, 可并列提示 schema
 */
async function resolveTableTarget(
  client: CatalogClient,
  scope: SqlSuggestScope,
  qualifier: string | undefined,
  leaf: string,
  schemaFallback = 'public',
): Promise<{ schema: string; tablePrefix: string; alsoSchemas: boolean }> {
  if (qualifier?.trim()) {
    return {
      schema: qualifier.trim(),
      tablePrefix: leaf,
      alsoSchemas: false,
    }
  }
  const name = leaf.trim()
  if (!name) {
    return { schema: defaultSchema(scope, schemaFallback), tablePrefix: '', alsoSchemas: true }
  }
  try {
    const res = await client.listSchemas(scope, name, catalogLimitForPrefix(name))
    if (res.schemas.some((s) => s.name === name)) {
      return { schema: name, tablePrefix: '', alsoSchemas: false }
    }
  } catch {
    // fall through
  }
  return {
    schema: defaultSchema(scope, schemaFallback),
    tablePrefix: name,
    alsoSchemas: true,
  }
}

type KindSet = { Module: number; Class: number; Field: number }

type QuoteIdentFn = (name: string) => string

type TextModel = {
  getWordUntilPosition(position: {
    lineNumber: number
    column: number
  }): { word: string }
  getValueInRange(range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }): string
}

type TextPosition = { lineNumber: number; column: number }

function textBeforeCaret(model: TextModel, position: TextPosition): string {
  return model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  })
}

function catalogItem(
  label: string,
  kind: number,
  detail: string,
  quoteIdent: QuoteIdentFn,
): ICompletionItem {
  return {
    label,
    kind,
    detail,
    insertText: quoteIdent(label),
    // 前缀匹配优先：同前缀内按名字；0_ 保证 catalog 排在关键字前
    sortText: `0_${label}`,
    filterText: label,
  }
}

/** 截断提示：不可插入，引导继续输入以缩小前缀 */
function truncatedHintItem(kind: number, what: string, prefix: string): ICompletionItem {
  return {
    label: `… 还有更多${what}，请继续输入前缀`,
    kind,
    detail: 'truncated',
    insertText: '',
    sortText: '9_truncated',
    // 与当前前缀对齐，避免 matchOnWordStartOnly 下被滤掉
    filterText: prefix.trim() || ' ',
  }
}

async function catalogItems(
  client: CatalogClient,
  scope: SqlSuggestScope,
  suggestions: Suggestions,
  entities: EntityContext[] | null | undefined,
  kinds: KindSet,
  model: TextModel,
  position: TextPosition,
  quoteIdent: QuoteIdentFn,
  schemaFallback = 'public',
): Promise<ICompletionItem[]> {
  const syntax = suggestions.syntax ?? []
  const before = textBeforeCaret(model, position)
  // parser 在 `UPDATE t SET ` 半成品时常误报 table、丢 entity；编排层兜底列槽
  const updateSetColumn = isUpdateSetColumnSlot(before)
  if (syntax.length === 0 && !updateSetColumn) return []

  const needSchema =
    !updateSetColumn && syntax.some((s) => isSchemaCtx(String(s.syntaxContextType)))
  const tableSyntax = updateSetColumn
    ? []
    : syntax.filter((s) => isTableLike(String(s.syntaxContextType)))
  const needColumn =
    updateSetColumn || syntax.some((s) => isColumnCtx(String(s.syntaxContextType)))
  const items: ICompletionItem[] = []

  const pushSchemas = async (prefix: string) => {
    const limit = catalogLimitForPrefix(prefix)
    const key = `sch\0${scope.sessionId}\0${scope.database ?? ''}\0${prefix}\0${limit}`
    const res = await cachedSchemas(key, () =>
      client.listSchemas(scope, prefix, limit),
    )
    for (const s of res.schemas) {
      items.push(
        catalogItem(s.name, kinds.Module, res.truncated ? 'schema · …' : 'schema', quoteIdent),
      )
    }
    if (res.truncated) {
      items.push(truncatedHintItem(kinds.Module, ' schema', prefix))
    }
  }

  if (needSchema) {
    const ranges = syntax.find((s) => isSchemaCtx(String(s.syntaxContextType)))?.wordRanges
    const { prefix } = resolveCatalogPrefix(model, position, ranges)
    await pushSchemas(prefix)
  }

  if (tableSyntax.length > 0) {
    const ranges = tableSyntax[0]?.wordRanges
    const { qualifier, prefix: leaf } = resolveCatalogPrefix(model, position, ranges)
    const { schema, tablePrefix, alsoSchemas } = await resolveTableTarget(
      client,
      scope,
      qualifier,
      leaf,
      schemaFallback,
    )
    if (alsoSchemas && !needSchema) {
      await pushSchemas(leaf)
    }
    const limit = catalogLimitForPrefix(tablePrefix)
    const key = `tbl\0${scope.sessionId}\0${scope.database ?? ''}\0${schema}\0${tablePrefix}\0${limit}`
    const res = await cachedTables(key, () =>
      client.listTables(scope, schema, tablePrefix, limit),
    )
    for (const t of res.tables) {
      const typeLabel = t.type && t.type !== 'table' ? t.type : 'table'
      items.push(
        catalogItem(
          t.name,
          kinds.Class,
          res.truncated ? `${typeLabel} · ${schema} · …` : `${typeLabel} · ${schema}`,
          quoteIdent,
        ),
      )
    }
    if (res.truncated) {
      items.push(truncatedHintItem(kinds.Class, '表', tablePrefix))
    }
  }

  if (needColumn) {
    const ranges = syntax.find((s) => isColumnCtx(String(s.syntaxContextType)))?.wordRanges
    const { qualifier, prefix } = resolveCatalogPrefix(model, position, ranges)
    const relations = resolveColumnRelations(
      scope,
      qualifier,
      entities,
      before,
      schemaFallback,
    )
    await Promise.all(
      relations.map(async (rel) => {
        const key = `col\0${scope.sessionId}\0${scope.database ?? ''}\0${rel.schema}\0${rel.table}\0${prefix}`
        try {
          const res = await cachedColumns(key, () =>
            client.listColumns(scope, rel.schema, rel.table, prefix),
          )
          for (const c of res.columns) {
            const detail = [c.dataType, `${rel.schema}.${rel.table}`]
              .filter(Boolean)
              .join(' · ')
            items.push(catalogItem(c.name, kinds.Field, detail, quoteIdent))
          }
        } catch {
          // ignore per-table failures
        }
      }),
    )
  }

  return items
}

export function createSqlCatalogCompletionService(
  client: CatalogClient,
  defaultCompletionService: CompletionService,
  completionItemKind: KindSet,
  options?: { quoteIdent?: QuoteIdentFn; defaultSchema?: string },
): CompletionService {
  const quoteIdent = options?.quoteIdent ?? quoteSqlIdent
  const schemaFallback = options?.defaultSchema?.trim() || 'public'
  return async (model, position, context, suggestions, entities, snippets) => {
    const base = await defaultCompletionService(
      model,
      position,
      context,
      suggestions,
      entities,
      snippets,
    )
    const baseItems = Array.isArray(base) ? base : base.suggestions
    const scope = activeScope
    if (!scope?.sessionId || !suggestions) {
      return baseItems
    }

    const epoch = scopeEpoch
    let extra: ICompletionItem[] = []
    try {
      extra = await catalogItems(
        client,
        scope,
        suggestions,
        entities,
        completionItemKind,
        model,
        position,
        quoteIdent,
        schemaFallback,
      )
    } catch {
      extra = []
    }
    if (epoch !== scopeEpoch) {
      return baseItems
    }
    return [...extra, ...baseItems]
  }
}
