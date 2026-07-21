/**
 * MySQL 表设计器 ops 生成（列 / 索引 / 外键）。
 */
import type {
  MysqlColumnInfo,
  MysqlDesignColumnSpec,
  MysqlDesignForeignKeySpec,
  MysqlDesignIndexSpec,
  MysqlDesignOp,
  MysqlForeignKeyInfo,
  MysqlIndexInfo,
} from '@/api/types/mysql'
import {
  newEmptyColumn,
  newEmptyForeignKey,
  newEmptyIndex,
  parseColumnList,
  splitDataTypeFields,
  type DesignColumnDraft,
  type DesignForeignKeyDraft,
  type DesignIndexDraft,
} from './table-design'

export function toDesignRows(cols: MysqlColumnInfo[], pkCols: string[]): DesignColumnDraft[] {
  const pk = new Set(pkCols)
  return cols.map((c, i) => {
    const parts = splitDataTypeFields(c.dataType)
    return {
      __rowKey: `col-${i}-${c.name}`,
      originalName: c.name,
      name: c.name,
      dataType: parts.dataType,
      typeBase: parts.typeBase,
      typeLength: parts.typeLength,
      typeScale: parts.typeScale,
      nullable: c.nullable,
      defaultExpr: c.default ?? '',
      primaryKey: pk.has(c.name),
      autoIncrement: false,
      comment: c.comment ?? '',
      removed: false,
    }
  })
}

export function toIndexDrafts(indexes: MysqlIndexInfo[], pkCols: string[]): DesignIndexDraft[] {
  return indexes
    .filter((idx) => !idx.primary)
    .map((idx) => {
      const columnsText = (idx.columns ?? []).join(', ')
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
}

export function toForeignKeyDrafts(fks: MysqlForeignKeyInfo[]): DesignForeignKeyDraft[] {
  return fks.map((fk) => ({
    __rowKey: `fk-${fk.name}`,
    originalName: fk.name,
    name: fk.name,
    columnsText: fk.columns.join(', '),
    refTable: fk.refTable,
    refColumnsText: fk.refColumns.join(', '),
    onDelete: fk.onDelete ?? 'NO ACTION',
    onUpdate: fk.onUpdate ?? 'NO ACTION',
    removed: false,
  }))
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

function columnSpecFromDraft(col: DesignColumnDraft): MysqlDesignColumnSpec {
  return {
    name: col.name,
    dataType: col.dataType,
    nullable: col.nullable,
    default: col.defaultExpr || null,
    comment: col.comment || undefined,
    autoIncrement: col.autoIncrement || undefined,
  }
}

function indexSpecFromDraft(idx: DesignIndexDraft): MysqlDesignIndexSpec {
  return {
    name: idx.name || undefined,
    columns: parseColumnList(idx.columnsText),
    unique: idx.unique,
    primary: false,
  }
}

function fkSpecFromDraft(fk: DesignForeignKeyDraft): MysqlDesignForeignKeySpec {
  return {
    name: fk.name || undefined,
    columns: parseColumnList(fk.columnsText),
    refTable: fk.refTable,
    refColumns: parseColumnList(fk.refColumnsText),
    onDelete: fk.onDelete || undefined,
    onUpdate: fk.onUpdate || undefined,
  }
}

/**
 * 从草稿列表生成 ALTER TABLE 的 ops。
 * 用于 designPreview / designApply。
 */
export function buildAlterDesignOps(
  origCols: DesignColumnDraft[],
  newCols: DesignColumnDraft[],
  origIndexes: DesignIndexDraft[],
  newIndexes: DesignIndexDraft[],
  origFks: DesignForeignKeyDraft[],
  newFks: DesignForeignKeyDraft[],
): MysqlDesignOp[] {
  const ops: MysqlDesignOp[] = []

  // 列变更
  const origColMap = new Map(origCols.map((c) => [c.originalName, c]))
  for (const col of newCols) {
    if (col.removed) {
      if (col.originalName) ops.push({ op: 'drop_column', name: col.originalName })
      continue
    }
    if (!col.originalName) {
      // 新增
      ops.push({ op: 'add_column', column: columnSpecFromDraft(col) })
    } else {
      const orig = origColMap.get(col.originalName)
      if (!orig) continue
      const changed =
        col.name !== orig.name ||
        col.dataType !== orig.dataType ||
        col.nullable !== orig.nullable ||
        col.defaultExpr !== orig.defaultExpr ||
        col.comment !== orig.comment ||
        col.autoIncrement !== orig.autoIncrement
      if (changed) {
        ops.push({ op: 'alter_column', oldName: col.originalName, column: columnSpecFromDraft(col) })
      }
    }
  }

  // 主键变更（基于列的 primaryKey 标志推断）
  const origPkCols = origCols.filter((c) => c.primaryKey && !c.removed).map((c) => c.name)
  const newPkCols = newCols.filter((c) => c.primaryKey && !c.removed).map((c) => c.name)
  const pkChanged =
    origPkCols.length !== newPkCols.length ||
    origPkCols.some((c, i) => c !== newPkCols[i])
  if (pkChanged) {
    ops.push({ op: 'set_primary_key', columns: newPkCols })
  }

  // 索引变更
  const origIdxMap = new Map(origIndexes.map((i) => [i.originalName, i]))
  for (const idx of newIndexes) {
    if (idx.removed) {
      if (idx.originalName) ops.push({ op: 'drop_index', name: idx.originalName })
      continue
    }
    if (!idx.originalName) {
      ops.push({ op: 'add_index', index: indexSpecFromDraft(idx) })
    } else {
      const orig = origIdxMap.get(idx.originalName)
      if (!orig) continue
      const changed =
        idx.name !== orig.snapName ||
        idx.columnsText !== orig.snapColumnsText ||
        idx.unique !== orig.snapUnique
      if (changed) {
        ops.push({ op: 'drop_index', name: idx.originalName })
        ops.push({ op: 'add_index', index: indexSpecFromDraft(idx) })
      }
    }
  }

  // 外键变更
  const origFkMap = new Map(origFks.map((f) => [f.originalName, f]))
  for (const fk of newFks) {
    if (fk.removed) {
      if (fk.originalName) ops.push({ op: 'drop_foreign_key', name: fk.originalName })
      continue
    }
    if (!fk.originalName) {
      ops.push({ op: 'add_foreign_key', fk: fkSpecFromDraft(fk) })
    } else {
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
        ops.push({ op: 'drop_foreign_key', name: fk.originalName })
        ops.push({ op: 'add_foreign_key', fk: fkSpecFromDraft(fk) })
      }
    }
  }

  return ops
}

/** 为 createTable 生成列 / 索引 / 外键规格。 */
export function buildCreateColumns(cols: DesignColumnDraft[]): MysqlDesignColumnSpec[] {
  return cols.filter((c) => !c.removed && c.name).map(columnSpecFromDraft)
}

export function buildCreateIndexes(indexes: DesignIndexDraft[]): MysqlDesignIndexSpec[] {
  return indexes.filter((i) => !i.removed && i.columnsText).map(indexSpecFromDraft)
}

export function buildCreateForeignKeys(fks: DesignForeignKeyDraft[]): MysqlDesignForeignKeySpec[] {
  return fks.filter((f) => !f.removed && f.columnsText && f.refTable).map(fkSpecFromDraft)
}
