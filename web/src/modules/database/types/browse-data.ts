/** 表 / 视图数据浏览外壳文案（由方言 i18n 注入）。 */
export interface BrowseDataShellLabels {
  toolbarLabel: string
  featureLabel: string
  insert: string
  insertTooltip: string
  delete: string
  deleteTooltip: string
  import: string
  importTooltip: string
  export: string
  exportTooltip: string
  filter: string
  filterToggle: string
  refresh: string
  needTable: string
  empty: string
}

/** 浏览网格行：稳定 rowKey + 可选新建草稿标记。 */
export type BrowseDataRow = Record<string, unknown> & {
  __rowKey: string
  __rowIndex: number
  __isNew?: boolean
}
