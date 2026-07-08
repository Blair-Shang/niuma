/**
 * 浮层 / 模态 z-index 常量，与 `styles.css` 中 `--rs-z-*` token 对齐。
 * 组件样式应使用 `z-index: var(--rs-z-*)`，禁止硬编码层级。
 */

/** 下拉 / Popover / Tooltip 浮层 */
export const RS_Z_DROPDOWN = 'var(--rs-z-dropdown)'

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
