import { describe, expect, it } from 'vitest'
import {
  extractUpdateTargetRelation,
  isUpdateSetColumnSlot,
  stripSqlIdentQuotes,
} from './update-set-heuristic'

describe('stripSqlIdentQuotes', () => {
  it('strips backticks and double quotes', () => {
    expect(stripSqlIdentQuotes('`bas_sku`')).toBe('bas_sku')
    expect(stripSqlIdentQuotes('"bas_sku"')).toBe('bas_sku')
    expect(stripSqlIdentQuotes('`a``b`')).toBe('a`b')
  })
})

describe('isUpdateSetColumnSlot', () => {
  it('detects SET column positions', () => {
    expect(isUpdateSetColumnSlot('UPDATE bas_sku SET ')).toBe(true)
    expect(isUpdateSetColumnSlot('UPDATE bas_sku SET ed')).toBe(true)
    expect(isUpdateSetColumnSlot('UPDATE bas_sku SET edittime = NOW(), ')).toBe(true)
    expect(isUpdateSetColumnSlot('UPDATE bas_sku SET edittime = NOW(), qty')).toBe(true)
  })

  it('rejects value / where positions', () => {
    expect(isUpdateSetColumnSlot('UPDATE bas_sku SET edittime = ')).toBe(false)
    expect(isUpdateSetColumnSlot('UPDATE bas_sku SET edittime = NOW()')).toBe(false)
    expect(isUpdateSetColumnSlot('UPDATE bas_sku SET edittime = 1 WHERE ')).toBe(false)
    expect(isUpdateSetColumnSlot('SELECT edittime FROM bas_sku')).toBe(false)
  })
})

describe('extractUpdateTargetRelation', () => {
  it('extracts plain and qualified table names', () => {
    expect(extractUpdateTargetRelation('UPDATE bas_sku SET ')).toBe('bas_sku')
    expect(extractUpdateTargetRelation('UPDATE wms_ftest.bas_sku SET ')).toBe('wms_ftest.bas_sku')
    expect(extractUpdateTargetRelation('UPDATE `bas_sku` SET ')).toBe('`bas_sku`')
    expect(extractUpdateTargetRelation('UPDATE IGNORE bas_sku SET x')).toBe('bas_sku')
    expect(extractUpdateTargetRelation('UPDATE ONLY public.bas_sku SET ')).toBe('public.bas_sku')
    expect(extractUpdateTargetRelation('UPDATE "bas_sku" AS t SET ')).toBe('"bas_sku"')
  })
})
