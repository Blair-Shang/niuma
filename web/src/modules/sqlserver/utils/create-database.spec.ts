import { describe, expect, it } from 'vitest'
import {
  buildCreateDatabaseSql,
  isAzureSqlHost,
  isAzureSqlPaasEdition,
  isSystemDatabaseName,
  resolveAzureSqlPaas,
  suggestDataFileName,
  suggestLogFileName,
  validateCollationName,
  validateDatabaseName,
} from './create-database'

describe('validateDatabaseName', () => {
  it('rejects empty, oversize, control chars and system names', () => {
    expect(validateDatabaseName('')).toBe('empty')
    expect(validateDatabaseName('   ')).toBe('empty')
    expect(validateDatabaseName('a'.repeat(129))).toBe('tooLong')
    expect(validateDatabaseName('db\nname')).toBe('invalidChars')
    expect(validateDatabaseName('foo;bar')).toBe('invalidChars')
    expect(validateDatabaseName('master')).toBe('systemName')
    expect(validateDatabaseName('TempDB')).toBe('systemName')
    expect(validateDatabaseName('AppDb')).toBeUndefined()
    expect(validateDatabaseName('Sales', ['sales', 'Report'])).toBe('exists')
    expect(validateDatabaseName('Sales', ['Report'])).toBeUndefined()
  })
})

describe('validateCollationName', () => {
  it('allows server default and real collation identifiers', () => {
    expect(validateCollationName('')).toBe(true)
    expect(validateCollationName('__server_default__')).toBe(true)
    expect(validateCollationName('Chinese_PRC_CI_AS')).toBe(true)
    expect(validateCollationName("Latin1'; DROP")).toBe(false)
  })
})

describe('buildCreateDatabaseSql', () => {
  it('emits CREATE + optional ALTER batches with GO', () => {
    const sql = buildCreateDatabaseSql({
      name: 'Sales',
      collation: 'Chinese_PRC_CI_AS',
      recovery: 'SIMPLE',
      compatibilityLevel: 160,
    })
    expect(sql).toContain('CREATE DATABASE [Sales]')
    expect(sql).toContain('COLLATE Chinese_PRC_CI_AS')
    expect(sql).toContain('SET RECOVERY SIMPLE')
    expect(sql).toContain('SET COMPATIBILITY_LEVEL = 160')
    expect(sql.split('\nGO\n').length).toBeGreaterThan(2)
  })

  it('quotes ] in the database name', () => {
    expect(buildCreateDatabaseSql({ name: 'a]b' })).toContain('CREATE DATABASE [a]]b];')
  })

  it('omits recovery and files on Azure SQL', () => {
    const sql = buildCreateDatabaseSql({
      name: 'cloud',
      azure: true,
      recovery: 'FULL',
      files: {
        data: { logicalName: 'cloud', fileName: 'C:\\x.mdf', sizeMb: 8, filegrowthMb: 64 },
        log: { logicalName: 'cloud_log', fileName: 'C:\\x.ldf', sizeMb: 8, filegrowthMb: 64 },
      },
    })
    expect(sql).toContain('CREATE DATABASE [cloud];')
    expect(sql).not.toContain('ON PRIMARY')
    expect(sql).not.toContain('RECOVERY')
  })

  it('emits data and log file clauses', () => {
    const sql = buildCreateDatabaseSql({
      name: 'FilesDb',
      files: {
        data: {
          logicalName: 'FilesDb',
          fileName: 'D:\\data\\FilesDb.mdf',
          sizeMb: 16,
          filegrowthMb: 32,
        },
        log: {
          logicalName: 'FilesDb_log',
          fileName: 'D:\\data\\FilesDb_log.ldf',
          sizeMb: 8,
          filegrowthMb: 8,
        },
      },
    })
    expect(sql).toContain('ON PRIMARY')
    expect(sql).toContain("FILENAME = N'D:\\data\\FilesDb.mdf'")
    expect(sql).toContain('SIZE = 16MB')
    expect(sql).toContain('MAXSIZE = UNLIMITED')
    expect(sql).toContain('LOG ON')
  })
})

describe('path helpers', () => {
  it('joins Windows and POSIX default paths', () => {
    expect(suggestDataFileName('D:\\data\\', 'App')).toBe('D:\\data\\App.mdf')
    expect(suggestLogFileName('/var/opt/mssql/data/', 'App')).toBe('/var/opt/mssql/data/App_log.ldf')
  })

  it('detects Azure SQL hosts', () => {
    expect(isAzureSqlHost('myserver.database.windows.net')).toBe(true)
    expect(isAzureSqlHost('myserver.database.usgovcloudapi.net')).toBe(true)
    expect(isAzureSqlHost('192.168.1.10')).toBe(false)
    expect(isSystemDatabaseName('msdb')).toBe(true)
  })

  it('treats EngineEdition 5/6 as Azure SQL PaaS, not Managed Instance', () => {
    expect(isAzureSqlPaasEdition(5)).toBe(true)
    expect(isAzureSqlPaasEdition(8)).toBe(false)
    expect(resolveAzureSqlPaas(8, true)).toBe(false)
    expect(resolveAzureSqlPaas(5, false)).toBe(true)
    expect(resolveAzureSqlPaas(Number.NaN, true)).toBe(true)
  })
})
