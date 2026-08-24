/**
 * SQL Server 对象脚本：视图 / 过程 / 函数 / 序列 / 同义词。
 */
export type SqlServerObjectKind = 'view' | 'procedure' | 'function' | 'sequence' | 'synonym'

export type SqlServerObjectScriptMode = 'create' | 'alter'

export type SqlServerObjectCategory = 'views' | 'procedures' | 'functions' | 'sequences' | 'synonyms'

export const SQLSERVER_CREATE_OBJECT_PLACEHOLDERS: Record<SqlServerObjectCategory, string> = {
  views: 'NewView',
  procedures: 'NewProcedure',
  functions: 'NewFunction',
  sequences: 'NewSequence',
  synonyms: 'NewSynonym',
}

const CREATE_PLACEHOLDER_NAMES = new Set(Object.values(SQLSERVER_CREATE_OBJECT_PLACEHOLDERS))

export function isCreatePlaceholderName(name: string | undefined): boolean {
  return Boolean(name && CREATE_PLACEHOLDER_NAMES.has(name))
}

export function categoryToObjectKind(category: SqlServerObjectCategory): SqlServerObjectKind {
  if (category === 'views') return 'view'
  if (category === 'procedures') return 'procedure'
  if (category === 'sequences') return 'sequence'
  if (category === 'synonyms') return 'synonym'
  return 'function'
}

export function objectKindToCategory(kind: SqlServerObjectKind): SqlServerObjectCategory {
  if (kind === 'view') return 'views'
  if (kind === 'procedure') return 'procedures'
  if (kind === 'sequence') return 'sequences'
  if (kind === 'synonym') return 'synonyms'
  return 'functions'
}

export function objectKindIcon(kind: SqlServerObjectKind): string {
  if (kind === 'view') return 'eye'
  if (kind === 'procedure') return 'workflow'
  if (kind === 'sequence') return 'hash'
  if (kind === 'synonym') return 'link'
  return 'square-function'
}

export function isObjectCategory(name: string | undefined): name is SqlServerObjectCategory {
  return (
    name === 'views' ||
    name === 'procedures' ||
    name === 'functions' ||
    name === 'sequences' ||
    name === 'synonyms'
  )
}

export function objectKindSegment(
  kind: SqlServerObjectKind,
): 'table' | 'procedure' | 'function' | 'sequence' | 'synonym' {
  if (kind === 'view') return 'table'
  return kind
}
