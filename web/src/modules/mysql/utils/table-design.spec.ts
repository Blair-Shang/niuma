import { describe, expect, it } from 'vitest'
import {
  buildDataType,
  defaultCreateTableColumns,
  formatMysqlDefaultExpr,
  parseDataType,
  syncColumnDataType,
  type DesignColumnDraft,
} from './table-design'
import {
  applyPrimaryIndexToColumns,
  buildAlterDesignOps,
  buildCreateColumns,
  buildCreateIndexes,
  syncPrimaryIndexFromColumns,
  toIndexDrafts,
} from './table-design-ops'

describe('mysql table-design types', () => {
  it('parses UNSIGNED and ENUM', () => {
    expect(parseDataType('INT UNSIGNED')).toMatchObject({
      base: 'INT',
      unsigned: true,
    })
    expect(parseDataType("ENUM('a','b')")).toMatchObject({
      base: 'ENUM',
      enumValues: "'a','b'",
      unsigned: false,
    })
  })

  it('builds UNSIGNED and ENUM literals', () => {
    expect(buildDataType('BIGINT', { unsigned: true })).toBe('BIGINT UNSIGNED')
    expect(buildDataType('ENUM', { enumValues: "'x','y'" })).toBe("ENUM('x','y')")
  })

  it('seeds default create columns with id PK', () => {
    const cols = defaultCreateTableColumns()
    expect(cols).toHaveLength(1)
    expect(cols[0]?.name).toBe('id')
    expect(cols[0]?.primaryKey).toBe(true)
    expect(cols[0]?.autoIncrement).toBe(true)
    const specs = buildCreateColumns(cols)
    expect(specs[0]?.primaryKey).toBe(true)
    expect(syncColumnDataType(cols[0]!)).toBe('BIGINT')
  })

  it('formats DEFAULT expressions for SQL', () => {
    expect(formatMysqlDefaultExpr('ss')).toBe("'ss'")
    expect(formatMysqlDefaultExpr("'ss'")).toBe("'ss'")
    expect(formatMysqlDefaultExpr('NULL')).toBe('NULL')
    expect(formatMysqlDefaultExpr('CURRENT_TIMESTAMP')).toBe('CURRENT_TIMESTAMP')
    expect(formatMysqlDefaultExpr('12')).toBe('12')
    expect(formatMysqlDefaultExpr("it's")).toBe("'it''s'")
  })

  it('quotes bare defaults in CHANGE COLUMN clause', () => {
    const orig: DesignColumnDraft = {
      __rowKey: 'c1',
      originalName: 'col_3',
      name: 'col_3',
      dataType: 'INT UNSIGNED',
      typeBase: 'INT',
      unsigned: true,
      enumValues: '',
      nullable: true,
      defaultExpr: '',
      primaryKey: false,
      autoIncrement: false,
      comment: '',
      removed: false,
    }
    const next: DesignColumnDraft = {
      ...orig,
      defaultExpr: 'ss',
      comment: 'dd',
    }
    const ops = buildAlterDesignOps([orig], [next], [], [], [], [])
    expect(ops).toHaveLength(1)
    expect(ops[0]?.dataType).toContain("DEFAULT 'ss'")
    expect(ops[0]?.dataType).toContain("COMMENT 'dd'")
  })

  it('strips AUTO_INCREMENT before DROP PRIMARY KEY and restores after ADD', () => {
    const id: DesignColumnDraft = {
      __rowKey: 'c-id',
      originalName: 'id',
      name: 'id',
      dataType: 'BIGINT',
      typeBase: 'BIGINT',
      unsigned: false,
      enumValues: '',
      nullable: false,
      defaultExpr: '',
      primaryKey: true,
      autoIncrement: true,
      comment: '',
      removed: false,
    }
    const nameCol: DesignColumnDraft = {
      __rowKey: 'c-name',
      originalName: 'name',
      name: 'name',
      dataType: 'VARCHAR(64)',
      typeBase: 'VARCHAR',
      typeLength: 64,
      unsigned: false,
      enumValues: '',
      nullable: false,
      defaultExpr: '',
      primaryKey: false,
      autoIncrement: false,
      comment: '',
      removed: false,
    }
    // 把主键从 id 挪到 name，并关掉 id 的 AI
    const nextId = { ...id, primaryKey: false, autoIncrement: false }
    const nextName = { ...nameCol, primaryKey: true }
    const ops = buildAlterDesignOps([id, nameCol], [nextId, nextName], [], [], [], [])

    expect(ops.map((o) => o.op)).toEqual([
      'rename_column', // strip AI on id
      'drop_primary_key',
      'add_primary_key',
    ])
    expect(ops[0]?.dataType).not.toContain('AUTO_INCREMENT')
    expect(ops[2]?.columns).toEqual(['name'])
  })

  it('moves AUTO_INCREMENT to the new primary key column', () => {
    const id: DesignColumnDraft = {
      __rowKey: 'c-id',
      originalName: 'id',
      name: 'id',
      dataType: 'BIGINT',
      typeBase: 'BIGINT',
      unsigned: false,
      enumValues: '',
      nullable: false,
      defaultExpr: '',
      primaryKey: true,
      autoIncrement: true,
      comment: '',
      removed: false,
    }
    const code: DesignColumnDraft = {
      __rowKey: 'c-code',
      originalName: 'code',
      name: 'code',
      dataType: 'BIGINT',
      typeBase: 'BIGINT',
      unsigned: false,
      enumValues: '',
      nullable: false,
      defaultExpr: '',
      primaryKey: false,
      autoIncrement: false,
      comment: '',
      removed: false,
    }
    const nextId = { ...id, primaryKey: false, autoIncrement: false }
    const nextCode = { ...code, primaryKey: true, autoIncrement: true }
    const ops = buildAlterDesignOps([id, code], [nextId, nextCode], [], [], [], [])

    expect(ops.map((o) => o.op)).toEqual([
      'rename_column', // strip AI on id
      'drop_primary_key',
      'add_primary_key',
      'rename_column', // add AI on code after PK
    ])
    expect(ops[0]?.name).toBe('id')
    expect(ops[0]?.dataType).not.toContain('AUTO_INCREMENT')
    expect(ops[2]?.columns).toEqual(['code'])
    expect(ops[3]?.name).toBe('code')
    expect(ops[3]?.dataType).toContain('AUTO_INCREMENT')
  })

  it('shows PRIMARY in index drafts and syncs with column PK flags', () => {
    const drafts = toIndexDrafts(
      [
        {
          name: 'PRIMARY',
          unique: true,
          primary: true,
          definition: 'PRIMARY KEY (id)',
          columns: ['id'],
          method: 'BTREE',
        },
        {
          name: 'idx_name',
          unique: false,
          primary: false,
          definition: 'INDEX (name)',
          columns: ['name'],
          method: 'BTREE',
        },
      ],
      ['id'],
    )
    expect(drafts[0]?.primary).toBe(true)
    expect(drafts[0]?.name).toBe('PRIMARY')
    expect(buildCreateIndexes(drafts)).toHaveLength(1)
    expect(buildCreateIndexes(drafts)[0]?.name).toBe('idx_name')

    const cols = defaultCreateTableColumns()
    const synced = syncPrimaryIndexFromColumns([], cols)
    expect(synced).toHaveLength(1)
    expect(synced[0]?.name).toBe('PRIMARY')
    expect(synced[0]?.columnsText).toBe('id')

    const withName: DesignColumnDraft = {
      ...cols[0]!,
      __rowKey: 'c-name',
      originalName: '',
      name: 'name',
      dataType: 'VARCHAR(64)',
      typeBase: 'VARCHAR',
      typeLength: 64,
      primaryKey: false,
      autoIncrement: false,
    }
    const nextCols = applyPrimaryIndexToColumns([...cols, withName], 'name')
    expect(nextCols.filter((c) => c.primaryKey).map((c) => c.name)).toEqual(['name'])
  })
})
