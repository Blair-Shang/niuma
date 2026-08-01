/**
 * 达梦表设计器 ops 生成（列 / 索引 / 外键 / CHECK）。
 * ALTER ops 对齐后端扁平 DesignOp（services/dameng-service/internal/ddl/design.go）。
 */
import type {
  DamengCheckInfo,
  DamengColumnInfo,
  DamengDesignCheckSpec,
  DamengDesignColumnSpec,
  DamengDesignForeignKeySpec,
  DamengDesignIndexSpec,
  DamengDesignOp,
  DamengForeignKeyInfo,
  DamengIndexInfo,
} from '@/api/types/dameng'
import {
  formatDamengDefaultExpr,
  joinColumnList,
  newEmptyCheck,
  newEmptyColumn,
  newEmptyForeignKey,
  newEmptyIndex,
  nextDraftKey,
  normalizeIndexMethod,
  parseColumnList,
  splitDataTypeFields,
  suggestIndexName,
  type DesignCheckDraft,
  type DesignColumnDraft,
  type DesignForeignKeyDraft,
  type DesignIndexDraft,
} from './table-design'

export function toDesignRows(cols: DamengColumnInfo[], pkCols: string[]): DesignColumnDraft[] {
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

export function toIndexDrafts(indexes: DamengIndexInfo[], pkCols: string[]): DesignIndexDraft[] {
  const drafts: DesignIndexDraft[] = indexes.map((idx) => {
    const columnsText = (idx.columns ?? []).join(', ')
    const method = normalizeIndexMethod(idx.method || 'BTREE')
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
    method: 'BTREE',
    removed: false,
    snapName: existing ? 'PRIMARY' : '',
    snapColumnsText: existing ? columnsText : '',
    snapUnique: true,
    snapMethod: 'BTREE',
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
  fks: DamengForeignKeyInfo[],
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

export function toCheckDrafts(checks: DamengCheckInfo[]): DesignCheckDraft[] {
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

function columnSpecFromDraft(col: DesignColumnDraft): DamengDesignColumnSpec {
  const def = formatDamengDefaultExpr(col.defaultExpr)
  return {
    name: col.name,
    dataType: col.dataType,
    nullable: col.nullable,
    default: def || null,
    comment: col.comment || undefined,
    autoIncrement: col.autoIncrement || undefined,
    primaryKey: col.primaryKey || undefined,
  }
}

/** MODIFY 用的类型片段（含 NULL / AI / DEFAULT）。达梦注释走 COMMENT ON COLUMN，不写入此片段。 */
function columnModifyTypeClause(col: DesignColumnDraft, opts?: { autoIncrement?: boolean }): string {
  const wantAi = opts?.autoIncrement ?? col.autoIncrement
  let s = col.dataType.trim()
  if (!col.nullable) s += ' NOT NULL'
  if (wantAi) s += ' IDENTITY'
  const def = formatDamengDefaultExpr(col.defaultExpr)
  if (def) s += ` DEFAULT ${def}`
  return s
}

/** 列结构变更：改名用 rename_column；类型/空/默认/AI 用 rename_column+dataType（后端转 MODIFY）。 */
function renameColumnOp(col: DesignColumnDraft, autoIncrement?: boolean): DamengDesignOp {
  return {
    op: 'rename_column',
    name: col.originalName,
    newName: col.name,
    dataType: columnModifyTypeClause(col, {
      autoIncrement: autoIncrement ?? col.autoIncrement,
    }),
  }
}

function setColumnCommentOp(col: DesignColumnDraft): DamengDesignOp {
  return {
    op: 'set_column_comment',
    name: col.name,
    comment: col.comment,
  }
}

function indexSpecFromDraft(idx: DesignIndexDraft): DamengDesignIndexSpec {
  const columns = parseColumnList(idx.columnsText)
  const name = idx.name.trim() || suggestIndexName(idx.columnsText, `idx_${columns[0] ?? 'col'}`)
  const method = normalizeIndexMethod(idx.method || 'BTREE')
  return {
    name,
    columns,
    unique: idx.unique,
    primary: false,
    method,
  }
}

function fkSpecFromDraft(fk: DesignForeignKeyDraft): DamengDesignForeignKeySpec {
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

function checkSpecFromDraft(ck: DesignCheckDraft): DamengDesignCheckSpec {
  const item: DamengDesignCheckSpec = { expression: ck.expression.trim() }
  if (ck.name.trim()) item.name = ck.name.trim()
  return item
}

function flatAddIndex(idx: DesignIndexDraft): DamengDesignOp {
  const spec = indexSpecFromDraft(idx)
  return {
    op: 'add_index',
    name: spec.name,
    columns: spec.columns,
    unique: spec.unique,
    method: spec.method,
  }
}

function flatAddForeignKey(fk: DesignForeignKeyDraft): DamengDesignOp {
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

function flatAddCheck(ck: DesignCheckDraft): DamengDesignOp {
  return {
    op: 'add_check',
    name: ck.name.trim(),
    expression: ck.expression.trim(),
  }
}

/**
 * 从草稿列表生成 ALTER TABLE 的扁平 ops（对齐后端 DesignOp）。
 *
 * 达梦 IDENTITY 约束：
 * - 不可直接 MODIFY 自增列（Error -2664），须先 `DROP IDENTITY`
 * - 加回自增用 `ADD col IDENTITY(1,1)`（达梦工具惯用写法）
 * 主键变更顺序：列结构（无 AI）→ DROP IDENTITY → DROP/ADD PK → ADD IDENTITY。
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
): DamengDesignOp[] {
  const ops: DamengDesignOp[] = []

  const origColMap = new Map(origCols.map((c) => [c.originalName, c]))

  const origPkCols = origCols.filter((c) => c.primaryKey && !c.removed).map((c) => c.name)
  const newPkCols = newCols.filter((c) => c.primaryKey && !c.removed).map((c) => c.name)
  const pkChanged =
    origPkCols.length !== newPkCols.length || origPkCols.some((c, i) => c !== newPkCols[i])

  // 主键重建期间不能带 AI；非主键变更时 AI 在结构变更后再 ADD IDENTITY
  const deferAutoIncrement = pkChanged

  let identityDropped = false
  const ensureDropIdentity = (): void => {
    if (identityDropped) return
    ops.push({ op: 'drop_identity' })
    identityDropped = true
  }

  // ── 1) 列结构变更（MODIFY 从不带 IDENTITY）────────────────────────
  for (const col of newCols) {
    if (col.removed) {
      if (col.originalName) {
        const orig = origColMap.get(col.originalName)
        if (orig?.autoIncrement) ensureDropIdentity()
        ops.push({ op: 'drop_column', name: col.originalName })
      }
      continue
    }
    if (!col.originalName) {
      const def = formatDamengDefaultExpr(col.defaultExpr)
      // ADD COLUMN 不带 AI：新建 AI 列须等主键就绪（或非 defer 时随后 ADD IDENTITY）
      ops.push({
        op: 'add_column',
        name: col.name,
        dataType: col.dataType,
        nullable: col.nullable,
        default: def || null,
        comment: col.comment || undefined,
      })
      continue
    }

    const orig = origColMap.get(col.originalName)
    if (!orig) continue
    const structureChanged =
      col.name !== orig.name ||
      col.dataType !== orig.dataType ||
      col.nullable !== orig.nullable ||
      col.defaultExpr !== orig.defaultExpr
    const commentChanged = col.comment !== orig.comment
    const aiChanged = col.autoIncrement !== orig.autoIncrement

    if (deferAutoIncrement) {
      // 主键重建：结构变更前若原列是 AI，先 DROP IDENTITY；AI 加回放到 PK 段
      if (structureChanged) {
        if (orig.autoIncrement) ensureDropIdentity()
        ops.push(renameColumnOp(col, false))
      }
      if (commentChanged) ops.push(setColumnCommentOp(col))
    } else if (structureChanged || aiChanged || commentChanged) {
      if (orig.autoIncrement && (structureChanged || !col.autoIncrement)) {
        ensureDropIdentity()
      }
      if (structureChanged) {
        ops.push(renameColumnOp(col, false))
      }
      // 非 PK 变更：结构改完或仅勾选自增后，按需挂回 IDENTITY
      if (col.autoIncrement && (aiChanged || (structureChanged && orig.autoIncrement))) {
        ops.push({ op: 'add_identity', name: col.name })
      }
      if (commentChanged) ops.push(setColumnCommentOp(col))
    }
  }

  // 新建列在非 defer 场景下勾了 AI：补 ADD IDENTITY
  if (!deferAutoIncrement) {
    for (const col of newCols) {
      if (col.removed || col.originalName || !col.autoIncrement) continue
      ops.push({ op: 'add_identity', name: col.name })
    }
  }

  // ── 2) 主键重建：DROP IDENTITY → DROP/ADD PK → ADD IDENTITY ────────
  if (pkChanged) {
    for (const col of newCols) {
      if (col.removed || !col.originalName) continue
      const orig = origColMap.get(col.originalName)
      if (orig?.autoIncrement) ensureDropIdentity()
    }
    // 被删掉的原 AI 列也要先剥 IDENTITY（上面 removed 分支已处理；此处兜底 orig 快照）
    for (const orig of origCols) {
      if (orig.autoIncrement) ensureDropIdentity()
    }

    if (origPkCols.length > 0) ops.push({ op: 'drop_primary_key' })
    if (newPkCols.length > 0) ops.push({ op: 'add_primary_key', columns: newPkCols })

    for (const col of newCols) {
      if (col.removed || !col.autoIncrement || !col.primaryKey) continue
      ops.push({ op: 'add_identity', name: col.name })
    }
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
export function buildCreateColumns(cols: DesignColumnDraft[]): DamengDesignColumnSpec[] {
  return cols.filter((c) => !c.removed && c.name).map(columnSpecFromDraft)
}

export function buildCreateIndexes(indexes: DesignIndexDraft[]): DamengDesignIndexSpec[] {
  // PRIMARY 由列 primaryKey 生成，不走 add_index
  return indexes.filter((i) => !i.removed && !i.primary && i.columnsText).map(indexSpecFromDraft)
}

export function buildCreateForeignKeys(fks: DesignForeignKeyDraft[]): DamengDesignForeignKeySpec[] {
  return fks.filter((f) => !f.removed && f.columnsText && f.refTable).map(fkSpecFromDraft)
}

export function buildCreateChecks(checks: DesignCheckDraft[]): DamengDesignCheckSpec[] {
  return checks.filter((c) => !c.removed && c.expression.trim()).map(checkSpecFromDraft)
}
