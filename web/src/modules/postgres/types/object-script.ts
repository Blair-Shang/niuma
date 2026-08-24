/**
 * Postgres 对象脚本：视图 / 存储过程 / 函数 / 序列（新建与编辑共用）。
 * 对齐 MySQL / Dameng：专用对象编辑页，保存即执行 DDL。
 */
export type PostgresObjectKind = 'view' | 'procedure' | 'function' | 'sequence'

export type PostgresObjectScriptMode = 'create' | 'alter'

export type PostgresObjectCategory = 'views' | 'procedures' | 'functions' | 'sequences'

export const POSTGRES_CREATE_OBJECT_PLACEHOLDERS: Record<PostgresObjectCategory, string> = {
  views: 'new_view',
  procedures: 'new_proc',
  functions: 'new_func',
  sequences: 'new_sequence',
}

const CREATE_PLACEHOLDER_NAMES = new Set(Object.values(POSTGRES_CREATE_OBJECT_PLACEHOLDERS))

/** 新建占位名不进入 Tab 标题（对齐 MySQL 表设计 / 对象脚本：Tab 只显示真实名或功能名）。 */
export function isCreatePlaceholderName(name: string | undefined): boolean {
  return Boolean(name && CREATE_PLACEHOLDER_NAMES.has(name))
}

export function categoryToObjectKind(category: PostgresObjectCategory): PostgresObjectKind {
  if (category === 'views') return 'view'
  if (category === 'procedures') return 'procedure'
  if (category === 'sequences') return 'sequence'
  return 'function'
}

export function objectKindToCategory(kind: PostgresObjectKind): PostgresObjectCategory {
  if (kind === 'view') return 'views'
  if (kind === 'procedure') return 'procedures'
  if (kind === 'sequence') return 'sequences'
  return 'functions'
}

export function objectKindIcon(kind: PostgresObjectKind): string {
  if (kind === 'view') return 'eye'
  if (kind === 'procedure') return 'workflow'
  if (kind === 'sequence') return 'list-ordered'
  return 'square-function'
}

export function isObjectCategory(name: string | undefined): name is PostgresObjectCategory {
  return (
    name === 'views' ||
    name === 'procedures' ||
    name === 'functions' ||
    name === 'sequences'
  )
}
