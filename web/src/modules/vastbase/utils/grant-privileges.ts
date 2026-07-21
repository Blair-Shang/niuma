/**
 * GRANT / REVOKE 权限列表与 SQL 生成（按对象类型过滤）。
 */
import type { VastGrantTarget } from '@/modules/vastbase/stores/ddl-actions'
import { quoteIdent, qualifiedName } from '@/modules/vastbase/sql-seed'

const TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'ALL PRIVILEGES',
] as const

const VIEW_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'REFERENCES',
  'TRIGGER',
  'ALL PRIVILEGES',
] as const

const SCHEMA_PRIVILEGES = ['USAGE', 'CREATE', 'ALL PRIVILEGES'] as const

const ROUTINE_PRIVILEGES = ['EXECUTE', 'ALL PRIVILEGES'] as const

/** 按对象类型返回可选权限（PG / Vastbase 语义）。 */
export function privilegesForTarget(target: VastGrantTarget | undefined): string[] {
  switch (target) {
    case 'schema':
      return [...SCHEMA_PRIVILEGES]
    case 'function':
    case 'procedure':
      return [...ROUTINE_PRIVILEGES]
    case 'view':
      return [...VIEW_PRIVILEGES]
    case 'table':
    default:
      return [...TABLE_PRIVILEGES]
  }
}

/** 打开对话框时的默认权限（可多选，默认一项）。 */
export function defaultPrivileges(target: VastGrantTarget | undefined): string[] {
  switch (target) {
    case 'schema':
      return ['USAGE']
    case 'function':
    case 'procedure':
      return ['EXECUTE']
    case 'view':
    case 'table':
    default:
      return ['SELECT']
  }
}

/**
 * GRANT/REVOKE 对象类型关键字。
 * 视图在 PG 系用 ON TABLE（兼容物化视图）；过程用 PROCEDURE。
 */
export function objectKindSql(target: VastGrantTarget | undefined): string {
  switch (target) {
    case 'schema':
      return 'SCHEMA'
    case 'function':
      return 'FUNCTION'
    case 'procedure':
      return 'PROCEDURE'
    case 'view':
    case 'table':
    default:
      return 'TABLE'
  }
}

export interface BuildGrantSqlInput {
  mode: 'GRANT' | 'REVOKE'
  target: VastGrantTarget | undefined
  /** Schema 名，或 schema.object */
  schema?: string
  name: string
  /** 例程参数签名（不含括号） */
  args?: string
  privileges: string[]
  grantee: string
  withGrantOption?: boolean
}

function buildObjectTarget(input: BuildGrantSqlInput): string {
  const target = input.target
  if (target === 'schema') {
    return quoteIdent(input.name)
  }

  let base: string
  if (input.schema && !input.name.includes('.')) {
    base = qualifiedName(input.schema, input.name)
  } else if (input.name.includes('.')) {
    base = input.name
      .split('.')
      .map((p) => quoteIdent(p))
      .join('.')
  } else {
    base = quoteIdent(input.name)
  }

  if (target === 'function' || target === 'procedure') {
    const args = input.args != null && input.args !== '' ? input.args : ''
    return `${base}(${args})`
  }
  return base
}

function formatGrantee(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.toUpperCase() === 'PUBLIC') return 'PUBLIC'
  return quoteIdent(trimmed)
}

function normalizePrivileges(privileges: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of privileges) {
    const v = p.trim().toUpperCase()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v === 'ALL' ? 'ALL PRIVILEGES' : v)
  }
  if (seen.has('ALL PRIVILEGES')) {
    return ['ALL PRIVILEGES']
  }
  return out
}

/** 生成单条 GRANT / REVOKE 语句。 */
export function buildGrantRevokeSql(input: BuildGrantSqlInput): string {
  const privs = normalizePrivileges(input.privileges)
  const who = formatGrantee(input.grantee)
  if (privs.length === 0 || !who) return ''

  const objectKind = objectKindSql(input.target)
  const objectTarget = buildObjectTarget(input)
  const privList = privs.join(', ')

  if (input.mode === 'REVOKE') {
    return `REVOKE ${privList} ON ${objectKind} ${objectTarget} FROM ${who};`
  }

  const grantOpt = input.withGrantOption ? ' WITH GRANT OPTION' : ''
  return `GRANT ${privList} ON ${objectKind} ${objectTarget} TO ${who}${grantOpt};`
}
