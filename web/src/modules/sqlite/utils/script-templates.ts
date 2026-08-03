/**
 * SQLite 连接树「生成脚本 / 维护 / DDL」模板（对齐 MySQL Navicat / DBeaver 常用项）。
 */
import { quoteIdent, qualifiedName } from '@/modules/sqlite/sql-seed'

export type SqliteWalCheckpointMode = 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE'

export interface ScriptColumn {
  name: string
  dataType?: string
}

export function selectAllSql(schema: string, table: string, limit = 100): string {
  return `SELECT *\nFROM ${qualifiedName(schema, table)}\nLIMIT ${limit};\n`
}

export function countSql(schema: string, table: string): string {
  return `SELECT COUNT(*) AS cnt\nFROM ${qualifiedName(schema, table)};\n`
}

export function insertTemplateSql(
  schema: string,
  table: string,
  columns: ScriptColumn[] = [],
): string {
  const qn = qualifiedName(schema, table)
  if (columns.length === 0) {
    return `INSERT INTO ${qn} (\n  -- columns\n) VALUES (\n  -- values\n);\n`
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

export function updateTemplateSql(
  schema: string,
  table: string,
  columns: ScriptColumn[] = [],
  pkColumns: string[] = [],
): string {
  const qn = qualifiedName(schema, table)
  const pkSet = new Set(pkColumns)
  const setCols = columns.length
    ? columns
        .filter((c) => !pkSet.has(c.name))
        .map((c) => {
          const hint = c.dataType ? ` /* ${c.dataType} */` : ''
          return `  ${quoteIdent(c.name)} = NULL${hint}`
        })
    : ['  -- column = value']
  if (setCols.length === 0) {
    setCols.push('  -- column = value')
  }
  const where =
    pkColumns.length > 0
      ? pkColumns.map((name) => `  ${quoteIdent(name)} = NULL`).join('\n  AND ')
      : '  1 /* TODO: add WHERE */'
  return `UPDATE ${qn}\nSET\n${setCols.join(',\n')}\nWHERE\n${where};\n`
}

export function deleteTemplateSql(
  schema: string,
  table: string,
  pkColumns: string[] = [],
): string {
  const qn = qualifiedName(schema, table)
  const where =
    pkColumns.length > 0
      ? pkColumns.map((name) => `  ${quoteIdent(name)} = NULL`).join('\n  AND ')
      : '  1 /* TODO: add WHERE */'
  return `DELETE FROM ${qn}\nWHERE\n${where};\n`
}

export function dropTableSql(schema: string, table: string): string {
  return `DROP TABLE IF EXISTS ${qualifiedName(schema, table)};\n`
}

export function dropViewSql(schema: string, view: string): string {
  return `DROP VIEW IF EXISTS ${qualifiedName(schema, view)};\n`
}

export function dropIndexSql(schema: string, index: string): string {
  return `DROP INDEX IF EXISTS ${qualifiedName(schema, index)};\n`
}

export function dropTriggerSql(schema: string, trigger: string): string {
  return `DROP TRIGGER IF EXISTS ${qualifiedName(schema, trigger)};\n`
}

/** SQLite 无 TRUNCATE：清空数据用 DELETE。 */
export function emptyTableSql(schema: string, table: string): string {
  return `DELETE FROM ${qualifiedName(schema, table)};\n`
}

export function renameTableSql(schema: string, from: string, to: string): string {
  return `ALTER TABLE ${qualifiedName(schema, from)} RENAME TO ${quoteIdent(to)};\n`
}

/** PRAGMA / VACUUM 的 schema 前缀；main 或空则不加限定（默认库）。 */
function schemaPrefix(schema?: string): string {
  const s = schema?.trim()
  if (!s || s === 'main') return ''
  return `${quoteIdent(s)}.`
}

export function vacuumSql(schema?: string): string {
  const s = schema?.trim()
  if (s && s !== 'main') return `VACUUM ${quoteIdent(s)};\n`
  return `VACUUM;\n`
}

export function analyzeSql(schema?: string, table?: string): string {
  if (schema && table) return `ANALYZE ${qualifiedName(schema, table)};\n`
  if (schema && schema !== 'main') return `ANALYZE ${quoteIdent(schema)};\n`
  return `ANALYZE;\n`
}

export function integrityCheckSql(schema?: string): string {
  return `PRAGMA ${schemaPrefix(schema)}integrity_check;\n`
}

export function quickCheckSql(schema?: string): string {
  return `PRAGMA ${schemaPrefix(schema)}quick_check;\n`
}

/** 默认 FULL：完成检查点且比 TRUNCATE 更温和。 */
export function walCheckpointSql(
  schema?: string,
  mode: SqliteWalCheckpointMode = 'FULL',
): string {
  return `PRAGMA ${schemaPrefix(schema)}wal_checkpoint(${mode});\n`
}

export function reindexSql(schema?: string, table?: string): string {
  if (schema && table) return `REINDEX ${qualifiedName(schema, table)};\n`
  if (schema && schema !== 'main') return `REINDEX ${quoteIdent(schema)};\n`
  return `REINDEX;\n`
}
