/**
 * 表设计器状态与 DDL ops 生成（列 / 索引 / 外键 / CHECK / PK / 注释）。
 */
import type {
  VastColumnInfo,
  VastConstraintInfo,
  VastCreateTableCheck,
  VastCreateTableColumn,
  VastCreateTableForeignKey,
  VastCreateTableIndex,
  VastDesignOp,
  VastForeignKeyInfo,
  VastIndexInfo,
} from '@/api/types/vastbase'
import {
  columnsEqual,
  dataTypesEquivalent,
  newEmptyCheck,
  newEmptyColumn,
  newEmptyForeignKey,
  newEmptyIndex,
  normalizeFkAction,
  normalizeIndexMethod,
  parseColumnList,
  splitDataTypeFields,
  syncColumnDataType,
  type DesignCheckDraft,
  type DesignColumnDraft,
  type DesignForeignKeyDraft,
  type DesignIndexDraft,
} from '@/modules/vastbase/utils/table-design'

export function toDesignRows(cols: VastColumnInfo[], pkCols: string[]): DesignColumnDraft[] {
  const pk = new Set(pkCols)
  return cols.map((c) => {
    const parts = splitDataTypeFields(c.dataType)
    return {
      __rowKey: `col-${c.ordinal}-${c.name}`,
      originalName: c.name,
      name: c.name,
      dataType: parts.dataType,
      typeBase: parts.typeBase,
      typeLength: parts.typeLength,
      typeScale: parts.typeScale,
      nullable: c.nullable,
      defaultExpr: c.default ?? '',
      primaryKey: pk.has(c.name),
      comment: c.comment ?? '',
      removed: false,
    }
  })
}

export function toIndexDrafts(indexes: VastIndexInfo[]): DesignIndexDraft[] {
  return indexes.map((idx) => {
    const columnsText = (idx.columns ?? []).join(', ')
    const expression = idx.keyExpression ?? ''
    const whereText = idx.where ?? ''
    const method = normalizeIndexMethod(idx.method ?? 'btree')
    return {
      __rowKey: `idx-${idx.name}`,
      originalName: idx.name,
      name: idx.name,
      columnsText,
      expression,
      whereText,
      unique: idx.unique,
      method,
      primary: idx.primary,
      removed: false,
      snapName: idx.name,
      snapColumnsText: columnsText,
      snapExpression: expression,
      snapWhereText: whereText,
      snapUnique: idx.unique,
      snapMethod: method,
    }
  })
}

export function toForeignKeyDrafts(fks: VastForeignKeyInfo[]): DesignForeignKeyDraft[] {
  return fks.map((fk) => {
    const columnsText = fk.columns.join(', ')
    const refColumnsText = fk.refColumns.join(', ')
    const onDelete = normalizeFkAction(fk.onDelete ?? 'NO ACTION')
    const onUpdate = normalizeFkAction(fk.onUpdate ?? 'NO ACTION')
    return {
      __rowKey: `fk-${fk.name}`,
      originalName: fk.name,
      name: fk.name,
      columnsText,
      refSchema: fk.refSchema,
      refTable: fk.refTable,
      refColumnsText,
      onDelete,
      onUpdate,
      removed: false,
      snapName: fk.name,
      snapColumnsText: columnsText,
      snapRefSchema: fk.refSchema,
      snapRefTable: fk.refTable,
      snapRefColumnsText: refColumnsText,
      snapOnDelete: onDelete,
      snapOnUpdate: onUpdate,
    }
  })
}

function extractCheckExpression(c: VastConstraintInfo): string {
  if (c.expression?.trim()) return c.expression.trim()
  const d = (c.definition ?? '').trim()
  const upper = d.toUpperCase()
  if (!upper.startsWith('CHECK')) return d
  const start = d.indexOf('(')
  const end = d.lastIndexOf(')')
  if (start < 0 || end <= start) return d.replace(/^CHECK\s*/i, '').trim()
  return d.slice(start + 1, end).trim()
}

export function toCheckDrafts(constraints: VastConstraintInfo[]): DesignCheckDraft[] {
  return constraints
    .filter((c) => c.type === 'c' || c.typeLabel?.toUpperCase() === 'CHECK')
    .map((c) => {
      const expression = extractCheckExpression(c)
      return {
        __rowKey: `chk-${c.name}`,
        originalName: c.name,
        name: c.name,
        expression,
        removed: false,
        snapName: c.name,
        snapExpression: expression,
      }
    })
}

export function buildCreateColumns(rows: DesignColumnDraft[]): VastCreateTableColumn[] {
  return rows
    .filter((r) => !r.removed)
    .map((r) => {
      const dataType = syncColumnDataType(r)
      const col: VastCreateTableColumn = {
        name: r.name.trim(),
        dataType,
        nullable: r.primaryKey ? false : r.nullable,
        primaryKey: r.primaryKey,
        comment: r.comment.trim() || undefined,
      }
      if (r.defaultExpr.trim()) col.default = r.defaultExpr.trim()
      return col
    })
}

function indexHasKeys(r: DesignIndexDraft): boolean {
  return !!r.expression.trim() || parseColumnList(r.columnsText).length > 0
}

export function buildCreateIndexes(indexes: DesignIndexDraft[]): VastCreateTableIndex[] {
  return indexes
    .filter((r) => !r.removed && !r.primary && r.name.trim() && indexHasKeys(r))
    .map((r) => {
      const item: VastCreateTableIndex = {
        name: r.name.trim(),
        unique: r.unique,
      }
      if (r.expression.trim()) item.expression = r.expression.trim()
      else item.columns = parseColumnList(r.columnsText)
      if (r.whereText.trim()) item.where = r.whereText.trim()
      const method = normalizeIndexMethod(r.method)
      if (method && method !== 'btree') item.method = method
      return item
    })
}

export function buildCreateForeignKeys(
  fks: DesignForeignKeyDraft[],
): VastCreateTableForeignKey[] {
  return fks
    .filter((r) => !r.removed)
    .map((r) => {
      const item: VastCreateTableForeignKey = {
        name: r.name.trim() || undefined,
        columns: parseColumnList(r.columnsText),
        refSchema: r.refSchema.trim() || undefined,
        refTable: r.refTable.trim(),
        refColumns: parseColumnList(r.refColumnsText),
      }
      const onDelete = normalizeFkAction(r.onDelete)
      const onUpdate = normalizeFkAction(r.onUpdate)
      if (onDelete !== 'NO ACTION') item.onDelete = onDelete
      if (onUpdate !== 'NO ACTION') item.onUpdate = onUpdate
      return item
    })
    .filter((r) => r.columns.length > 0 && r.refTable && r.refColumns.length > 0)
}

export function buildCreateChecks(checks: DesignCheckDraft[]): VastCreateTableCheck[] {
  return checks
    .filter((r) => !r.removed && r.expression.trim())
    .map((r) => {
      const item: VastCreateTableCheck = { expression: r.expression.trim() }
      if (r.name.trim()) item.name = r.name.trim()
      return item
    })
}

function findPkConstraintName(constraints: VastConstraintInfo[]): string | undefined {
  return constraints.find((c) => c.type === 'p')?.name
}

function uniqueConstraintNames(constraints: VastConstraintInfo[]): Set<string> {
  return new Set(constraints.filter((c) => c.type === 'u').map((c) => c.name))
}

function pushDropIndex(
  ops: VastDesignOp[],
  name: string,
  uniqNames: Set<string>,
): void {
  if (uniqNames.has(name)) {
    ops.push({ op: 'drop_constraint', name })
  } else {
    ops.push({ op: 'drop_index', name })
  }
}

function pushAddIndex(ops: VastDesignOp[], idx: DesignIndexDraft): void {
  if (!idx.name.trim() || !indexHasKeys(idx)) return
  const op: VastDesignOp = {
    op: 'add_index',
    name: idx.name.trim(),
    unique: idx.unique,
  }
  if (idx.expression.trim()) op.expression = idx.expression.trim()
  else op.columns = parseColumnList(idx.columnsText)
  if (idx.whereText.trim()) op.where = idx.whereText.trim()
  const method = normalizeIndexMethod(idx.method)
  if (method && method !== 'btree') op.method = method
  ops.push(op)
}

function indexStructChanged(idx: DesignIndexDraft): boolean {
  return (
    idx.columnsText.trim() !== idx.snapColumnsText.trim() ||
    idx.expression.trim() !== idx.snapExpression.trim() ||
    idx.whereText.trim() !== idx.snapWhereText.trim() ||
    idx.unique !== idx.snapUnique ||
    normalizeIndexMethod(idx.method) !== normalizeIndexMethod(idx.snapMethod)
  )
}

function fkStructChanged(fk: DesignForeignKeyDraft): boolean {
  return (
    fk.columnsText.trim() !== fk.snapColumnsText.trim() ||
    fk.refSchema.trim() !== fk.snapRefSchema.trim() ||
    fk.refTable.trim() !== fk.snapRefTable.trim() ||
    fk.refColumnsText.trim() !== fk.snapRefColumnsText.trim() ||
    normalizeFkAction(fk.onDelete) !== fk.snapOnDelete ||
    normalizeFkAction(fk.onUpdate) !== fk.snapOnUpdate
  )
}

function pushAddForeignKey(ops: VastDesignOp[], fk: DesignForeignKeyDraft): void {
  const cols = parseColumnList(fk.columnsText)
  const refCols = parseColumnList(fk.refColumnsText)
  if (cols.length === 0 || !fk.refTable.trim() || refCols.length === 0) return
  const op: VastDesignOp = {
    op: 'add_foreign_key',
    name: fk.name.trim(),
    columns: cols,
    refSchema: fk.refSchema.trim() || undefined,
    refTable: fk.refTable.trim(),
    refColumns: refCols,
  }
  const onDelete = normalizeFkAction(fk.onDelete)
  const onUpdate = normalizeFkAction(fk.onUpdate)
  if (onDelete !== 'NO ACTION') op.onDelete = onDelete
  if (onUpdate !== 'NO ACTION') op.onUpdate = onUpdate
  ops.push(op)
}

function pushAddCheck(ops: VastDesignOp[], ck: DesignCheckDraft): void {
  if (!ck.expression.trim()) return
  ops.push({
    op: 'add_check',
    name: ck.name.trim(),
    expression: ck.expression.trim(),
  })
}

/** 生成 ALTER 设计 ops（列 + PK + 索引 + 外键 + CHECK + 表注释）。 */
export function buildAlterDesignOps(input: {
  tableName: string
  rows: DesignColumnDraft[]
  snapshot: VastColumnInfo[]
  pkSnapshot: string[]
  indexes: DesignIndexDraft[]
  foreignKeys: DesignForeignKeyDraft[]
  checks: DesignCheckDraft[]
  constraints: VastConstraintInfo[]
  tableComment: string
  tableCommentSnapshot: string
}): VastDesignOp[] {
  const ops: VastDesignOp[] = []
  const snapByName = new Map(input.snapshot.map((c) => [c.name, c]))

  for (const r of input.rows) {
    if (r.removed) {
      if (r.originalName) ops.push({ op: 'drop_column', name: r.originalName })
      continue
    }
    if (!r.originalName) {
      const op: VastDesignOp = {
        op: 'add_column',
        name: r.name,
        dataType: syncColumnDataType(r),
        nullable: r.nullable,
      }
      if (r.defaultExpr) op.default = r.defaultExpr
      if (r.comment.trim()) op.comment = r.comment.trim()
      ops.push(op)
      continue
    }

    const orig = snapByName.get(r.originalName)
    if (!orig) continue

    if (r.name !== r.originalName) {
      ops.push({ op: 'rename_column', name: r.originalName, newName: r.name })
    }
    const effectiveName = r.name
    const nextType = syncColumnDataType(r)
    if (!dataTypesEquivalent(nextType, orig.dataType)) {
      ops.push({ op: 'alter_type', name: effectiveName, dataType: nextType })
    }
    if (r.nullable !== orig.nullable) {
      ops.push({
        op: r.nullable ? 'set_null' : 'set_not_null',
        name: effectiveName,
      })
    }
    const origDefault = orig.default ?? ''
    if (r.defaultExpr !== origDefault) {
      if (!r.defaultExpr) {
        ops.push({ op: 'drop_default', name: effectiveName })
      } else {
        ops.push({ op: 'set_default', name: effectiveName, default: r.defaultExpr })
      }
    }
    const origComment = orig.comment ?? ''
    if (r.comment !== origComment) {
      ops.push({
        op: 'set_column_comment',
        name: effectiveName,
        comment: r.comment,
      })
    }
  }

  const nextPk = input.rows
    .filter((r) => !r.removed && r.primaryKey)
    .map((r) => r.name.trim())
    .filter(Boolean)
  if (!columnsEqual(nextPk, input.pkSnapshot)) {
    const pkName = findPkConstraintName(input.constraints)
    if (input.pkSnapshot.length > 0) {
      ops.push({
        op: 'drop_primary_key',
        name: pkName || `${input.tableName}_pkey`,
      })
    }
    if (nextPk.length > 0) {
      ops.push({ op: 'add_primary_key', name: '', columns: nextPk })
    }
  }

  const uniqNames = uniqueConstraintNames(input.constraints)
  for (const idx of input.indexes) {
    if (idx.primary) continue
    if (idx.removed) {
      if (idx.originalName) pushDropIndex(ops, idx.originalName, uniqNames)
      continue
    }
    if (!idx.originalName) {
      pushAddIndex(ops, idx)
      continue
    }

    const structChanged = indexStructChanged(idx)
    const nameChanged = idx.name.trim() !== idx.snapName
    if (!structChanged && !nameChanged) continue

    if (!structChanged && nameChanged && !uniqNames.has(idx.originalName)) {
      ops.push({
        op: 'rename_index',
        name: idx.originalName,
        newName: idx.name.trim(),
      })
      continue
    }

    pushDropIndex(ops, idx.originalName, uniqNames)
    pushAddIndex(ops, idx)
  }

  for (const fk of input.foreignKeys) {
    if (fk.removed) {
      if (fk.originalName) ops.push({ op: 'drop_constraint', name: fk.originalName })
      continue
    }
    if (!fk.originalName) {
      pushAddForeignKey(ops, fk)
      continue
    }
    const nameChanged = fk.name.trim() !== fk.snapName
    if (!fkStructChanged(fk) && !nameChanged) continue
    ops.push({ op: 'drop_constraint', name: fk.originalName })
    pushAddForeignKey(ops, fk)
  }

  for (const ck of input.checks) {
    if (ck.removed) {
      if (ck.originalName) ops.push({ op: 'drop_constraint', name: ck.originalName })
      continue
    }
    if (!ck.originalName) {
      pushAddCheck(ops, ck)
      continue
    }
    const changed =
      ck.name.trim() !== ck.snapName || ck.expression.trim() !== ck.snapExpression.trim()
    if (!changed) continue
    ops.push({ op: 'drop_constraint', name: ck.originalName })
    pushAddCheck(ops, ck)
  }

  if (input.tableComment !== input.tableCommentSnapshot) {
    ops.push({
      op: 'set_table_comment',
      name: '',
      comment: input.tableComment,
    })
  }

  return ops
}

export function addDraftColumn(rows: DesignColumnDraft[]): DesignColumnDraft[] {
  return [...rows, newEmptyColumn(rows.length)]
}

export function addDraftIndex(indexes: DesignIndexDraft[]): DesignIndexDraft[] {
  return [...indexes, newEmptyIndex(indexes.length)]
}

export function addDraftForeignKey(
  fks: DesignForeignKeyDraft[],
  schema: string,
): DesignForeignKeyDraft[] {
  return [...fks, newEmptyForeignKey(fks.length, schema)]
}

export function addDraftCheck(checks: DesignCheckDraft[]): DesignCheckDraft[] {
  return [...checks, newEmptyCheck(checks.length)]
}
