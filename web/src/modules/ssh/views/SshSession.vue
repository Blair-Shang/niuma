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
  type RsSplitPaneInstance,
  type RsSelectOptions,
} from '@niuma/ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi, dialogApi, fsApi, sshApi } from '@/api'
import type { ConnectionProfile } from '@/api/types/ftp'
import type { SshSftpEntry } from '@/api/types/ssh'
import { useSessionLease } from '@/modules/connection/useSessionLease'
import { openInFile } from '@/modules/file-editor'
import FtpFilePane from '@/modules/ftp/components/FtpFilePane.vue'
import type { FtpPaneEntry } from '@/modules/ftp/composables/useFtpPaneList'
import { useSshTransfer } from '@/modules/ssh/composables/useSshTransfer'
import SshMonitorPane from '@/modules/ssh/components/SshMonitorPane.vue'
import SshTerminalGroup from '@/modules/ssh/components/SshTerminalGroup.vue'
import { useSessionActionStore } from '@/stores/session-actions'
import { useShellStore } from '@/stores/shell'
import {
  clearDiagnostic,
  publishDiagnostic,
} from '@/shell/panels/ai/workspace-context'
import { useTransferHubStore } from '@/stores/transfer-hub'
import { useTabStore } from '@/stores/tab'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import { useSshTerminalSync } from '@/modules/ssh/composables/useSshTerminalSync'
import { createId } from '@/utils/id'

const props = defineProps<{
  profileId: string
  /** 工作区 Tab id（Session Registry 借用键） */
  tabId?: string
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

const dialogInstanceId = createId()
const dialogMountId = computed(() => `nm-ssh-dialog-mount-${dialogInstanceId}`)
const dialogMountTo = computed(() => `#${dialogMountId.value}`)
let dialogMountEl: HTMLDivElement | null = null

// ── 输入 / 确认对话框 ─────────────────────────────────────────────────
const promptOpen = ref(false)
const promptTitle = ref('')
const promptPlaceholder = ref('')
const promptValue = ref('')
/** 回调 ref，避免 InstanceType<typeof RsInput> / 模板赋值触发 TS 递归过深 */
let promptInputEl: HTMLElement | null = null
function bindPromptInput(el: unknown): void {
  promptInputEl = null
  if (!el || typeof el !== 'object') return
  if ('$el' in el) {
    const host = (el as { $el?: unknown }).$el
    promptInputEl = host instanceof HTMLElement ? host : null
    return
  }
  if (el instanceof HTMLElement) {
    promptInputEl = el
  }
}
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
    promptInputEl?.querySelector('input')?.focus()
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

const { sessionId, acquireSession, reconnectSession } = useSessionLease({
  kind: 'ssh',
  profileId: () => props.profileId,
  tabId: () => props.tabId,
  onAcquired: async (sid) => {
    transferHub.registerSession({
      sessionId: sid,
      provider: 'ssh',
      label: sessionLabel(),
    })
    await refreshRemote()
    await refreshTransfers()
  },
  buildOnRelease: () => [
    () => {
      const id = sessionId.value
      if (id) {
        transferHub.unregisterSession(id)
      }
    },
  ],
})

const { enqueue: enqueueTransfer, refresh: refreshTransfers } = useSshTransfer(sessionId)

const remotePath = ref('.')
/** 路径输入草稿：未回车前不参与上传/删除等操作，避免用错目录 */
const remotePathDraft = ref('.')
const entries = ref<SshSftpEntry[]>([])
const connecting = ref(true)
const loadingFiles = ref(false)
const error = ref<string | null>(null)

const remotePaneRef = ref<InstanceType<typeof FtpFilePane> | null>(null)
const terminalGroupRef = ref<InstanceType<typeof SshTerminalGroup> | null>(null)
const sftpSplitRef = ref<RsSplitPaneInstance | null>(null)
const sftpHeadRef = ref<HTMLElement | null>(null)

// ── 分屏（终端 PTY 分屏）──────────────────────────────────────────────
const TERMINAL_MAX_PANES = 1
const terminalPaneCount = ref(1)

const {
  terminalSyncEnabled,
  effectiveSyncGroupId,
  ensureTerminalSyncGroup,
  onTerminalBroadcastInput,
} = useSshTerminalSync({
  terminalSyncGroupId: toRef(props, 'terminalSyncGroupId'),
  terminalGroupRef,
})

// ── 多主机分屏（由 TabBar 分屏承载，不固定分屏数）────────────────────────
const multiHostOpen = ref(false)
const addHostProfileId = ref<string>('')
const selectedHostProfileIds = ref<string[]>([])

const sshProfileSelectOptions = computed<RsSelectOptions>(() => {
  const list = sshProfiles.allProfiles
  const opts: Array<{ label: string; value: string }> = []
  for (const p of list) {
    if (p.profileId === props.profileId) {
      continue
    }
    if (selectedHostProfileIds.value.includes(p.profileId)) {
      continue
    }
    opts.push({ label: p.profileName, value: p.profileId })
  }
  return opts
})

function sshProfileName(profileId: string): string {
  const p = sshProfiles.allProfiles.find((x) => x.profileId === profileId)
  return p?.profileName ?? profileId
}

function addSelectedHost(): void {
  const id = addHostProfileId.value.trim()
  if (!id) return
  if (id === props.profileId) {
    addHostProfileId.value = ''
    toast.error('当前主机无需重复添加')
    return
  }
  if (selectedHostProfileIds.value.includes(id)) {
    addHostProfileId.value = ''
    toast.error('该主机已添加')
    return
  }
  selectedHostProfileIds.value.push(id)
  addHostProfileId.value = ''
  toast.success(`已添加 ${sshProfileName(id)}`)
}

function removeSelectedHost(profileId: string): void {
  selectedHostProfileIds.value = selectedHostProfileIds.value.filter((x) => x !== profileId)
}

function openMultiHostDialog(): void {
  if (!sshProfiles.loading && sshProfiles.allProfiles.length === 0) {
    sshProfiles.loadAll().catch(() => undefined)
  }
  addHostProfileId.value = ''
  selectedHostProfileIds.value = []
  multiHostOpen.value = true
}

function applyMultiHostSplit(): void {
  const list = selectedHostProfileIds.value
  if (list.length === 0) {
    multiHostOpen.value = false
    return
  }
  const srcTab = tabStore.activeTab
  if (!srcTab || srcTab.moduleId !== 'ssh') {
    multiHostOpen.value = false
    return
  }
  // 勾选了同步：确保本 Tab 有同步组 id，这样 split 出来的副本天然继承同组
  if (terminalSyncEnabled.value) {
    ensureTerminalSyncGroup()
  }
  const sourceGroupId = tabStore.groups.find((g) => g.tabs.some((t) => t.tabId === srcTab.tabId))?.groupId
  if (!sourceGroupId) {
    multiHostOpen.value = false
    return
  }
  for (const profileId of list) {
    tabStore.splitGroup(sourceGroupId)
    const copyTab = tabStore.activeTab
    if (!copyTab || copyTab.moduleId !== 'ssh') continue
    tabStore.updateTabProps(copyTab.tabId, { profileId })
    tabStore.updateTitle(copyTab.tabId, sshProfileName(profileId))
  }
  multiHostOpen.value = false
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
    await acquireSession()
    clearDiagnostic(`ssh-conn:${props.profileId}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.ssh.session.connectError')
    toast.error(error.value)
    publishDiagnostic({
      id: `ssh-conn:${props.profileId}`,
      label: 'SSH Connect',
      detail: props.profileId,
      text: error.value,
      kind: 'ssh',
      tabId: useTabStore().activeTabId || undefined,
    })
  } finally {
    connecting.value = false
  }
}

async function reconnect(): Promise<void> {
  connecting.value = true
  error.value = null
  try {
    await reconnectSession()
    clearDiagnostic(`ssh-conn:${props.profileId}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.ssh.session.connectError')
    toast.error(error.value)
    publishDiagnostic({
      id: `ssh-conn:${props.profileId}`,
      label: 'SSH Connect',
      detail: props.profileId,
      text: error.value,
      kind: 'ssh',
      tabId: useTabStore().activeTabId || undefined,
    })
  } finally {
    connecting.value = false
  }
}

async function refreshRemote(): Promise<void> {
  if (!sessionId.value) {
    return
  }
  loadingFiles.value = true
  error.value = null
  const requestPath = remotePathDraft.value
  try {
    const result = await sshApi.sftpDirList({
      sessionId: sessionId.value,
      path: requestPath,
    })
    const nextPath = result.path || requestPath
    remotePath.value = nextPath
    remotePathDraft.value = nextPath
    entries.value = result.entries ?? []
    clearDiagnostic(`ssh-sftp:${props.profileId}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.ssh.session.listError')
    toast.error(error.value)
    publishDiagnostic({
      id: `ssh-sftp:${props.profileId}`,
      label: 'SFTP',
      detail: requestPath,
      text: error.value,
      kind: 'ssh',
      tabId: useTabStore().activeTabId || undefined,
    })
  } finally {
    loadingFiles.value = false
  }
}

function navigateRemote(path: string): void {
  remotePath.value = path
  remotePathDraft.value = path
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
  const targetDir = remotePath.value
  const localPaths = await resolveUploadLocalPaths(true)
  await enqueueUploadPaths(localPaths, targetDir)
}

async function uploadFolderToCurrentDir(): Promise<void> {
  const targetDir = remotePath.value
  const result = await dialogApi.openFolder({
    title: t('modules.ftp.session.uploadFolder'),
  })
  if (result.canceled || !result.filePaths[0]) {
    return
  }
  await enqueueUploadPaths([result.filePaths[0]], targetDir)
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
    if (typeof document !== 'undefined' && !dialogMountEl) {
      dialogMountEl = document.createElement('div')
      dialogMountEl.id = dialogMountId.value
      dialogMountEl.className = 'nm-ssh-session__dialog-mount'
      document.body.appendChild(dialogMountEl)
    }
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
  if (dialogMountEl) {
    dialogMountEl.remove()
  }
  dialogMountEl = null
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
              <!-- 分屏同步：勾选后加入当前同步组（未创建则自动生成） -->
              <label class="nm-ssh-session__split-sync" :title="effectiveSyncGroupId ? '同组分屏将同步输入' : '勾选后将创建同步组'">
                <input type="checkbox" v-model="terminalSyncEnabled" />
                <span>终端同步</span>
              </label>

              <button
                type="button"
                class="nm-ssh-session__mh-btn"
                :title="'多主机分屏'"
                @click="openMultiHostDialog"
              >
                <RsIcon name="columns-2" :size="14" />
                <span>多主机</span>
              </button>

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
            :path="remotePathDraft"
            :entries="remotePaneEntries"
            :loading="loadingFiles"
            :can-go-up="remotePath !== '.' && remotePath !== '/'"
            show-modified
            :draggable-files="false"
            remote-upload
            @update:path="remotePathDraft = $event"
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
            @upload="() => void uploadToCurrentDir()"
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
      v-model:open="multiHostOpen"
      title="多主机分屏"
      width="lg"
      :teleport-to="dialogMountTo"
    >
        <template #body>
        <div class="nm-ssh-session__mh">
          <p class="nm-ssh-session__mh-hint">
            选择要在分屏里打开的主机数量（不限制个数）。创建后可在每个分屏 Tab 单独勾选“终端同步”。
          </p>

          <div class="nm-ssh-session__mh-row">
            <RsSelect
              v-model="addHostProfileId"
              class="nm-ssh-session__mh-select"
              :options="sshProfileSelectOptions"
            />
            <RsButton
              size="sm"
              variant="default"
              :disabled="!addHostProfileId.trim()"
              @click="addSelectedHost"
            >
              添加
            </RsButton>
          </div>

          <div v-if="selectedHostProfileIds.length" class="nm-ssh-session__mh-list">
            <div
              v-for="pid in selectedHostProfileIds"
              :key="pid"
              class="nm-ssh-session__mh-item"
              :title="sshProfileName(pid)"
            >
              <span class="nm-ssh-session__mh-name">{{ sshProfileName(pid) }}</span>
              <button type="button" class="nm-ssh-session__mh-remove" @click="removeSelectedHost(pid)">
                <RsIcon name="x" :size="14" />
              </button>
            </div>
          </div>
          <p v-else class="nm-ssh-session__mh-empty">还未选择主机。</p>
        </div>
        </template>

        <template #footer>
          <RsButton variant="ghost" @click="multiHostOpen = false">取消</RsButton>
          <RsButton variant="primary" :disabled="selectedHostProfileIds.length === 0" @click="applyMultiHostSplit">
            在分屏打开（{{ selectedHostProfileIds.length }}）
          </RsButton>
        </template>
    </RsDialog>

    <RsDialog
      v-model:open="promptOpen"
      :title="promptTitle"
      width="sm"
      layout="form"
      :resizable="false"
      :fullscreenable="false"
      :show-close="false"
      :teleport-to="dialogMountTo"
    >
        <template #body>
        <RsInput
          :ref="(el) => bindPromptInput(el)"
          v-model="promptValue"
          :placeholder="promptPlaceholder"
          @press-enter="onPromptConfirm"
        />
        </template>
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
      :teleport-to="dialogMountTo"
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

.nm-ssh-session__split-sync {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
  color: var(--rs-muted);
  font-size: 11px;
  padding: 0 var(--rs-space-sm);
  height: 2rem;
  border-left: 1px solid var(--rs-border-subtle);
  user-select: none;
}

.nm-ssh-session__mh-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
  height: 2rem;
  padding: 0 var(--rs-space-sm);
  border: none;
  border-left: 1px solid var(--rs-border-subtle);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  transition: background var(--rs-transition-fast), color var(--rs-transition-fast);
  font-size: var(--rs-font-size-xs);
  white-space: nowrap;
}

.nm-ssh-session__mh-btn:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-ssh-session__mh {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-ssh-session__mh-hint {
  margin: 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.nm-ssh-session__mh-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
}

.nm-ssh-session__mh-select {
  flex: 1;
  min-width: 0;
}

.nm-ssh-session__mh-row :deep(.rs-select) {
  width: 100%;
}

.nm-ssh-session__mh-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nm-ssh-session__mh-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: 6px var(--rs-space-sm);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-xs);
  background: var(--rs-surface-elevated);
}

.nm-ssh-session__mh-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.nm-ssh-session__mh-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border: none;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-ssh-session__mh-remove:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-ssh-session__mh-empty {
  margin: 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
}

.nm-ssh-session__sftp-chevron {
  flex-shrink: 0;
}

.nm-ssh-session__sftp--collapsed .nm-ssh-session__sftp-head {
  border-bottom: none;
}

.nm-ssh-session__dialog-mount {
  /* 作为 RsDialog/ConfirmDialog 的 Teleport 挂载点（动态挂到 body） */
  position: relative;
}
</style>
