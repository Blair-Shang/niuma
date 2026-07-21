import { describe, expect, it } from 'vitest'
import { parsePrimaryFromRelation } from './parse-query-from'

describe('parsePrimaryFromRelation', () => {
  it('parses schema.table', () => {
    expect(parsePrimaryFromRelation('SELECT 1 FROM public.bas_sku')).toEqual({
      schema: 'public',
      table: 'bas_sku',
    })
  })

  it('strips database prefix when matches connection database', () => {
    expect(parsePrimaryFromRelation('SELECT 1 FROM wd_ftest.public.bas_sku', 'wd_ftest')).toEqual({
      schema: 'public',
      table: 'bas_sku',
    })
  })

  it('parses quoted identifiers', () => {
    expect(parsePrimaryFromRelation('SELECT * FROM "public"."bas_sku"')).toEqual({
      schema: 'public',
      table: 'bas_sku',
    })
  })

  it('defaults bare table to defaultSchema', () => {
    expect(parsePrimaryFromRelation('SELECT * FROM bas_sku', undefined, 'public')).toEqual({
      schema: 'public',
      table: 'bas_sku',
    })
  })

  it('strips table alias', () => {
    expect(parsePrimaryFromRelation('SELECT * FROM public.bas_sku t')).toEqual({
      schema: 'public',
      table: 'bas_sku',
    })
  })
})
