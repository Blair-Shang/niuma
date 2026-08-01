/**
 * MySQL 连接树「生成脚本 / 新建对象 / 维护」模板（对齐 Navicat / DBeaver 常用项）。
 */
import { quoteIdent, qualifiedName } from '@/modules/mysql/sql-seed'
import type { CategoryId } from '@/modules/mysql/conn-tree-shared'

export interface ScriptColumn {
  name: string
  dataType?: string
}

export function selectAllSql(database: string, table: string, limit = 100): string {
  return `SELECT *\nFROM ${qualifiedName(database, table)}\nLIMIT ${limit};`
}

export function countSql(database: string, table: string): string {
  return `SELECT COUNT(*) AS cnt\nFROM ${qualifiedName(database, table)};`
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

export function updateTemplateSql(
  database: string,
  table: string,
  columns: ScriptColumn[] = [],
  pkColumns: string[] = [],
): string {
  const qn = qualifiedName(database, table)
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
      : '  true /* TODO: add WHERE */'
  return `UPDATE ${qn}\nSET\n${setCols.join(',\n')}\nWHERE\n${where};`
}

export function deleteTemplateSql(
  database: string,
  table: string,
  pkColumns: string[] = [],
): string {
  const qn = qualifiedName(database, table)
  const where =
    pkColumns.length > 0
      ? pkColumns.map((name) => `  ${quoteIdent(name)} = NULL`).join('\n  AND ')
      : '  true /* TODO: add WHERE */'
  return `DELETE FROM ${qn}\nWHERE\n${where};`
}

export function analyzeTableSql(database: string, table: string): string {
  return `ANALYZE TABLE ${qualifiedName(database, table)};`
}

export function optimizeTableSql(database: string, table: string): string {
  return `OPTIMIZE TABLE ${qualifiedName(database, table)};`
}

export function checkTableSql(database: string, table: string): string {
  return `CHECK TABLE ${qualifiedName(database, table)};`
}

export function repairTableSql(database: string, table: string): string {
  return `REPAIR TABLE ${qualifiedName(database, table)};`
}

/**
 * 新建对象 SQL 模板（对象脚本面板预填；保留 catalog 表/列补全）。
 * 视图：FROM 后空位便于补全表名；
 * 例程：Navicat 风格直接写 CREATE…BEGIN…END;（无需 DELIMITER；拆句走 mysqlCompoundBlocks）。
 */
export function createObjectTemplate(database: string, category: CategoryId): string {
  const qn = (name: string) => qualifiedName(database, name)
  switch (category) {
    case 'tables':
      return (
        `CREATE TABLE ${qn('new_table')} (\n` +
        `  \`id\` BIGINT NOT NULL AUTO_INCREMENT,\n` +
        `  PRIMARY KEY (\`id\`)\n` +
        `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n`
      )
    case 'views':
      return (
        `CREATE VIEW ${qn('new_view')} AS\n` +
        `SELECT\n` +
        `  *\n` +
        `FROM \n`
      )
    case 'procedures':
      return (
        `CREATE PROCEDURE ${qn('new_proc')}()\n` +
        `BEGIN\n` +
        `  -- body\n` +
        `  SELECT 1;\n` +
        `END;\n`
      )
    case 'functions':
      return (
        `CREATE FUNCTION ${qn('new_func')}()\n` +
        `RETURNS INT\n` +
        `DETERMINISTIC\n` +
        `BEGIN\n` +
        `  -- body\n` +
        `  RETURN 1;\n` +
        `END;\n`
      )
  }
}

export function dropDatabaseSql(name: string): string {
  return `DROP DATABASE IF EXISTS ${quoteIdent(name)};`
}

export function dropTableSql(database: string, table: string): string {
  return `DROP TABLE IF EXISTS ${qualifiedName(database, table)};`
}

export function dropViewSql(database: string, view: string): string {
  return `DROP VIEW IF EXISTS ${qualifiedName(database, view)};`
}

export function dropProcedureSql(database: string, name: string): string {
  return `DROP PROCEDURE IF EXISTS ${qualifiedName(database, name)};`
}

export function dropFunctionSql(database: string, name: string): string {
  return `DROP FUNCTION IF EXISTS ${qualifiedName(database, name)};`
}

export function truncateTableSql(database: string, table: string): string {
  return `TRUNCATE TABLE ${qualifiedName(database, table)};`
}

export function renameTableSql(database: string, from: string, to: string): string {
  return `RENAME TABLE ${qualifiedName(database, from)} TO ${qualifiedName(database, to)};`
}

export function createDatabaseSql(
  name: string,
  options?: { charset?: string; collation?: string },
): string {
  const parts = [`CREATE DATABASE ${quoteIdent(name)}`]
  const charset = options?.charset?.trim()
  const collation = options?.collation?.trim()
  if (charset) {
    parts.push(`CHARACTER SET ${charset}`)
  }
  if (collation) {
    parts.push(`COLLATE ${collation}`)
  }
  return `${parts.join(' ')};`
}

export function showCreateDatabaseSql(database: string): string {
  return `SHOW CREATE DATABASE ${quoteIdent(database)}`
}

export function showCreateTableSql(database: string, table: string): string {
  return `SHOW CREATE TABLE ${qualifiedName(database, table)}`
}

export function showCreateViewSql(database: string, view: string): string {
  return `SHOW CREATE VIEW ${qualifiedName(database, view)}`
}

export function showCreateProcedureSql(database: string, name: string): string {
  return `SHOW CREATE PROCEDURE ${qualifiedName(database, name)}`
}

export function showCreateFunctionSql(database: string, name: string): string {
  return `SHOW CREATE FUNCTION ${qualifiedName(database, name)}`
}
