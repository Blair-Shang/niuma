/**
 * SQL Server 新建数据库：标识符校验与 T-SQL 生成（方括号标识符 + GO 分批）。
 */
import { quoteIdent } from '@/modules/sqlserver/sql-seed'

export const SQLSERVER_SYSTEM_DATABASES = ['master', 'model', 'msdb', 'tempdb'] as const

export const SQLSERVER_RECOVERY_MODELS = ['FULL', 'SIMPLE', 'BULK_LOGGED'] as const

export type SqlServerRecoveryModel = (typeof SQLSERVER_RECOVERY_MODELS)[number]

export const SQLSERVER_COMPAT_LEVELS = [100, 110, 120, 130, 140, 150, 160, 170] as const

export const COLLATION_SERVER_DEFAULT = '__server_default__'

export const MAX_DATABASE_NAME_LENGTH = 128

export type DatabaseNameError = 'empty' | 'tooLong' | 'invalidChars' | 'systemName' | 'exists'

/** Azure SQL Database / Synapse（不含 Managed Instance）。 */
export const AZURE_SQL_PAAS_ENGINE_EDITIONS = [5, 6] as const

export interface SqlServerDatabaseFileSpec {
  logicalName: string
  fileName: string
  sizeMb: number
  filegrowthMb: number
}

export interface SqlServerCreateDatabaseSpec {
  name: string
  collation?: string
  recovery?: SqlServerRecoveryModel | ''
  compatibilityLevel?: number | ''
  azure?: boolean
  files?: {
    data: SqlServerDatabaseFileSpec
    log: SqlServerDatabaseFileSpec
  }
}

const CONTROL_CHARS = /[\u0000-\u001f]/
const COLLATION_RE = /^[A-Za-z]\w*$/

const AZURE_SQL_HOST_MARKERS = [
  '.database.windows.net',
  '.database.chinacloudapi.cn',
  '.database.usgovcloudapi.net',
  '.database.cloudapi.de',
  '.sql.azuresynapse.net',
] as const

export function isAzureSqlHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return AZURE_SQL_HOST_MARKERS.some((marker) => h.includes(marker))
}

export function isAzureSqlPaasEdition(edition: number): boolean {
  return (AZURE_SQL_PAAS_ENGINE_EDITIONS as readonly number[]).includes(edition)
}

/** EngineEdition 优先；探测失败时回退主机名提示。Managed Instance 按本地实例处理。 */
export function resolveAzureSqlPaas(engineEdition: number, hostHint: boolean): boolean {
  if (Number.isFinite(engineEdition) && engineEdition > 0) {
    return isAzureSqlPaasEdition(engineEdition)
  }
  return hostHint
}

export function isSystemDatabaseName(name: string): boolean {
  return (SQLSERVER_SYSTEM_DATABASES as readonly string[]).includes(name.trim().toLowerCase())
}

export function validateDatabaseName(
  name: string,
  existingNames: readonly string[] = [],
): DatabaseNameError | undefined {
  const trimmed = name.trim()
  if (!trimmed) return 'empty'
  if (trimmed.length > MAX_DATABASE_NAME_LENGTH) return 'tooLong'
  if (CONTROL_CHARS.test(trimmed) || trimmed.includes(';')) return 'invalidChars'
  if (isSystemDatabaseName(trimmed)) return 'systemName'
  const lower = trimmed.toLowerCase()
  if (existingNames.some((n) => n.toLowerCase() === lower)) return 'exists'
  return undefined
}

export function validateCollationName(collation: string): boolean {
  const c = collation.trim()
  if (!c || c === COLLATION_SERVER_DEFAULT) return true
  return COLLATION_RE.test(c) && c.length <= 128
}

function nString(value: string): string {
  return `N'${value.replaceAll("'", "''")}'`
}

function joinOsPath(dir: string, file: string): string {
  let trimmed = dir
  while (trimmed.endsWith('\\') || trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1)
  }
  if (!trimmed) return file
  const sep = dir.includes('/') && !dir.includes('\\') ? '/' : '\\'
  return `${trimmed}${sep}${file}`
}

export function suggestDataFileName(dataPath: string, dbName: string): string {
  return joinOsPath(dataPath, `${dbName.trim()}.mdf`)
}

export function suggestLogFileName(logPath: string, dbName: string): string {
  return joinOsPath(logPath, `${dbName.trim()}_log.ldf`)
}

function fileClause(spec: SqlServerDatabaseFileSpec): string {
  const size = Math.max(1, Math.trunc(spec.sizeMb))
  const growth = Math.max(0, Math.trunc(spec.filegrowthMb))
  const logical = spec.logicalName.trim() || 'data'
  return `(
  NAME = ${nString(logical)},
  FILENAME = ${nString(spec.fileName.trim())},
  SIZE = ${size}MB,
  MAXSIZE = UNLIMITED,
  FILEGROWTH = ${growth}MB
)`
}

/** 生成可执行 T-SQL（独立行 GO，供客户端拆批，不发给服务器）。 */
export function buildCreateDatabaseSql(spec: SqlServerCreateDatabaseSpec): string {
  const name = spec.name.trim()
  const ident = quoteIdent(name)
  const batches: string[] = []

  let create = `CREATE DATABASE ${ident}`
  if (spec.files && !spec.azure) {
    create += `\nON PRIMARY\n${fileClause(spec.files.data)}\nLOG ON\n${fileClause(spec.files.log)}`
  }
  const collation = spec.collation?.trim()
  if (collation && collation !== COLLATION_SERVER_DEFAULT && validateCollationName(collation)) {
    create += `\nCOLLATE ${collation}`
  }
  create += ';'
  batches.push(create)

  if (!spec.azure) {
    const recovery = spec.recovery
    if (recovery && (SQLSERVER_RECOVERY_MODELS as readonly string[]).includes(recovery)) {
      batches.push(`ALTER DATABASE ${ident} SET RECOVERY ${recovery};`)
    }
  }

  const compat = spec.compatibilityLevel
  if (typeof compat === 'number' && SQLSERVER_COMPAT_LEVELS.includes(compat as (typeof SQLSERVER_COMPAT_LEVELS)[number])) {
    batches.push(`ALTER DATABASE ${ident} SET COMPATIBILITY_LEVEL = ${compat};`)
  }

  return `${batches.join('\nGO\n')}\nGO\n`
}
