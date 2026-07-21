/**
 * 浮层 / 模态 z-index 常量，与 `styles.css` 中 `--rs-z-*` token 对齐。
 * 组件样式应使用 `z-index: var(--rs-z-*)`，禁止硬编码层级。
 */

/** 下拉 / Popover / Tooltip 浮层 */
export const RS_Z_DROPDOWN = 'var(--rs-z-dropdown)'

/** Shell 常驻面板（底部 Dock 等），须低于 modal */
export const RS_Z_PANEL = 'var(--rs-z-panel)'

/** 模态对话框 */
export const RS_Z_MODAL = 'var(--rs-z-modal)'

/** 全局 Toast */
export const RS_Z_TOAST = 'var(--rs-z-toast)'

/** 反馈语义色调（Dialog 图标等） */
export type RsFeedbackTone = 'default' | 'info' | 'success' | 'warning' | 'danger'

export type RsToastType = 'success' | 'error' | 'info' | 'warning'

export type RsToastPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'

export const RS_TOAST_DEFAULT_POSITION: RsToastPosition = 'top-center'

/** 多条 Toast 之间的垂直间距（px），传给 vue-sonner `gap` */
export const RS_TOAST_DEFAULT_GAP = 4

export const rsToastPositions = [
  'top-center',
  'top-left',
  'top-right',
  'bottom-center',
  'bottom-left',
  'bottom-right',
] as const satisfies readonly RsToastPosition[]

export function rsFeedbackIconClass(tone: RsFeedbackTone): string {
  return `rs-feedback-icon rs-feedback-icon--${tone}`
}
