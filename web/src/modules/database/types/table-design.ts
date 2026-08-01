/** 表设计器模式：新建 / 修改 */
export type TableDesignMode = 'create' | 'alter'

/** 分节 id；方言可扩展自定义 id */
export type TableDesignSection = 'columns' | 'indexes' | 'foreignKeys' | 'checks' | (string & {})

/** 分节描述（tab 条） */
export interface TableDesignSectionItem {
  id: TableDesignSection
  label: string
  count?: number
}

/** 表设计器外壳文案（由方言 i18n 注入） */
export interface TableDesignShellLabels {
  reload: string
  preview: string
  /** create 模式主按钮 */
  create: string
  /** alter 模式主按钮 */
  apply: string
  previewTitle: string
  add?: string
  selectRow?: string
  copyPreview?: string
  openInQuery?: string
  moveUp?: string
  moveDown?: string
}
