import { bridgeInvoke } from '@/api/client'
import type {
  WindowActionResult,
  WindowFullscreenParams,
  WindowIdParams,
  WindowListResult,
  WindowOpenParams,
  WindowOpenResult,
  WindowSetTitleParams,
  WindowStartResizeParams,
  WindowState,
} from '@/api/types/window'

const emptyParams = {} as WindowIdParams

/** CEF 多窗口管理（`shell.window.*`） */
export const windowApi = {
  /**
   * 打开新的 CEF 顶层窗口。
   *
   * @param params - 初始 URL / 路由、尺寸与 chrome 选项
   * @returns 新窗口 id
   */
  open(params: WindowOpenParams): Promise<WindowOpenResult> {
    return bridgeInvoke<WindowOpenResult>('shell.window.open', params)
  },

  /**
   * 关闭指定或当前聚焦窗口。
   *
   * @param params - 可选 `windowId`；省略时关闭当前窗口
   * @returns 关闭是否成功
   */
  close(params: WindowIdParams = emptyParams): Promise<WindowActionResult> {
    return bridgeInvoke<WindowActionResult>('shell.window.close', params)
  },

  /**
   * 将窗口置于前台并激活。
   *
   * @param params - 可选 `windowId`；省略时使用当前聚焦窗口
   * @returns 聚焦是否成功
   */
  focus(params: WindowIdParams = emptyParams): Promise<WindowActionResult> {
    return bridgeInvoke<WindowActionResult>('shell.window.focus', params)
  },

  /**
   * 最小化窗口。
   *
   * @param params - 可选 `windowId`；省略时使用当前聚焦窗口
   * @returns 操作是否成功
   */
  minimize(params: WindowIdParams = emptyParams): Promise<WindowActionResult> {
    return bridgeInvoke<WindowActionResult>('shell.window.minimize', params)
  },

  /**
   * 最大化窗口。
   *
   * @param params - 可选 `windowId`；省略时使用当前聚焦窗口
   * @returns 操作是否成功
   */
  maximize(params: WindowIdParams = emptyParams): Promise<WindowActionResult> {
    return bridgeInvoke<WindowActionResult>('shell.window.maximize', params)
  },

  /**
   * 从最大化 / 全屏 / 最小化状态还原。
   *
   * @param params - 可选 `windowId`；省略时使用当前聚焦窗口
   * @returns 操作是否成功
   */
  restore(params: WindowIdParams = emptyParams): Promise<WindowActionResult> {
    return bridgeInvoke<WindowActionResult>('shell.window.restore', params)
  },

  /**
   * 切换窗口全屏。
   *
   * @param params - 目标窗口与 `enabled`（默认 `true` 进入全屏）
   * @returns 操作是否成功
   */
  setFullscreen(params: WindowFullscreenParams): Promise<WindowActionResult> {
    return bridgeInvoke<WindowActionResult>('shell.window.fullscreen', params)
  },

  /**
   * 查询窗口最大化 / 最小化 / 全屏状态。
   *
   * @param params - 可选 `windowId`；省略时使用当前聚焦窗口
   * @returns 当前窗口状态快照
   */
  getState(params: WindowIdParams = emptyParams): Promise<WindowState> {
    return bridgeInvoke<WindowState>('shell.window.state', params)
  },

  /**
   * 列出 Shell 管理的全部窗口。
   *
   * @returns 窗口摘要列表（含 focused / maximized 等）
   */
  list(): Promise<WindowListResult> {
    return bridgeInvoke<WindowListResult>('shell.window.list')
  },

  /**
   * 通知 Shell 显示窗口（在 Vue 首帧渲染完毕后调用，消除启动黑屏闪烁）。
   *
   * @param params - 可选 `windowId`；省略时显示当前聚焦窗口
   * @returns 操作是否成功
   */
  reveal(params: WindowIdParams = emptyParams): Promise<WindowActionResult> {
    return bridgeInvoke<WindowActionResult>('shell.window.reveal', params)
  },

  /**
   * 设置任务栏 / 系统窗口标题（无边框窗口下 Web 标题栏与任务栏可独立设置）。
   *
   * @param params - 目标窗口与标题文本
   */
  setTitle(params: WindowSetTitleParams): Promise<WindowActionResult> {
    return bridgeInvoke<WindowActionResult>('shell.window.setTitle', params)
  },

  /**
   * 从指定边缘开始拖拽缩放窗口（无边框 frameless 模式）。
   *
   * @param params - 目标窗口与边缘方向
   */
  startResize(params: WindowStartResizeParams): Promise<WindowActionResult> {
    return bridgeInvoke<WindowActionResult>('shell.window.startResize', params)
  },
} as const
