<script setup lang="ts">
import {
  RsButton,
  RsConfirmDialog,
  RsDialog,
  RsInput,
  RsLoading,
  RsSplitPane,
  expandSplitPane,
  resolveSplitConstraints,
  useRsToast,
  type RsSplitPaneItem,
} from '@niuma/ui'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi, dialogApi, fsApi, ftpApi } from '@/api'
import { useSessionLease } from '@/modules/connection/useSessionLease'
import { openInFile } from '@/modules/file-editor'
import type { ConnectionProfile, FtpEntry } from '@/api/types/ftp'
import type { LocalEntry } from '@/api/types/fs'
import FtpFilePane from '@/modules/ftp/components/FtpFilePane.vue'
import TransferQueue from '@/modules/ftp/components/TransferQueue.vue'
import type { FtpPaneEntry } from '@/modules/ftp/composables/useFtpPaneList'
import { useFtpTransfer } from '@/modules/ftp/composables/useFtpTransfer'
import {
  isPathInside,
  readFtpDragPayload,
  readFtpDragSideFromTypes,
  writeFtpDragData,
  type FtpDragEntry,
} from '@/modules/ftp/utils/ftpDrag'
import { isFtpConnectionError } from '@/modules/ftp/utils/ftpConnectionError'
import {
  canGoUpLocalPath,
  joinLocalPath,
  normalizeLocalPath,
  parentLocalPath,
} from '@/modules/ftp/utils/localPath'
import { useSessionActionStore } from '@/stores/session-actions'
import { useTransferHubStore } from '@/stores/transfer-hub'

const props = defineProps<{
  profileId: string
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessionActionStore = useSessionActionStore()
const transferHub = useTransferHubStore()

const profile = ref<ConnectionProfile | null>(null)

const { sessionId, acquireSession, reconnectSession } = useSessionLease({
  kind: 'ftp',
  profileId: () => props.profileId,
  tabId: () => props.tabId,
  onAcquired: async (sid) => {
    transferHub.registerSession({
      sessionId: sid,
      provider: 'ftp',
      label: profile.value?.profileName || profile.value?.hostAddress || 'FTP',
    })
    await refreshRemote()
    await refreshTransfers()
    await transferHub.refreshSession(sid)
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

const { tasks, enqueue, cancel, pause, resume, refresh: refreshTransfers } = useFtpTransfer(sessionId)
const remotePath = ref('/')
const entries = ref<FtpEntry[]>([])
const localPath = ref('')
const localEntries = ref<LocalEntry[]>([])
const loading = ref(false)
const localLoading = ref(false)
// 初始为 true：首次渲染立刻显示加载圈，避免渲染空白面板造成白屏
const connecting = ref(true)
const error = ref<string | null>(null)

const localPaneRef = ref<InstanceType<typeof FtpFilePane> | null>(null)
const remotePaneRef = ref<InstanceType<typeof FtpFilePane> | null>(null)

// ── 输入对话框（新建文件夹 / 重命名） ──────────────────────────────────
const promptOpen = ref(false)
const promptTitle = ref('')
const promptPlaceholder = ref('')
const promptValue = ref('')
const promptInputRef = ref<InstanceType<typeof RsInput> | null>(null)
let resolvePrompt: ((v: string | null) => void) | null = null

function showPrompt(title: string, placeholder: string, defaultValue = ''): Promise<string | null> {
  promptTitle.value = title
  promptPlaceholder.value = placeholder
  promptValue.value = defaultValue
  promptOpen.value = true
  return new Promise((resolve) => { resolvePrompt = resolve })
}

watch(promptOpen, async (open) => {
  if (open) {
    await nextTick()
    // 等 portal 渲染完成后聚焦输入框
    await nextTick()
    ;(promptInputRef.value as { $el?: HTMLElement } | null)?.$el
      ?.querySelector('input')
      ?.focus()
  } else if (resolvePrompt) {
    resolvePrompt(null)
    resolvePrompt = null
  }
})

function onPromptConfirm(): void {
  const v = promptValue.value.trim()
  if (!v) return
  promptOpen.value = false
  resolvePrompt?.(v)
  resolvePrompt = null
}

function onPromptCancel(): void {
  promptOpen.value = false
  resolvePrompt?.(null)
  resolvePrompt = null
}

// ── 确认对话框（删除） ────────────────────────────────────────────────
const confirmOpen = ref(false)
const confirmDesc = ref('')
let resolveConfirm: ((v: boolean) => void) | null = null

function showConfirm(desc: string): Promise<boolean> {
  confirmDesc.value = desc
  confirmOpen.value = true
  return new Promise((resolve) => { resolveConfirm = resolve })
}

watch(confirmOpen, (open) => {
  if (!open && resolveConfirm) {
    resolveConfirm(false)
    resolveConfirm = null
  }
})

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

function targetExistsForUpload(name: string): boolean {
  return entries.value.some((entry) => entry.name === name)
}

function targetExistsForDownload(name: string): boolean {
  return localEntries.value.some((entry) => entry.name === name)
}

function planUploadItems(paneEntries: FtpPaneEntry[]): TransferPlanItem[] {
  return paneEntries
    .filter((entry) => entry.kind !== 'link')
    .map((entry) => ({
      name: entry.name,
      localPath: joinLocalPath(localPath.value, entry.name),
      remotePath: joinRemotePath(remotePath.value, entry.name),
    }))
}

function planDownloadItems(paneEntries: FtpPaneEntry[]): TransferPlanItem[] {
  return planUploadItems(paneEntries)
}

function planDragUploadItems(dragEntries: FtpDragEntry[]): TransferPlanItem[] {
  return dragEntries.map((entry) => ({
    name: entry.name,
    localPath: entry.path,
    remotePath: joinRemotePath(remotePath.value, entry.name),
  }))
}

function planDragDownloadItems(dragEntries: FtpDragEntry[]): TransferPlanItem[] {
  return dragEntries.map((entry) => ({
    name: entry.name,
    localPath: joinLocalPath(localPath.value, entry.name),
    remotePath: entry.path,
  }))
}

function collectTransferConflicts(
  direction: 'upload' | 'download',
  items: TransferPlanItem[],
): TransferPlanItem[] {
  const exists = direction === 'upload' ? targetExistsForUpload : targetExistsForDownload
  return items.filter((item) => exists(item.name))
}

async function confirmTransferOverwrite(
  direction: 'upload' | 'download',
  items: TransferPlanItem[],
): Promise<boolean> {
  const conflicts = collectTransferConflicts(direction, items)
  if (conflicts.length === 0) {
    return true
  }
  if (conflicts.length === 1) {
    const name = conflicts[0]!.name
    const key =
      direction === 'upload'
        ? 'modules.ftp.session.overwriteUploadConfirm'
        : 'modules.ftp.session.overwriteDownloadConfirm'
    return showConfirm(t(key, { name }))
  }
  const key =
    direction === 'upload'
      ? 'modules.ftp.session.overwriteUploadAllConfirm'
      : 'modules.ftp.session.overwriteDownloadAllConfirm'
  return showConfirm(t(key, { count: conflicts.length }))
}

async function enqueueTransferItems(
  direction: 'upload' | 'download',
  items: TransferPlanItem[],
): Promise<void> {
  if (!sessionId.value || items.length === 0) {
    return
  }
  if (!(await confirmTransferOverwrite(direction, items))) {
    return
  }
  try {
    for (const item of items) {
      await enqueue({
        direction,
        localPath: item.localPath,
        remotePath: item.remotePath,
        overwrite: 'overwrite',
      })
    }
    if (sessionId.value) {
      await transferHub.refreshSession(sessionId.value)
    }
    toast.success(t('modules.ftp.session.transferQueued'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.transferError'))
  }
}

type FtpMoveTarget =
  | { kind: 'parent' }
  | { kind: 'dir'; entry: FtpPaneEntry }

const dragOverLocal = ref(false)
const dragOverRemote = ref(false)

const splitPanes = computed((): RsSplitPaneItem[] => [
  { key: 'local', min: 20 },
  { key: 'remote', min: 20 },
])

/** 传输队列折叠后仅保留标题栏高度 */
const QUEUE_COLLAPSED_PCT = 2

const queueSplitPanes = computed((): RsSplitPaneItem[] => [
  { key: 'workspace', min: 25 },
  {
    key: 'queue',
    size: 20,
    min: QUEUE_COLLAPSED_PCT,
    max: 55,
    collapsible: true,
    collapsedSize: QUEUE_COLLAPSED_PCT,
  },
])

const fileSplitSizes = ref([40, 60])

const queueSplitSizes = ref([80, 20])
const queueUiCollapsed = ref(false)
const queueSplitRef = ref<InstanceType<typeof RsSplitPane> | null>(null)
const transferQueueRef = ref<InstanceType<typeof TransferQueue> | null>(null)

const queueConstraints = computed(() => resolveSplitConstraints(queueSplitPanes.value))

function roundSplitPct(value: number): number {
  return Math.round(value * 10000) / 10000
}

function measureQueueHeaderPx(): number {
  const root = transferQueueRef.value?.$el as HTMLElement | undefined
  const header = root?.querySelector('.nm-transfer-queue__header') as HTMLElement | null
  return header?.offsetHeight ?? 34
}

function snapQueuePaneToHeader(): void {
  const splitEl = queueSplitRef.value?.$el as HTMLElement | undefined
  if (!splitEl || splitEl.offsetHeight <= 0) {
    return
  }
  const pct = roundSplitPct(
    Math.min(
      queueConstraints.value[1]?.max ?? 55,
      Math.max(QUEUE_COLLAPSED_PCT, (measureQueueHeaderPx() / splitEl.offsetHeight) * 100),
    ),
  )
  queueSplitSizes.value = [roundSplitPct(100 - pct), pct]
}

function toggleQueueCollapse(): void {
  if (queueUiCollapsed.value) {
    queueUiCollapsed.value = false
    queueSplitSizes.value = expandSplitPane(queueSplitSizes.value, queueConstraints.value, 1, 22)
    return
  }
  queueUiCollapsed.value = true
  void nextTick(() => snapQueuePaneToHeader())
}

function onQueueSplitCollapse(key: string): void {
  if (key !== 'queue') {
    return
  }
  queueUiCollapsed.value = true
  void nextTick(() => snapQueuePaneToHeader())
}

function onQueueSplitExpand(key: string): void {
  if (key === 'queue') {
    queueUiCollapsed.value = false
  }
}

function onQueueResizeEnd(sizes: number[]): void {
  const queuePct = sizes[1]
  if (queuePct === undefined) {
    return
  }
  const splitEl = queueSplitRef.value?.$el as HTMLElement | undefined
  if (!splitEl || splitEl.offsetHeight <= 0) {
    return
  }
  const headerPct = (measureQueueHeaderPx() / splitEl.offsetHeight) * 100
  if (queuePct <= headerPct * 1.2) {
    queueUiCollapsed.value = true
    snapQueuePaneToHeader()
  } else if (queuePct > headerPct * 1.6) {
    queueUiCollapsed.value = false
  }
}

const remotePaneEntries = computed((): FtpPaneEntry[] =>
  entries.value.map((e) => ({
    name: e.name,
    kind: e.kind,
    size: e.size,
    modifiedAt: e.modifiedAt,
  })),
)

const localPaneEntries = computed((): FtpPaneEntry[] =>
  localEntries.value.map((e) => ({
    name: e.name,
    kind: e.kind,
    size: e.size,
  })),
)

const canGoLocalUp = computed(() => canGoUpLocalPath(localPath.value))

function joinRemotePath(base: string, name: string): string {
  if (base === '/' || base === '') {
    return `/${name}`
  }
  return `${base.replace(/\/$/, '')}/${name}`
}

function parentRemotePath(path: string): string {
  if (path === '/' || path === '') {
    return '/'
  }
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
}

let localRefreshSeq = 0

async function refreshLocal(): Promise<void> {
  if (!localPath.value) {
    return
  }
  const listingPath = localPath.value
  const seq = ++localRefreshSeq
  localLoading.value = true
  try {
    const result = await fsApi.listDir({ path: listingPath })
    if (seq !== localRefreshSeq) {
      return
    }
    localPath.value = normalizeLocalPath(result.path || localPath.value)
    localEntries.value = result.entries ?? []
  } catch (e) {
    if (seq !== localRefreshSeq) {
      return
    }
    toast.error(e instanceof Error ? e.message : t('modules.ftp.loadError'))
  } finally {
    if (seq === localRefreshSeq) {
      localLoading.value = false
    }
  }
}

function setLocalPath(path: string): void {
  localPath.value = normalizeLocalPath(path)
  localEntries.value = []
  localPaneRef.value?.resetOnNavigate()
  void refreshLocal()
}

async function loadProfile(): Promise<void> {
  const result = await connectionApi.get({ profileId: props.profileId })
  profile.value = result.profile
}

async function initLocalPath(): Promise<void> {
  const home = await fsApi.homeDir()
  setLocalPath(home.path)
}

async function openSession(): Promise<void> {
  connecting.value = true
  error.value = null
  try {
    await acquireSession()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.ftp.session.connectError')
    toast.error(error.value)
  } finally {
    connecting.value = false
  }
}

async function silentReconnect(): Promise<void> {
  await reconnectSession()
  if (!sessionId.value) {
    throw new Error(t('modules.ftp.session.connectError'))
  }
}

/** 远程操作失败且像连接断开时，自动 forceReconnect 后重试一次。 */
async function withRemoteReconnect<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (!isFtpConnectionError(e)) {
      throw e
    }
    await silentReconnect()
    toast.info(t('modules.ftp.session.reconnected'))
    return fn()
  }
}

async function reconnect(): Promise<void> {
  connecting.value = true
  error.value = null
  try {
    await reconnectSession()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.ftp.session.connectError')
    toast.error(error.value)
  } finally {
    connecting.value = false
  }
}

async function refreshRemote(): Promise<void> {
  if (!sessionId.value) {
    return
  }
  loading.value = true
  error.value = null
  try {
    const result = await withRemoteReconnect(() => ftpApi.dirList({
      sessionId: sessionId.value!,
      path: remotePath.value,
    }))
    remotePath.value = result.path || remotePath.value
    entries.value = result.entries ?? []
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    if (message.includes('session busy')) {
      toast.warning(t('modules.ftp.session.listBusy'))
      return
    }
    error.value = message || t('modules.ftp.session.listError')
  } finally {
    loading.value = false
  }
}

function navigateRemote(path: string): void {
  remotePath.value = path
  remotePaneRef.value?.resetOnNavigate()
  void refreshRemote()
}

function navigateLocal(path: string): void {
  setLocalPath(path)
}

function goRemoteUp(): void {
  navigateRemote(parentRemotePath(remotePath.value))
}

function goLocalUp(): void {
  navigateLocal(parentLocalPath(localPath.value))
}

async function browseLocalFolder(): Promise<void> {
  try {
    const result = await dialogApi.openFolder({
      title: t('modules.ftp.session.browseLocalFolderTitle'),
      okButtonLabel: t('modules.ftp.session.browseLocalFolderConfirm'),
      defaultPath: localPath.value || undefined,
    })
    if (result.canceled || result.filePaths.length === 0) {
      return
    }
    setLocalPath(result.filePaths[0])
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.browseLocalFolderError'))
  }
}

async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path)
    toast.success(t('modules.ftp.session.pathCopied'))
  } catch {
    toast.error(t('modules.ftp.session.copyPathError'))
  }
}

async function showLocalInFolder(entry: FtpPaneEntry): Promise<void> {
  try {
    await fsApi.showInFolder({ path: joinLocalPath(localPath.value, entry.name) })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.showInFolderError'))
  }
}

async function enqueueDownloadEntry(entry: FtpPaneEntry): Promise<void> {
  await enqueueTransferItems('download', planDownloadItems([entry]))
}

async function enqueueUploadEntry(entry: FtpPaneEntry): Promise<void> {
  await enqueueTransferItems('upload', planUploadItems([entry]))
}

async function batchDownload(entriesToDownload: FtpPaneEntry[]): Promise<void> {
  await enqueueTransferItems('download', planDownloadItems(entriesToDownload))
}

async function batchUpload(entriesToUpload: FtpPaneEntry[]): Promise<void> {
  await enqueueTransferItems('upload', planUploadItems(entriesToUpload))
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
  loading.value = true
  let deleted = 0
  const failures: { name: string; error: string }[] = []
  try {
    for (const entry of items) {
      try {
        await withRemoteReconnect(() => ftpApi.entryDelete({
          sessionId: sessionId.value!,
          path: joinRemotePath(remotePath.value, entry.name),
          kind: entry.kind,
          recursive: entry.kind === 'dir',
        }))
        deleted++
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : t('modules.ftp.session.deleteError')
        failures.push({ name: entry.name, error: errorMsg })
      }
    }
    if (deleted > 0) {
      remotePaneRef.value?.clearSelection()
      await refreshRemote()
    }
    if (failures.length === 0) {
      toast.success(t('modules.ftp.session.deleted'))
    } else if (failures.length === 1) {
      const fail = failures[0]!
      toast.error(t('modules.ftp.session.deleteItemError', { name: fail.name, error: fail.error }))
    } else {
      toast.error(t('modules.ftp.session.deletePartialError', {
        failed: failures.length,
        total: items.length,
      }))
      toast.error(t('modules.ftp.session.deleteItemError', {
        name: failures[0]!.name,
        error: failures[0]!.error,
      }))
    }
  } finally {
    loading.value = false
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
  loading.value = true
  try {
    await withRemoteReconnect(() => ftpApi.entryRename({
      sessionId: sessionId.value!,
      fromPath: joinRemotePath(remotePath.value, entry.name),
      toPath: joinRemotePath(remotePath.value, newName.trim()),
    }))
    toast.success(t('modules.ftp.session.renamed'))
    await refreshRemote()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.renameError'))
  } finally {
    loading.value = false
  }
}

async function mkdirLocal(): Promise<void> {
  const name = await showPrompt(
    t('modules.ftp.session.mkdir'),
    t('modules.ftp.session.mkdirPrompt'),
  )
  if (!name) {
    return
  }
  localLoading.value = true
  try {
    await fsApi.mkdir({ path: joinLocalPath(localPath.value, name.trim()) })
    await refreshLocal()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.listError'))
  } finally {
    localLoading.value = false
  }
}

async function renameLocalEntry(entry: FtpPaneEntry): Promise<void> {
  const newName = await showPrompt(
    t('modules.ftp.session.rename'),
    t('modules.ftp.session.renamePrompt'),
    entry.name,
  )
  if (!newName || newName === entry.name) {
    return
  }
  localLoading.value = true
  try {
    await fsApi.rename({
      fromPath: joinLocalPath(localPath.value, entry.name),
      toPath: joinLocalPath(localPath.value, newName.trim()),
    })
    toast.success(t('modules.ftp.session.renamed'))
    await refreshLocal()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.renameError'))
  } finally {
    localLoading.value = false
  }
}

async function deleteLocalEntries(entries: FtpPaneEntry[]): Promise<void> {
  if (entries.length === 0) {
    return
  }
  let confirmMsg: string
  if (entries.length > 1) {
    confirmMsg = t('modules.ftp.session.deleteSelectedConfirm', { count: entries.length })
  } else if (entries[0].kind === 'dir') {
    confirmMsg = t('modules.ftp.session.deleteDirConfirm', { name: entries[0].name })
  } else {
    confirmMsg = t('modules.ftp.session.deleteConfirm', { name: entries[0].name })
  }
  if (!(await showConfirm(confirmMsg))) {
    return
  }
  localLoading.value = true
  let deleted = 0
  const failures: { name: string; error: string }[] = []
  try {
    for (const entry of entries) {
      try {
        await fsApi.delete({ path: joinLocalPath(localPath.value, entry.name) })
        deleted++
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : t('modules.ftp.session.deleteError')
        failures.push({ name: entry.name, error: errorMsg })
      }
    }
    if (deleted > 0) {
      await refreshLocal()
    }
    if (failures.length === 0) {
      toast.success(t('modules.ftp.session.deleted'))
    } else if (failures.length === 1) {
      const fail = failures[0]!
      toast.error(t('modules.ftp.session.deleteItemError', { name: fail.name, error: fail.error }))
    } else {
      toast.error(t('modules.ftp.session.deletePartialError', {
        failed: failures.length,
        total: entries.length,
      }))
      toast.error(t('modules.ftp.session.deleteItemError', {
        name: failures[0]!.name,
        error: failures[0]!.error,
      }))
    }
  } finally {
    localLoading.value = false
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
  loading.value = true
  try {
    await withRemoteReconnect(() => ftpApi.dirMake({
      sessionId: sessionId.value!,
      path: joinRemotePath(remotePath.value, name.trim()),
    }))
    await refreshRemote()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.listError'))
  } finally {
    loading.value = false
  }
}

function onLocalOpen(entry: FtpPaneEntry): void {
  if (entry.kind === 'dir') {
    navigateLocal(joinLocalPath(localPath.value, entry.name))
  } else {
    void enqueueUploadEntry(entry)
  }
}

function onRemoteOpen(entry: FtpPaneEntry): void {
  if (entry.kind === 'dir') {
    navigateRemote(joinRemotePath(remotePath.value, entry.name))
  } else {
    void enqueueDownloadEntry(entry)
  }
}

function onLocalCopyPath(name: string): void {
  void copyPath(joinLocalPath(localPath.value, name))
}

function onRemoteCopyPath(name: string): void {
  void copyPath(joinRemotePath(remotePath.value, name))
}

/** 在文件工作台中在线编辑本地文件 */
function onLocalOpenInEditor(entry: FtpPaneEntry): void {
  if (entry.kind !== 'file') {
    return
  }
  void openInFile({
    provider: 'local',
    label: entry.name,
    readonly: false,
    context: { path: joinLocalPath(localPath.value, entry.name) },
  })
}

/** 在文件工作台中在线编辑远程 FTP 文件 */
function onRemoteOpenInEditor(entry: FtpPaneEntry): void {
  if (entry.kind !== 'file' || !sessionId.value) {
    return
  }
  void openInFile({
    provider: 'ftp',
    label: entry.name,
    readonly: false,
    context: {
      sessionId: sessionId.value,
      path: joinRemotePath(remotePath.value, entry.name),
    },
  })
}

function buildLocalDragEntries(entriesToDrag: FtpPaneEntry[]): FtpDragEntry[] {
  return entriesToDrag.map((entry) => ({
    name: entry.name,
    kind: entry.kind === 'dir' ? 'dir' : 'file',
    path: joinLocalPath(localPath.value, entry.name),
  }))
}

function buildRemoteDragEntries(entriesToDrag: FtpPaneEntry[]): FtpDragEntry[] {
  return entriesToDrag.map((entry) => ({
    name: entry.name,
    kind: entry.kind === 'dir' ? 'dir' : 'file',
    path: joinRemotePath(remotePath.value, entry.name),
  }))
}

function resolveMoveDestination(
  target: FtpMoveTarget,
  joinPath: (base: string, name: string) => string,
  parentPath: (path: string) => string,
  currentPath: string,
): string {
  if (target.kind === 'parent') {
    return parentPath(currentPath)
  }
  return joinPath(currentPath, target.entry.name)
}

function canMoveDragEntries(
  sources: FtpDragEntry[],
  destinationDir: string,
  joinPath: (base: string, name: string) => string,
): boolean {
  const dest = destinationDir.replace(/[/\\]+$/, '')
  for (const source of sources) {
    const nextPath = joinPath(dest, source.name)
    if (source.path === nextPath) {
      return false
    }
    if (source.kind === 'dir' && isPathInside(source.path, dest)) {
      return false
    }
  }
  return true
}

async function moveLocalEntries(sources: FtpPaneEntry[], target: FtpMoveTarget): Promise<void> {
  const destinationDir = resolveMoveDestination(
    target,
    joinLocalPath,
    parentLocalPath,
    localPath.value,
  )
  const dragEntries = buildLocalDragEntries(sources)
  if (!canMoveDragEntries(dragEntries, destinationDir, joinLocalPath)) {
    toast.error(t('modules.ftp.session.moveInvalidTarget'))
    return
  }
  localLoading.value = true
  try {
    for (const entry of dragEntries) {
      await fsApi.rename({
        fromPath: entry.path,
        toPath: joinLocalPath(destinationDir, entry.name),
      })
    }
    toast.success(t('modules.ftp.session.moved'))
    localPaneRef.value?.clearSelection()
    await refreshLocal()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.moveError'))
  } finally {
    localLoading.value = false
  }
}

async function moveRemoteEntries(sources: FtpPaneEntry[], target: FtpMoveTarget): Promise<void> {
  if (!sessionId.value) {
    return
  }
  const destinationDir = resolveMoveDestination(
    target,
    joinRemotePath,
    parentRemotePath,
    remotePath.value,
  )
  const dragEntries = buildRemoteDragEntries(sources)
  if (!canMoveDragEntries(dragEntries, destinationDir, joinRemotePath)) {
    toast.error(t('modules.ftp.session.moveInvalidTarget'))
    return
  }
  loading.value = true
  try {
    for (const entry of dragEntries) {
      await withRemoteReconnect(() => ftpApi.entryRename({
        sessionId: sessionId.value!,
        fromPath: entry.path,
        toPath: joinRemotePath(destinationDir, entry.name),
      }))
    }
    toast.success(t('modules.ftp.session.moved'))
    remotePaneRef.value?.clearSelection()
    await refreshRemote()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.ftp.session.moveError'))
  } finally {
    loading.value = false
  }
}

function onLocalDragStart(e: DragEvent, entries: FtpPaneEntry[]): void {
  if (!entries.length) {
    return
  }
  writeFtpDragData(e, { side: 'local', entries: buildLocalDragEntries(entries) })
}

function onRemoteDragStart(e: DragEvent, entries: FtpPaneEntry[]): void {
  if (!entries.length) {
    return
  }
  writeFtpDragData(e, { side: 'remote', entries: buildRemoteDragEntries(entries) })
}

function onLocalDragOver(e: DragEvent): void {
  if (readFtpDragSideFromTypes(e) === 'remote') {
    e.preventDefault()
    dragOverLocal.value = true
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }
}

function onRemoteDragOver(e: DragEvent): void {
  if (readFtpDragSideFromTypes(e) === 'local') {
    e.preventDefault()
    dragOverRemote.value = true
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }
}

async function onLocalDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  dragOverLocal.value = false
  const payload = readFtpDragPayload(e)
  if (!payload || payload.side !== 'remote') {
    return
  }
  if (!payload.entries.length) {
    return
  }
  await enqueueTransferItems('download', planDragDownloadItems(payload.entries))
}

async function onRemoteDrop(e: DragEvent): Promise<void> {
  e.preventDefault()
  dragOverRemote.value = false
  const payload = readFtpDragPayload(e)
  if (!payload || payload.side !== 'local') {
    return
  }
  if (!payload.entries.length) {
    return
  }
  await enqueueTransferItems('upload', planDragUploadItems(payload.entries))
}

onMounted(async () => {
  try {
    await loadProfile()
    await initLocalPath()
    await openSession()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('modules.ftp.loadError')
    // openSession 的 finally 仅在自身执行后运行；如果 loadProfile / initLocalPath
    // 先抛出，connecting 会卡在初始的 true，此处兜底确保错误态下不显示无限 loading
    connecting.value = false
  }
})

watch(
  () => sessionActionStore.reconnectSignals[props.profileId],
  (val) => {
    if (val) void reconnect()
  },
)

</script>

<template>
  <div class="nm-ftp-session">
    <p v-if="error" class="nm-ftp-session__error" role="alert">{{ error }}</p>

    <RsLoading v-if="connecting" class="nm-ftp-session__loading" />

    <div v-else class="nm-ftp-session__body">
      <RsSplitPane
        ref="queueSplitRef"
        v-model:sizes="queueSplitSizes"
        class="nm-ftp-session__queue-split"
        orientation="vertical"
        :panes="queueSplitPanes"
        with-handle
        @collapse="onQueueSplitCollapse"
        @expand="onQueueSplitExpand"
        @resize-end="onQueueResizeEnd"
      >
        <template #workspace>
          <RsSplitPane
            v-model:sizes="fileSplitSizes"
            class="nm-ftp-session__split"
            :panes="splitPanes"
            with-handle
          >
            <template #local>
          <FtpFilePane
            ref="localPaneRef"
            side="local"
            browse-folder
            :label="t('modules.ftp.session.local')"
            :path="localPath"
            :entries="localPaneEntries"
            :loading="localLoading"
            :drag-over="dragOverLocal"
            :can-go-up="canGoLocalUp"
            @update:path="localPath = $event"
            @refresh="refreshLocal"
            @go-up="goLocalUp"
            @browse-folder="browseLocalFolder"
            @mkdir="mkdirLocal"
            @open="onLocalOpen"
            @upload="enqueueUploadEntry"
            @upload-selected="batchUpload"
            @delete="deleteLocalEntries"
            @delete-selected="deleteLocalEntries"
            @rename="renameLocalEntry"
            @show-in-folder="showLocalInFolder"
            @copy-path="onLocalCopyPath"
            @open-in-editor="onLocalOpenInEditor"
            @move="(sources, target) => void moveLocalEntries(sources, target)"
            @dragstart="onLocalDragStart"
            @dragover="onLocalDragOver"
            @dragleave="dragOverLocal = false"
            @drop="onLocalDrop"
          />
        </template>

        <template #remote>
          <FtpFilePane
            ref="remotePaneRef"
            side="remote"
            :label="t('modules.ftp.session.remote')"
            :path="remotePath"
            :entries="remotePaneEntries"
            :loading="loading"
            :drag-over="dragOverRemote"
            :can-go-up="remotePath !== '/'"
            show-modified
            @update:path="remotePath = $event"
            @refresh="refreshRemote"
            @go-up="goRemoteUp"
            @mkdir="mkdirRemote"
            @open="onRemoteOpen"
            @download="enqueueDownloadEntry"
            @download-selected="batchDownload"
            @delete="deleteRemoteEntries"
            @delete-selected="deleteRemoteEntries"
            @rename="renameRemoteEntry"
            @copy-path="onRemoteCopyPath"
            @open-in-editor="onRemoteOpenInEditor"
            @move="(sources, target) => void moveRemoteEntries(sources, target)"
            @dragstart="onRemoteDragStart"
            @dragover="onRemoteDragOver"
            @dragleave="dragOverRemote = false"
            @drop="onRemoteDrop"
          />
            </template>
          </RsSplitPane>
        </template>

        <template #queue>
          <div
            class="nm-ftp-session__queue-slot"
            :class="{ 'nm-ftp-session__queue-slot--collapsed': queueUiCollapsed }"
          >
            <TransferQueue
              ref="transferQueueRef"
              :tasks="tasks"
              :collapsed="queueUiCollapsed"
              @toggle-collapse="toggleQueueCollapse"
              @cancel="(id) => void cancel(id)"
              @pause="(id) => void pause(id)"
              @resume="(id) => void resume(id)"
            />
          </div>
        </template>
      </RsSplitPane>
    </div>

    <!-- 输入对话框：新建文件夹 / 重命名 -->
    <RsDialog
      v-model:open="promptOpen"
      :title="promptTitle"
      width="sm"
      layout="confirm"
      :resizable="false"
      :fullscreenable="false"
      :show-close="false"
    >
      <template #body>
      <RsInput
        ref="promptInputRef"
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

    <!-- 确认对话框：删除 -->
    <RsConfirmDialog
      v-model:open="confirmOpen"
      :description="confirmDesc"
      @confirm="onConfirmOk"
      @cancel="onConfirmCancel"
    />
  </div>
</template>

<style scoped>
.nm-ftp-session {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--nm-editor-bg, var(--rs-surface));
}

.nm-ftp-session__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-ftp-session__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-ftp-session__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.nm-ftp-session__queue-split {
  flex: 1;
  min-height: 0;
}

.nm-ftp-session__queue-split :deep(.rs-split__pane) {
  min-height: 0;
}

/* 折叠/悬浮时分割线始终可见 */
.nm-ftp-session__queue-split :deep(.rs-split__resizer) {
  opacity: 1;
  background: var(--rs-border-subtle);
}

.nm-ftp-session__queue-split :deep(.rs-split__resizer--handle) {
  background: var(--rs-border-subtle);
}

.nm-ftp-session__queue-slot {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.nm-ftp-session__queue-slot--collapsed {
  height: auto;
  justify-content: flex-start;
}

.nm-ftp-session__split {
  height: 100%;
  min-height: 0;
}

.nm-ftp-session__split :deep(.rs-split__pane) {
  min-width: 0;
}
</style>
