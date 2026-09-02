/**
 * 工作区页签拖入 AI 面板：变成 Composer @ 引用。
 * 与 context-pack / ai store 分开，避免循环依赖。
 */
import { useAiStore } from '@/stores/ai'
import { useTabStore } from '@/stores/tab'
import { draggingTabId, endTabDrag, isNiumaTabDrag, NIUMA_TAB_MIME } from '@/shell/workspace/tab-dnd'
import { attachmentFromTab } from './context-pack'

/** 把拖入的工作区页签变成 Composer @ 引用；成功则结束页签拖拽。 */
export function acceptDroppedTab(event: DragEvent): boolean {
  if (!isNiumaTabDrag(event)) {
    return false
  }
  const fromMime = event.dataTransfer?.getData(NIUMA_TAB_MIME)?.trim()
  const tabId = draggingTabId.value || fromMime || ''
  if (!tabId) {
    return false
  }
  const tab = useTabStore().allTabs.find((item) => item.tabId === tabId)
  if (!tab) {
    endTabDrag()
    return false
  }
  useAiStore().queueComposerAttachments([attachmentFromTab(tab)])
  endTabDrag()
  return true
}
