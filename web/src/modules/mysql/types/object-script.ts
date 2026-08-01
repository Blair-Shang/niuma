/**
 * MySQL 对象脚本面板：视图 / 存储过程 / 函数（新建与编辑共用）。
 */
export type MysqlObjectKind = 'view' | 'procedure' | 'function'

export type MysqlObjectScriptMode = 'create' | 'alter'

export type MysqlObjectCategory = 'views' | 'procedures' | 'functions'

export const MYSQL_CREATE_OBJECT_PLACEHOLDERS: Record<MysqlObjectCategory, string> = {
  views: 'new_view',
  procedures: 'new_proc',
  functions: 'new_func',
}

export function categoryToObjectKind(category: MysqlObjectCategory): MysqlObjectKind {
  if (category === 'views') return 'view'
  if (category === 'procedures') return 'procedure'
  return 'function'
}

export function objectKindToCategory(kind: MysqlObjectKind): MysqlObjectCategory {
  if (kind === 'view') return 'views'
  if (kind === 'procedure') return 'procedures'
  return 'functions'
}

export function objectKindIcon(kind: MysqlObjectKind): string {
  if (kind === 'view') return 'eye'
  if (kind === 'procedure') return 'workflow'
  return 'square-function'
}
