/** 对象脚本模式：新建 / 编辑（视图、过程、函数等） */
export type ObjectScriptMode = 'create' | 'alter'

/** 底部状态条语气 */
export type ObjectScriptMessageTone = 'ok' | 'error'

/** 对象脚本外壳文案（由方言 i18n 注入） */
export interface ObjectScriptShellLabels {
  format: string
  formatTooltip: string
  copy: string
  refresh: string
  /** create 模式主按钮 */
  create: string
  /** alter 模式主按钮 */
  save: string
  needObject: string
  modeCreate: string
}

/** 对象脚本右键菜单文案（对齐查询面板常用项 + AI） */
export interface ObjectScriptContextMenuLabels {
  apply: string
  applySelection?: string
  format: string
  compress: string
  copy: string
  paste: string
  askAi?: string
}
