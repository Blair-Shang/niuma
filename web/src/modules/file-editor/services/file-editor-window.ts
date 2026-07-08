import { fileEditorApi } from '@/api/file-editor'
import { subscribeBridgeEvent } from '@/api/event-bus'
import { windowApi } from '@/api/window'
import type { FileOpenSpec } from '@/api/types/file-editor'
import {
  FILE_WORKBENCH_ROUTE,
  FILE_WORKBENCH_WINDOW_TITLE,
} from '@/modules/file-editor/constants'

/** 主窗口侧缓存的工作台 Shell windowId（仅用于 focus，不代替 Platform 裁决） */
let cachedWorkbenchWindowId: number | null = null

/** 防止并发打开时重复调用 shell.window.open */
let openingWorkbench: Promise<number> | null = null

let windowCloseSubscribed = false

function ensureWindowCloseListener(): void {
  if (windowCloseSubscribed) {
    return
  }
  windowCloseSubscribed = true
  subscribeBridgeEvent((detail) => {
    if (typeof detail !== 'object' || detail === null) {
      return
    }
    const event = detail as { type?: string; windowId?: number }
    if (event.type !== 'shell.window.closed' || typeof event.windowId !== 'number') {
      return
    }
    if (cachedWorkbenchWindowId === event.windowId) {
      cachedWorkbenchWindowId = null
    }
    void fileEditorApi.unregisterWindow({ windowId: event.windowId })
  })
}

async function isWindowAlive(windowId: number): Promise<boolean> {
  const list = await windowApi.list()
  return list.windows.some((entry) => entry.id === windowId)
}

async function openFileWorkbenchShell(): Promise<number> {
  if (!openingWorkbench) {
    openingWorkbench = windowApi
      .open({
        route: FILE_WORKBENCH_ROUTE,
        title: FILE_WORKBENCH_WINDOW_TITLE,
        width: 960,
        height: 700,
        minWidth: 480,
        minHeight: 360,
        frameless: true,
        resizable: true,
      })
      .then((opened) => {
        cachedWorkbenchWindowId = opened.windowId
        return opened.windowId
      })
      .finally(() => {
        openingWorkbench = null
      })
  }
  return openingWorkbench
}

async function focusWorkbench(windowId: number): Promise<void> {
  if (!(await isWindowAlive(windowId))) {
    await fileEditorApi.unregisterWindow({ windowId })
    cachedWorkbenchWindowId = null
    const newId = await openFileWorkbenchShell()
    // 新窗口尚未 reveal，勿 focus（Shell Focus 会 Show 导致黑屏闪烁）
    cachedWorkbenchWindowId = newId
    return
  }

  cachedWorkbenchWindowId = windowId
  await windowApi.focus({ windowId })
}

/**
 * 在文件工作台中打开文件（查看 / 编辑共用同一 CEF 窗口与 Tab 管理）。
 *
 * 1. Platform `fileEditor.openTab` 协调 Tab（无窗口 → create/queue，有窗口 → append）
 * 2. create/queue → 确保仅存在一个 `/file-workbench` Shell 窗口
 * 3. append → 聚焦已有工作台并由事件 `fileEditor.tab.open` 追加 Tab
 */
export async function openInFile(spec: FileOpenSpec): Promise<void> {
  ensureWindowCloseListener()

  const result = await fileEditorApi.openTab(spec)

  if (result.action === 'create' || result.action === 'queue') {
    await openFileWorkbenchShell()
    // 首显由工作台 main.ts → reveal 统一处理，不在此 focus
    return
  }

  if (result.windowId) {
    await focusWorkbench(result.windowId)
    return
  }

  if (cachedWorkbenchWindowId) {
    await focusWorkbench(cachedWorkbenchWindowId)
  }
}

/** @deprecated 使用 openInFile；保留兼容旧调用 */
export async function openInFileEditor(spec: FileOpenSpec): Promise<void> {
  await openInFile({ ...spec, readonly: false })
}

/** @deprecated 使用 openInFile({ ...spec, readonly: true })；保留兼容旧调用 */
export async function openInFileViewer(spec: FileOpenSpec): Promise<void> {
  await openInFile({ ...spec, readonly: true })
}
