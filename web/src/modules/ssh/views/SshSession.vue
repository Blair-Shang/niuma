<script setup lang="ts">
import {
  RsButton,
  RsConfirmDialog,
  RsDialog,
  RsIcon,
  RsInput,
  RsSelect,
  RsLoading,
  RsSplitPane,
  expandSplitPane,
  resolveSplitConstraints,
  useRsToast,
  type RsSplitPaneItem,
  type RsSelectOptions,
} from '@niuma/ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi, dialogApi, fsApi, sshApi } from '@/api'
import type { ConnectionProfile } from '@/api/types/ftp'
import type { SshSftpEntry } from '@/api/types/ssh'
import { openInFile } from '@/modules/file-editor'
import FtpFilePane from '@/modules/ftp/components/FtpFilePane.vue'
import type { FtpPaneEntry } from '@/modules/ftp/composables/useFtpPaneList'
import { useSshTransfer } from '@/modules/ssh/composables/useSshTransfer'
import SshMonitorPane from '@/modules/ssh/components/SshMonitorPane.vue'
import SshTerminalGroup from '@/modules/ssh/components/SshTerminalGroup.vue'
import { useSessionActionStore } from '@/stores/session-actions'
import { useShellStore } from '@/stores/shell'
import { useTransferHubStore } from '@/stores/transfer-hub'
import { useTabStore } from '@/stores/tab'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import { publishTerminalSync, subscribeTerminalSync } from '@/modules/ssh/composables/terminalSyncBus'

const props = defineProps<{
  profileId: string
  /** A/B/C/D 分屏多主机：所有分屏共享的终端同步组 id */
  terminalSyncGroupId?: string
  /** A/B/C/D 槽位标识（仅用于展示与排除自身同步回环） */
  terminalSyncSlot?: 'A' | 'B' | 'C' | 'D'
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessionActionStore = useSessionActionStore()
const transferHub = useTransferHubStore()
const shellStore = useShellStore()
const tabStore = useTabStore()
const sshProfiles = useConnectionProfiles(['ssh'])

// ── 输入 / 确认对话框 ─────────────────────────────────────────────────
const promptOpen = ref(false)
const promptTitle = ref('')
const promptPlaceholder = ref('')
const promptValue = ref('')
const promptInputRef = ref<InstanceType<typeof RsInput> | null>(null)
let resolvePrompt: ((v: string | null) => void) | null = null

const confirmOpen = ref(false)
const confirmDesc = ref('')
let resolveConfirm: ((v: boolean) => void) | null = null

function showPrompt(title: string, placeholder: string, defaultValue = ''): Promise<string | null> {
  promptTitle.value = title
  promptPlaceholder.value = placeholder
  promptValue.value = defaultValue
  promptOpen.value = true
  return new Promise((resolve) => { resolvePrompt = resolve })
}

function showConfirm(desc: string): Promise<boolean> {
  confirmDesc.value = desc
  confirmOpen.value = true
  return new Promise((resolve) => { resolveConfirm = resolve })
}

watch(promptOpen, async (open) => {
  if (open) {
    await nextTick()
    await nextTick()
    ;(promptInputRef.value as { $el?: HTMLElement } | null)?.$el
      ?.querySelector('input')
      ?.focus()
  } else if (resolvePrompt) {
    resolvePrompt(null)
    resolvePrompt = null
  }
})

watch(confirmOpen, (open) => {
  if (!open && resolveConfirm) {
    resolveConfirm(false)
    resolveConfirm = null
  }
})

function onPromptConfirm(): void {
  const v = promptValue.value.trim()
  if (!v) {
    return
  }
  promptOpen.value = false
  resolvePrompt?.(v)
  resolvePrompt = null
}

function onPromptCancel(): void {
  promptOpen.value = false
  resolvePrompt?.(null)
  resolvePrompt = null
}

function onConfirmOk(): void {
  confirmOpen.value = false
  resolveConfirm?.(true)
  resolveConfirm = null
}

function onConfirmCancel(): void {
  confirmOpen.value = false
  resolveConfirm?.(false)
  resolveConfirm = null
}

interface TransferPlanItem {
  name: string
  localPath: string
  remotePath: string
}

const profile = ref<ConnectionProfile | null>(null)
const sessionId = ref<string | null>(null)

const { enqueue: enqueueTransfer, refresh: refreshTransfers } = useSshTransfer(sessionId)

const remotePath = ref('.')
const entries = ref<SshSftpEntry[]>([])
const connecting = ref(true)
const loadingFiles = ref(false)
const error = ref<string | null>(null)

const remotePaneRef = ref<InstanceType<typeof FtpFilePane> | null>(null)
const terminalGroupRef = ref<InstanceType<typeof SshTerminalGroup> | null>(null)
const sftpSplitRef = ref<InstanceType<typeof RsSplitPane> | null>(null)
const sftpHeadRef = ref<HTMLElement | null>(null)

// ── 分屏（终端 PTY 分屏）──────────────────────────────────────────────
const TERMINAL_MAX_PANES = 1
const terminalPaneCount = ref(1)
const terminalSyncEnabled = ref(false)

const terminalInstanceId = crypto.randomUUID()
let offTerminalSync: (() => void) | null = null

watch(
  () => props.terminalSyncGroupId,
  (groupId) => {
    offTerminalSync?.()
    offTerminalSync = null
    if (!groupId) {
      terminalSyncEnabled.value = false
      return
    }
    offTerminalSync = subscribeTerminalSync(groupId, (event) => {
      if (event.sourceInstanceId === terminalInstanceId) return
      if (!terminalSyncEnabled.value) return
      terminalGroupRef.value?.sendInput(event.data).catch(() => undefined)
    })
  },
  { immediate: true },
)

function onTerminalBroadcastInput(data: string): void {
  const groupId = props.terminalSyncGroupId
  if (!groupId) return
  if (!terminalSyncEnabled.value) return
  publishTerminalSync({
    syncGroupId: groupId,
    sourceInstanceId: terminalInstanceId,
    data,
  })
}

// ── A/B/C/D 多主机（仅在 A 入口 Tab 展示）──────────────────────────────
const slotBProfileId = ref<string>('')
const slotCProfileId = ref<string>('')
const slotDProfileId = ref<string>('')

function normalizeProfileId(v: string): string | null {
  return v.trim() ? v : null
}

const abcdSelectedCount = computed(() => {
  return [slotBProfileId.value, slotCProfileId.value, slotDProfileId.value].reduce((acc, v) => {
    return acc + (normalizeProfileId(v) ? 1 : 0)
  }, 0)
})

const sshProfileSelectOptions = computed<RsSelectOptions>(() => {
  const list = sshProfiles.allProfiles
  const opts: Array<{ label: string; value: string }> = []
  for (const p of list) {
    opts.push({ label: p.profileName, value: p.profileId })
  }
  return [{ label: '未选择', value: '' }, ...opts]
})

function sshProfileName(profileId: string): string {
  const p = sshProfiles.allProfiles.find((x) => x.profileId === profileId)
  return p?.profileName ?? profileId
}

function applyAbcdSplit(): void {
  // 仅允许在“非多主机模式”的 A 入口发起
  if (props.terminalSyncGroupId) return
  if (props.terminalSyncSlot && props.terminalSyncSlot !== 'A') return

  const srcTab = tabStore.activeTab
  if (!srcTab || srcTab.moduleId !== 'ssh') return

  const b = normalizeProfileId(slotBProfileId.value)
  const c = normalizeProfileId(slotCProfileId.value)
  const d = normalizeProfileId(slotDProfileId.value)
  const selected = [
    { slot: 'B' as const, profileId: b },
    { slot: 'C' as const, profileId: c },
    { slot: 'D' as const, profileId: d },
  ].filter((x) => x.profileId)

  if (selected.length === 0) return

  const syncGroupId = crypto.randomUUID()

  // A 当前 Tab 打标签（让它成为组内 A，并开启“终端同步”入口）
  tabStore.updateTabProps(srcTab.tabId, {
    terminalSyncGroupId: syncGroupId,
    terminalSyncSlot: 'A',
  })
  tabStore.updateTitle(srcTab.tabId, `A ${profile.value?.profileName ?? srcTab.title ?? props.profileId}`)

  // 从源组复制 A Tab；每次 split 都在 A 所在组上取 activeTab
  const sourceGroupId = tabStore.groups.find((g) => g.tabs.some((t) => t.tabId === srcTab.tabId))?.groupId
  if (!sourceGroupId) return

  for (const item of selected) {
    tabStore.splitGroup(sourceGroupId)
    const copyTab = tabStore.activeTab
    if (!copyTab || copyTab.moduleId !== 'ssh') continue

    tabStore.updateTabProps(copyTab.tabId, {
      profileId: item.profileId as string,
      terminalSyncGroupId: syncGroupId,
      terminalSyncSlot: item.slot,
    })
    tabStore.updateTitle(copyTab.tabId, `${item.slot} ${sshProfileName(item.profileId as string)}`)
  }
}

/** SFTP 区域当前活动 Tab */
const sftpActiveTab = ref<'files' | 'monitor'>('files')

function onSftpTabClick(tab: 'files' | 'monitor'): void {
  sftpActiveTab.value = tab
  if (sftpUiCollapsed.value) {
    toggleSftpCollapse()
  }
}

/** SFTP 折叠后仅保留工具栏高度 */
const SFTP_COLLAPSED_PCT = 2

const splitPanes = computed((): RsSplitPaneItem[] => [
  { key: 'terminal', min: 28 },
  {
    key: 'files',
    size: 22,
    min: SFTP_COLLAPSED_PCT,
    max: 55,
    collapsible: true,
    collapsedSize: SFTP_COLLAPSED_PCT,
  },
])

const sftpSplitSizes = ref([88, 12])
const sftpUiCollapsed = ref(true)

const sftpConstraints = computed(() => resolveSplitConstraints(splitPanes.value))

const remotePaneEntries = computed(() => entries.value)

function roundSplitPct(value: number): number {
  return Math.round(value * 10000) / 10000
}

function measureSftpHeaderPx(): number {
  const head = sftpHeadRef.value
  return head?.offsetHeight ?? 32
}

function snapSftpPaneToHeader(): void {
  const splitEl = sftpSplitRef.value?.$el as HTMLElement | undefined
  if (!splitEl || splitEl.offsetHeight <= 0) {
    return
  }
  const pct = roundSplitPct(
    Math.min(
      sftpConstraints.value[1]?.max ?? 55,
      Math.max(SFTP_COLLAPSED_PCT, (measureSftpHeaderPx() / splitEl.offsetHeight) * 100),
    ),
  )
  sftpSplitSizes.value = [roundSplitPct(100 - pct), pct]
}

function toggleSftpCollapse(): void {
  if (sftpUiCollapsed.value) {
    sftpUiCollapsed.value = false
    sftpSplitSizes.value = expandSplitPane(sftpSplitSizes.value, sftpConstraints.value, 1, 28)
    void nextTick(() => terminalGroupRef.value?.refreshSize())
    return
  }
  sftpUiCollapsed.value = true
  void nextTick(() => {
    snapSftpPaneToHeader()
    terminalGroupRef.value?.refreshSize()
  })
}

function onSftpSplitCollapse(key: string): void {
  if (key !== 'files') {
    return
  }
  sftpUiCollapsed.value = true
  void nextTick(() => {
    snapSftpPaneToHeader()
    terminalGroupRef.value?.refreshSize()
  })
}

function onSftpSplitExpand(key: string): void {
  if (key === 'files') {
    sftpUiCollapsed.value = false
    void nextTick(() => terminalGroupRef.value?.refreshSize())
  }
}

function onSftpResizeEnd(sizes: number[]): void {
  const filesPct = sizes[1]
  if (filesPct === undefined) {
    return
  }
  const splitEl = sftpSplitRef.value?.$el as HTMLElement | undefined
  if (!splitEl || splitEl.offsetHeight <= 0) {
    return
  }
  const toolbarPct = (measureSftpHeaderPx() / splitEl.offsetHeight) * 100
  if (filesPct <= toolbarPct * 1.2) {
    sftpUiCollapsed.value = true
    snapSftpPaneToHeader()
  } else if (filesPct > toolbarPct * 1.6) {
    sftpUiCollapsed.value = false
  }
  terminalGroupRef.value?.refreshSize()
}

function joinRemotePath(base: string, name: string): string {
  if (base === '/' || base === '') {
    return `/${name}`
  }
  if (base === '.') {
    return name
  }
  return `${base.replace(/\/$/, '')}/${name}`
}

function parentRemotePath(path: string): string {
  if (path === '/' || path === '' || path === '.') {
    return '.'
  }
  const normalized = path.replace(/\/$/, '')
  const parts = normalized.split('/').filter(Boolean)
  parts.pop()
  if (path.startsWith('/')) {
    return parts.length ? `/${parts.join('/')}` : '/'
  }
  return parts.length ? parts.join('/') : '.'
}

function sessionLabel(): string {
  const p = profile.value
  if (!p) {
    return 'SSH'
  }
  return p.profileName || p.hostAddress || 'SSH'
}

async function loadProfile(): Promise<void> {
  const result = await connectionApi.get({ profileId: props.profileId })
  profile.value = result.profile
}

async function openSession(): Promise<void> {
  connecting.value = true
  error.value = null
  try {
    const result = await sshApi.sessionOpen({ profileId: props.profileId })
    sessionId.value = result.sessionId
    transferHub.registerSession({
      sessionId: result.sessionId,
      provider: 'ssh',
      label: sessionLabel(),
    })
    await refreshRemote()
    await refreshTransfers()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.ssh.session.connectError')
    toast.error(error.value)
  } finally {
    connecting.value = false
  }
}

async function reconnect(): Promise<void> {
  await closeSession()
  await openSession()
}

async function closeSession(): Promise<void> {
  const id = sessionId.value
  if (!id) {
    return
  }
  transferHub.unregisterSession(id)
  try {
    await sshApi.sessionClose({ sessionId: id })
  } catch {
    // 关闭失败不阻断卸载
  }
  sessionId.value = null
}

async function refreshRemote(): Promise<void> {
  if (!sessionId.value) {
    return
  }
  loadingFiles.value = true
  error.value = null
  try {
    const result = await sshApi.sftpDirList({
      sessionId: sessionId.value,
      path: remotePath.value,
    })
    remotePath.value = result.path || remotePath.value
    entries.value = result.entries ?? []
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.ssh.session.listError')
    toast.error(error.value)
  } finally {
    loadingFiles.value = false
  }
}

function navigateRemote(path: string): void {
  remotePath.value = path
  remotePaneRef.value?.resetOnNavigate()
  void refreshRemote()
}

function goRemoteUp(): void {
  navigateRemote(parentRemotePath(remotePath.value))
}

async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path)
    toast.success(t('modules.ftp.session.pathCopied'))
  } catch {
    toast.error(t('modules.ftp.session.copyPathError'))
  }
}

function onRemoteOpen(entry: FtpPaneEntry): void {
  if (entry.kind === 'dir') {
    navigateRemote(joinRemotePath(remotePath.value, entry.name))
    return
  }
  void onRemoteOpenInEditor(entry)
}

function onRemoteCopyPath(name: string): void {
  void copyPath(joinRemotePath(remotePath.value, name))
}

async function onRemoteOpenInEditor(entry: FtpPaneEntry): Promise<void> {
  if (entry.kind !== 'file' || !sessionId.value) {
    return
  }
  await openInFile({
    provider: 'ssh-sftp',
    label: entry.name,
    readonly: false,
    context: {
      sessionId: sessionId.value,
      path: joinRemotePath(remotePath.value, entry.name),
    },
  })
}

function joinLocalDefault(baseDir: string, name: string): string {
  const sep = baseDir.includes('\\') ? '\\' : '/'
  return baseDir.endsWith(sep) ? `${baseDir}${name}` : `${baseDir}${sep}${name}`
}

function planDownloadItems(paneEntries: FtpPaneEntry[]): TransferPlanItem[] {
  return paneEntries
    .filter((entry) => entry.kind !== 'link')
    .map((entry) => ({
      name: entry.name,
      localPath: '',
      remotePath: joinRemotePath(remotePath.value, entry.name),
    }))
}

async function resolveDownloadLocalPath(name: string): Promise<string | null> {
  const home = await fsApi.homeDir()
  const result = await dialogApi.saveFile({
    title: t('modules.ftp.session.download'),
    defaultPath: joinLocalDefault(home.path, name),
  })
  if (result.canceled || !result.filePaths[0]) {
    return null
  }
  return result.filePaths[0]
}

async function resolveUploadLocalPaths(multiple = false): Promise<string[]> {
  const home = await fsApi.homeDir()
  const result = await dialogApi.openFile({
    title: t('modules.ftp.session.upload'),
    defaultPath: home.path,
    multiple,
  })
  if (result.canceled || !result.filePaths.length) {
    return []
  }
  return result.filePaths
}

function localBaseName(localPath: string): string {
  const normalized = localPath.replaceAll('\\', '/')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

async function enqueueUploadPaths(localPaths: string[], remoteDir: string): Promise<void> {
  if (!sessionId.value || localPaths.length === 0) {
    return
  }
  try {
    for (const localPath of localPaths) {
      await enqueueTransfer({
        direction: 'upload',
        localPath,
        remotePath: joinRemotePath(remoteDir, localBaseName(localPath)),
        overwrite: 'overwrite',
      })
    }
    await transferHub.refreshSession(sessionId.value)
    shellStore.openBottomDock('transfers')
    toast.success(t('modules.ftp.session.transferQueued'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.transferError'))
  }
}

async function uploadToCurrentDir(): Promise<void> {
  const localPaths = await resolveUploadLocalPaths(true)
  await enqueueUploadPaths(localPaths, remotePath.value)
}

async function uploadFolderToCurrentDir(): Promise<void> {
  const result = await dialogApi.openFolder({
    title: t('modules.ftp.session.uploadFolder'),
  })
  if (result.canceled || !result.filePaths[0]) {
    return
  }
  await enqueueUploadPaths([result.filePaths[0]], remotePath.value)
}

async function enqueueTransferItems(
  direction: 'upload' | 'download',
  items: TransferPlanItem[],
): Promise<void> {
  if (!sessionId.value || items.length === 0) {
    return
  }
  try {
    for (const item of items) {
      let localPath = item.localPath
      if (direction === 'download') {
        const picked = await resolveDownloadLocalPath(item.name)
        if (!picked) {
          return
        }
        localPath = picked
      }
      await enqueueTransfer({
        direction,
        localPath,
        remotePath: item.remotePath,
        overwrite: 'overwrite',
      })
    }
    await transferHub.refreshSession(sessionId.value)
    shellStore.openBottomDock('transfers')
    toast.success(t('modules.ftp.session.transferQueued'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.transferError'))
  }
}

async function enqueueDownloadEntry(entry: FtpPaneEntry): Promise<void> {
  await enqueueTransferItems('download', planDownloadItems([entry]))
}

async function batchDownload(entriesToDownload: FtpPaneEntry[]): Promise<void> {
  await enqueueTransferItems('download', planDownloadItems(entriesToDownload))
}

async function enqueueUploadEntry(entry: FtpPaneEntry): Promise<void> {
  if (entry.kind === 'dir') {
    const localPaths = await resolveUploadLocalPaths(true)
    await enqueueUploadPaths(localPaths, joinRemotePath(remotePath.value, entry.name))
    return
  }
  const localPaths = await resolveUploadLocalPaths(false)
  if (!localPaths[0] || !sessionId.value) {
    return
  }
  try {
    await enqueueTransfer({
      direction: 'upload',
      localPath: localPaths[0],
      remotePath: joinRemotePath(remotePath.value, entry.name),
      overwrite: 'overwrite',
    })
    await transferHub.refreshSession(sessionId.value)
    shellStore.openBottomDock('transfers')
    toast.success(t('modules.ftp.session.transferQueued'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.transferError'))
  }
}

async function deleteRemoteEntries(items: FtpPaneEntry[]): Promise<void> {
  if (!sessionId.value || !items.length) {
    return
  }
  let msg: string
  if (items.length > 1) {
    msg = t('modules.ftp.session.deleteSelectedConfirm', { count: items.length })
  } else if (items[0]!.kind === 'dir') {
    msg = t('modules.ftp.session.deleteDirConfirm', { name: items[0]!.name })
  } else {
    msg = t('modules.ftp.session.deleteConfirm', { name: items[0]!.name })
  }
  if (!(await showConfirm(msg))) {
    return
  }
  loadingFiles.value = true
  let deleted = 0
  const failures: { name: string; error: string }[] = []
  try {
    for (const entry of items) {
      try {
        await sshApi.sftpEntryDelete({
          sessionId: sessionId.value,
          path: joinRemotePath(remotePath.value, entry.name),
          kind: entry.kind,
          recursive: entry.kind === 'dir',
        })
        deleted++
      } catch (e) {
        failures.push({
          name: entry.name,
          error: e instanceof Error ? e.message : t('modules.ftp.session.deleteError'),
        })
      }
    }
    if (deleted > 0) {
      remotePaneRef.value?.clearSelection()
      await refreshRemote()
    }
    if (failures.length === 0) {
      toast.success(t('modules.ftp.session.deleted'))
    } else if (failures.length === 1) {
      toast.error(t('modules.ftp.session.deleteItemError', {
        name: failures[0]!.name,
        error: failures[0]!.error,
      }))
    } else {
      toast.error(t('modules.ftp.session.deletePartialError', {
        failed: failures.length,
        total: items.length,
      }))
    }
  } finally {
    loadingFiles.value = false
  }
}

async function renameRemoteEntry(entry: FtpPaneEntry): Promise<void> {
  if (!sessionId.value) {
    return
  }
  const newName = await showPrompt(
    t('modules.ftp.session.rename'),
    t('modules.ftp.session.renamePrompt'),
    entry.name,
  )
  if (!newName || newName === entry.name) {
    return
  }
  loadingFiles.value = true
  try {
    await sshApi.sftpEntryRename({
      sessionId: sessionId.value,
      fromPath: joinRemotePath(remotePath.value, entry.name),
      toPath: joinRemotePath(remotePath.value, newName.trim()),
    })
    toast.success(t('modules.ftp.session.renamed'))
    await refreshRemote()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.renameError'))
  } finally {
    loadingFiles.value = false
  }
}

async function mkdirRemote(): Promise<void> {
  if (!sessionId.value) {
    return
  }
  const name = await showPrompt(
    t('modules.ftp.session.mkdir'),
    t('modules.ftp.session.mkdirPrompt'),
  )
  if (!name) {
    return
  }
  loadingFiles.value = true
  try {
    await sshApi.sftpDirMake({
      sessionId: sessionId.value,
      path: joinRemotePath(remotePath.value, name.trim()),
    })
    await refreshRemote()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.listError'))
  } finally {
    loadingFiles.value = false
  }
}

onMounted(async () => {
  try {
    if (!props.terminalSyncGroupId) {
      sshProfiles.loadAll().catch(() => undefined)
    }
    await loadProfile()
    await openSession()
    void nextTick(() => {
      if (sftpUiCollapsed.value) {
        snapSftpPaneToHeader()
      }
      terminalGroupRef.value?.refreshSize()
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.ssh.loadError')
    connecting.value = false
  }
})

onBeforeUnmount(() => {
  offTerminalSync?.()
  offTerminalSync = null
  void closeSession()
})

watch(
  () => sessionActionStore.reconnectSignals[props.profileId],
  (val) => {
    if (val) void reconnect()
  },
)

// splitGroup 后把拷贝 Tab 的 profileId 改成新的目标主机时，需要显式重连
watch(
  () => props.profileId,
  (next, prev) => {
    if (!next || next === prev) return
    void reconnect()
  },
)
</script>

<template>
  <div class="nm-ssh-session">
    <p v-if="error" class="nm-ssh-session__error" role="alert">{{ error }}</p>

    <RsLoading v-if="connecting" class="nm-ssh-session__loading" />

    <RsSplitPane
      v-else
      ref="sftpSplitRef"
      v-model:sizes="sftpSplitSizes"
      class="nm-ssh-session__split"
      orientation="vertical"
      :panes="splitPanes"
      with-handle
      @collapse="onSftpSplitCollapse"
      @expand="onSftpSplitExpand"
      @resize-end="onSftpResizeEnd"
    >
      <template #terminal>
        <SshTerminalGroup
          ref="terminalGroupRef"
          class="nm-ssh-session__terminal"
          :session-id="sessionId"
          :pane-count="terminalPaneCount"
          :sync-input="terminalSyncEnabled"
          :max-panes="TERMINAL_MAX_PANES"
          :term-type="String(profile?.connectionOptions?.term_type ?? 'xterm-256color')"
          @broadcastInput="onTerminalBroadcastInput"
        />
      </template>

      <template #files>
        <div
          class="nm-ssh-session__sftp"
          :class="{ 'nm-ssh-session__sftp--collapsed': sftpUiCollapsed }"
        >
          <header
            ref="sftpHeadRef"
            class="nm-ssh-session__sftp-head"
          >
            <!-- 折叠/展开按钮 -->
            <button
              type="button"
              class="nm-ssh-session__sftp-collapse"
              :aria-label="sftpUiCollapsed ? t('modules.ssh.session.expandSftp') : t('modules.ssh.session.collapseSftp')"
              @click="toggleSftpCollapse"
            >
              <RsIcon
                class="nm-ssh-session__sftp-chevron"
                :name="sftpUiCollapsed ? 'chevron-up' : 'chevron-down'"
                :size="14"
              />
            </button>

            <!-- Tab 切换 -->
            <div class="nm-ssh-session__sftp-tabs">
              <button
                type="button"
                class="nm-ssh-session__sftp-tab"
                :class="{ 'nm-ssh-session__sftp-tab--active': sftpActiveTab === 'files' }"
                @click="onSftpTabClick('files')"
              >
                {{ t('modules.ssh.session.remoteFiles') }}
              </button>
              <button
                type="button"
                class="nm-ssh-session__sftp-tab"
                :class="{ 'nm-ssh-session__sftp-tab--active': sftpActiveTab === 'monitor' }"
                @click="onSftpTabClick('monitor')"
              >
                {{ t('modules.ssh.session.monitor') }}
              </button>
            </div>

            <div class="nm-ssh-session__sftp-right">
              <!-- 分屏控制（保持与监控工具栏同层次） -->
              <div class="nm-ssh-session__split-controls" aria-label="multi host controls">
                <template v-if="props.terminalSyncGroupId">
                  <label class="nm-ssh-session__split-sync">
                    <input type="checkbox" v-model="terminalSyncEnabled" />
                    <span>终端同步 {{ props.terminalSyncSlot ?? 'A' }}</span>
                  </label>
                </template>

                <template v-else-if="!props.terminalSyncSlot || props.terminalSyncSlot === 'A'">
                  <div class="nm-ssh-session__host-split">
                    <div class="nm-ssh-session__host-split-row">
                      <span class="nm-ssh-session__host-split-title">多主机</span>
                      <span class="nm-ssh-session__host-split-a">A: {{ profile?.profileName ?? props.profileId }}</span>
                    </div>

                    <div class="nm-ssh-session__host-split-selects">
                      <div class="nm-ssh-session__host-slot">
                        <span class="nm-ssh-session__host-slot-label">B</span>
                        <RsSelect v-model="slotBProfileId" :options="sshProfileSelectOptions" />
                      </div>
                      <div class="nm-ssh-session__host-slot">
                        <span class="nm-ssh-session__host-slot-label">C</span>
                        <RsSelect v-model="slotCProfileId" :options="sshProfileSelectOptions" />
                      </div>
                      <div class="nm-ssh-session__host-slot">
                        <span class="nm-ssh-session__host-slot-label">D</span>
                        <RsSelect v-model="slotDProfileId" :options="sshProfileSelectOptions" />
                      </div>
                    </div>

                    <div class="nm-ssh-session__host-split-actions">
                      <RsButton
                        size="sm"
                        variant="primary"
                        :disabled="abcdSelectedCount === 0"
                        @click="applyAbcdSplit"
                      >
                        创建A/B/C/D分屏
                      </RsButton>
                    </div>
                  </div>
                </template>
              </div>

              <!-- 当前路径（仅文件Tab可见） -->
              <span
                v-if="!sftpUiCollapsed && sftpActiveTab === 'files' && remotePath"
                class="nm-ssh-session__sftp-path"
              >{{ remotePath }}</span>
            </div>
          </header>

          <!-- 远程文件面板 -->
          <FtpFilePane
            v-show="!sftpUiCollapsed && sftpActiveTab === 'files'"
            ref="remotePaneRef"
            side="remote"
            :label="t('modules.ssh.session.remoteFiles')"
            :path="remotePath"
            :entries="remotePaneEntries"
            :loading="loadingFiles"
            :can-go-up="remotePath !== '.' && remotePath !== '/'"
            show-modified
            :draggable-files="false"
            remote-upload
            @update:path="remotePath = $event"
            @refresh="refreshRemote"
            @go-up="goRemoteUp"
            @open="onRemoteOpen"
            @copy-path="onRemoteCopyPath"
            @open-in-editor="(entry) => void onRemoteOpenInEditor(entry)"
            @mkdir="mkdirRemote"
            @rename="(entry) => void renameRemoteEntry(entry)"
            @delete="(items) => void deleteRemoteEntries(items)"
            @delete-selected="(items) => void deleteRemoteEntries(items)"
            @download="(entry) => void enqueueDownloadEntry(entry)"
            @download-selected="(items) => void batchDownload(items)"
            @upload-pane="() => void uploadToCurrentDir()"
            @upload-folder-pane="() => void uploadFolderToCurrentDir()"
            @upload="(entry) => void enqueueUploadEntry(entry)"
          />

          <!-- 监控面板 -->
          <SshMonitorPane
            v-show="!sftpUiCollapsed && sftpActiveTab === 'monitor'"
            :session-id="sessionId"
            :active="!sftpUiCollapsed && sftpActiveTab === 'monitor'"
          />
        </div>
      </template>
    </RsSplitPane>

    <RsDialog
      v-model:open="promptOpen"
      :title="promptTitle"
      width="sm"
      :show-close="false"
    >
      <RsInput
        ref="promptInputRef"
        v-model="promptValue"
        :placeholder="promptPlaceholder"
        @press-enter="onPromptConfirm"
      />
      <template #footer>
        <RsButton variant="default" @click="onPromptCancel">{{ t('common.cancel') }}</RsButton>
        <RsButton variant="primary" :disabled="!promptValue.trim()" @click="onPromptConfirm">
          {{ t('common.confirm') }}
        </RsButton>
      </template>
    </RsDialog>

    <RsConfirmDialog
      v-model:open="confirmOpen"
      :description="confirmDesc"
      @confirm="onConfirmOk"
      @cancel="onConfirmCancel"
    />
  </div>
</template>

<style scoped>
.nm-ssh-session {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--nm-editor-bg, var(--rs-surface));
}

.nm-ssh-session__error {
  margin: 0;
  padding: var(--rs-space-sm) var(--rs-space-md);
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
  flex-shrink: 0;
}

.nm-ssh-session__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-ssh-session__split {
  flex: 1;
  min-height: 0;
}

.nm-ssh-session__split :deep(.rs-split__pane) {
  min-height: 0;
}

.nm-ssh-session__split :deep(.rs-split__resizer) {
  opacity: 1;
  background: var(--rs-border-subtle);
}

.nm-ssh-session__terminal {
  height: 100%;
  min-height: 0;
}

.nm-ssh-session__sftp {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--nm-editor-bg, var(--rs-surface));
}

.nm-ssh-session__sftp-head {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-height: 2rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--nm-frame-bg);
}

.nm-ssh-session__sftp-collapse {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  min-height: 2rem;
  flex-shrink: 0;
  border: none;
  border-right: 1px solid var(--rs-border-subtle);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  transition: background var(--rs-transition-fast);
}

.nm-ssh-session__sftp-collapse:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-ssh-session__sftp-tabs {
  display: flex;
  align-items: stretch;
  height: 100%;
}

.nm-ssh-session__sftp-tab {
  display: flex;
  align-items: center;
  padding: 0 var(--rs-space-sm);
  min-height: 2rem;
  border: none;
  border-right: 1px solid var(--rs-border-subtle);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--rs-transition-fast), color var(--rs-transition-fast);
}

.nm-ssh-session__sftp-tab:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-ssh-session__sftp-tab--active {
  color: var(--rs-primary);
  box-shadow: inset 0 -2px 0 var(--rs-primary);
}

.nm-ssh-session__sftp-path {
  padding-right: var(--rs-space-sm);
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rs-table-muted-fg);
  font-size: var(--rs-font-size-xs);
  font-variant-numeric: tabular-nums;
}

.nm-ssh-session__sftp-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
}

.nm-ssh-session__split-controls {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--rs-space-xs);
  user-select: none;
  flex-shrink: 0;
}

.nm-ssh-session__split-label {
  color: var(--rs-muted);
  font-size: 11px;
}

.nm-ssh-session__split-btn {
  border: 1px solid var(--rs-border-subtle);
  background: transparent;
  color: var(--rs-text);
  border-radius: var(--rs-radius-xs);
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

.nm-ssh-session__split-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.nm-ssh-session__split-count {
  min-width: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--rs-text);
  font-size: 11px;
}

.nm-ssh-session__split-sync {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
  color: var(--rs-muted);
  font-size: 11px;
}

.nm-ssh-session__host-split {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--rs-space-xs);
}

.nm-ssh-session__host-split-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
}

.nm-ssh-session__host-split-title {
  color: var(--rs-muted);
  font-size: 11px;
  white-space: nowrap;
}

.nm-ssh-session__host-split-a {
  color: var(--rs-text);
  font-size: 11px;
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-ssh-session__host-split-selects {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
}

.nm-ssh-session__host-slot {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.nm-ssh-session__host-slot-label {
  color: var(--rs-muted);
  font-size: 11px;
  white-space: nowrap;
}

.nm-ssh-session__host-split-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.nm-ssh-session__sftp-chevron {
  flex-shrink: 0;
}

.nm-ssh-session__sftp--collapsed .nm-ssh-session__sftp-head {
  border-bottom: none;
}
</style>
