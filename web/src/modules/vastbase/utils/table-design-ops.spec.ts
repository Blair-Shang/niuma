import { describe, expect, it } from 'vitest'
import {
  buildAlterDesignOps,
  buildCreateChecks,
  buildCreateForeignKeys,
  buildCreateIndexes,
  toCheckDrafts,
  toDesignRows,
  toForeignKeyDrafts,
  toIndexDrafts,
} from './table-design-ops'
import { defaultCreateTableColumns, parseColumnList } from './table-design'

describe('table-design-ops phase5', () => {
  it('parses column lists', () => {
    expect(parseColumnList('a, b，c')).toEqual(['a', 'b', 'c'])
  })

  it('loads comments and pk into drafts', () => {
    const rows = toDesignRows(
      [
        {
          ordinal: 1,
          name: 'id',
          dataType: 'bigint',
          nullable: false,
          comment: '主键',
        },
        {
          ordinal: 2,
          name: 'title',
          dataType: 'character varying(64)',
          nullable: true,
        },
      ],
      ['id'],
    )
    expect(rows[0]?.primaryKey).toBe(true)
    expect(rows[0]?.comment).toBe('主键')
    expect(rows[0]?.typeBase).toBe('BIGINT')
    expect(rows[1]?.typeBase).toBe('VARCHAR')
    expect(rows[1]?.typeLength).toBe('64')
  })

  it('builds create indexes with where/expression/method and fk actions', () => {
    expect(
      buildCreateIndexes([
        {
          __rowKey: '1',
          originalName: '',
          name: 'idx_a',
          columnsText: '',
          expression: 'lower(name)',
          whereText: 'name IS NOT NULL',
          unique: false,
          method: 'btree',
          primary: false,
          removed: false,
          snapName: '',
          snapColumnsText: '',
          snapExpression: '',
          snapWhereText: '',
          snapUnique: false,
          snapMethod: 'btree',
        },
        {
          __rowKey: '2',
          originalName: '',
          name: 'idx_gin',
          columnsText: '',
          expression: 'data',
          whereText: '',
          unique: false,
          method: 'gin',
          primary: false,
          removed: false,
          snapName: '',
          snapColumnsText: '',
          snapExpression: '',
          snapWhereText: '',
          snapUnique: false,
          snapMethod: 'btree',
        },
      ]),
    ).toEqual([
      {
        name: 'idx_a',
        unique: false,
        expression: 'lower(name)',
        where: 'name IS NOT NULL',
      },
      {
        name: 'idx_gin',
        unique: false,
        expression: 'data',
        method: 'gin',
      },
    ])

    expect(
      buildCreateForeignKeys([
        {
          __rowKey: '1',
          originalName: '',
          name: 'fk_u',
          columnsText: 'user_id',
          refSchema: 'public',
          refTable: 'users',
          refColumnsText: 'id',
          onDelete: 'CASCADE',
          onUpdate: 'NO ACTION',
          removed: false,
          snapName: '',
          snapColumnsText: '',
          snapRefSchema: 'public',
          snapRefTable: '',
          snapRefColumnsText: '',
          snapOnDelete: 'NO ACTION',
          snapOnUpdate: 'NO ACTION',
        },
      ]),
    ).toEqual([
      {
        name: 'fk_u',
        columns: ['user_id'],
        refSchema: 'public',
        refTable: 'users',
        refColumns: ['id'],
        onDelete: 'CASCADE',
      },
    ])
  })

  it('builds create checks and loads check drafts', () => {
    expect(
      buildCreateChecks([
        {
          __rowKey: '1',
          originalName: '',
          name: 'chk_pos',
          expression: 'id > 0',
          removed: false,
          snapName: '',
          snapExpression: '',
        },
      ]),
    ).toEqual([{ name: 'chk_pos', expression: 'id > 0' }])

    const drafts = toCheckDrafts([
      {
        name: 'orders_check',
        type: 'c',
        typeLabel: 'CHECK',
        definition: 'CHECK ((amount > (0)::numeric))',
        expression: 'amount > (0)::numeric',
      },
    ])
    expect(drafts[0]?.expression).toBe('amount > (0)::numeric')
  })

  it('in-place edits existing index via rename or recreate', () => {
    const indexes = toIndexDrafts([
      {
        name: 'idx_old',
        unique: false,
        primary: false,
        definition: '',
        columns: ['a'],
        method: 'btree',
      },
    ])
    indexes[0]!.name = 'idx_new'
    const base = {
      tableName: 't',
      rows: [] as ReturnType<typeof defaultCreateTableColumns>,
      snapshot: [],
      pkSnapshot: [] as string[],
      foreignKeys: [],
      checks: [],
      constraints: [],
      tableComment: '',
      tableCommentSnapshot: '',
    }
    const renameOps = buildAlterDesignOps({ ...base, indexes })
    expect(renameOps).toEqual([
      { op: 'rename_index', name: 'idx_old', newName: 'idx_new' },
    ])

    indexes[0]!.columnsText = 'a, b'
    const recreateOps = buildAlterDesignOps({ ...base, indexes })
    expect(recreateOps.some((o) => o.op === 'drop_index' && o.name === 'idx_old')).toBe(true)
    expect(recreateOps.some((o) => o.op === 'add_index' && o.name === 'idx_new')).toBe(true)
  })

  it('recreates index when method changes and emits check ops', () => {
    const indexes = toIndexDrafts([
      {
        name: 'idx_data',
        unique: false,
        primary: false,
        definition: '',
        columns: ['data'],
        method: 'btree',
      },
    ])
    indexes[0]!.method = 'gin'
    const checks = toCheckDrafts([
      {
        name: 'chk_old',
        type: 'c',
        typeLabel: 'CHECK',
        definition: 'CHECK (id > 0)',
        expression: 'id > 0',
      },
    ])
    checks[0]!.expression = 'id >= 0'
    const ops = buildAlterDesignOps({
      tableName: 'orders',
      rows: [],
      snapshot: [],
      pkSnapshot: [],
      indexes,
      foreignKeys: [],
      checks,
      constraints: [
        {
          name: 'chk_old',
          type: 'c',
          typeLabel: 'CHECK',
          definition: 'CHECK (id > 0)',
          expression: 'id > 0',
        },
      ],
      tableComment: '',
      tableCommentSnapshot: '',
    })
    expect(ops.some((o) => o.op === 'drop_index' && o.name === 'idx_data')).toBe(true)
    expect(ops.some((o) => o.op === 'add_index' && o.method === 'gin')).toBe(true)
    expect(ops.some((o) => o.op === 'drop_constraint' && o.name === 'chk_old')).toBe(true)
    expect(ops.some((o) => o.op === 'add_check' && o.expression === 'id >= 0')).toBe(true)
  })

  it('recreates FK when onDelete changes', () => {
    const fks = toForeignKeyDrafts([
      {
        name: 'fk_u',
        columns: ['user_id'],
        refSchema: 'public',
        refTable: 'users',
        refColumns: ['id'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    ])
    fks[0]!.onDelete = 'CASCADE'
    const ops = buildAlterDesignOps({
      tableName: 'orders',
      rows: [],
      snapshot: [],
      pkSnapshot: [],
      indexes: [],
      foreignKeys: fks,
      checks: [],
      constraints: [],
      tableComment: '',
      tableCommentSnapshot: '',
    })
    expect(ops[0]).toEqual({ op: 'drop_constraint', name: 'fk_u' })
    expect(ops[1]?.op).toBe('add_foreign_key')
    expect(ops[1]?.onDelete).toBe('CASCADE')
  })
})
