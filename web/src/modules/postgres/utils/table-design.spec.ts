import { describe, expect, it } from 'vitest'
import type { PostgresColumnInfo } from '@/api/types/postgres'
import {
  dataTypesEquivalent,
  parseDataType,
  splitDataTypeFields,
} from '@/modules/postgres/utils/table-design'
import { buildAlterDesignOps, toDesignRows } from '@/modules/postgres/utils/table-design-ops'

describe('postgres table-design types', () => {
  it('treats format_type aliases as equivalent', () => {
    expect(dataTypesEquivalent('character varying(50)', 'VARCHAR(50)')).toBe(true)
    expect(dataTypesEquivalent('character varying(255)', 'VARCHAR(255)')).toBe(true)
    expect(dataTypesEquivalent('character(1)', 'CHAR(1)')).toBe(true)
    expect(dataTypesEquivalent('timestamp without time zone', 'TIMESTAMP')).toBe(true)
    expect(dataTypesEquivalent('timestamp(6) without time zone', 'TIMESTAMP(6)')).toBe(true)
    expect(dataTypesEquivalent('character varying(50)', 'VARCHAR(100)')).toBe(false)
  })

  it('parses catalog type names into designer fields', () => {
    expect(parseDataType('character varying(50)')).toMatchObject({ base: 'VARCHAR', length: 50 })
    expect(splitDataTypeFields('character varying(50)').dataType).toBe('VARCHAR(50)')
    expect(parseDataType('timestamp without time zone')).toMatchObject({ base: 'TIMESTAMP' })
  })
})

describe('postgres table-design-ops alter type', () => {
  const emptyRest = {
    tableName: 'test',
    pkSnapshot: [] as string[],
    indexes: [],
    foreignKeys: [],
    checks: [],
    constraints: [],
    tableComment: '',
    tableCommentSnapshot: '',
  }

  it('does not emit alter_type when only format_type aliases differ', () => {
    const snapshot: PostgresColumnInfo[] = [
      { ordinal: 1, name: 'a11', dataType: 'character varying(50)', nullable: true },
      { ordinal: 2, name: 'col_6', dataType: 'character varying(255)', nullable: true },
    ]
    const rows = toDesignRows(snapshot, [])
    const ops = buildAlterDesignOps({ ...emptyRest, rows, snapshot })
    expect(ops).toEqual([])
  })

  it('emits alter_type when varchar length actually changes', () => {
    const snapshot: PostgresColumnInfo[] = [
      { ordinal: 1, name: 'a11', dataType: 'character varying(50)', nullable: true },
    ]
    const rows = toDesignRows(snapshot, [])
    rows[0]!.typeLength = '100'
    const ops = buildAlterDesignOps({ ...emptyRest, rows, snapshot })
    expect(ops).toEqual([{ op: 'alter_type', name: 'a11', dataType: 'VARCHAR(100)' }])
  })
})
