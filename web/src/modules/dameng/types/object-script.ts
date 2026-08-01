/**
 * 达梦对象脚本：视图 / 过程 / 函数 / 包 / 触发器 / 同义词 / 序列（新建与编辑共用）。
 * 对齐 Navicat / DBeaver：专用对象编辑页，保存即执行 DDL 并刷新树。
 */
export type DamengObjectKind =
  | 'view'
  | 'procedure'
  | 'function'
  | 'package'
  | 'trigger'
  | 'synonym'
  | 'sequence'

export type DamengObjectScriptMode = 'create' | 'alter'

export type DamengObjectCategory =
  | 'views'
  | 'procedures'
  | 'functions'
  | 'packages'
  | 'synonyms'
  | 'triggers'
  | 'sequences'

export const DAMENG_CREATE_OBJECT_PLACEHOLDERS: Record<DamengObjectCategory, string> = {
  views: 'new_view',
  procedures: 'new_proc',
  functions: 'new_func',
  packages: 'new_pkg',
  synonyms: 'new_syn',
  triggers: 'new_trg',
  sequences: 'new_seq',
}

const CATEGORY_TO_KIND: Record<DamengObjectCategory, DamengObjectKind> = {
  views: 'view',
  procedures: 'procedure',
  functions: 'function',
  packages: 'package',
  synonyms: 'synonym',
  triggers: 'trigger',
  sequences: 'sequence',
}

const KIND_TO_CATEGORY: Record<DamengObjectKind, DamengObjectCategory> = {
  view: 'views',
  procedure: 'procedures',
  function: 'functions',
  package: 'packages',
  synonym: 'synonyms',
  trigger: 'triggers',
  sequence: 'sequences',
}

const KIND_ICON: Record<DamengObjectKind, string> = {
  view: 'eye',
  procedure: 'workflow',
  function: 'square-function',
  package: 'package',
  synonym: 'link-2',
  trigger: 'zap',
  sequence: 'list-ordered',
}

export function categoryToObjectKind(category: DamengObjectCategory): DamengObjectKind {
  return CATEGORY_TO_KIND[category]
}

export function objectKindToCategory(kind: DamengObjectKind): DamengObjectCategory {
  return KIND_TO_CATEGORY[kind]
}

export function objectKindIcon(kind: DamengObjectKind): string {
  return KIND_ICON[kind]
}

export function isObjectCategory(name: string | undefined): name is DamengObjectCategory {
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

/** 过程体类对象：树节点用 routine 段。 */
export function isRoutineObjectKind(kind: DamengObjectKind): boolean {
  return (
    kind === 'procedure' ||
    kind === 'function' ||
    kind === 'package' ||
    kind === 'trigger' ||
    kind === 'synonym'
  )
}

/** 可通过 meta.ddl 加载的对象（非 procedure/function 的 ALL_SOURCE 专用接口）。 */
export function usesMetaDdlLoad(kind: DamengObjectKind): boolean {
  return (
    kind === 'view' ||
    kind === 'package' ||
    kind === 'trigger' ||
    kind === 'synonym' ||
    kind === 'sequence'
  )
}
