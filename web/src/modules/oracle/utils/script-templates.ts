/**
 * Oracle 对象脚本新建模板 / 树级 DDL / 生成脚本。
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
  const placeholder = ORACLE_CREATE_OBJECT_PLACEHOLDERS[category]
  const qn = qualifiedName(schema, placeholder)
  if (category === 'views') return `CREATE OR REPLACE VIEW ${qn} AS\nSELECT\n  *\nFROM \n`
  if (category === 'procedures') {
    return `CREATE OR REPLACE PROCEDURE ${qn}\nAS\nBEGIN\n  NULL;\nEND;\n/\n`
  }
  if (category === 'functions') {
    return `CREATE OR REPLACE FUNCTION ${qn}\nRETURN NUMBER\nAS\nBEGIN\n  RETURN 0;\nEND;\n/\n`
  }
  if (category === 'synonyms') return createSynonymSql(schema, placeholder)
  if (category === 'triggers') return createTriggerSql(schema, placeholder)
  if (category === 'sequences') return createSequenceSql(schema, placeholder)
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

export function dropObjectSql(schema: string, name: string, category: OracleObjectCategory): string {
  const type =
    category === 'views'
      ? 'VIEW'
      : category === 'procedures'
        ? 'PROCEDURE'
        : category === 'functions'
          ? 'FUNCTION'
          : category === 'synonyms'
            ? 'SYNONYM'
            : category === 'triggers'
              ? 'TRIGGER'
              : category === 'sequences'
                ? 'SEQUENCE'
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

export function dropSynonymSql(schema: string, name: string): string {
  return `DROP SYNONYM ${qualifiedName(schema, name)};`
}

export function dropTriggerSql(schema: string, name: string): string {
  return `DROP TRIGGER ${qualifiedName(schema, name)};`
}

/** 删除 Schema：与 CREATE USER 对称，DROP USER … CASCADE。 */
export function dropSchemaSql(name: string): string {
  return `DROP USER ${quoteIdent(name.trim())} CASCADE;`
}

export function truncateTableSql(schema: string, table: string): string {
  return `TRUNCATE TABLE ${qualifiedName(schema, table)};`
}

export function renameTableSql(schema: string, from: string, to: string): string {
  return `ALTER TABLE ${qualifiedName(schema, from)} RENAME TO ${quoteIdent(to)};`
}

/**
 * 仅当会话用户就是视图属主时可用。
 * DBA 经 CURRENT_SCHEMA 代管其它 schema 时会 ORA-03001，需走 recreate 回退。
 */
export function renameViewSql(_schema: string, from: string, to: string): string {
  return `RENAME ${quoteIdent(from)} TO ${quoteIdent(to)}`
}

/** 带 schema 限定，避免依赖 CURRENT_SCHEMA / 会话属主。 */
export function renameSequenceSql(schema: string, from: string, to: string): string {
  return `ALTER SEQUENCE ${qualifiedName(schema, from)} RENAME TO ${quoteIdent(to)}`
}

/**
 * 把 CREATE [OR REPLACE] VIEW [schema.]old 改写为 CREATE OR REPLACE VIEW schema.new。
 * 用于非属主会话无法 RENAME 时的「建新删旧」回退。
 */
export function rewriteOracleViewDdlForRename(
  ddl: string,
  schema: string,
  from: string,
  to: string,
): string {
  let s = (ddl ?? '').trim().replace(/;\s*$/, '')
  if (!s) return s
  const qSchema = quoteIdent(schema)
  const qTo = quoteIdent(to)
  const fromEsc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const namePat = `(?:"${fromEsc}"|${fromEsc})`
  const re = new RegExp(
    `^(create\\s+(?:or\\s+replace\\s+)?)view\\s+(?:(?:"[^"]+"|[A-Za-z0-9_$#]+)\\s*\\.\\s*)?${namePat}\\b`,
    'i',
  )
  if (re.test(s)) {
    s = s.replace(re, `$1VIEW ${qSchema}.${qTo}`)
  } else if (/^create\s+(or\s+replace\s+)?view\b/i.test(s)) {
    // 未匹配到旧名时仍强制换成目标限定名
    s = s.replace(
      /^create\s+(?:or\s+replace\s+)?view\s+(?:(?:"[^"]+"|[A-Za-z0-9_$#]+)\s*\.\s*)?(?:"[^"]+"|[A-Za-z0-9_$#]+)/i,
      `CREATE OR REPLACE VIEW ${qSchema}.${qTo}`,
    )
  } else {
    // ALL_VIEWS 退化正文：仅有 AS 查询
    s = `CREATE OR REPLACE VIEW ${qSchema}.${qTo} AS\n${s}`
  }
  if (!/^create\s+or\s+replace\s+/i.test(s)) {
    s = s.replace(/^create\s+/i, 'CREATE OR REPLACE ')
  }
  return s
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

/**
 * Oracle Schema ≈ 用户：CREATE USER 会创建同名模式。
 * 常规标识符不引号并转大写（与 ALL_USERS 一致）；密码按需双引号。
 * 默认带 USERS / TEMP / QUOTA（12c+ RESOURCE 不再含无限表空间配额）。
 * 经 ODPI 执行时不要带尾 `;`。
 */
export function createSchemaSql(
  name: string,
  password: string,
  options?: {
    defaultTablespace?: string
    temporaryTablespace?: string
    quotaUnlimited?: boolean
  },
): string {
  const user = formatOracleUserIdent(name)
  const pwd = formatOraclePassword(password)
  const lines = [`CREATE USER ${user} IDENTIFIED BY ${pwd}`]

  const defaultTs = (options?.defaultTablespace ?? 'USERS').trim()
  if (defaultTs) {
    lines.push(`  DEFAULT TABLESPACE ${formatOracleUserIdent(defaultTs)}`)
  }

  const tempTs = (options?.temporaryTablespace ?? 'TEMP').trim()
  if (tempTs) {
    lines.push(`  TEMPORARY TABLESPACE ${formatOracleUserIdent(tempTs)}`)
  }

  if (options?.quotaUnlimited !== false && defaultTs) {
    lines.push(`  QUOTA UNLIMITED ON ${formatOracleUserIdent(defaultTs)}`)
  }

  return lines.join('\n')
}

/** 新建用户后常用基础授权（CONNECT / RESOURCE）。 */
export function grantSchemaConnectResourceSql(name: string): string {
  return `GRANT CONNECT, RESOURCE TO ${formatOracleUserIdent(name)}`
}

/** 常规 Oracle 标识符：字母开头，仅含字母数字 _ $ # → 不引号并大写。 */
function isSimpleOracleIdent(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_$#]*$/.test(name)
}

function formatOracleUserIdent(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return quoteIdent(trimmed)
  if (isSimpleOracleIdent(trimmed)) return trimmed.toUpperCase()
  return quoteIdent(trimmed)
}

/**
 * 密码：含非 [A-Za-z0-9_#$] 或以非字母开头时必须双引号；
 * 一律双引号更稳妥。密码本身禁止含双引号（Oracle 规则）。
 */
function formatOraclePassword(password: string): string {
  if (password.includes('"')) {
    throw new Error('password must not contain double quote')
  }
  return quoteIdent(password)
}
