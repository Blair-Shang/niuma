/**
 * 达梦对象脚本新建模板 / 树级 DDL / 生成脚本（对齐 Navicat / DBeaver 常用项）。
 */
import { qualifiedName, quoteIdent } from '@/modules/dameng/sql-seed'
import type { DamengObjectCategory } from '@/modules/dameng/types/object-script'
import { DAMENG_CREATE_OBJECT_PLACEHOLDERS } from '@/modules/dameng/types/object-script'

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

export function createObjectTemplate(schema: string, category: DamengObjectCategory): string {
  const placeholder = DAMENG_CREATE_OBJECT_PLACEHOLDERS[category]
  const qn = qualifiedName(schema, placeholder)
  switch (category) {
    case 'views':
      return (
        `CREATE OR REPLACE VIEW ${qn} AS\n` +
        `SELECT\n` +
        `  *\n` +
        `FROM \n`
      )
    case 'procedures':
      return (
        `CREATE OR REPLACE PROCEDURE ${qn}\n` +
        `AS\n` +
        `BEGIN\n` +
        `  NULL;\n` +
        `END;\n`
      )
    case 'functions':
      return (
        `CREATE OR REPLACE FUNCTION ${qn}\n` +
        `RETURN INT\n` +
        `AS\n` +
        `BEGIN\n` +
        `  RETURN 0;\n` +
        `END;\n`
      )
    case 'packages':
      return createPackageSql(schema, placeholder)
    case 'synonyms':
      return createSynonymSql(schema, placeholder)
    case 'triggers':
      return createTriggerSql(schema, placeholder)
    case 'sequences':
      return createSequenceSql(schema, placeholder)
    default:
      return ''
  }
}

export function createSequenceSql(schema: string, name = 'new_seq'): string {
  const qn = qualifiedName(schema, name)
  return (
    `CREATE SEQUENCE ${qn}\n` +
    `  INCREMENT BY 1\n` +
    `  START WITH 1\n` +
    `  NOCACHE\n` +
    `  NOCYCLE;\n`
  )
}

/** 包 / 同义词 / 触发器新建模板（对象脚本面板编辑执行）。 */
export function createPackageSql(schema: string, name = 'new_pkg'): string {
  const qn = qualifiedName(schema, name)
  return (
    `CREATE OR REPLACE PACKAGE ${qn} AS\n` +
    `  -- package specification\n` +
    `  PROCEDURE hello;\n` +
    `END ${quoteIdent(name)};\n` +
    `/\n` +
    `\n` +
    `CREATE OR REPLACE PACKAGE BODY ${qn} AS\n` +
    `  PROCEDURE hello AS\n` +
    `  BEGIN\n` +
    `    NULL;\n` +
    `  END hello;\n` +
    `END ${quoteIdent(name)};\n` +
    `/\n`
  )
}

export function createSynonymSql(schema: string, name = 'new_syn'): string {
  const qn = qualifiedName(schema, name)
  return (
    `-- 请将 target_schema.target_object 替换为真实对象后再执行\n` +
    `CREATE OR REPLACE SYNONYM ${qn} FOR ${qualifiedName('target_schema', 'target_object')};\n`
  )
}

export function createTriggerSql(schema: string, name = 'new_trg'): string {
  const qn = qualifiedName(schema, name)
  const tableQn = qualifiedName(schema, 'target_table')
  return (
    `CREATE OR REPLACE TRIGGER ${qn}\n` +
    `BEFORE INSERT ON ${tableQn}\n` +
    `FOR EACH ROW\n` +
    `BEGIN\n` +
    `  NULL;\n` +
    `END;\n` +
    `/\n`
  )
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

export function dropSynonymSql(schema: string, name: string): string {
  return `DROP SYNONYM ${qualifiedName(schema, name)};`
}

export function dropTriggerSql(schema: string, name: string): string {
  return `DROP TRIGGER ${qualifiedName(schema, name)};`
}

export function truncateTableSql(schema: string, table: string): string {
  return `TRUNCATE TABLE ${qualifiedName(schema, table)};`
}

export function renameTableSql(schema: string, from: string, to: string): string {
  return `ALTER TABLE ${qualifiedName(schema, from)} RENAME TO ${quoteIdent(to)};`
}

/** 达梦视图重命名语法与表相同（ALTER TABLE … RENAME TO）。 */
export function renameViewSql(schema: string, from: string, to: string): string {
  return `ALTER TABLE ${qualifiedName(schema, from)} RENAME TO ${quoteIdent(to)};`
}

export function renameSequenceSql(schema: string, from: string, to: string): string {
  return `ALTER SEQUENCE ${qualifiedName(schema, from)} RENAME TO ${quoteIdent(to)};`
}

/**
 * 达梦 Schema ≈ 用户：CREATE USER 会创建同名模式。
 * 密码按标识符双引号转义，避免特殊字符破坏语句。
 */
export function createSchemaSql(name: string, password: string): string {
  const user = quoteIdent(name.trim())
  const pwd = quoteIdent(password)
  return `CREATE USER ${user} IDENTIFIED BY ${pwd};`
}

/**
 * 删除 Schema：与创建对称，执行 DROP USER … CASCADE（含同名模式及下属对象）。
 * CASCADE 在用户仍有对象时必需，否则会报错拒绝删除。
 */
export function dropSchemaSql(name: string): string {
  return `DROP USER ${quoteIdent(name.trim())} CASCADE;`
}

/** 新建用户后常用基础授权（可与 CREATE USER 分两条执行）。 */
export function grantSchemaResourceSql(name: string): string {
  return `GRANT RESOURCE, PUBLIC TO ${quoteIdent(name.trim())};`
}

export function compilePackageSql(schema: string, name: string): string {
  return `ALTER PACKAGE ${qualifiedName(schema, name)} COMPILE PACKAGE;\n`
}

export function compilePackageBodySql(schema: string, name: string): string {
  return `ALTER PACKAGE ${qualifiedName(schema, name)} COMPILE BODY;\n`
}

/** 重新编译过程（修复 STATUS=INVALID / -7160）。 */
export function compileProcedureSql(schema: string, name: string): string {
  return `ALTER PROCEDURE ${qualifiedName(schema, name)} COMPILE;\n`
}

/** 重新编译函数（修复 STATUS=INVALID / -7160）。 */
export function compileFunctionSql(schema: string, name: string): string {
  return `ALTER FUNCTION ${qualifiedName(schema, name)} COMPILE;\n`
}

/** 生成带 schema 限定的标识（调试/提示用）。 */
export function formatQualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}
