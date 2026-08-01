/**
 * Oracle 表设计器 ops 生成（列 / 索引 / 外键）。
 * ALTER ops 对齐后端扁平 DesignOp（services/oracle-service/internal/ddl/design.go）。
 */
import type {
  OracleColumnInfo,
  OracleDesignColumnSpec,
  OracleDesignForeignKeySpec,
  OracleDesignIndexSpec,
  OracleDesignOp,
  OracleForeignKeyInfo,
  OracleIndexInfo,
} from '@/api/types/oracle'
import {
  formatOracleDefaultExpr,
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

export function toDesignRows(cols: OracleColumnInfo[], pkCols: string[]): DesignColumnDraft[] {
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
      unsigned: parts.unsigned,
      enumValues: parts.enumValues,
      nullable: c.nullable !== false,
      defaultExpr: c.default ?? '',
      primaryKey: pk.has(c.name),
      autoIncrement: Boolean(c.autoIncrement),
      comment: c.comment ?? '',
      removed: false,
    }
  })
}

export function toIndexDrafts(indexes: OracleIndexInfo[], pkCols: string[]): DesignIndexDraft[] {
  const drafts = indexes.map((idx) => {
    const columnsText = (idx.columns ?? []).join(', ')
    const method = (idx.method || 'BTREE').toUpperCase()
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

export function toForeignKeyDrafts(fks: OracleForeignKeyInfo[]): DesignForeignKeyDraft[] {
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

function columnSpecFromDraft(col: DesignColumnDraft): OracleDesignColumnSpec {
  const def = formatOracleDefaultExpr(col.defaultExpr)
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

/** CHANGE / MODIFY 用的完整类型片段（含 NULL / AI / DEFAULT / COMMENT）。 */
function columnModifyTypeClause(col: DesignColumnDraft, opts?: { autoIncrement?: boolean }): string {
  const wantAi = opts?.autoIncrement ?? col.autoIncrement
  let s = col.dataType.trim()
  if (!col.nullable) s += ' NOT NULL'
  if (wantAi) s += ' IDENTITY'
  const def = formatOracleDefaultExpr(col.defaultExpr)
  if (def) s += ` DEFAULT ${def}`
  if (col.comment.trim()) {
    const esc = col.comment.replace(/'/g, "''")
    s += ` COMMENT '${esc}'`
  }
  return s
}

function renameColumnOp(col: DesignColumnDraft, autoIncrement?: boolean): OracleDesignOp {
  return {
    op: 'rename_column',
    name: col.originalName,
    newName: col.name,
    dataType: columnModifyTypeClause(col, {
      autoIncrement: autoIncrement ?? col.autoIncrement,
    }),
  }
}

function indexSpecFromDraft(idx: DesignIndexDraft): OracleDesignIndexSpec {
  const columns = parseColumnList(idx.columnsText)
  const name = idx.name.trim() || suggestIndexName(idx.columnsText, `idx_${columns[0] ?? 'col'}`)
  const method = (idx.method || 'BTREE').toUpperCase()
  return {
    name,
    columns,
    unique: idx.unique,
    primary: false,
    method: method === 'HASH' ? 'HASH' : 'BTREE',
  }
}

function fkSpecFromDraft(fk: DesignForeignKeyDraft): OracleDesignForeignKeySpec {
  return {
    name: fk.name || undefined,
    columns: parseColumnList(fk.columnsText),
    refTable: fk.refTable,
    refColumns: parseColumnList(fk.refColumnsText),
    onDelete: fk.onDelete || undefined,
    onUpdate: fk.onUpdate || undefined,
  }
}

function flatAddIndex(idx: DesignIndexDraft): OracleDesignOp {
  const spec = indexSpecFromDraft(idx)
  return {
    op: 'add_index',
    name: spec.name,
    columns: spec.columns,
    unique: spec.unique,
    method: spec.method,
  }
}

function flatAddForeignKey(fk: DesignForeignKeyDraft): OracleDesignOp {
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
 * 从草稿列表生成 ALTER TABLE 的扁平 ops（对齐后端 DesignOp）。
 *
 * 主键变更时须遵守 MySQL 规则：IDENTITY 列必须是 KEY（Error 1075）。
 * 顺序固定为：列结构变更（不含 AI）→ 剥掉旧 AI → DROP/ADD PK → 再按需加回 AI。
 */
export function buildAlterDesignOps(
  origCols: DesignColumnDraft[],
  newCols: DesignColumnDraft[],
  origIndexes: DesignIndexDraft[],
  newIndexes: DesignIndexDraft[],
  origFks: DesignForeignKeyDraft[],
  newFks: DesignForeignKeyDraft[],
): OracleDesignOp[] {
  const ops: OracleDesignOp[] = []

  const origColMap = new Map(origCols.map((c) => [c.originalName, c]))

  const origPkCols = origCols.filter((c) => c.primaryKey && !c.removed).map((c) => c.name)
  const newPkCols = newCols.filter((c) => c.primaryKey && !c.removed).map((c) => c.name)
  const pkChanged =
    origPkCols.length !== newPkCols.length || origPkCols.some((c, i) => c !== newPkCols[i])

  // 主键重建期间不能带 AI；非主键变更时 AI 可随列 MODIFY 一起发出
  const deferAutoIncrement = pkChanged

  // ── 1) 列结构变更（主键重建时强制不写 IDENTITY）────────────────
  const strippedAiKeys = new Set<string>()
  for (const col of newCols) {
    if (col.removed) {
      if (col.originalName) ops.push({ op: 'drop_column', name: col.originalName })
      continue
    }
    if (!col.originalName) {
      const def = formatOracleDefaultExpr(col.defaultExpr)
      // ADD COLUMN 不带 AI：新建 AI 列须等主键就绪
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
    const nonAiChanged =
      col.name !== orig.name ||
      col.dataType !== orig.dataType ||
      col.nullable !== orig.nullable ||
      col.defaultExpr !== orig.defaultExpr ||
      col.comment !== orig.comment
    const aiChanged = col.autoIncrement !== orig.autoIncrement

    if (deferAutoIncrement) {
      // 主键重建期间列 CHANGE 一律不带 AI；旧 AI 的剥离在 PK 段统一处理
      if (nonAiChanged) {
        ops.push(renameColumnOp(col, false))
        if (orig.autoIncrement) strippedAiKeys.add(col.originalName)
      }
    } else if (nonAiChanged || aiChanged) {
      ops.push(renameColumnOp(col, col.autoIncrement))
    }
  }

  // ── 2) 主键重建：先确保旧 AI 已剥掉，再 DROP / ADD ───────────────────
  if (pkChanged) {
    for (const col of newCols) {
      if (col.removed || !col.originalName) continue
      const orig = origColMap.get(col.originalName)
      if (!orig?.autoIncrement) continue
      if (strippedAiKeys.has(col.originalName)) continue
      ops.push(renameColumnOp(col, false))
      strippedAiKeys.add(col.originalName)
    }
    if (origPkCols.length > 0) ops.push({ op: 'drop_primary_key' })
    if (newPkCols.length > 0) ops.push({ op: 'add_primary_key', columns: newPkCols })

    // ADD PK 后为仍勾选 AI 且属于新主键的列加回 IDENTITY
    for (const col of newCols) {
      if (col.removed || !col.autoIncrement || !col.primaryKey) continue
      if (!col.originalName) {
        // 新建列：ADD COLUMN 后补 AI（列名即 name）
        ops.push({
          op: 'rename_column',
          name: col.name,
          newName: col.name,
          dataType: columnModifyTypeClause(col, { autoIncrement: true }),
        })
        continue
      }
      ops.push(renameColumnOp(col, true))
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
      (idx.method || 'BTREE').toUpperCase() !== (orig.snapMethod || 'BTREE').toUpperCase()
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

/** 为 createTable 生成列 / 索引 / 外键规格。 */
export function buildCreateColumns(cols: DesignColumnDraft[]): OracleDesignColumnSpec[] {
  return cols.filter((c) => !c.removed && c.name).map(columnSpecFromDraft)
}

export function buildCreateIndexes(indexes: DesignIndexDraft[]): OracleDesignIndexSpec[] {
  // PRIMARY 由列 primaryKey 生成，不走 add_index
  return indexes.filter((i) => !i.removed && !i.primary && i.columnsText).map(indexSpecFromDraft)
}

export function buildCreateForeignKeys(fks: DesignForeignKeyDraft[]): OracleDesignForeignKeySpec[] {
  return fks.filter((f) => !f.removed && f.columnsText && f.refTable).map(fkSpecFromDraft)
}
