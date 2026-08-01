/**
 * ClickHouse 对象脚本 / 树菜单模板（视图 / MV / 表 DDL / 生成脚本）。
 */
import { onClusterSqlSuffix } from '@/modules/clickhouse/utils/cluster'
import { quoteIdent, qualifiedName } from '@/modules/clickhouse/sql-seed'
import type { ClickHouseObjectCategory } from '@/modules/clickhouse/types/object-script'
import { CLICKHOUSE_CREATE_OBJECT_PLACEHOLDERS } from '@/modules/clickhouse/types/object-script'

export interface ScriptColumn {
  name: string
  dataType?: string
}

export type ScriptClusterOptions = { onCluster?: string }

export function createObjectTemplate(
  database: string,
  category: ClickHouseObjectCategory,
  options?: ScriptClusterOptions,
): string {
  const placeholder = CLICKHOUSE_CREATE_OBJECT_PLACEHOLDERS[category]
  const qn = qualifiedName(database, placeholder)
  const oc = onClusterSqlSuffix(options?.onCluster)
  if (category === 'materializedViews') {
    return (
      `CREATE MATERIALIZED VIEW IF NOT EXISTS ${qn}${oc}\n` +
      `ENGINE = MergeTree()\n` +
      `ORDER BY tuple()\n` +
      `AS\n` +
      `SELECT\n` +
      `  1 AS col\n`
    )
  }
  if (category === 'dictionaries') {
    return (
      `CREATE OR REPLACE DICTIONARY ${qn}${oc}\n` +
      `(\n` +
      `  id UInt64,\n` +
      `  value String\n` +
      `)\n` +
      `PRIMARY KEY id\n` +
      `SOURCE(NULL())\n` +
      `LAYOUT(FLAT())\n` +
      `LIFETIME(0)\n`
    )
  }
  return (
    `CREATE OR REPLACE VIEW ${qn}${oc} AS\n` +
    `SELECT\n` +
    `  1 AS col\n`
  )
}

export function selectAllSql(database: string, table: string, limit = 100): string {
  return `SELECT *\nFROM ${qualifiedName(database, table)}\nLIMIT ${limit};`
}

export function countSql(database: string, table: string): string {
  return `SELECT count() AS cnt\nFROM ${qualifiedName(database, table)};`
}

export function insertTemplateSql(
  database: string,
  table: string,
  columns: ScriptColumn[] = [],
): string {
  const qn = qualifiedName(database, table)
  if (columns.length === 0) {
    return `INSERT INTO ${qn} (\n  -- columns\n) VALUES (\n  -- values\n);`
  }
  const names = columns.map((c) => `  ${quoteIdent(c.name)}`).join(',\n')
  const values = columns
    .map((c) => {
      const hint = c.dataType ? ` /* ${c.dataType} */` : ''
      return `  NULL${hint}`
    })
    .join(',\n')
  return `INSERT INTO ${qn} (\n${names}\n) VALUES (\n${values}\n);`
}

export function createDatabaseSql(name: string, options?: ScriptClusterOptions): string {
  return `CREATE DATABASE IF NOT EXISTS ${quoteIdent(name)}${onClusterSqlSuffix(options?.onCluster)};`
}

export function dropDatabaseSql(name: string, options?: ScriptClusterOptions): string {
  return `DROP DATABASE IF EXISTS ${quoteIdent(name)}${onClusterSqlSuffix(options?.onCluster)};`
}

export function dropTableSql(
  database: string,
  table: string,
  options?: ScriptClusterOptions,
): string {
  return `DROP TABLE IF EXISTS ${qualifiedName(database, table)}${onClusterSqlSuffix(options?.onCluster)};`
}

export function dropViewSql(
  database: string,
  name: string,
  options?: ScriptClusterOptions,
): string {
  return `DROP VIEW IF EXISTS ${qualifiedName(database, name)}${onClusterSqlSuffix(options?.onCluster)};`
}

export function dropDictionarySql(
  database: string,
  name: string,
  options?: ScriptClusterOptions,
): string {
  return `DROP DICTIONARY IF EXISTS ${qualifiedName(database, name)}${onClusterSqlSuffix(options?.onCluster)};`
}

export function truncateTableSql(
  database: string,
  table: string,
  options?: ScriptClusterOptions,
): string {
  return `TRUNCATE TABLE IF EXISTS ${qualifiedName(database, table)}${onClusterSqlSuffix(options?.onCluster)};`
}

export function renameTableSql(
  database: string,
  from: string,
  to: string,
  options?: ScriptClusterOptions,
): string {
  const oc = onClusterSqlSuffix(options?.onCluster)
  return `RENAME TABLE ${qualifiedName(database, from)} TO ${qualifiedName(database, to)}${oc};`
}

export function reloadDictionarySql(database: string, name: string): string {
  return `SYSTEM RELOAD DICTIONARY ${qualifiedName(database, name)};`
}

export function optimizeTableSql(
  database: string,
  table: string,
  options?: ScriptClusterOptions,
): string {
  return `OPTIMIZE TABLE ${qualifiedName(database, table)}${onClusterSqlSuffix(options?.onCluster)};`
}

export function detachTableSql(
  database: string,
  table: string,
  options?: ScriptClusterOptions,
): string {
  return `DETACH TABLE ${qualifiedName(database, table)}${onClusterSqlSuffix(options?.onCluster)};`
}

export function attachTableSql(
  database: string,
  table: string,
  options?: ScriptClusterOptions,
): string {
  return `ATTACH TABLE ${qualifiedName(database, table)}${onClusterSqlSuffix(options?.onCluster)};`
}

export function dictionarySelectSeed(database: string, name: string, limit = 100): string {
  return `SELECT *\nFROM ${qualifiedName(database, name)}\nLIMIT ${limit};\n`
}
