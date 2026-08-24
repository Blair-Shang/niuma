import { describe, expect, it } from 'vitest'
import {
  normalizeObjectSaveSql,
  parseSqlServerObjectNameFromSql,
  toCreateOrAlterSql,
  toSequenceAlterSql,
  toSynonymReplaceSql,
} from '@/modules/sqlserver/utils/normalize-object-ddl'

describe('parseSqlServerObjectNameFromSql', () => {
  it('parses bracket-qualified view', () => {
    expect(
      parseSqlServerObjectNameFromSql('CREATE VIEW [dbo].[MyView]\nAS\nSELECT 1;', 'view'),
    ).toBe('MyView')
  })

  it('parses CREATE OR ALTER procedure', () => {
    expect(
      parseSqlServerObjectNameFromSql(
        'CREATE OR ALTER PROCEDURE dbo.MyProc\nAS\nBEGIN\n  SELECT 1;\nEND;',
        'procedure',
      ),
    ).toBe('MyProc')
  })

  it('parses PROC short form', () => {
    expect(parseSqlServerObjectNameFromSql('CREATE PROC [Sales].[GetOrders]\nAS\nSELECT 1;', 'procedure')).toBe(
      'GetOrders',
    )
  })

  it('parses ALTER SEQUENCE', () => {
    expect(
      parseSqlServerObjectNameFromSql('ALTER SEQUENCE [dbo].[NewSequence]\n  RESTART WITH 1;', 'sequence'),
    ).toBe('NewSequence')
  })

  it('parses CREATE SYNONYM and DROP+CREATE', () => {
    expect(
      parseSqlServerObjectNameFromSql('CREATE SYNONYM [dbo].[Emp] FOR [HR].[dbo].[Employees];', 'synonym'),
    ).toBe('Emp')
    expect(
      parseSqlServerObjectNameFromSql(
        'DROP SYNONYM IF EXISTS [dbo].[Emp];\nCREATE SYNONYM [dbo].[Emp] FOR [HR].[dbo].[Employees];',
        'synonym',
      ),
    ).toBe('Emp')
  })
})

describe('toCreateOrAlterSql', () => {
  it('upgrades CREATE VIEW', () => {
    expect(toCreateOrAlterSql('CREATE VIEW [dbo].[V]\nAS\nSELECT 1;', 'view')).toMatch(
      /^CREATE OR ALTER VIEW/i,
    )
  })

  it('leaves sequence as CREATE', () => {
    expect(toCreateOrAlterSql('CREATE SEQUENCE [dbo].[S]\n  AS BIGINT;', 'sequence')).toMatch(
      /^CREATE SEQUENCE/i,
    )
  })

  it('leaves synonym as CREATE', () => {
    expect(toCreateOrAlterSql('CREATE SYNONYM [dbo].[S] FOR [dbo].[T];', 'synonym')).toMatch(
      /^CREATE SYNONYM/i,
    )
  })
})

describe('toSequenceAlterSql', () => {
  it('converts catalog CREATE SEQUENCE to ALTER like SSMS', () => {
    const catalog =
      'CREATE SEQUENCE [dbo].[Seq]\n  AS bigint\n  START WITH 1\n  INCREMENT BY 1\n  MINVALUE 1\n  MAXVALUE 999\n  NO CYCLE\n  CACHE 50\n'
    const got = toSequenceAlterSql(catalog)
    expect(got).toMatch(/^ALTER SEQUENCE \[dbo\]\.\[Seq\]/i)
    expect(got).toContain('RESTART WITH 1')
    expect(got).toContain('INCREMENT BY 1')
    expect(got).not.toMatch(/\bAS\s+bigint\b/i)
    expect(got).not.toMatch(/\bSTART\s+WITH\b/i)
  })

  it('handles formatter-split CREATE / START WITH', () => {
    const formatted =
      'CREATE\nSEQUENCE [dbo].[NewSequence] AS bigint START\nWITH\n    1 INCREMENT BY 1;'
    const got = toSequenceAlterSql(formatted)
    expect(got).toMatch(/^ALTER SEQUENCE/i)
    expect(got).toContain('RESTART WITH')
    expect(got).not.toMatch(/\bAS\s+bigint\b/i)
  })

  it('leaves ALTER SEQUENCE unchanged', () => {
    const alter = 'ALTER SEQUENCE [dbo].[S]\n  RESTART WITH 2\n  INCREMENT BY 1;'
    expect(toSequenceAlterSql(alter)).toBe(alter)
  })
})

describe('normalizeObjectSaveSql', () => {
  it('keeps CREATE SEQUENCE in create mode', () => {
    const sql = 'CREATE SEQUENCE [dbo].[S]\n  AS BIGINT\n  START WITH 1;'
    expect(normalizeObjectSaveSql(sql, 'sequence', 'create')).toMatch(/^CREATE SEQUENCE/i)
  })

  it('uses ALTER SEQUENCE in alter mode', () => {
    const sql = 'CREATE SEQUENCE [dbo].[S]\n  AS BIGINT\n  START WITH 1;'
    expect(normalizeObjectSaveSql(sql, 'sequence', 'alter')).toMatch(/^ALTER SEQUENCE/i)
  })

  it('keeps CREATE SYNONYM in create mode', () => {
    const sql = 'CREATE SYNONYM [dbo].[Emp] FOR [dbo].[Employees];'
    expect(normalizeObjectSaveSql(sql, 'synonym', 'create')).toMatch(/^CREATE SYNONYM/i)
  })

  it('uses DROP + CREATE for existing synonym', () => {
    const sql = 'CREATE SYNONYM [dbo].[Emp] FOR [dbo].[Employees];'
    const got = normalizeObjectSaveSql(sql, 'synonym', 'alter')
    expect(got).toMatch(/^DROP SYNONYM IF EXISTS \[dbo\]\.\[Emp\];/i)
    expect(got).toContain('CREATE SYNONYM [dbo].[Emp]')
  })
})

describe('toSynonymReplaceSql', () => {
  it('leaves DROP + CREATE unchanged', () => {
    const sql = 'DROP SYNONYM IF EXISTS [dbo].[Emp];\nCREATE SYNONYM [dbo].[Emp] FOR [dbo].[T];'
    expect(toSynonymReplaceSql(sql)).toBe(sql)
  })
})
