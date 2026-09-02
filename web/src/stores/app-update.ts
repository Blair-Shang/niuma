import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isBridgeAvailable } from '@/api/client'
import { CloudApiError } from '@/api/cloud/client'
import {
  checkAppUpdate,
  fetchLatestRelease,
  fetchPublishedRelease,
  fetchReleaseHistory,
  recordUpdateHit,
  type UpdateRelease,
} from '@/api/cloud/updates'
import { shellApi } from '@/api/shell'
import {
  onShellUpdateProgress,
  shellUpdateApply,
  shellUpdateCancel,
  shellUpdateDownload,
  shellUpdateVerify,
} from '@/api/shell-update'
import { useBridgeStore } from '@/stores/bridge'

/** Bridge / 网络错误映射为 appUpdate.errors.* 键；未知则回落原文。 */
function mapUpdateError(e: unknown, fallbackKey: string): string {
  if (e instanceof CloudApiError) {
    if (e.code === 'network_error') return 'network_error'
    return e.code || fallbackKey
  }
  const msg = e instanceof Error ? e.message : ''
  const known = [
    'cancelled',
    'hash_mismatch',
    'host_not_allowed',
    'file_missing',
    'network_error',
    'apply_unsupported_platform',
    'openDownloadFailed',
  ]
  for (const code of known) {
    if (msg === code || msg.includes(code)) return code
  }
  return fallbackKey
}

const SNOOZE_KEY = 'niuma.appUpdate.snooze'
const READY_KEY = 'niuma.appUpdate.readyPack'

type Phase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'forced'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'applying'
  | 'error'

type ReadyPack = { version: string; path: string }

function mapPlatform(raw?: string | null): string {
  const p = (raw || '').toLowerCase()
  if (p === 'kylin' || p === 'linux') return 'linux'
  if (p === 'macos' || p === 'darwin') return 'macos'
  return 'windows'
}

/** Linux / macOS 尚未稳定，检查与官网同一条 beta 渠道。 */
function updateChannel(platform: string): string {
  return platform === 'windows' ? 'stable' : 'beta'
}

function readSnooze(): { version: string; until: number } | null {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as { version: string; until: number }
  } catch {
    return null
  }
}

function writeSnooze(version: string, hours = 24) {
  localStorage.setItem(
    SNOOZE_KEY,
    JSON.stringify({ version, until: Date.now() + hours * 3600 * 1000 }),
  )
}

function readReadyPack(): ReadyPack | null {
  try {
    const raw = localStorage.getItem(READY_KEY)
    if (!raw) return null
    const pack = JSON.parse(raw) as ReadyPack
    if (!pack.version || !pack.path) return null
    return pack
  } catch {
    return null
  }
}

function writeReadyPack(pack: ReadyPack) {
  localStorage.setItem(READY_KEY, JSON.stringify(pack))
}

function clearReadyPack() {
  localStorage.removeItem(READY_KEY)
}

export const useAppUpdateStore = defineStore('appUpdate', () => {
  const phase = ref<Phase>('idle')
  const latest = ref<UpdateRelease | null>(null)
  const forceUpdate = ref(false)
  const error = ref('')
  const dialogOpen = ref(false)
  const aboutOpen = ref(false)
  const changelogOpen = ref(false)
  const changelogRelease = ref<UpdateRelease | null>(null)
  const changelogItems = ref<UpdateRelease[]>([])
  const changelogLoading = ref(false)
  const changelogError = ref('')
  const changelogHasUpdate = ref(false)
  const aboutChecking = ref(false)
  const received = ref(0)
  const total = ref(0)
  const localPath = ref('')
  let downloadTask: Promise<void> | null = null
  let progressOff: (() => void) | null = null

  const progressPercent = computed(() => {
    if (total.value <= 0) return 0
    return Math.min(100, Math.round((received.value / total.value) * 100))
  })

  /** Windows / Linux / macOS 均走应用内下载 + 拉起安装包。 */
  const inAppInstallSupported = computed(() => isBridgeAvailable())

  function platformArch() {
    const bridge = useBridgeStore()
    return {
      platform: mapPlatform(bridge.shellInfo?.platform),
      arch: (bridge.shellInfo?.arch || 'x64').toLowerCase(),
      current: bridge.shellVersion?.trim() || '',
    }
  }

  function openDialog() {
    dialogOpen.value = true
  }

  function closeDialog() {
    if (forceUpdate.value) return
    dialogOpen.value = false
  }

  function openAbout() {
    aboutOpen.value = true
  }

  function closeAbout() {
    aboutOpen.value = false
  }

  async function openChangelog() {
    changelogOpen.value = true
    changelogLoading.value = true
    changelogError.value = ''
    changelogRelease.value = null
    changelogItems.value = []
    changelogHasUpdate.value = false
    const { platform, arch, current } = platformArch()
    const channel = updateChannel(platform)
    try {
      const [items, checkRes] = await Promise.all([
        fetchReleaseHistory({ platform, arch, channel, limit: 3 }).catch(async (e) => {
          if (e instanceof CloudApiError && (e.status === 404 || e.code === 'not_found')) {
            return [] as UpdateRelease[]
          }
          const one = await fetchLatestRelease({ platform, arch, channel }).catch(() => null)
          return one ? [one] : Promise.reject(e)
        }),
        current
          ? checkAppUpdate({ current, platform, arch, channel }).catch(() => null)
          : Promise.resolve(null),
      ])
      const cards = items.slice(0, 3)
      const filled = await Promise.all(
        cards.map((card) =>
          card.notesMd
            ? Promise.resolve(card)
            : fetchPublishedRelease({ platform, arch, channel, version: card.version }).catch(
                () => card,
              ),
        ),
      )
      changelogItems.value = filled
      changelogRelease.value = filled[0] ?? null
      if (checkRes?.updateAvailable && checkRes.latest) {
        changelogHasUpdate.value = true
        latest.value = checkRes.latest
        forceUpdate.value = !!checkRes.forceUpdate
        if (
          phase.value !== 'downloading' &&
          phase.value !== 'verifying' &&
          phase.value !== 'ready' &&
          phase.value !== 'applying'
        ) {
          phase.value = forceUpdate.value ? 'forced' : 'available'
        }
        startSilentDownload()
      }
    } catch (e) {
      if (e instanceof CloudApiError && (e.status === 404 || e.code === 'not_found')) {
        changelogRelease.value = null
        changelogItems.value = []
      } else {
        changelogError.value = mapUpdateError(e, 'checkFailed')
      }
    } finally {
      changelogLoading.value = false
    }
  }

  function closeChangelog() {
    changelogOpen.value = false
  }

  /** 从「关于」发起检查更新。 */
  async function checkFromAbout() {
    aboutChecking.value = true
    try {
      await check({ manual: true })
      if (dialogOpen.value) aboutOpen.value = false
    } finally {
      aboutChecking.value = false
    }
  }

  /** 从更新日志跳转到安装更新流程。 */
  function updateFromChangelog() {
    if (!latest.value && changelogRelease.value) {
      latest.value = changelogRelease.value
      phase.value = 'available'
    }
    if (!latest.value) return
    changelogOpen.value = false
    dialogOpen.value = true
    startSilentDownload()
  }

  function snooze() {
    if (forceUpdate.value || !latest.value) return
    writeSnooze(latest.value.version)
    dialogOpen.value = false
    // 稍后提醒只关窗，后台下载继续。
    if (phase.value === 'idle') {
      void ensureDownloaded()
    }
  }

  function stopProgressListen() {
    if (progressOff) {
      progressOff()
      progressOff = null
    }
  }

  /** 下载并校验安装包，不拉起安装、不退出应用。关窗后仍继续。 */
  async function ensureDownloaded(): Promise<string> {
    if (!latest.value) {
      throw new Error('updateFailed')
    }
    if (!isBridgeAvailable()) {
      throw new Error('desktopOnly')
    }
    const version = latest.value.version
    const sha256 = latest.value.sha256
    if (phase.value === 'ready' && localPath.value) {
      return localPath.value
    }
    if (downloadTask) {
      await downloadTask
      if (phase.value === 'ready' && localPath.value) {
        return localPath.value
      }
      throw new Error(error.value || 'updateFailed')
    }

    downloadTask = (async () => {
      error.value = ''
      const cached = readReadyPack()
      if (cached && cached.version === version) {
        try {
          await shellUpdateVerify({ path: cached.path, sha256 })
          localPath.value = cached.path
          phase.value = 'ready'
          return
        } catch {
          clearReadyPack()
        }
      }

      phase.value = 'downloading'
      received.value = 0
      total.value = latest.value?.fileSize || 0
      stopProgressListen()
      progressOff = onShellUpdateProgress((p) => {
        received.value = p.received
        total.value = p.total || total.value
      })
      try {
        const dl = await shellUpdateDownload({
          url: latest.value!.downloadUrl,
          sha256,
          expectedSize: latest.value!.fileSize || undefined,
        })
        localPath.value = dl.path
        phase.value = 'verifying'
        await shellUpdateVerify({ path: dl.path, sha256 })
        writeReadyPack({ version, path: dl.path })
        phase.value = 'ready'
      } finally {
        stopProgressListen()
      }
    })()

    try {
      await downloadTask
    } finally {
      downloadTask = null
    }
    if (phase.value !== 'ready' || !localPath.value) {
      throw new Error(error.value || 'updateFailed')
    }
    return localPath.value
  }

  function startSilentDownload() {
    if (!latest.value || !isBridgeAvailable()) return
    if (phase.value === 'ready' || phase.value === 'applying') return
    if (downloadTask) return
    void ensureDownloaded().catch((e) => {
      error.value = mapUpdateError(e, 'updateFailed')
      phase.value = forceUpdate.value ? 'forced' : 'available'
    })
  }

  async function check(opts?: { manual?: boolean; prompt?: boolean }) {
    const bridge = useBridgeStore()
    const current = bridge.shellVersion?.trim()
    if (!current) {
      if (opts?.manual) error.value = 'noLocalVersion'
      return
    }
    const busy =
      phase.value === 'downloading' ||
      phase.value === 'verifying' ||
      phase.value === 'ready' ||
      phase.value === 'applying'
    if (busy) {
      if (opts?.manual || opts?.prompt || forceUpdate.value) dialogOpen.value = true
      return
    }
    phase.value = 'checking'
    error.value = ''
    try {
      const platform = mapPlatform(bridge.shellInfo?.platform)
      const arch = (bridge.shellInfo?.arch || 'x64').toLowerCase()
      const res = await checkAppUpdate({ current, platform, arch, channel: updateChannel(platform) })
      if (!res.updateAvailable || !res.latest) {
        phase.value = 'idle'
        latest.value = null
        forceUpdate.value = false
        if (opts?.manual) {
          dialogOpen.value = true
          error.value = ''
          // 手动检查且已最新：用空 latest + idle 表示 up-to-date
          phase.value = 'idle'
        }
        return
      }
      latest.value = res.latest
      forceUpdate.value = !!res.forceUpdate
      phase.value = forceUpdate.value ? 'forced' : 'available'
      const snoozed =
        !opts?.manual &&
        !forceUpdate.value &&
        (() => {
          const sn = readSnooze()
          return !!(sn && sn.version === res.latest.version && sn.until > Date.now())
        })()
      // 手动检查、强制更新、或启动后首次发现（未稍后提醒）才弹窗；每小时复查保持静默。
      if (opts?.manual || forceUpdate.value || (opts?.prompt && !snoozed)) {
        dialogOpen.value = true
      }
      if (!snoozed || forceUpdate.value) {
        void recordUpdateHit({
          product: res.latest.product,
          channel: res.latest.channel,
          platform: res.latest.platform,
          arch: res.latest.arch,
          version: res.latest.version,
        }).catch(() => undefined)
      }
      startSilentDownload()
    } catch (e) {
      // 自动检查失败不打扰；仅手动检查展示错误。
      if (opts?.manual) {
        phase.value = 'error'
        error.value = mapUpdateError(e, 'checkFailed')
        dialogOpen.value = true
      } else {
        error.value = ''
        phase.value = 'idle'
      }
    }
  }

  /** 用户点「立即更新」：开始或继续后台下载，不立刻退出。已就绪则重启安装。 */
  async function startUpdate() {
    if (!latest.value) return
    if (!isBridgeAvailable()) {
      error.value = 'desktopOnly'
      return
    }
    error.value = ''
    void recordUpdateHit({
      product: latest.value.product,
      channel: latest.value.channel,
      platform: latest.value.platform,
      arch: latest.value.arch,
      version: latest.value.version,
    }).catch(() => undefined)
    if (phase.value === 'ready' && localPath.value) {
      await restartToUpdate()
      return
    }
    try {
      await ensureDownloaded()
    } catch (e) {
      const code = mapUpdateError(e, 'updateFailed')
      if (code === 'apply_unsupported_platform' && latest.value.downloadUrl) {
        try {
          await shellApi.openExternal({ url: latest.value.downloadUrl })
          error.value = ''
          phase.value = forceUpdate.value ? 'forced' : 'available'
          return
        } catch (openErr) {
          error.value = mapUpdateError(openErr, 'openDownloadFailed')
        }
      } else {
        error.value = code
      }
      phase.value = forceUpdate.value ? 'forced' : 'available'
    }
  }

  /** 拉起安装包并退出本进程；下载未完成时先等后台下完。 */
  async function restartToUpdate() {
    if (!latest.value) return
    error.value = ''
    try {
      const path = await ensureDownloaded()
      phase.value = 'applying'
      await shellUpdateApply({ path })
      clearReadyPack()
    } catch (e) {
      const code = mapUpdateError(e, 'updateFailed')
      if (code === 'apply_unsupported_platform' && latest.value.downloadUrl) {
        try {
          await shellApi.openExternal({ url: latest.value.downloadUrl })
          error.value = ''
          phase.value = 'ready'
          return
        } catch (openErr) {
          error.value = mapUpdateError(openErr, 'openDownloadFailed')
        }
      } else {
        error.value = code
      }
      phase.value = localPath.value ? 'ready' : forceUpdate.value ? 'forced' : 'available'
    }
  }

  async function cancelDownload() {
    try {
      await shellUpdateCancel()
    } catch {
      /* ignore */
    }
    downloadTask = null
    stopProgressListen()
    phase.value = forceUpdate.value ? 'forced' : 'available'
  }

  const HOUR_MS = 60 * 60 * 1000
  let hourlyTimer: ReturnType<typeof setInterval> | null = null

  /** 启动完成后检查一次：有新版本弹窗，失败或已最新静默。之后每小时静默复查。 */
  function scheduleStartupCheck(delayMs = 10_000) {
    window.setTimeout(() => {
      void check({ prompt: true })
    }, delayMs)
    if (hourlyTimer != null) {
      clearInterval(hourlyTimer)
    }
    hourlyTimer = setInterval(() => {
      void check({ manual: false })
    }, HOUR_MS)
  }

  return {
    phase,
    latest,
    forceUpdate,
    error,
    dialogOpen,
    aboutOpen,
    aboutChecking,
    changelogOpen,
    changelogRelease,
    changelogItems,
    changelogLoading,
    changelogError,
    changelogHasUpdate,
    received,
    total,
    progressPercent,
    inAppInstallSupported,
    openDialog,
    closeDialog,
    openAbout,
    closeAbout,
    openChangelog,
    closeChangelog,
    checkFromAbout,
    updateFromChangelog,
    snooze,
    check,
    startUpdate,
    restartToUpdate,
    cancelDownload,
    scheduleStartupCheck,
  }
})
