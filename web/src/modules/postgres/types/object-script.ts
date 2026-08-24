/**
 * Postgres 对象脚本：视图 / 物化视图 / 存储过程 / 函数 / 序列 / 触发器。
 */
export type PostgresObjectKind =
  | 'view'
  | 'materialized_view'
  | 'procedure'
  | 'function'
  | 'sequence'
  | 'trigger'

export type PostgresObjectScriptMode = 'create' | 'alter'

export type PostgresObjectCategory =
  | 'views'
  | 'materialized_views'
  | 'procedures'
  | 'functions'
  | 'sequences'
  | 'triggers'

export const POSTGRES_CREATE_OBJECT_PLACEHOLDERS: Record<PostgresObjectCategory, string> = {
  views: 'new_view',
  materialized_views: 'new_matview',
  procedures: 'new_proc',
  functions: 'new_func',
  sequences: 'new_sequence',
  triggers: 'new_trigger',
}

const CREATE_PLACEHOLDER_NAMES = new Set(Object.values(POSTGRES_CREATE_OBJECT_PLACEHOLDERS))

/** 新建占位名不进入 Tab 标题（对齐 MySQL 表设计 / 对象脚本：Tab 只显示真实名或功能名）。 */
export function isCreatePlaceholderName(name: string | undefined): boolean {
  return Boolean(name && CREATE_PLACEHOLDER_NAMES.has(name))
}

export function categoryToObjectKind(category: PostgresObjectCategory): PostgresObjectKind {
  if (category === 'views') return 'view'
  if (category === 'materialized_views') return 'materialized_view'
  if (category === 'procedures') return 'procedure'
  if (category === 'sequences') return 'sequence'
  if (category === 'triggers') return 'trigger'
  return 'function'
}

export function objectKindToCategory(kind: PostgresObjectKind): PostgresObjectCategory {
  if (kind === 'view') return 'views'
  if (kind === 'materialized_view') return 'materialized_views'
  if (kind === 'procedure') return 'procedures'
  if (kind === 'sequence') return 'sequences'
  if (kind === 'trigger') return 'triggers'
  return 'functions'
}

export function objectKindIcon(kind: PostgresObjectKind): string {
  if (kind === 'view') return 'eye'
  if (kind === 'materialized_view') return 'layers'
  if (kind === 'procedure') return 'workflow'
  if (kind === 'sequence') return 'list-ordered'
  if (kind === 'trigger') return 'zap'
  return 'square-function'
}

export function isObjectCategory(name: string | undefined): name is PostgresObjectCategory {
  return (
    name === 'views' ||
    name === 'materialized_views' ||
    name === 'procedures' ||
    name === 'functions' ||
    name === 'sequences' ||
    name === 'triggers'
  )
}
