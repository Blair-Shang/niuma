/**
 * Oracle 对象脚本：视图 / 过程 / 函数 / 包 / 触发器 / 同义词 / 序列（新建与编辑共用）。
 */
export type OracleObjectKind =
  | 'view'
  | 'procedure'
  | 'function'
  | 'package'
  | 'trigger'
  | 'synonym'
  | 'sequence'

export type OracleObjectScriptMode = 'create' | 'alter'

export type OracleObjectCategory =
  | 'views'
  | 'procedures'
  | 'functions'
  | 'packages'
  | 'synonyms'
  | 'triggers'
  | 'sequences'

export const ORACLE_CREATE_OBJECT_PLACEHOLDERS: Record<OracleObjectCategory, string> = {
  views: 'new_view',
  procedures: 'new_proc',
  functions: 'new_func',
  packages: 'new_package',
  synonyms: 'new_syn',
  triggers: 'new_trg',
  sequences: 'new_seq',
}

const CATEGORY_TO_KIND: Record<OracleObjectCategory, OracleObjectKind> = {
  views: 'view',
  procedures: 'procedure',
  functions: 'function',
  packages: 'package',
  synonyms: 'synonym',
  triggers: 'trigger',
  sequences: 'sequence',
}

const KIND_TO_CATEGORY: Record<OracleObjectKind, OracleObjectCategory> = {
  view: 'views',
  procedure: 'procedures',
  function: 'functions',
  package: 'packages',
  synonym: 'synonyms',
  trigger: 'triggers',
  sequence: 'sequences',
}

const KIND_ICON: Record<OracleObjectKind, string> = {
  view: 'eye',
  procedure: 'workflow',
  function: 'square-function',
  package: 'package',
  synonym: 'link-2',
  trigger: 'zap',
  sequence: 'list-ordered',
}

export function categoryToObjectKind(category: OracleObjectCategory): OracleObjectKind {
  return CATEGORY_TO_KIND[category]
}

export function objectKindToCategory(kind: OracleObjectKind): OracleObjectCategory {
  return KIND_TO_CATEGORY[kind]
}

export function objectKindIcon(kind: OracleObjectKind): string {
  return KIND_ICON[kind]
}

export function isObjectCategory(name: string | undefined): name is OracleObjectCategory {
  return (
    name === 'views' ||
    name === 'procedures' ||
    name === 'functions' ||
    name === 'packages' ||
    name === 'synonyms' ||
    name === 'triggers' ||
    name === 'sequences'
  )
}

/** 树节点用 routine 段的对象。 */
export function isRoutineObjectKind(kind: OracleObjectKind): boolean {
  return (
    kind === 'procedure' ||
    kind === 'function' ||
    kind === 'package' ||
    kind === 'trigger' ||
    kind === 'synonym'
  )
}

/** 可通过 meta.ddl 加载的对象（非 procedure/function 的 ALL_SOURCE）。 */
export function usesMetaDdlLoad(kind: OracleObjectKind): boolean {
  return (
    kind === 'view' ||
    kind === 'package' ||
    kind === 'trigger' ||
    kind === 'synonym' ||
    kind === 'sequence'
  )
}
