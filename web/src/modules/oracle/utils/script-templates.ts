/**
 * Oracle 对象脚本新建模板 / 树级 DDL / 生成脚本（对齐 Navicat / DBeaver 常用项）。
 */
import { qualifiedName, quoteIdent } from '@/modules/oracle/sql-seed'
import type { OracleObjectCategory } from '@/modules/oracle/types/object-script'
import { ORACLE_CREATE_OBJECT_PLACEHOLDERS } from '@/modules/oracle/types/object-script'

export interface ScriptColumn {
  name: string
  dataType?: string
}

export function selectAllSql(schema: string, table: string, limit = 100): string {
  return `SELECT *\nFROM ${qualifiedName(schema, table)}\nFETCH FIRST ${limit} ROWS ONLY;`
}

export function countSql(schema: string, table: string): string {
  return `SELECT COUNT(*) AS ${quoteIdent('cnt')}\nFROM ${qualifiedName(schema, table)};`
}

export function insertTemplateSql(
  schema: string,
  table: string,
  columns: ScriptColumn[] = [],
): string {
  const qn = qualifiedName(schema, table)
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
      : '  1 = 1 /* TODO: add WHERE */'
  return `UPDATE ${qn}\nSET\n${setCols.join(',\n')}\nWHERE\n${where};`
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
      : '  1 = 1 /* TODO: add WHERE */'
  return `DELETE FROM ${qn}\nWHERE\n${where};`
}

export function createObjectTemplate(schema: string, category: OracleObjectCategory): string {
  const qn = qualifiedName(schema, ORACLE_CREATE_OBJECT_PLACEHOLDERS[category])
  if (category === 'views') return `CREATE OR REPLACE VIEW ${qn} AS\nSELECT\n  *\nFROM \n`
  if (category === 'procedures') {
    return `CREATE OR REPLACE PROCEDURE ${qn}\nAS\nBEGIN\n  NULL;\nEND;\n/\n`
  }
  if (category === 'functions') {
    return `CREATE OR REPLACE FUNCTION ${qn}\nRETURN NUMBER\nAS\nBEGIN\n  RETURN 0;\nEND;\n/\n`
  }
  return (
    `CREATE OR REPLACE PACKAGE ${qn} AS\n` +
    `  PROCEDURE example;\n` +
    `END;\n` +
    `/\n\n` +
    `CREATE OR REPLACE PACKAGE BODY ${qn} AS\n` +
    `  PROCEDURE example IS\n` +
    `  BEGIN\n` +
    `    NULL;\n` +
    `  END;\n` +
    `END;\n` +
    `/\n`
  )
}

export function createSequenceSql(schema: string, name = 'new_seq'): string {
  return (
    `CREATE SEQUENCE ${qualifiedName(schema, name)}\n` +
    `  START WITH 1\n` +
    `  INCREMENT BY 1\n` +
    `  NOCACHE\n` +
    `  NOCYCLE;\n`
  )
}

export function dropObjectSql(schema: string, name: string, category: OracleObjectCategory): string {
  const type =
    category === 'views'
      ? 'VIEW'
      : category === 'procedures'
        ? 'PROCEDURE'
        : category === 'functions'
          ? 'FUNCTION'
          : 'PACKAGE'
  return `DROP ${type} ${qualifiedName(schema, name)};`
}

export function dropTableSql(schema: string, table: string): string {
  return `DROP TABLE ${qualifiedName(schema, table)};`
}

export function dropViewSql(schema: string, name: string): string {
  return `DROP VIEW ${qualifiedName(schema, name)};`
}

export function dropProcedureSql(schema: string, name: string): string {
  return `DROP PROCEDURE ${qualifiedName(schema, name)};`
}

export function dropFunctionSql(schema: string, name: string): string {
  return `DROP FUNCTION ${qualifiedName(schema, name)};`
}

export function dropSequenceSql(schema: string, name: string): string {
  return `DROP SEQUENCE ${qualifiedName(schema, name)};`
}

export function dropPackageSql(schema: string, name: string): string {
  return `DROP PACKAGE ${qualifiedName(schema, name)};`
}

export function truncateTableSql(schema: string, table: string): string {
  return `TRUNCATE TABLE ${qualifiedName(schema, table)};`
}

export function renameTableSql(schema: string, from: string, to: string): string {
  return `ALTER TABLE ${qualifiedName(schema, from)} RENAME TO ${quoteIdent(to)};`
}

/** 依赖会话 current_schema；执行时传入 schema。 */
export function renameViewSql(_schema: string, from: string, to: string): string {
  return `RENAME ${quoteIdent(from)} TO ${quoteIdent(to)};`
}

/** 依赖会话 current_schema；执行时传入 schema。 */
export function renameSequenceSql(_schema: string, from: string, to: string): string {
  return `RENAME ${quoteIdent(from)} TO ${quoteIdent(to)};`
}

export function compilePackageSql(schema: string, name: string): string {
  return `ALTER PACKAGE ${qualifiedName(schema, name)} COMPILE PACKAGE;\n`
}

export function compilePackageBodySql(schema: string, name: string): string {
  return `ALTER PACKAGE ${qualifiedName(schema, name)} COMPILE BODY;\n`
}

export function compileProcedureSql(schema: string, name: string): string {
  return `ALTER PROCEDURE ${qualifiedName(schema, name)} COMPILE;\n`
}

export function compileFunctionSql(schema: string, name: string): string {
  return `ALTER FUNCTION ${qualifiedName(schema, name)} COMPILE;\n`
}

export function formatQualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}
