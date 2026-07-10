import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useTabStore, type EditorGroup, type WorkspaceTab } from '@/stores/tab'
import { publishTerminalSync, subscribeTerminalSync } from '@/modules/ssh/composables/terminalSyncBus'
import { createId } from '@/utils/id'

type TerminalGroupExpose = {
  sendInput: (data: string) => Promise<void>
}

function collectWorkspaceSshSessionTabs(groups: readonly EditorGroup[]): WorkspaceTab[] {
  const out: WorkspaceTab[] = []
  for (const group of groups) {
    for (const tab of group.tabs) {
      if (tab.moduleId === 'ssh' && tab.props.profileId) {
        out.push(tab)
      }
    }
  }
  return out
}

function findWorkspaceSyncGroupId(groups: readonly EditorGroup[]): string | undefined {
  for (const tab of collectWorkspaceSshSessionTabs(groups)) {
    const gid = tab.props.terminalSyncGroupId
    if (typeof gid === 'string' && gid.length > 0) {
      return gid
    }
  }
  return undefined
}

/**
 * 跨编辑组 SSH 分屏的终端输入同步：同工作区内所有 SSH 会话 Tab 共享一个 syncGroupId。
 */
export function useSshTerminalSync(options: {
  terminalSyncGroupId: Ref<string | undefined>
  terminalGroupRef: Ref<TerminalGroupExpose | null>
}) {
  const tabStore = useTabStore()
  const terminalSyncEnabled = ref(Boolean(options.terminalSyncGroupId.value))
  const terminalInstanceId = createId()
  let offTerminalSync: (() => void) | null = null

  const effectiveSyncGroupId = computed(
    () => options.terminalSyncGroupId.value ?? findWorkspaceSyncGroupId(tabStore.groups),
  )

  function propagateSyncGroupId(groupId: string): void {
    for (const tab of collectWorkspaceSshSessionTabs(tabStore.groups)) {
      if (tab.props.terminalSyncGroupId !== groupId) {
        tabStore.updateTabProps(tab.tabId, { terminalSyncGroupId: groupId })
      }
    }
  }

  function ensureTerminalSyncGroup(): string {
    const groupId = effectiveSyncGroupId.value ?? createId()
    propagateSyncGroupId(groupId)
    return groupId
  }

  watch(
    effectiveSyncGroupId,
    (groupId) => {
      offTerminalSync?.()
      offTerminalSync = null
      if (!groupId) {
        return
      }
      offTerminalSync = subscribeTerminalSync(groupId, (event) => {
        if (event.sourceInstanceId === terminalInstanceId) return
        if (!terminalSyncEnabled.value) return
        options.terminalGroupRef.value?.sendInput(event.data).catch(() => undefined)
      })
    },
    { immediate: true },
  )

  watch(
    terminalSyncEnabled,
    (enabled) => {
      if (!enabled) return
      ensureTerminalSyncGroup()
    },
    { immediate: true },
  )

  function onTerminalBroadcastInput(data: string): void {
    if (!terminalSyncEnabled.value || !data) return
    const groupId = effectiveSyncGroupId.value ?? ensureTerminalSyncGroup()
    publishTerminalSync({
      syncGroupId: groupId,
      sourceInstanceId: terminalInstanceId,
      data,
    })
  }

  onBeforeUnmount(() => {
    offTerminalSync?.()
    offTerminalSync = null
  })

  return {
    terminalSyncEnabled,
    effectiveSyncGroupId,
    ensureTerminalSyncGroup,
    onTerminalBroadcastInput,
  }
}
