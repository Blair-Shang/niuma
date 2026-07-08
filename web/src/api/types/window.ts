/** 可选窗口 id；省略时 Shell 使用当前聚焦窗口 */
export interface WindowIdParams {
  /** Shell 内部分配的窗口 id */
  windowId?: number
}

/** `shell.window.state` Bridge 响应 */
export interface WindowState {
  /** 查询的窗口 id */
  id?: number
  /** 是否处于最大化 */
  maximized: boolean
  /** 是否处于最小化 */
  minimized: boolean
  /** 是否处于全屏 */
  fullscreen: boolean
  /** 当前窗口是否为无边框（Web 自绘 chrome） */
  frameless?: boolean
}

/** `shell.window.open` 请求参数 */
export interface WindowOpenParams {
  /** 完整加载 URL；与 `route` 二选一 */
  url?: string
  /** 应用内 hash 路由，如 `/ssh` */
  route?: string
  /** 窗口标题 */
  title?: string
  /** 初始宽度（px） */
  width?: number
  /** 初始高度（px） */
  height?: number
  /** 是否允许用户缩放 */
  resizable?: boolean
  /** 是否显示最大化按钮 */
  maximizable?: boolean
  /** 是否显示最小化按钮 */
  minimizable?: boolean
  /** 创建时是否最大化 */
  maximized?: boolean
  /** 是否无边框（Web 自绘 chrome） */
  frameless?: boolean
  /** 最小宽度（px） */
  minWidth?: number
  /** 最小高度（px） */
  minHeight?: number
}

/** `shell.window.open` Bridge 响应 */
export interface WindowOpenResult {
  /** 新创建窗口的 id */
  windowId: number
}

/** `shell.window.list` 单条窗口摘要 */
export interface WindowSummary {
  id: number
  title: string
  url: string
  /** 是否为当前聚焦窗口 */
  focused: boolean
  maximized: boolean
  minimized: boolean
  fullscreen: boolean
}

/** `shell.window.list` Bridge 响应 */
export interface WindowListResult {
  windows: WindowSummary[]
}

/** `shell.window.fullscreen` 请求参数 */
export interface WindowFullscreenParams extends WindowIdParams {
  /** `true` 进入全屏，`false` 退出；默认 `true` */
  enabled?: boolean
}

/** 窗口操作类 Bridge 方法的通用响应字段 */
export interface WindowActionResult {
  closed?: boolean
  focused?: boolean
  maximized?: boolean
  minimized?: boolean
  restored?: boolean
  fullscreen?: boolean
  revealed?: boolean
  titleSet?: boolean
  resizing?: boolean
}

/** `shell.window.setTitle` 请求参数 */
export interface WindowSetTitleParams extends WindowIdParams {
  /** 任务栏与系统窗口标题 */
  title: string
}

/** `shell.window.startResize` 请求参数 */
export interface WindowStartResizeParams extends WindowIdParams {
  /** 拖拽缩放的边缘：n/s/e/w/ne/nw/se/sw */
  edge: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
}
