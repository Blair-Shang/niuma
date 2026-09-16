import type { RsButtonTone } from '@niuma/ui'

/** IDE 顶栏只读身份段（库、集合、schema 等）。 */
export interface SqlIdeToolbarIdentityPart {
  text: string
  icon?: string
  title?: string
}

/** IDE 顶栏图标按钮：直接 v-bind 到 RsButton，不要再包一层组件。 */
export const sqlIdeToolbarIconButton = {
  type: 'button',
  variant: 'text',
  size: 'sm',
  radius: 'sm',
  iconOnly: true,
} as const

/** SqlIdeToolbar 图标按钮：业务侧只声明，由工具条统一渲染。 */
export interface SqlIdeToolbarAction {
  key: string
  icon: string
  /** 悬浮提示；无 label 时同时作为无障碍名称 */
  title: string
  /** 显示在图标右侧的文案；不传则仅图标 */
  label?: string
  disabled?: boolean
  loading?: boolean
  /** RsButton 语义色：执行 success、停止 danger，默认中性 */
  tone?: RsButtonTone
  /** 默认 lead（身份右侧）；trail 靠右 */
  align?: 'lead' | 'trail'
}

/** SqlIdeToolbar 分隔线。 */
export interface SqlIdeToolbarSep {
  key: string
  sep: true
  align?: 'lead' | 'trail'
}

/** 顶栏分段选项（编辑模式等）。 */
export interface SqlIdeToolbarModeOption {
  key: string
  label: string
}

/** SqlIdeToolbar 分段切换，默认靠右。 */
export interface SqlIdeToolbarModes {
  key: string
  kind: 'modes'
  label: string
  value: string
  options: SqlIdeToolbarModeOption[]
  align?: 'lead' | 'trail'
}

/** SqlIdeToolbar 过滤输入，默认靠右、图标 search。 */
export interface SqlIdeToolbarFilter {
  key: string
  kind: 'filter'
  value: string
  placeholder?: string
  icon?: string
  disabled?: boolean
  align?: 'lead' | 'trail'
}

export type SqlIdeToolbarItem =
  | SqlIdeToolbarAction
  | SqlIdeToolbarSep
  | SqlIdeToolbarModes
  | SqlIdeToolbarFilter

/** 是否为工具条分隔项。 */
export function isSqlIdeToolbarSep(item: SqlIdeToolbarItem): item is SqlIdeToolbarSep {
  return 'sep' in item && item.sep === true
}

/** 是否为分段切换项。 */
export function isSqlIdeToolbarModes(item: SqlIdeToolbarItem): item is SqlIdeToolbarModes {
  return 'kind' in item && item.kind === 'modes'
}

/** 是否为过滤输入项。 */
export function isSqlIdeToolbarFilter(item: SqlIdeToolbarItem): item is SqlIdeToolbarFilter {
  return 'kind' in item && item.kind === 'filter'
}

/** 是否为图标按钮。 */
export function isSqlIdeToolbarAction(item: SqlIdeToolbarItem): item is SqlIdeToolbarAction {
  return (
    !isSqlIdeToolbarSep(item) &&
    !isSqlIdeToolbarModes(item) &&
    !isSqlIdeToolbarFilter(item)
  )
}
