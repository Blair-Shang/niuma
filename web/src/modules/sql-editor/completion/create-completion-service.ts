/**
 * 按 parser 槽位调用 CatalogClient，合并关键字/snippets（docs/23）。
 * 前缀解析见 completion/prefix.ts — 各 SQL 方言共用。
 */
import type {
  CompletionService,
  EntityContext,
  ICompletionItem,
  Suggestions,
  WordRange,
} from 'monaco-sql-languages'
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

function defaultSchema(scope: SqlSuggestScope): string {
  return (scope.schema ?? 'public').trim() || 'public'
}

function parseRelation(text: string, fallbackSchema: string, database?: string): Relation | null {
  const raw = text.replaceAll('"', '').trim()
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
): Relation[] {
  const fb = defaultSchema(scope)
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
): Relation[] {
  const relations = collectRelations(entities, scope)
  const q = qualifier?.trim()
  if (!q) return relations
  const narrowed = relations.filter(
    (r) =>
      r.alias === q || r.table === q || `${r.schema}.${r.table}` === q,
  )
  if (narrowed.length > 0) return narrowed
  return [{ schema: defaultSchema(scope), table: q }]
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
    return { schema: defaultSchema(scope), tablePrefix: '', alsoSchemas: true }
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
    schema: defaultSchema(scope),
    tablePrefix: name,
    alsoSchemas: true,
  }
}

type KindSet = { Module: number; Class: number; Field: number }

type TextModel = {
  getWordUntilPosition(position: {
    lineNumber: number
    column: number
  }): { word: string }
}

type TextPosition = { lineNumber: number; column: number }

function catalogItem(label: string, kind: number, detail: string): ICompletionItem {
  return {
    label,
    kind,
    detail,
    insertText: quoteSqlIdent(label),
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
): Promise<ICompletionItem[]> {
  const syntax = suggestions.syntax ?? []
  if (syntax.length === 0) return []

  const needSchema = syntax.some((s) => isSchemaCtx(String(s.syntaxContextType)))
  const tableSyntax = syntax.filter((s) => isTableLike(String(s.syntaxContextType)))
  const needColumn = syntax.some((s) => isColumnCtx(String(s.syntaxContextType)))
  const items: ICompletionItem[] = []

  const pushSchemas = async (prefix: string) => {
    const limit = catalogLimitForPrefix(prefix)
    const key = `sch\0${scope.sessionId}\0${scope.database ?? ''}\0${prefix}\0${limit}`
    const res = await cachedSchemas(key, () =>
      client.listSchemas(scope, prefix, limit),
    )
    for (const s of res.schemas) {
      items.push(
        catalogItem(s.name, kinds.Module, res.truncated ? 'schema · …' : 'schema'),
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
    const relations = resolveColumnRelations(scope, qualifier, entities)
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
            items.push(catalogItem(c.name, kinds.Field, detail))
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
): CompletionService {
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
