/**
 * SQL Server 表设计器 ops 生成（列 / 索引 / 外键 / CHECK）。
 * ALTER ops 对齐后端扁平 DesignOp（services/sqlserver-service/internal/ddl/design.go）。
 * 现有列不能用 ALTER COLUMN 加减 IDENTITY；新建列可通过 add_column.autoIncrement。
 */
import type {
  SqlServerCheckInfo,
  SqlServerColumnInfo,
  SqlServerDesignCheckSpec,
  SqlServerDesignColumnSpec,
  SqlServerDesignForeignKeySpec,
  SqlServerDesignIndexSpec,
  SqlServerDesignOp,
  SqlServerForeignKeyInfo,
  SqlServerIndexInfo,
} from '@/api/types/sqlserver'
import {
  clampColumnTypeParams,
  formatSqlServerDefaultExpr,
  joinColumnList,
  newEmptyCheck,
  newEmptyColumn,
  newEmptyForeignKey,
  newEmptyIndex,
  nextDraftKey,
  normalizeIndexMethod,
  parseColumnList,
  splitDataTypeFields,
  syncColumnDataType,
  suggestIndexName,
  type DesignCheckDraft,
  type DesignColumnDraft,
  type DesignForeignKeyDraft,
  type DesignIndexDraft,
} from './table-design'

export function toDesignRows(cols: SqlServerColumnInfo[], pkCols: string[]): DesignColumnDraft[] {
  const pk = new Set(pkCols)
  return cols.map((c, i) => {
    const parts = splitDataTypeFields(c.dataType ?? '')
    return {
      __rowKey: `col-${i}-${c.name}`,
      originalName: c.name,
      name: c.name,
      dataType: parts.dataType,
      typeBase: parts.typeBase,
      typeLength: parts.typeLength,
      typeScale: parts.typeScale,
      nullable: c.nullable !== false,
      defaultExpr: c.default ?? '',
      primaryKey: pk.has(c.name),
      autoIncrement: Boolean(c.autoIncrement),
      comment: c.comment ?? '',
      removed: false,
    }
  })
}

export function toIndexDrafts(indexes: SqlServerIndexInfo[], pkCols: string[]): DesignIndexDraft[] {
  const drafts: DesignIndexDraft[] = indexes.map((idx) => {
    const columnsText = (idx.columns ?? []).join(', ')
    const method = normalizeIndexMethod(idx.method || 'NONCLUSTERED')
    const primary = Boolean(idx.primary)
    return {
      __rowKey: `idx-${idx.name}`,
      originalName: idx.name,
      name: primary ? 'PRIMARY' : idx.name,
      columnsText,
      unique: primary ? true : idx.unique,
      primary,
      method,
      removed: false,
      snapName: primary ? 'PRIMARY' : idx.name,
      snapColumnsText: columnsText,
      snapUnique: primary ? true : idx.unique,
      snapMethod: method,
    }
  })

  // 元数据偶发缺 PRIMARY 时，用主键列合成一行（对齐 Navicat 索引页始终可见 PRIMARY）
  if (!drafts.some((d) => d.primary) && pkCols.length > 0) {
    drafts.unshift(makePrimaryIndexDraft(pkCols, /* existing */ true))
  }

  drafts.sort((a, b) => Number(b.primary) - Number(a.primary))
  return drafts
}

/** 构造 PRIMARY 索引草稿（新建或由列主键勾选同步）。 */
export function makePrimaryIndexDraft(
  pkCols: string[],
  existing: boolean,
): DesignIndexDraft {
  const columnsText = joinColumnList(pkCols)
  return {
    __rowKey: existing ? 'idx-PRIMARY' : nextDraftKey('idx-pk'),
    originalName: existing ? 'PRIMARY' : '',
    name: 'PRIMARY',
    columnsText,
    unique: true,
    primary: true,
    method: 'NONCLUSTERED',
    removed: false,
    snapName: existing ? 'PRIMARY' : '',
    snapColumnsText: existing ? columnsText : '',
    snapUnique: true,
    snapMethod: 'NONCLUSTERED',
  }
}

/**
 * 按列上的 primaryKey 勾选，同步索引页中的 PRIMARY 行（Navicat：栏位主键 ↔ 索引 PRIMARY）。
 */
export function syncPrimaryIndexFromColumns(
  indexes: DesignIndexDraft[],
  columns: DesignColumnDraft[],
): DesignIndexDraft[] {
  const pkCols = columns.filter((c) => !c.removed && c.primaryKey && c.name).map((c) => c.name)
  const others = indexes.filter((i) => !i.primary)
  if (pkCols.length === 0) {
    return others
  }
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

/**
 * 编辑索引页 PRIMARY 列清单后，回写列上的 primaryKey（并强制 NOT NULL）。
 */
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

export function toForeignKeyDrafts(
  fks: SqlServerForeignKeyInfo[],
  defaultSchema = '',
): DesignForeignKeyDraft[] {
  return fks.map((fk) => ({
    __rowKey: `fk-${fk.name}`,
    originalName: fk.name,
    name: fk.name,
    columnsText: fk.columns.join(', '),
    refSchema: fk.refSchema?.trim() || defaultSchema,
    refTable: fk.refTable,
    refColumnsText: fk.refColumns.join(', '),
    onDelete: fk.onDelete ?? 'NO ACTION',
    onUpdate: fk.onUpdate ?? 'NO ACTION',
    removed: false,
  }))
}

export function toCheckDrafts(checks: SqlServerCheckInfo[]): DesignCheckDraft[] {
  return checks.map((ck) => {
    const expression = (ck.expression ?? '').trim()
    return {
      __rowKey: `chk-${ck.name}`,
      originalName: ck.name,
      name: ck.name,
      expression,
      removed: false,
      snapName: ck.name,
      snapExpression: expression,
    }
  })
}

export function addDraftColumn(cols: DesignColumnDraft[]): DesignColumnDraft[] {
  return [...cols, newEmptyColumn()]
}

export function addDraftIndex(indexes: DesignIndexDraft[]): DesignIndexDraft[] {
  return [...indexes, newEmptyIndex()]
}

export function addDraftForeignKey(
  fks: DesignForeignKeyDraft[],
  schema = '',
): DesignForeignKeyDraft[] {
  return [...fks, newEmptyForeignKey(schema)]
}

export function addDraftCheck(checks: DesignCheckDraft[]): DesignCheckDraft[] {
  return [...checks, newEmptyCheck(checks.filter((c) => !c.removed).length)]
}

function columnSpecFromDraft(col: DesignColumnDraft): SqlServerDesignColumnSpec {
  const def = formatSqlServerDefaultExpr(col.defaultExpr)
  const clamped = clampColumnTypeParams(col)
  return {
    name: col.name,
    dataType: syncColumnDataType({ ...col, ...clamped }),
    nullable: col.nullable,
    default: def || null,
    comment: col.comment || undefined,
    autoIncrement: col.autoIncrement || undefined,
    primaryKey: col.primaryKey || undefined,
  }
}

/** 仅改名时不带 dataType，避免对 IDENTITY 列再走 ALTER COLUMN。 */
function alterColumnTypeOp(col: DesignColumnDraft, typeOrNullChanged: boolean): SqlServerDesignOp {
  if (!typeOrNullChanged) {
    return {
      op: 'rename_column',
      name: col.originalName,
      newName: col.name,
    }
  }
  return {
    op: 'rename_column',
    name: col.originalName,
    newName: col.name,
    dataType: col.dataType.trim(),
    nullable: col.nullable,
  }
}

function setColumnCommentOp(col: DesignColumnDraft): SqlServerDesignOp {
  return {
    op: 'set_column_comment',
    name: col.name,
    comment: col.comment,
  }
}

function indexSpecFromDraft(idx: DesignIndexDraft): SqlServerDesignIndexSpec {
  const columns = parseColumnList(idx.columnsText)
  const name = idx.name.trim() || suggestIndexName(idx.columnsText, `idx_${columns[0] ?? 'col'}`)
  const method = normalizeIndexMethod(idx.method || 'NONCLUSTERED')
  return {
    name,
    columns,
    unique: idx.unique,
    primary: false,
    method,
  }
}

function fkSpecFromDraft(fk: DesignForeignKeyDraft): SqlServerDesignForeignKeySpec {
  return {
    name: fk.name || undefined,
    columns: parseColumnList(fk.columnsText),
    refSchema: fk.refSchema.trim() || undefined,
    refTable: fk.refTable,
    refColumns: parseColumnList(fk.refColumnsText),
    onDelete: fk.onDelete || undefined,
    onUpdate: fk.onUpdate || undefined,
  }
}

function checkSpecFromDraft(ck: DesignCheckDraft): SqlServerDesignCheckSpec {
  const item: SqlServerDesignCheckSpec = { expression: ck.expression.trim() }
  if (ck.name.trim()) item.name = ck.name.trim()
  return item
}

function flatAddIndex(idx: DesignIndexDraft): SqlServerDesignOp {
  const spec = indexSpecFromDraft(idx)
  return {
    op: 'add_index',
    name: spec.name,
    columns: spec.columns,
    unique: spec.unique,
    method: spec.method,
  }
}

function flatAddForeignKey(fk: DesignForeignKeyDraft): SqlServerDesignOp {
  const spec = fkSpecFromDraft(fk)
  return {
    op: 'add_foreign_key',
    name: spec.name,
    columns: spec.columns,
    refSchema: spec.refSchema,
    refTable: spec.refTable,
    refColumns: spec.refColumns,
    onDelete: spec.onDelete,
    onUpdate: spec.onUpdate,
  }
}

function flatAddCheck(ck: DesignCheckDraft): SqlServerDesignOp {
  return {
    op: 'add_check',
    name: ck.name.trim(),
    expression: ck.expression.trim(),
  }
}

/**
 * 从草稿列表生成 ALTER TABLE 的扁平 ops（对齐后端 DesignOp）。
 *
 * SQL Server IDENTITY：现有列不能 ALTER 加减；新建列走 add_column.autoIncrement。
 * ALTER COLUMN 只改类型与空值；默认值走 set_default / drop_default。
 */
export function buildAlterDesignOps(
  origCols: DesignColumnDraft[],
  newCols: DesignColumnDraft[],
  origIndexes: DesignIndexDraft[],
  newIndexes: DesignIndexDraft[],
  origFks: DesignForeignKeyDraft[],
  newFks: DesignForeignKeyDraft[],
  origChecks: DesignCheckDraft[] = [],
  newChecks: DesignCheckDraft[] = [],
): SqlServerDesignOp[] {
  const ops: SqlServerDesignOp[] = []

  const origColMap = new Map(origCols.map((c) => [c.originalName, c]))

  const origPkCols = origCols.filter((c) => c.primaryKey && !c.removed).map((c) => c.name)
  const newPkCols = newCols.filter((c) => c.primaryKey && !c.removed).map((c) => c.name)
  const pkChanged =
    origPkCols.length !== newPkCols.length || origPkCols.some((c, i) => c !== newPkCols[i])

  for (const col of newCols) {
    if (col.removed) {
      if (col.originalName) {
        ops.push({ op: 'drop_column', name: col.originalName })
      }
      continue
    }
    if (!col.originalName) {
      const def = formatSqlServerDefaultExpr(col.defaultExpr)
      ops.push({
        op: 'add_column',
        name: col.name,
        dataType: col.dataType,
        nullable: col.nullable,
        default: col.autoIncrement ? undefined : def || null,
        comment: col.comment || undefined,
        autoIncrement: col.autoIncrement || undefined,
      })
      continue
    }

    const orig = origColMap.get(col.originalName)
    if (!orig) continue
    const renamed = col.name !== orig.name
    const typeOrNullChanged =
      col.dataType !== orig.dataType || col.nullable !== orig.nullable
    const defaultChanged = col.defaultExpr !== orig.defaultExpr
    const commentChanged = col.comment !== orig.comment

    if (renamed || typeOrNullChanged) {
      ops.push(alterColumnTypeOp(col, typeOrNullChanged))
    }
    if (defaultChanged && !col.autoIncrement) {
      const def = formatSqlServerDefaultExpr(col.defaultExpr)
      if (def) {
        ops.push({ op: 'set_default', name: col.name, default: def })
      } else {
        ops.push({ op: 'drop_default', name: col.name })
      }
    }
    if (commentChanged) ops.push(setColumnCommentOp(col))
  }

  if (pkChanged) {
    if (origPkCols.length > 0) ops.push({ op: 'drop_primary_key' })
    if (newPkCols.length > 0) ops.push({ op: 'add_primary_key', columns: newPkCols })
  }

  const origIdxMap = new Map(origIndexes.map((i) => [i.originalName, i]))
  for (const idx of newIndexes) {
    // PRIMARY 走 drop/add_primary_key，禁止 drop_index PRIMARY
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
      idx.unique !== orig.snapUnique ||
      normalizeIndexMethod(idx.method) !== normalizeIndexMethod(orig.snapMethod)
    if (changed) {
      ops.push({ op: 'drop_index', name: idx.originalName })
      ops.push(flatAddIndex(idx))
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
      fk.refSchema !== orig.refSchema ||
      fk.refTable !== orig.refTable ||
      fk.refColumnsText !== orig.refColumnsText ||
      fk.onDelete !== orig.onDelete ||
      fk.onUpdate !== orig.onUpdate
    if (changed) {
      ops.push({ op: 'drop_constraint', name: fk.originalName })
      ops.push(flatAddForeignKey(fk))
    }
  }

  const origCkMap = new Map(origChecks.map((c) => [c.originalName, c]))
  for (const ck of newChecks) {
    if (ck.removed) {
      if (ck.originalName) ops.push({ op: 'drop_constraint', name: ck.originalName })
      continue
    }
    if (!ck.expression.trim()) continue
    if (!ck.originalName) {
      ops.push(flatAddCheck(ck))
      continue
    }
    const orig = origCkMap.get(ck.originalName)
    if (!orig) continue
    const changed =
      ck.name !== orig.snapName || ck.expression.trim() !== orig.snapExpression.trim()
    if (changed) {
      ops.push({ op: 'drop_constraint', name: ck.originalName })
      ops.push(flatAddCheck(ck))
    }
  }

  return ops
}

/** 为 createTable 生成列 / 索引 / 外键 / CHECK 规格。 */
export function buildCreateColumns(cols: DesignColumnDraft[]): SqlServerDesignColumnSpec[] {
  return cols.filter((c) => !c.removed && c.name).map(columnSpecFromDraft)
}

export function buildCreateIndexes(indexes: DesignIndexDraft[]): SqlServerDesignIndexSpec[] {
  // PRIMARY 由列 primaryKey 生成，不走 add_index
  return indexes.filter((i) => !i.removed && !i.primary && i.columnsText).map(indexSpecFromDraft)
}

export function buildCreateForeignKeys(fks: DesignForeignKeyDraft[]): SqlServerDesignForeignKeySpec[] {
  return fks.filter((f) => !f.removed && f.columnsText && f.refTable).map(fkSpecFromDraft)
}

export function buildCreateChecks(checks: DesignCheckDraft[]): SqlServerDesignCheckSpec[] {
  return checks.filter((c) => !c.removed && c.expression.trim()).map(checkSpecFromDraft)
}
