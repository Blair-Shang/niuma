import { bridgeInvoke } from '@/api/client'
import type {
  FileEditorOpenTabResult,
  FileEditorRegisterWindowParams,
  FileEditorRegisterWindowResult,
  FileEditorUnregisterWindowParams,
  FileOpenSpec,
} from '@/api/types/file-editor'

/** Platform 文件工作台跨窗口协调（`platform.fileEditor.*`，进程内内存，不持久化） */
export const fileEditorApi = {
  /** 请求在工作台中打开文件；无窗口时返回 create，否则 append 并推送事件 */
  openTab(spec: FileOpenSpec): Promise<FileEditorOpenTabResult> {
    return bridgeInvoke<FileEditorOpenTabResult>('platform.fileEditor.openTab', spec)
  },

  /** 工作台窗口挂载时注册 Shell windowId，并拉取待打开队列 */
  registerWindow(params: FileEditorRegisterWindowParams): Promise<FileEditorRegisterWindowResult> {
    return bridgeInvoke<FileEditorRegisterWindowResult>(
      'platform.fileEditor.registerWindow',
      params,
    )
  },

  /** 工作台窗口关闭时注销 */
  unregisterWindow(
    params: FileEditorUnregisterWindowParams = {},
  ): Promise<{ unregistered: boolean }> {
    return bridgeInvoke<{ unregistered: boolean }>('platform.fileEditor.unregisterWindow', params)
  },
} as const
