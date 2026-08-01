/**
 * ClickHouse 表设计器 ops 生成（列 + 表注释 + 跳数索引）。
 */
import type {
  ClickHouseColumnInfo,
  ClickHouseDesignColumnSpec,
  ClickHouseDesignIndexSpec,
  ClickHouseDesignOp,
  ClickHouseIndexInfo,
} from '@/api/types/clickhouse'
import {
  nextDraftKey,
  parseDataType,
  syncColumnDataType,
  type DesignColumnDraft,
  type DesignIndexDraft,
} from './table-design'

export function toDesignRows(cols: ClickHouseColumnInfo[]): DesignColumnDraft[] {
  return cols.map((c, i) => {
    const parsed = parseDataType(c.dataType ?? 'String')
    const draft: DesignColumnDraft = {
      __rowKey: `col-${i}-${c.name}`,
      originalName: c.name,
      name: c.name,
      dataType: c.dataType ?? 'String',
      typeBase: parsed.typeBase,
      typeLength: parsed.typeLength,
      typeScale: parsed.typeScale,
      typeInner: parsed.typeInner,
      enumValues: parsed.enumValues,
      nullable: parsed.nullable,
      lowCardinality: parsed.lowCardinality,
      defaultExpr: c.default ?? '',
      comment: c.comment ?? '',
      codec: '',
      removed: false,
    }
    // 保持服务端原始字面量；向导字段用于侧栏编辑
    return draft
  })
}

export function toIndexDrafts(indexes: ClickHouseIndexInfo[]): DesignIndexDraft[] {
  return indexes.map((idx, i) => ({
    __rowKey: `idx-${i}-${idx.name}`,
    originalName: idx.name,
    name: idx.name,
    expression: idx.expression ?? '',
    type: idx.type?.trim() || 'minmax',
    granularity: 1,
    removed: false,
  }))
}

export function buildCreateColumns(cols: DesignColumnDraft[]): ClickHouseDesignColumnSpec[] {
  return cols
    .filter((c) => !c.removed && c.name.trim())
    .map((c) => {
      const dataType = (c.dataType.trim() || syncColumnDataType(c) || 'String')
      const spec: ClickHouseDesignColumnSpec = {
        name: c.name.trim(),
        dataType,
      }
      if (c.defaultExpr.trim()) spec.default = c.defaultExpr.trim()
      if (c.comment.trim()) spec.comment = c.comment.trim()
      if (c.codec.trim()) spec.codec = c.codec.trim()
      return spec
    })
}

export function buildCreateIndexes(indexes: DesignIndexDraft[]): ClickHouseDesignIndexSpec[] {
  return indexes
    .filter((i) => !i.removed && i.name.trim() && i.expression.trim())
    .map((i) => {
      const spec: ClickHouseDesignIndexSpec = {
        name: i.name.trim(),
        expression: i.expression.trim(),
        type: i.type.trim() || 'minmax',
      }
      if (i.granularity > 0) spec.granularity = i.granularity
      return spec
    })
}

export function buildAlterDesignOps(
  orig: DesignColumnDraft[],
  current: DesignColumnDraft[],
  origComment: string,
  comment: string,
  origOrderBy = '',
  orderBy = '',
  origIndexes: DesignIndexDraft[] = [],
  currentIndexes: DesignIndexDraft[] = [],
): ClickHouseDesignOp[] {
  const ops: ClickHouseDesignOp[] = []
  const origByKey = new Map(orig.map((c) => [c.__rowKey, c]))
  const currentActive = current.filter((c) => !c.removed)

  for (const c of current) {
    if (!c.removed) continue
    if (c.originalName) {
      ops.push({ op: 'drop_column', name: c.originalName })
    }
  }

  for (const c of currentActive) {
    const prev = origByKey.get(c.__rowKey)
    if (!prev || !c.originalName) {
      if (!c.name.trim()) continue
      const op: ClickHouseDesignOp = {
        op: 'add_column',
        name: c.name.trim(),
        dataType: c.dataType.trim() || syncColumnDataType(c) || 'String',
      }
      if (c.defaultExpr.trim()) op.default = c.defaultExpr.trim()
      if (c.comment.trim()) op.comment = c.comment.trim()
      ops.push(op)
      continue
    }

    const newName = c.name.trim()
    if (newName && newName !== prev.originalName) {
      ops.push({ op: 'rename_column', name: prev.originalName, newName })
    }

    const typeChanged = (c.dataType.trim() || 'String') !== (prev.dataType.trim() || 'String')
    const defaultChanged = c.defaultExpr.trim() !== prev.defaultExpr.trim()
    const commentChanged = c.comment.trim() !== prev.comment.trim()
    if (typeChanged || defaultChanged || commentChanged) {
      const op: ClickHouseDesignOp = {
        op: 'modify_column',
        name: newName || prev.originalName,
        dataType: c.dataType.trim() || syncColumnDataType(c) || 'String',
      }
      if (c.defaultExpr.trim()) op.default = c.defaultExpr.trim()
      else if (defaultChanged) op.default = ''
      if (c.comment.trim()) op.comment = c.comment.trim()
      ops.push(op)
    }
  }

  if (comment.trim() !== origComment.trim()) {
    ops.push({ op: 'set_table_comment', comment: comment.trim() })
  }

  if (orderBy.trim() !== origOrderBy.trim() && orderBy.trim()) {
    ops.push({ op: 'set_order_by', expression: orderBy.trim() })
  }

  const origIdxByKey = new Map(origIndexes.map((i) => [i.__rowKey, i]))
  for (const idx of currentIndexes) {
    if (!idx.removed) continue
    if (idx.originalName) {
      ops.push({ op: 'drop_index', name: idx.originalName })
    }
  }

  for (const idx of currentIndexes.filter((i) => !i.removed)) {
    const prev = origIdxByKey.get(idx.__rowKey)
    const name = idx.name.trim()
    const expression = idx.expression.trim()
    const type = idx.type.trim() || 'minmax'
    if (!name || !expression) continue

    if (prev?.originalName) {
      const changed =
        name !== prev.originalName
        || expression !== prev.expression.trim()
        || type !== (prev.type.trim() || 'minmax')
        || idx.granularity !== prev.granularity
      if (!changed) continue
      ops.push({ op: 'drop_index', name: prev.originalName })
    }

    const op: ClickHouseDesignOp = {
      op: 'add_index',
      name,
      expression,
      type,
    }
    if (idx.granularity > 0) op.granularity = idx.granularity
    ops.push(op)
  }

  return ops
}

export function ensureAtLeastOneColumn(cols: DesignColumnDraft[]): DesignColumnDraft[] {
  if (cols.some((c) => !c.removed)) return cols
  return [
    ...cols,
    {
      __rowKey: nextDraftKey('col'),
      originalName: '',
      name: 'col1',
      dataType: 'String',
      typeBase: 'String',
      typeInner: '',
      enumValues: '',
      nullable: false,
      lowCardinality: false,
      defaultExpr: '',
      comment: '',
      codec: '',
      removed: false,
    } satisfies DesignColumnDraft,
  ]
}
