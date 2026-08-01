/**
 * SQLite 树维护 / 诊断 SQL 模板（仅本模块使用）。
 */
import { quoteIdent, qualifiedName } from '@/modules/sqlite/sql-seed'

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

export function vacuumSql(schema?: string): string {
  const s = schema?.trim()
  if (s && s !== 'main') return `VACUUM ${quoteIdent(s)};\n`
  return `VACUUM;\n`
}

export function analyzeSql(schema?: string, table?: string): string {
  if (schema && table) return `ANALYZE ${qualifiedName(schema, table)};\n`
  if (schema) return `ANALYZE ${quoteIdent(schema)};\n`
  return `ANALYZE;\n`
}

export function integrityCheckSql(): string {
  return `PRAGMA integrity_check;\n`
}

export function quickCheckSql(): string {
  return `PRAGMA quick_check;\n`
}

export function walCheckpointSql(): string {
  return `PRAGMA wal_checkpoint(TRUNCATE);\n`
}

export function databaseInfoSql(): string {
  return [
    'SELECT sqlite_version() AS sqlite_version;',
    'PRAGMA page_count;',
    'PRAGMA page_size;',
    'PRAGMA freelist_count;',
    'PRAGMA encoding;',
    'PRAGMA journal_mode;',
    'PRAGMA synchronous;',
    'PRAGMA foreign_keys;',
    'PRAGMA database_list;',
  ].join('\n')
}
