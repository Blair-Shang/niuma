export type OracleObjectKind = 'view' | 'procedure' | 'function' | 'package'
export type OracleObjectScriptMode = 'create' | 'alter'
export type OracleObjectCategory = 'views' | 'procedures' | 'functions' | 'packages'

export const ORACLE_CREATE_OBJECT_PLACEHOLDERS: Record<OracleObjectCategory, string> = {
  views: 'new_view',
  procedures: 'new_proc',
  functions: 'new_func',
  packages: 'new_package',
}

export function categoryToObjectKind(category: OracleObjectCategory): OracleObjectKind {
  if (category === 'views') return 'view'
  if (category === 'procedures') return 'procedure'
  if (category === 'functions') return 'function'
  return 'package'
}

export function objectKindToCategory(kind: OracleObjectKind): OracleObjectCategory {
  if (kind === 'view') return 'views'
  if (kind === 'procedure') return 'procedures'
  if (kind === 'function') return 'functions'
  return 'packages'
}

export function objectKindIcon(kind: OracleObjectKind): string {
  if (kind === 'view') return 'eye'
  if (kind === 'procedure') return 'workflow'
  if (kind === 'function') return 'square-function'
  return 'package'
}

export function isObjectCategory(name: string | undefined): name is OracleObjectCategory {
  return name === 'views' || name === 'procedures' || name === 'functions' || name === 'packages'
}
