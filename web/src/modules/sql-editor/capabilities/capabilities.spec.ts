import { describe, expect, it } from 'vitest'
import {
  Cap,
  buildAiDialectRules,
  defaultClickHouseProfile,
  defaultKingbaseProfile,
  defaultMySQL8Profile,
  defaultPostgreSQLProfile,
  defaultSqliteProfile,
  defaultVastbaseProfile,
  hasCapability,
  resolveFormatterLanguage,
  resolveMonacoLanguageFromProfile,
  resolveSplitFeaturesFromProfile,
} from './types'

describe('sql-editor capabilities', () => {
  it('default vastbase enables plsql procedure not plpgsql procedure', () => {
    const p = defaultVastbaseProfile()
    expect(hasCapability(p, Cap.ProcPlsqlBare)).toBe(true)
    expect(hasCapability(p, Cap.ProcPlpgsqlDollar)).toBe(false)
    expect(hasCapability(p, Cap.SplitPlsqlBlocks)).toBe(true)
  })

  it('split features follow capabilities', () => {
    const f = resolveSplitFeaturesFromProfile(defaultVastbaseProfile())
    expect(f.plsqlBlocks).toBe(true)
    expect(f.dollarQuotes).toBe(true)
  })

  it('mysql default profile enables delimiter and compound blocks', () => {
    const f = resolveSplitFeaturesFromProfile(defaultMySQL8Profile())
    expect(f.delimiterBlocks).toBe(true)
    expect(f.mysqlCompoundBlocks).toBe(true)
    expect(f.backticks).toBe(true)
  })

  it('ai rules mention procedure style from caps', () => {
    const rules = buildAiDialectRules(defaultVastbaseProfile())
    expect(rules).toContain('proc.plsql_bare')
    expect(rules).toContain('CREATE PROCEDURE')
  })

  it('non-mysql dialects silently use builtin sql (no worker)', () => {
    const vast = resolveMonacoLanguageFromProfile(defaultVastbaseProfile())
    expect(vast.monacoLanguageId).toBe('sql')
    expect(vast.monacoSqlLanguages).toBe(false)
    expect(vast.useLsp).toBe(false)
    const pg = resolveMonacoLanguageFromProfile(defaultPostgreSQLProfile())
    expect(pg.monacoLanguageId).toBe('sql')
    expect(pg.useLsp).toBe(false)
  })

  it('editor.builtin_sql alone falls back to builtin sql', () => {
    const builtin = resolveMonacoLanguageFromProfile({
      family: 'vastbase',
      capabilities: [Cap.EditorBuiltinSql],
    })
    expect(builtin.monacoLanguageId).toBe('sql')
    expect(builtin.monacoSqlLanguages).toBe(false)
  })

  it('mysql uses Bridge SQL LSP (no sql-languages worker)', () => {
    const mysql = resolveMonacoLanguageFromProfile(defaultMySQL8Profile())
    expect(mysql.monacoLanguageId).toBe('mysql')
    expect(mysql.monacoSqlLanguages).toBe(false)
    expect(mysql.useLsp).toBe(true)
  })

  it('kingbase uses Bridge SQL LSP with kingbase languageId', () => {
    const kb = resolveMonacoLanguageFromProfile(defaultKingbaseProfile())
    expect(kb.monacoLanguageId).toBe('kingbase')
    expect(kb.monacoSqlLanguages).toBe(false)
    expect(kb.useLsp).toBe(true)
    expect(hasCapability(defaultKingbaseProfile(), Cap.EditorSqlLsp)).toBe(true)
  })

  it('clickhouse uses Bridge SQL LSP with clickhouse languageId', () => {
    const ch = resolveMonacoLanguageFromProfile(defaultClickHouseProfile())
    expect(ch.monacoLanguageId).toBe('clickhouse')
    expect(ch.monacoSqlLanguages).toBe(false)
    expect(ch.useLsp).toBe(true)
    expect(hasCapability(defaultClickHouseProfile(), Cap.EditorSqlLsp)).toBe(true)
    expect(hasCapability(defaultClickHouseProfile(), Cap.ClickHouseExplainEstimate)).toBe(true)
    expect(hasCapability(defaultClickHouseProfile(), Cap.ClickHouseExplainAnalyze)).toBe(false)
    expect(hasCapability(defaultClickHouseProfile(), Cap.ClickHouseCreateOrReplaceView)).toBe(true)
    expect(
      hasCapability(defaultClickHouseProfile(), Cap.ClickHouseCreateOrReplaceMaterializedView),
    ).toBe(false)
  })

  it('sqlite silently uses builtin sql until LSP', () => {
    const p = defaultSqliteProfile()
    expect(p.family).toBe('sqlite')
    expect(hasCapability(p, Cap.SqliteDoubleQuoteIdent)).toBe(true)
    expect(hasCapability(p, Cap.FormatSqlite)).toBe(true)
    expect(resolveFormatterLanguage(p)).toBe('sqlite')
    const monaco = resolveMonacoLanguageFromProfile(p)
    expect(monaco.monacoLanguageId).toBe('sql')
    expect(monaco.monacoSqlLanguages).toBe(false)
    expect(monaco.useLsp).toBe(false)
  })

  it('sqlite ai rules cover identifiers AUTOINCREMENT and affinities', () => {
    const rules = buildAiDialectRules(defaultSqliteProfile())
    expect(rules).toContain('sqlite.double_quote_ident')
    expect(rules).toContain('AUTOINCREMENT')
    expect(rules).toContain('affinities')
    expect(rules).toContain('ATTACH')
  })
})
