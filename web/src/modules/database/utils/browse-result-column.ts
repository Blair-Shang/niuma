/**
 * 浏览结果列工厂：统一 LOB 摘要、禁编二进制、大字段 dialog 呈现。
 * 方言只补 headerTip / canEdit / 元数据长度等差异。
 */
import type { RsTableColumn } from '@niuma/ui'
import type { BrowseDataRow } from '../types/browse-data'
import {
  formatBrowseCellValue,
  isBrowseBinCell,
  isBrowseBinaryLobCell,
} from './browse-cell-format'
import {
  alignForValueType,
  isSqlBinaryLobType,
  isSqlTextLobType,
  resolveSqlValueType,
  type ResolveSqlValueTypeOptions,
} from './column-value-type'

export interface BuildBrowseResultColumnOptions {
  name: string
  dataType?: string | null
  headerTip?: string
  width?: number
  minWidth?: number
  nullable?: boolean
  /** TINYINT(1) / BIT(1) 等 */
  typeLength?: number | null
  /** 方言：Oracle DATE → datetime 等 */
  dialect?: ResolveSqlValueTypeOptions['dialect']
  /** 当前表是否允许编辑（无主键 / 视图时为 false） */
  canEdit: boolean
  /** 方言二进制单元格检测；默认认 `{ $bin }` / `{ $lob: { type: BLOB } }` */
  isBinCell?: (value: unknown) => boolean
  sortable?: boolean
  filterable?: boolean
}

/** 构造单列：BLOB 只读摘要；TEXT/JSON/CLOB → 弹窗编辑。 */
export function buildBrowseResultColumn(
  options: BuildBrowseResultColumnOptions,
): RsTableColumn<BrowseDataRow> {
  const {
    name,
    dataType,
    headerTip,
    width = 120,
    minWidth = 80,
    nullable = true,
    typeLength,
    dialect,
    canEdit,
    sortable = true,
    filterable = true,
  } = options
  const isBin = options.isBinCell ?? ((value: unknown) => isBrowseBinaryLobCell(value) || isBrowseBinCell(value))
  const resolveOpts: ResolveSqlValueTypeOptions | undefined =
    typeLength != null || dialect != null
      ? { length: typeLength, dialect }
      : undefined
  const valueType = resolveSqlValueType(dataType, resolveOpts)
  const binaryLob = isSqlBinaryLobType(dataType)
  const textLob = !binaryLob && (valueType === 'textarea' || isSqlTextLobType(dataType))

  return {
    key: name,
    title: name,
    width,
    minWidth,
    ellipsis: true,
    sortable,
    filterable,
    align: alignForValueType(valueType),
    valueType,
    headerTip,
    nullable,
    emptyAsNull: true,
    editable: (row: BrowseDataRow) => {
      if (binaryLob || isBin(row[name])) return false
      if (row.__isNew) return true
      return canEdit
    },
    editorOptions: textLob ? { presentation: 'dialog', rows: 16 } : undefined,
    formatter:
      valueType === 'boolean' ? undefined : (value) => formatBrowseCellValue(value, valueType),
  }
}

export type BrowseRowChange = {
  colKey: string
  value: unknown
  previous: unknown
}
