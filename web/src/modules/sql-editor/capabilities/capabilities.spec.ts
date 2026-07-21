import { describe, expect, it } from 'vitest'
import {
  Cap,
  buildAiDialectRules,
  defaultMySQL8Profile,
  defaultPostgreSQLProfile,
  defaultVastbaseProfile,
  hasCapability,
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

  it('mysql default profile enables delimiter blocks', () => {
    const f = resolveSplitFeaturesFromProfile(defaultMySQL8Profile())
    expect(f.delimiterBlocks).toBe(true)
    expect(f.backticks).toBe(true)
  })

  it('ai rules mention procedure style from caps', () => {
    const rules = buildAiDialectRules(defaultVastbaseProfile())
    expect(rules).toContain('proc.plsql_bare')
    expect(rules).toContain('CREATE PROCEDURE')
  })

  it('monaco leaves pgsql worker when suppress cap is on', () => {
    const vast = resolveMonacoLanguageFromProfile(defaultVastbaseProfile())
    expect(vast.monacoLanguageId).toBe('sql')
    expect(vast.monacoSqlLanguages).toBe(false)
    const pg = resolveMonacoLanguageFromProfile(defaultPostgreSQLProfile())
    expect(pg.monacoLanguageId).toBe('pgsql')
    expect(pg.monacoSqlLanguages).toBe(true)
  })
})
