/** 对象一览外壳文案（由方言 i18n 注入；列定义仍在方言侧）。 */
export interface ObjectCatalogShellLabels {
  toolbarLabel: string
  featureLabel: string
  query: string
  queryTooltip: string
  create: string
  createTooltip: string
  refresh: string
  ddl: string
  ddlTooltip: string
  filterPlaceholder: string
  needDatabase: string
  empty: string
  emptyFilter: string
}

/** 对象一览分类标签（表 / 视图 / …）。 */
export interface ObjectCatalogCategoryTab {
  id: string
  label: string
}
