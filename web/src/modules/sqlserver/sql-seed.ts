/**
 * SQL Server 树动作种子 SQL（方括号标识符）。
 * 变更类脚本默认带安全 WHERE / 注释，打开查询后由用户审阅再执行。
 */

export function quoteIdent(name: string): string {
  return `[${String(name).replace(/]/g, ']]')}]`
}

/** 限定名：database.schema.object 或 schema.object。 */
export function qualifiedName(...parts: Array<string | undefined>): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .map(quoteIdent)
    .join('.')
}

function relationTarget(schema: string, table: string, database?: string): string {
  return database ? qualifiedName(database, schema, table) : qualifiedName(schema, table)
}

export function sqlserverSelectSeed(schema: string, table: string, database?: string): string {
  return `SELECT TOP (1000) *\nFROM ${relationTarget(schema, table, database)};\n`
}

export function sqlserverCountSeed(schema: string, table: string, database?: string): string {
  return `SELECT COUNT(*) AS cnt\nFROM ${relationTarget(schema, table, database)};\n`
}

export function sqlserverUseDatabaseSeed(database: string): string {
  return `USE ${quoteIdent(database)};\n`
}

function withUse(database: string | undefined, body: string): string {
  if (!database?.trim()) return body
  return `${sqlserverUseDatabaseSeed(database)}GO\n${body}`
}

export interface ScriptColumn {
  name: string
  dataType?: string
  autoIncrement?: boolean
  computed?: boolean
}

function writableColumns(columns: ScriptColumn[]): ScriptColumn[] {
  return columns.filter((column) => !column.autoIncrement && !column.computed)
}

export function sqlserverInsertSeed(
  schema: string,
  table: string,
  database?: string,
  columns: ScriptColumn[] = [],
): string {
  const target = relationTarget(schema, table, database)
  const writable = writableColumns(columns)
  if (writable.length === 0) {
    return `INSERT INTO ${target} (\n  /* columns */\n)\nVALUES (\n  /* values */\n);\n`
  }
  const names = writable.map((column) => `  ${quoteIdent(column.name)}`).join(',\n')
  const values = writable
    .map((column) => {
      const hint = column.dataType ? ` /* ${column.dataType} */` : ''
      return `  NULL${hint}`
    })
    .join(',\n')
  return `INSERT INTO ${target} (\n${names}\n)\nVALUES (\n${values}\n);\n`
}

export function sqlserverUpdateSeed(
  schema: string,
  table: string,
  database?: string,
  columns: ScriptColumn[] = [],
  pkColumns: string[] = [],
): string {
  const target = relationTarget(schema, table, database)
  const pkSet = new Set(pkColumns)
  const setCols = writableColumns(columns).filter((column) => !pkSet.has(column.name))
  const setLines = setCols.length
    ? setCols.map((column) => {
        const hint = column.dataType ? ` /* ${column.dataType} */` : ''
        return `  ${quoteIdent(column.name)} = NULL${hint}`
      })
    : ['  /* column = value */']
  const where =
    pkColumns.length > 0
      ? pkColumns.map((name) => `  ${quoteIdent(name)} = NULL`).join('\n  AND ')
      : '  1 = 0 -- review before execute'
  return `UPDATE ${target}\nSET\n${setLines.join(',\n')}\nWHERE\n${where};\n`
}

export function sqlserverDeleteSeed(
  schema: string,
  table: string,
  database?: string,
  pkColumns: string[] = [],
): string {
  const target = relationTarget(schema, table, database)
  const where =
    pkColumns.length > 0
      ? pkColumns.map((name) => `  ${quoteIdent(name)} = NULL`).join('\n  AND ')
      : '  1 = 0 -- review before execute'
  return `DELETE FROM ${target}\nWHERE\n${where};\n`
}

export function sqlserverTruncateSeed(schema: string, table: string, database?: string): string {
  return `TRUNCATE TABLE ${relationTarget(schema, table, database)};\n`
}

export function sqlserverDropTableSeed(schema: string, table: string, database?: string): string {
  return `DROP TABLE ${relationTarget(schema, table, database)};\n`
}

export function sqlserverDropViewSeed(schema: string, view: string, database?: string): string {
  return `DROP VIEW ${relationTarget(schema, view, database)};\n`
}

export function sqlserverDropSynonymSeed(schema: string, synonym: string, database?: string): string {
  return `DROP SYNONYM ${relationTarget(schema, synonym, database)};\n`
}

export function sqlserverDropRoutineSeed(
  kind: 'procedure' | 'function',
  schema: string,
  name: string,
  database?: string,
): string {
  const kw = kind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'
  return `DROP ${kw} ${relationTarget(schema, name, database)};\n`
}

export function sqlserverDropSequenceSeed(schema: string, name: string, database?: string): string {
  return `DROP SEQUENCE ${relationTarget(schema, name, database)};\n`
}

export function sqlserverExecRoutineSeed(
  kind: 'procedure' | 'function',
  schema: string,
  name: string,
  database?: string,
): string {
  const target = relationTarget(schema, name, database)
  if (kind === 'procedure') {
    return `EXEC ${target};\n-- EXEC ${target} @param = NULL;\n`
  }
  return `SELECT ${target}(/* args */);\n`
}

export function sqlserverSequenceNextSeed(schema: string, name: string, database?: string): string {
  return `SELECT NEXT VALUE FOR ${relationTarget(schema, name, database)} AS next_value;\n`
}

export function sqlserverCreateDatabaseSeed(): string {
  return `CREATE DATABASE [NewDatabase];\n`
}

export function sqlserverDropDatabaseSeed(database: string): string {
  return `DROP DATABASE ${quoteIdent(database)};\n`
}

/** 新建 Schema 对话框预览/执行用：不带 USE，由调用方连到目标库执行。 */
export function sqlserverCreateSchemaSql(schema: string, owner?: string): string {
  const ownerClause = owner?.trim() ? ` AUTHORIZATION ${quoteIdent(owner.trim())}` : ''
  return `CREATE SCHEMA ${quoteIdent(schema)}${ownerClause};\n`
}

export function sqlserverDropSchemaSeed(database: string, schema: string): string {
  return withUse(database, `DROP SCHEMA ${quoteIdent(schema)};\n`)
}

export function sqlserverCreateTableSeed(database: string, schema: string): string {
  return withUse(
    database,
    `CREATE TABLE ${qualifiedName(schema, 'NewTable')} (\n  [Id] INT IDENTITY(1, 1) NOT NULL PRIMARY KEY,\n  [Name] NVARCHAR(128) NOT NULL\n);\n`,
  )
}

export function sqlserverCreateViewSeed(database: string, schema: string): string {
  return withUse(
    database,
    `CREATE VIEW ${qualifiedName(schema, 'NewView')}\nAS\nSELECT\n  1 AS [Id];\n`,
  )
}

export function sqlserverCreateProcedureSeed(database: string, schema: string): string {
  return withUse(
    database,
    `CREATE PROCEDURE ${qualifiedName(schema, 'NewProcedure')}\nAS\nBEGIN\n  SET NOCOUNT ON;\n  SELECT 1 AS [Id];\nEND;\n`,
  )
}

export function sqlserverCreateFunctionSeed(database: string, schema: string): string {
  return withUse(
    database,
    `CREATE FUNCTION ${qualifiedName(schema, 'NewFunction')} ()\nRETURNS INT\nAS\nBEGIN\n  RETURN 1;\nEND;\n`,
  )
}

export function sqlserverObjectScriptTemplate(
  kind: 'view' | 'procedure' | 'function' | 'sequence' | 'synonym',
  schema: string,
): string {
  switch (kind) {
    case 'view':
      return `CREATE OR ALTER VIEW ${qualifiedName(schema, 'NewView')}\nAS\nSELECT\n  1 AS [Id];\n`
    case 'procedure':
      return `CREATE OR ALTER PROCEDURE ${qualifiedName(schema, 'NewProcedure')}\nAS\nBEGIN\n  SET NOCOUNT ON;\n  SELECT 1 AS [Id];\nEND;\n`
    case 'function':
      return `CREATE OR ALTER FUNCTION ${qualifiedName(schema, 'NewFunction')} ()\nRETURNS INT\nAS\nBEGIN\n  RETURN 1;\nEND;\n`
    case 'sequence':
      return `CREATE SEQUENCE ${qualifiedName(schema, 'NewSequence')}\n  AS BIGINT\n  START WITH 1\n  INCREMENT BY 1;\n`
    case 'synonym':
      return `CREATE SYNONYM ${qualifiedName(schema, 'NewSynonym')}\n  FOR ${qualifiedName(schema, 'TargetObject')};\n`
  }
}

export function sqlserverCreateSequenceSeed(database: string, schema: string): string {
  return withUse(
    database,
    `CREATE SEQUENCE ${qualifiedName(schema, 'NewSequence')}\n  AS BIGINT\n  START WITH 1\n  INCREMENT BY 1;\n`,
  )
}

/** 实例会话 / 请求监视（需 VIEW SERVER STATE；打开后由用户执行）。 */
export function sqlserverMonitorSeed(): string {
  return `SELECT
  s.session_id,
  s.login_name,
  s.host_name,
  s.program_name,
  s.status,
  s.cpu_time,
  s.memory_usage,
  r.command,
  r.wait_type,
  r.blocking_session_id,
  SUBSTRING(t.text, 1, 400) AS text_preview
FROM sys.dm_exec_sessions AS s
LEFT JOIN sys.dm_exec_requests AS r
  ON r.session_id = s.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) AS t
WHERE s.is_user_process = 1
ORDER BY s.session_id;
`
}
