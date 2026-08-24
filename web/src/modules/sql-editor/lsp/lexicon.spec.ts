import { describe, expect, it } from 'vitest'
import { buildSqlMonarch, normalizeLexicon, wordRules } from './lexicon'
import { FALLBACK_MYSQL_LEXICON, FALLBACK_POSTGRES_LEXICON } from './fallback-lexicon'

describe('sql lexicon monarch', () => {
  it('normalizeLexicon dedupes case-insensitively', () => {
    const lex = normalizeLexicon({
      keywords: ['Select', 'SELECT', ' from '],
      functions: ['NOW', 'now'],
    })
    expect(lex?.keywords).toEqual(['Select', 'from'])
    expect(lex?.functions).toEqual(['NOW'])
  })

  it('wordRules chunks long lists', () => {
    const words = Array.from({ length: 100 }, (_, i) => `KW${i}`)
    const rules = wordRules(words, 'keyword')
    expect(rules.length).toBe(2)
    expect(rules[0][1]).toBe('keyword')
  })

  it('buildSqlMonarch includes keyword and function tokens', () => {
    const monarch = buildSqlMonarch('mysql', FALLBACK_MYSQL_LEXICON)
    expect(monarch.ignoreCase).toBe(true)
    expect(monarch.tokenPostfix).toBe('.sql')
    const root = monarch.tokenizer.root as unknown[]
    expect(root.length).toBeGreaterThan(5)
    const tokens = root.map((r) => (Array.isArray(r) ? r[1] : null))
    expect(tokens).toContain('keyword')
    expect(tokens).toContain('predefined')
  })

  it('postgresql monarch includes dollar-quote tokens', () => {
    const monarch = buildSqlMonarch('postgresql', FALLBACK_POSTGRES_LEXICON)
    const root = monarch.tokenizer.root as Array<[RegExp, string] | unknown>
    const quoteRules = root.filter(
      (r) => Array.isArray(r) && r[1] === 'string.quote',
    )
    expect(quoteRules.length).toBeGreaterThanOrEqual(2)
  })
})
