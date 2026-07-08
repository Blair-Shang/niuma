/** 右键菜单图标尺寸（与 Dropdown / Menu 一致） */
export const RS_CONTEXT_MENU_ICON_SIZE = 16
export const RS_CONTEXT_MENU_ARROW_SIZE = 14

/** 右键菜单项定义 */
export interface RsContextMenuItem {
  /** 唯一标识，选中时回传 */
  key: string
  label: string
  icon?: string
  disabled?: boolean
  /** 危险操作样式 */
  danger?: boolean
  /** 为 true 时渲染分隔线 */
  separator?: boolean
  /** 子菜单项 */
  children?: RsContextMenuItem[]
  /** 键盘快捷键提示（仅展示，不绑定事件），如 "⌘K"、"⌃C" */
  shortcut?: string
}
