/**
 * SQLite 表设计器 ops 生成（列 / 索引 / 外键）。
 * ALTER ops 对齐后端扁平 DesignOp（services/sqlite-service/internal/ddl）。
 */
import type {
  SqliteColumnInfo,
  SqliteDesignColumnSpec,
  SqliteDesignForeignKeySpec,
  SqliteDesignIndexSpec,
  SqliteDesignOp,
  SqliteForeignKeyInfo,
  SqliteIndexInfo,
} from '@/api/types/sqlite'
import {
  formatSqliteDefaultExpr,
  joinColumnList,
  newEmptyColumn,
  newEmptyForeignKey,
  newEmptyIndex,
  nextDraftKey,
  parseColumnList,
  splitDataTypeFields,
  suggestIndexName,
  type DesignColumnDraft,
  type DesignForeignKeyDraft,
  type DesignIndexDraft,
} from './table-design'

/** 单列 INTEGER PRIMARY KEY 在 SQLite 中等价于可自增的 rowid 别名。 */
function inferAutoIncrement(col: SqliteColumnInfo, pkCols: string[]): boolean {
  if (!col.primaryKey && !pkCols.includes(col.name)) return false
  if (pkCols.length !== 1) return false
  const base = (col.dataType ?? '').trim().toUpperCase().replace(/\(.*\)$/, '')
  return base === 'INTEGER' || base === 'INT'
}

export function toDesignRows(cols: SqliteColumnInfo[], pkCols: string[]): DesignColumnDraft[] {
  const pk = new Set(pkCols.length ? pkCols : cols.filter((c) => c.primaryKey).map((c) => c.name))
  return cols.map((c, i) => {
    const parts = splitDataTypeFields(c.dataType || 'TEXT')
    const primaryKey = pk.has(c.name) || Boolean(c.primaryKey)
    return {
      __rowKey: `col-${i}-${c.name}`,
      originalName: c.name,
      name: c.name,
      dataType: parts.dataType,
      typeBase: parts.typeBase,
      typeLength: parts.typeLength,
      nullable: c.nullable !== false,
      defaultExpr: c.default ?? '',
      primaryKey,
      autoIncrement: inferAutoIncrement(c, [...pk]),
      checkExpr: c.check ?? '',
      generatedExpr: c.generatedExpr ?? '',
      generatedType:
        c.generatedType === 'VIRTUAL' || c.generatedType === 'STORED' ? c.generatedType : '',
      removed: false,
    }
  })
}

export function toIndexDrafts(indexes: SqliteIndexInfo[], pkCols: string[]): DesignIndexDraft[] {
  const drafts = indexes
    .filter((idx) => !String(idx.origin ?? '').toLowerCase().includes('pk'))
    .map((idx) => {
      const columnsText = (idx.columns ?? [])
        .slice()
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((c) => c.name)
        .join(', ')
      return {
        __rowKey: `idx-${idx.name}`,
        originalName: idx.name,
        name: idx.name,
        columnsText,
        unique: idx.unique,
        primary: false,
        removed: false,
        snapName: idx.name,
        snapColumnsText: columnsText,
        snapUnique: idx.unique,
      }
    })

  if (pkCols.length > 0) {
    drafts.unshift(makePrimaryIndexDraft(pkCols, true))
  }

  drafts.sort((a, b) => Number(b.primary) - Number(a.primary))
  return drafts
}

export function makePrimaryIndexDraft(pkCols: string[], existing: boolean): DesignIndexDraft {
  const columnsText = joinColumnList(pkCols)
  return {
    __rowKey: existing ? 'idx-PRIMARY' : nextDraftKey('idx-pk'),
    originalName: existing ? 'PRIMARY' : '',
    name: 'PRIMARY',
    columnsText,
    unique: true,
    primary: true,
    removed: false,
    snapName: existing ? 'PRIMARY' : '',
    snapColumnsText: existing ? columnsText : '',
    snapUnique: true,
  }
}

export function syncPrimaryIndexFromColumns(
  indexes: DesignIndexDraft[],
  columns: DesignColumnDraft[],
): DesignIndexDraft[] {
  const pkCols = columns.filter((c) => !c.removed && c.primaryKey && c.name).map((c) => c.name)
  const others = indexes.filter((i) => !i.primary)
  if (pkCols.length === 0) return others
  const existing = indexes.find((i) => i.primary && !i.removed)
  const primary = existing
    ? {
        ...existing,
        name: 'PRIMARY',
        columnsText: joinColumnList(pkCols),
        unique: true,
        primary: true,
        removed: false,
      }
    : makePrimaryIndexDraft(pkCols, false)
  return [primary, ...others]
}

export function applyPrimaryIndexToColumns(
  columns: DesignColumnDraft[],
  columnsText: string,
): DesignColumnDraft[] {
  const pkSet = new Set(parseColumnList(columnsText))
  return columns.map((c) => {
    if (c.removed) return c
    const primaryKey = pkSet.has(c.name)
    if (c.primaryKey === primaryKey && !(primaryKey && c.nullable)) return c
    return {
      ...c,
      primaryKey,
      nullable: primaryKey ? false : c.nullable,
    }
  })
}

/** 将 PRAGMA foreign_key_list 的逐列行合并为外键草稿。 */
export function toForeignKeyDrafts(fks: SqliteForeignKeyInfo[]): DesignForeignKeyDraft[] {
  const groups = new Map<number, SqliteForeignKeyInfo[]>()
  for (const fk of fks) {
    const list = groups.get(fk.id) ?? []
    list.push(fk)
    groups.set(fk.id, list)
  }
  return [...groups.entries()].map(([id, rows]) => {
    const sorted = rows.slice().sort((a, b) => a.sequence - b.sequence)
    const first = sorted[0]!
    const name = `fk_${id}`
    return {
      __rowKey: `fk-${id}`,
      originalName: name,
      name,
      columnsText: sorted.map((r) => r.fromColumn).join(', '),
      refTable: first.referencedTable,
      refColumnsText: sorted.map((r) => r.toColumn).join(', '),
      onDelete: first.onDelete || 'NO ACTION',
      onUpdate: first.onUpdate || 'NO ACTION',
      removed: false,
    }
  })
}

export function addDraftColumn(cols: DesignColumnDraft[]): DesignColumnDraft[] {
  return [...cols, newEmptyColumn()]
}

export function addDraftIndex(indexes: DesignIndexDraft[]): DesignIndexDraft[] {
  return [...indexes, newEmptyIndex()]
}

export function addDraftForeignKey(fks: DesignForeignKeyDraft[]): DesignForeignKeyDraft[] {
  return [...fks, newEmptyForeignKey()]
}

function columnSpecFromDraft(col: DesignColumnDraft): SqliteDesignColumnSpec {
  const isGenerated = Boolean(col.generatedType && col.generatedExpr.trim())
  const def = isGenerated ? '' : formatSqliteDefaultExpr(col.defaultExpr)
  return {
    name: col.name,
    dataType: col.dataType,
    nullable: col.nullable,
    default: def || null,
    autoIncrement: isGenerated ? undefined : col.autoIncrement || undefined,
    primaryKey: col.primaryKey || undefined,
    check: col.checkExpr.trim() || undefined,
    generatedExpr: isGenerated ? col.generatedExpr.trim() : undefined,
    generatedType: isGenerated ? col.generatedType : undefined,
  }
}

function indexSpecFromDraft(idx: DesignIndexDraft): SqliteDesignIndexSpec {
  const columns = parseColumnList(idx.columnsText)
  const name = idx.name.trim() || suggestIndexName(idx.columnsText, `idx_${columns[0] ?? 'col'}`)
  return {
    name,
    columns,
    unique: idx.unique,
    primary: false,
  }
}

function fkSpecFromDraft(fk: DesignForeignKeyDraft): SqliteDesignForeignKeySpec {
  return {
    name: fk.name || undefined,
    columns: parseColumnList(fk.columnsText),
    refTable: fk.refTable,
    refColumns: parseColumnList(fk.refColumnsText),
    onDelete: fk.onDelete || undefined,
    onUpdate: fk.onUpdate || undefined,
  }
}

function flatAddIndex(idx: DesignIndexDraft): SqliteDesignOp {
  const spec = indexSpecFromDraft(idx)
  return {
    op: 'add_index',
    name: spec.name,
    columns: spec.columns,
    unique: spec.unique,
  }
}

function flatAddForeignKey(fk: DesignForeignKeyDraft): SqliteDesignOp {
  const spec = fkSpecFromDraft(fk)
  return {
    op: 'add_foreign_key',
    name: spec.name,
    columns: spec.columns,
    refTable: spec.refTable,
    refColumns: spec.refColumns,
    onDelete: spec.onDelete,
    onUpdate: spec.onUpdate,
  }
}

/**
 * 从草稿列表生成 ALTER / rebuild 的扁平 ops（对齐后端 DesignOp）。
 * 列变更拆成 rename_column / alter_type / set_null|set_not_null / set_default|drop_default。
 */
export function buildAlterDesignOps(
  origCols: DesignColumnDraft[],
  newCols: DesignColumnDraft[],
  origIndexes: DesignIndexDraft[],
  newIndexes: DesignIndexDraft[],
  origFks: DesignForeignKeyDraft[],
  newFks: DesignForeignKeyDraft[],
): SqliteDesignOp[] {
  const ops: SqliteDesignOp[] = []
  const origColMap = new Map(origCols.map((c) => [c.originalName, c]))

  const origPkCols = origCols.filter((c) => c.primaryKey && !c.removed).map((c) => c.name)
  const newPkCols = newCols.filter((c) => c.primaryKey && !c.removed).map((c) => c.name)
  const pkChanged =
    origPkCols.length !== newPkCols.length || origPkCols.some((c, i) => c !== newPkCols[i])

  const origAi = origCols.some((c) => c.autoIncrement && c.primaryKey && !c.removed)
  const newAiCol = newCols.find((c) => !c.removed && c.autoIncrement && c.primaryKey)
  const aiChanged = Boolean(newAiCol) !== origAi || (newAiCol != null && !newPkCols.includes(newAiCol.name))

  for (const col of newCols) {
    if (col.removed) {
      if (col.originalName) ops.push({ op: 'drop_column', name: col.originalName })
      continue
    }
    if (!col.originalName) {
      const spec = columnSpecFromDraft(col)
      ops.push({
        op: 'add_column',
        name: spec.name,
        dataType: spec.dataType,
        nullable: spec.nullable,
        default: spec.default,
        autoIncrement: spec.autoIncrement,
        check: spec.check,
        generatedExpr: spec.generatedExpr,
        generatedType: spec.generatedType,
      })
      continue
    }

    const orig = origColMap.get(col.originalName)
    if (!orig) continue

    if (col.name !== orig.name) {
      ops.push({ op: 'rename_column', name: col.originalName, newName: col.name })
    }
    const colName = col.name
    if (col.dataType !== orig.dataType) {
      ops.push({ op: 'alter_type', name: colName, dataType: col.dataType })
    }
    if (col.nullable !== orig.nullable) {
      ops.push({ op: col.nullable ? 'set_null' : 'set_not_null', name: colName })
    }
    if (col.defaultExpr !== orig.defaultExpr && !col.generatedType) {
      const def = formatSqliteDefaultExpr(col.defaultExpr)
      if (def) {
        ops.push({ op: 'set_default', name: colName, default: def })
      } else {
        ops.push({ op: 'drop_default', name: colName })
      }
    }
    if (col.checkExpr !== orig.checkExpr) {
      ops.push({ op: 'set_check', name: colName, check: col.checkExpr.trim() })
    }
    if (
      col.generatedExpr !== orig.generatedExpr ||
      col.generatedType !== orig.generatedType
    ) {
      ops.push({
        op: 'set_generated',
        name: colName,
        generatedExpr: col.generatedExpr.trim(),
        generatedType: col.generatedType || '',
      })
    }
  }

  if (pkChanged || aiChanged) {
    if (origPkCols.length > 0) ops.push({ op: 'drop_primary_key' })
    if (newPkCols.length > 0) {
      const pkOp: SqliteDesignOp = { op: 'add_primary_key', columns: newPkCols }
      if (newAiCol && newPkCols.length === 1 && newPkCols[0] === newAiCol.name) {
        pkOp.autoIncrement = true
      }
      ops.push(pkOp)
    }
  }

  const origIdxMap = new Map(origIndexes.map((i) => [i.originalName, i]))
  for (const idx of newIndexes) {
    if (idx.primary) continue
    if (idx.removed) {
      if (idx.originalName) ops.push({ op: 'drop_index', name: idx.originalName })
      continue
    }
    if (!idx.originalName) {
      ops.push(flatAddIndex(idx))
      continue
    }
    const orig = origIdxMap.get(idx.originalName)
    if (!orig || orig.primary) continue
    const changed =
      idx.name !== orig.snapName ||
      idx.columnsText !== orig.snapColumnsText ||
      idx.unique !== orig.snapUnique
    if (changed) {
      if (idx.name !== orig.snapName && idx.columnsText === orig.snapColumnsText && idx.unique === orig.snapUnique) {
        ops.push({ op: 'rename_index', name: idx.originalName, newName: idx.name })
      } else {
        ops.push({ op: 'drop_index', name: idx.originalName })
        ops.push(flatAddIndex(idx))
      }
    }
  }

  const origFkMap = new Map(origFks.map((f) => [f.originalName, f]))
  for (const fk of newFks) {
    if (fk.removed) {
      if (fk.originalName) ops.push({ op: 'drop_constraint', name: fk.originalName })
      continue
    }
    if (!fk.originalName) {
      ops.push(flatAddForeignKey(fk))
      continue
    }
    const orig = origFkMap.get(fk.originalName)
    if (!orig) continue
    const changed =
      fk.name !== orig.name ||
      fk.columnsText !== orig.columnsText ||
      fk.refTable !== orig.refTable ||
      fk.refColumnsText !== orig.refColumnsText ||
      fk.onDelete !== orig.onDelete ||
      fk.onUpdate !== orig.onUpdate
    if (changed) {
      ops.push({ op: 'drop_constraint', name: fk.originalName })
      ops.push(flatAddForeignKey(fk))
    }
  }

  return ops
}

export function buildCreateColumns(cols: DesignColumnDraft[]): SqliteDesignColumnSpec[] {
  return cols.filter((c) => !c.removed && c.name).map(columnSpecFromDraft)
}

export function buildCreateIndexes(indexes: DesignIndexDraft[]): SqliteDesignIndexSpec[] {
  return indexes.filter((i) => !i.removed && !i.primary && i.columnsText).map(indexSpecFromDraft)
}

export function buildCreateForeignKeys(fks: DesignForeignKeyDraft[]): SqliteDesignForeignKeySpec[] {
  return fks.filter((f) => !f.removed && f.columnsText && f.refTable).map(fkSpecFromDraft)
}
