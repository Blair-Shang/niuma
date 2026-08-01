/**
 * Kingbase 连接树脚本模板（对齐 Navicat / DBeaver / Vastbase PG 系常用集）。
 */
import { buildRoutineCallSql } from '@/modules/kingbase/utils/routine-call'

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function qualifiedName(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

export function kingbaseSelectSeed(
  schema: string | undefined,
  table: string,
  limit = 100,
): string {
  const target = schema ? qualifiedName(schema, table) : quoteIdent(table)
  return `SELECT *\nFROM ${target}\nLIMIT ${limit};\n`
}

export function kingbaseCountSeed(schema: string, table: string): string {
  return `SELECT COUNT(*) AS cnt\nFROM ${qualifiedName(schema, table)};\n`
}

export function kingbaseInsertSeed(
  schema: string,
  table: string,
  columns: Array<{ name: string; dataType?: string }>,
): string {
  const qn = qualifiedName(schema, table)
  if (!columns.length) {
    return `INSERT INTO ${qn}\nVALUES ();\n`
  }
  const names = columns.map((c) => `  ${quoteIdent(c.name)}`).join(',\n')
  const values = columns
    .map((c) => {
      const hint = c.dataType ? ` /* ${c.dataType} */` : ''
      return `  NULL${hint}`
    })
    .join(',\n')
  return `INSERT INTO ${qn} (\n${names}\n) VALUES (\n${values}\n);\n`
}

export function kingbaseUpdateSeed(
  schema: string,
  table: string,
  columns: Array<{ name: string; dataType?: string }>,
  pkColumns: string[] = [],
): string {
  const qn = qualifiedName(schema, table)
  const setCols = columns.length
    ? columns
        .filter((c) => !pkColumns.includes(c.name))
        .map((c) => {
          const hint = c.dataType ? ` /* ${c.dataType} */` : ''
          return `  ${quoteIdent(c.name)} = NULL${hint}`
        })
    : ['  -- column = value']
  if (setCols.length === 0) setCols.push('  -- column = value')
  const where =
    pkColumns.length > 0
      ? pkColumns.map((name) => `  ${quoteIdent(name)} = NULL`).join('\n  AND ')
      : '  true /* TODO: add WHERE */'
  return `UPDATE ${qn}\nSET\n${setCols.join(',\n')}\nWHERE\n${where};\n`
}

export function kingbaseDeleteSeed(
  schema: string,
  table: string,
  pkColumns: string[] = [],
): string {
  const qn = qualifiedName(schema, table)
  const where =
    pkColumns.length > 0
      ? pkColumns.map((name) => `  ${quoteIdent(name)} = NULL`).join('\n  AND ')
      : '  true /* TODO: add WHERE */'
  return `DELETE FROM ${qn}\nWHERE\n${where};\n`
}

export function kingbaseTruncateSql(schema: string, table: string): string {
  return `TRUNCATE TABLE ${qualifiedName(schema, table)}`
}

export function kingbaseDropTableSql(schema: string, table: string, isView = false): string {
  const kw = isView ? 'VIEW' : 'TABLE'
  return `DROP ${kw} IF EXISTS ${qualifiedName(schema, table)}`
}

export function kingbaseVacuumSql(schema: string, table: string): string {
  return `VACUUM (VERBOSE, ANALYZE) ${qualifiedName(schema, table)};\n`
}

export function kingbaseAnalyzeSql(schema: string, table: string): string {
  return `ANALYZE VERBOSE ${qualifiedName(schema, table)};\n`
}

export function kingbaseRefreshMatViewSql(schema: string, table: string): string {
  return `REFRESH MATERIALIZED VIEW ${qualifiedName(schema, table)};\n`
}

export function kingbaseCallFunctionSeed(
  schema: string,
  name: string,
  args?: string,
): string {
  return buildRoutineCallSql({
    schema,
    name,
    kind: 'function',
    args,
    qualify: qualifiedName,
  })
}

export function kingbaseCallProcedureSeed(
  schema: string,
  name: string,
  args?: string,
): string {
  return buildRoutineCallSql({
    schema,
    name,
    kind: 'procedure',
    args,
    qualify: qualifiedName,
  })
}

export function kingbaseGrantSeed(
  target: 'table' | 'view' | 'schema' | 'function' | 'procedure',
  schema: string,
  name: string,
  args?: string,
): string {
  if (target === 'schema') {
    return [
      `-- GRANT / REVOKE on schema ${quoteIdent(schema)}`,
      `GRANT USAGE ON SCHEMA ${quoteIdent(schema)} TO PUBLIC;`,
      `-- REVOKE USAGE ON SCHEMA ${quoteIdent(schema)} FROM PUBLIC;`,
      '',
    ].join('\n')
  }
  if (target === 'function' || target === 'procedure') {
    const kind = target === 'function' ? 'FUNCTION' : 'PROCEDURE'
    const qn = args?.trim()
      ? `${qualifiedName(schema, name)}(${args})`
      : `${qualifiedName(schema, name)}()`
    return [
      `-- GRANT / REVOKE on ${kind.toLowerCase()} ${qn}`,
      `GRANT EXECUTE ON ${kind} ${qn} TO PUBLIC;`,
      `-- REVOKE EXECUTE ON ${kind} ${qn} FROM PUBLIC;`,
      '',
    ].join('\n')
  }
  const qn = qualifiedName(schema, name)
  return [
    `-- GRANT / REVOKE on ${target} ${qn}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${qn} TO PUBLIC;`,
    `-- REVOKE ALL ON TABLE ${qn} FROM PUBLIC;`,
    '',
  ].join('\n')
}

export function kingbaseDepsSql(schema: string, name: string): string {
  // 系统表必须带 pg_catalog，否则 LSP 会把别名解析到 public.* 并误报 unknown column。
  return [
    `-- Dependencies for ${qualifiedName(schema, name)}`,
    `SELECT`,
    `  n.nspname AS dependent_schema,`,
    `  c.relname AS dependent_name,`,
    `  CASE c.relkind`,
    `    WHEN 'r' THEN 'table'`,
    `    WHEN 'v' THEN 'view'`,
    `    WHEN 'm' THEN 'materialized_view'`,
    `    WHEN 'f' THEN 'foreign_table'`,
    `    ELSE c.relkind::text`,
    `  END AS dependent_kind`,
    `FROM pg_catalog.pg_depend d`,
    `JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid`,
    `JOIN pg_catalog.pg_class c ON c.oid = r.ev_class`,
    `JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace`,
    `JOIN pg_catalog.pg_class base ON base.oid = d.refobjid`,
    `JOIN pg_catalog.pg_namespace bn ON bn.oid = base.relnamespace`,
    `WHERE bn.nspname = '${schema.replace(/'/g, "''")}'`,
    `  AND base.relname = '${name.replace(/'/g, "''")}'`,
    `  AND c.oid <> base.oid`,
    `ORDER BY 1, 2;`,
    '',
  ].join('\n')
}

export function kingbaseSequenceNextvalSeed(schema: string, name: string): string {
  return `SELECT nextval('${qualifiedName(schema, name)}'::regclass);\n`
}

export function kingbaseSequenceCurrvalSeed(schema: string, name: string): string {
  return `SELECT currval('${qualifiedName(schema, name)}'::regclass);\n`
}

export function kingbaseSequenceSetvalSeed(schema: string, name: string): string {
  return `SELECT setval('${qualifiedName(schema, name)}'::regclass, 1, false);\n`
}

export function kingbaseDropSequenceSql(schema: string, name: string): string {
  return `DROP SEQUENCE IF EXISTS ${qualifiedName(schema, name)};\n`
}

export function kingbaseBatchDropSql(
  items: Array<{
    schema: string
    name: string
    kind: 'table' | 'view' | 'function' | 'procedure' | 'sequence'
    args?: string
  }>,
): string {
  const lines = [
    '-- Batch DROP script (review carefully before running)',
    'BEGIN;',
    '',
  ]
  for (const item of items) {
    const qn = qualifiedName(item.schema, item.name)
    if (item.kind === 'table') lines.push(`DROP TABLE IF EXISTS ${qn} CASCADE;`)
    else if (item.kind === 'view') lines.push(`DROP VIEW IF EXISTS ${qn} CASCADE;`)
    else if (item.kind === 'sequence') lines.push(`DROP SEQUENCE IF EXISTS ${qn} CASCADE;`)
    else if (item.kind === 'function') {
      const sig = item.args?.trim() ? `(${item.args})` : ''
      lines.push(`DROP FUNCTION IF EXISTS ${qn}${sig} CASCADE;`)
    } else {
      const sig = item.args?.trim() ? `(${item.args})` : ''
      lines.push(`DROP PROCEDURE IF EXISTS ${qn}${sig} CASCADE;`)
    }
  }
  lines.push('', 'COMMIT;', '')
  return lines.join('\n')
}

export const selectSeed = kingbaseSelectSeed
