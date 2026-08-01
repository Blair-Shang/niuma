import { describe, expect, it } from 'vitest'
import {
  columnsFromImportSeed,
  setClickHouseDesignSeed,
  suggestTableNameFromPath,
  takeClickHouseDesignSeed,
} from './design-seed'

describe('design-seed', () => {
  it('suggests table name from path', () => {
    expect(suggestTableNameFromPath('C:/data/orders_2024.csv')).toBe('orders_2024')
    expect(suggestTableNameFromPath('/tmp/a.b.parquet')).toBe('a_b')
  })

  it('takes seed once for matching database', () => {
    setClickHouseDesignSeed({ database: 'db1', tableName: 't1', columns: ['id', 'name'] })
    expect(takeClickHouseDesignSeed('db2')).toBeNull()
    const seed = takeClickHouseDesignSeed('db1')
    expect(seed?.tableName).toBe('t1')
    expect(takeClickHouseDesignSeed('db1')).toBeNull()
  })

  it('builds string columns from names', () => {
    const cols = columnsFromImportSeed(['id', ' name '])
    expect(cols.map((c) => c.name)).toEqual(['id', 'name'])
    expect(cols.every((c) => c.typeBase === 'String')).toBe(true)
  })
})
