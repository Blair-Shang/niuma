import { computed, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useDataTaskHubStore } from '@/stores/data-task-hub'
import { useShellStore } from '@/stores/shell'

/**
 * 数据任务浮动窗 / Dock 呈现共用状态。
 * 方言 Dialog 只需接 taskId + presentation，不必重复 float 防抖与 dockReady。
 */
export function useDataTransferPresentation(options: {
  taskId: Ref<string> | (() => string)
  presentation: Ref<'float' | 'inline'> | (() => 'float' | 'inline')
  activeInDock: Ref<boolean> | (() => boolean)
}) {
  const hub = useDataTaskHubStore()
  const shell = useShellStore()
  const { tasks } = storeToRefs(hub)

  function readTaskId(): string {
    return typeof options.taskId === 'function' ? options.taskId() : options.taskId.value
  }
  function readPresentation(): 'float' | 'inline' {
    return typeof options.presentation === 'function'
      ? options.presentation()
      : options.presentation.value
  }
  function readActiveInDock(): boolean {
    return typeof options.activeInDock === 'function'
      ? options.activeInDock()
      : options.activeInDock.value
  }

  const task = computed(() => tasks.value.find((item) => item.id === readTaskId()))
  const isInline = computed(() => readPresentation() === 'inline')
  const floatOpen = computed(() => !!task.value && task.value.surface === 'float')
  const busy = computed(() => task.value?.busy ?? false)

  /**
   * 挂载点由 BottomDock 用 v-show 保活，折叠时不必卸 Teleport。
   * 仅在切到「数据任务」页签时挂入，避免与 FTP 传输页抢同一 DOM。
   */
  const dockReady = computed(() => shell.bottomDockTab === 'dataTasks')

  let floatShownAt = 0
  watch(floatOpen, (visible) => {
    if (visible) floatShownAt = Date.now()
  })

  function onFloatOpenUpdate(next: boolean): void {
    if (next) return
    const current = task.value
    if (!current || current.busy || current.surface !== 'float') return
    if (Date.now() - floatShownAt < 120) return
    hub.close(readTaskId())
  }

  function onClose(): void {
    if (busy.value) return
    hub.close(readTaskId())
  }

  function onDock(): void {
    hub.dockTask(readTaskId())
  }

  function onPopOut(): void {
    hub.popOutTask(readTaskId())
  }

  return {
    hub,
    task,
    isInline,
    floatOpen,
    busy,
    dockReady,
    activeInDock: computed(() => readActiveInDock()),
    onFloatOpenUpdate,
    onClose,
    onDock,
    onPopOut,
  }
}
