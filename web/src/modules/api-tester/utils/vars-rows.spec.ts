import { describe, expect, it } from 'vitest'
import { recordToRows, rowsToRecord, rowsToTypedRecord, typedRecordToRows } from './vars-rows'

describe('vars-rows', () => {
  it('uses stable row ids from keys', () => {
    const rows = recordToRows({ token: 'a', baseUrl: 'http://x' }, 'env')
    expect(rows.map((row) => row.id)).toEqual(['env:token', 'env:baseUrl'])
    expect(rowsToRecord(rows)).toEqual({ token: 'a', baseUrl: 'http://x' })
  })

  it('round-trips variable kinds', () => {
    const rows = typedRecordToRows({ token: 'a', n: '1' }, { token: 'secret', n: 'number' }, 'env')
    expect(rows.map((row) => row.kind)).toEqual(['secret', 'number'])
    expect(rowsToTypedRecord(rows)).toEqual({
      vars: { token: 'a', n: '1' },
      kinds: { token: 'secret', n: 'number' },
    })
  })
})
