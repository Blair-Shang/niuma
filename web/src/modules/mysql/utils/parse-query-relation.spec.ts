import { describe, expect, it } from 'vitest'
import { parsePrimaryMysqlRelation } from './parse-query-relation'

describe('parsePrimaryMysqlRelation', () => {
  it('parses SELECT FROM', () => {
    expect(parsePrimaryMysqlRelation('SELECT * FROM bas_sku', 'wms_ftest')).toEqual({
      database: 'wms_ftest',
      table: 'bas_sku',
    })
    expect(parsePrimaryMysqlRelation('SELECT * FROM wms_ftest.bas_sku')).toEqual({
      database: 'wms_ftest',
      table: 'bas_sku',
    })
    expect(parsePrimaryMysqlRelation('SELECT * FROM `wms_ftest`.`bas_sku` t')).toEqual({
      database: 'wms_ftest',
      table: 'bas_sku',
    })
  })

  it('parses UPDATE / INSERT', () => {
    expect(parsePrimaryMysqlRelation('UPDATE bas_sku SET a=1', 'wms_ftest')).toEqual({
      database: 'wms_ftest',
      table: 'bas_sku',
    })
    expect(parsePrimaryMysqlRelation('INSERT INTO wms_ftest.bas_sku (a) VALUES (1)')).toEqual({
      database: 'wms_ftest',
      table: 'bas_sku',
    })
  })
})
