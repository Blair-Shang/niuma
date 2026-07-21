/**
 * 连接树右键 / 双击打开 Tab 时的 SQL 种子（无需 meta.* 时的企业级兜底）。
 * 表结构查看已由设计面板承接；本模块仍作为「在查询中打开」等入口的 SQL 种子。
 */

import { buildRoutineCallSql } from '@/modules/vastbase/utils/routine-call'

export type VastSessionTab =
  | 'query'
  | 'browse'
  | 'ddl'
  | 'design'
  | 'deps'
  | 'source'
  | 'call'
  | 'debug'
  | 'overview'
  | 'monitor'
  | 'tools'

export interface VastSeedContext {
  database?: string
  schema?: string
  table?: string
  routine?: string
  routineKind?: 'function' | 'procedure'
  /** 例程 identity arguments（无外层括号） */
  args?: string
  oid?: number
}

export interface VastSqlSeed {
  sql: string
  /** 连接成功后是否自动执行（浏览 / DDL / 源码） */
  autoRun: boolean
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function qualifiedName(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function browseSql(ctx: VastSeedContext): VastSqlSeed {
  if (ctx.schema && ctx.table) {
    return {
      sql: `SELECT *\nFROM ${qualifiedName(ctx.schema, ctx.table)}\nLIMIT 100`,
      autoRun: true,
    }
  }
  return { sql: 'SELECT 1', autoRun: false }
}

function querySql(ctx: VastSeedContext): VastSqlSeed {
  if (ctx.schema && ctx.table) {
    return {
      sql: `SELECT *\nFROM ${qualifiedName(ctx.schema, ctx.table)}\nWHERE true\nLIMIT 100`,
      autoRun: false,
    }
  }
  if (ctx.schema) {
    return {
      sql: `-- schema: ${ctx.schema}\nSET search_path TO ${quoteIdent(ctx.schema)};\n\nSELECT 1`,
      autoRun: false,
    }
  }
  if (ctx.database) {
    return {
      sql: `-- database: ${ctx.database}\nSELECT current_database(), current_schema()`,
      autoRun: false,
    }
  }
  return { sql: 'SELECT 1', autoRun: false }
}

function ddlSql(ctx: VastSeedContext): VastSqlSeed {
  if (!ctx.schema || !ctx.table) {
    return { sql: 'SELECT 1', autoRun: false }
  }
  const sch = lit(ctx.schema)
  const tbl = lit(ctx.table)
  return {
    sql: `SELECT
  CASE c.relkind
    WHEN 'v' THEN pg_catalog.pg_get_viewdef(c.oid, true)
    WHEN 'm' THEN pg_catalog.pg_get_viewdef(c.oid, true)
    ELSE (
      SELECT 'CREATE TABLE ' || ${lit(`${ctx.schema}.${ctx.table}`)} || E' (\\n'
        || string_agg(
          '  ' || quote_ident(a.attname) || ' '
            || pg_catalog.format_type(a.atttypid, a.atttypmod)
            || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
          E',\\n'
          ORDER BY a.attnum
        )
        || E'\\n);'
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = c.oid
        AND a.attnum > 0
        AND NOT a.attisdropped
    )
  END AS ddl,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized_view'
    WHEN 'f' THEN 'foreign_table'
    ELSE c.relkind::text
  END AS object_type
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = ${sch}
  AND c.relname = ${tbl}`,
    autoRun: true,
  }
}

function sourceSql(ctx: VastSeedContext): VastSqlSeed {
  if (!ctx.schema || !ctx.routine) {
    return { sql: 'SELECT 1', autoRun: false }
  }
  const sch = lit(ctx.schema)
  const name = lit(ctx.routine)
  const oidFilter =
    typeof ctx.oid === 'number' && Number.isFinite(ctx.oid) && ctx.oid > 0
      ? ` AND p.oid = ${Math.trunc(ctx.oid)}`
      : ''
  const argsFilter =
    !oidFilter && ctx.args != null && ctx.args !== ''
      ? ` AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ${lit(ctx.args)}`
      : ''
  return {
    // Vastbase/GaussDB：pg_get_functiondef 返回 record，须取 definition 列
    sql: `SELECT
  p.proname AS name,
  CASE p.prokind
    WHEN 'f' THEN 'function'
    WHEN 'p' THEN 'procedure'
    ELSE p.prokind::text
  END AS kind,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
  (SELECT d.definition FROM pg_catalog.pg_get_functiondef(p.oid) AS d) AS definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = ${sch}
  AND p.proname = ${name}${oidFilter}${argsFilter}
ORDER BY p.oid`,
    autoRun: true,
  }
}

function callSql(ctx: VastSeedContext): VastSqlSeed {
  if (!ctx.schema || !ctx.routine) {
    return { sql: 'SELECT 1', autoRun: false }
  }
  return {
    sql: buildRoutineCallSql({
      schema: ctx.schema,
      name: ctx.routine,
      kind: ctx.routineKind,
      args: ctx.args,
      qualify: qualifiedName,
    }),
    autoRun: false,
  }
}

function debugSql(ctx: VastSeedContext): VastSqlSeed {
  const target =
    ctx.schema && ctx.routine ? qualifiedName(ctx.schema, ctx.routine) : '(routine)'
  const sig = ctx.args ? `(${ctx.args})` : ''
  return {
    sql: `-- Debug ${target}${sig}\n-- Use the Debug pane for breakpoints / step / variables.`,
    autoRun: false,
  }
}

/** 按会话功能生成初始 SQL 与是否自动执行。 */
export function seedSqlForFeature(feature: VastSessionTab, ctx: VastSeedContext): VastSqlSeed {
  switch (feature) {
    case 'browse':
      return browseSql(ctx)
    case 'ddl':
      return ddlSql(ctx)
    case 'design':
      return { sql: 'SELECT 1', autoRun: false }
    case 'deps':
      return { sql: 'SELECT 1', autoRun: false }
    case 'source':
      return sourceSql(ctx)
    case 'call':
      return callSql(ctx)
    case 'debug':
      return debugSql(ctx)
    case 'overview':
      return { sql: 'SELECT 1', autoRun: false }
    case 'monitor':
      return { sql: 'SELECT 1', autoRun: false }
    case 'query':
    default:
      return querySql(ctx)
  }
}
