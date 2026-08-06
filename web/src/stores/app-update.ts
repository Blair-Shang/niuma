import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isBridgeAvailable } from '@/api/client'
import { CloudApiError } from '@/api/cloud/client'
import { checkAppUpdate, fetchLatestRelease, type UpdateRelease } from '@/api/cloud/updates'
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

type Phase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'forced'
  | 'downloading'
  | 'verifying'
  | 'applying'
  | 'error'

function mapPlatform(raw?: string | null): string {
  const p = (raw || '').toLowerCase()
  if (p === 'kylin' || p === 'linux') return 'linux'
  if (p === 'macos' || p === 'darwin') return 'macos'
  return 'windows'
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

export const useAppUpdateStore = defineStore('appUpdate', () => {
  const phase = ref<Phase>('idle')
  const latest = ref<UpdateRelease | null>(null)
  const forceUpdate = ref(false)
  const error = ref('')
  const dialogOpen = ref(false)
  const aboutOpen = ref(false)
  const changelogOpen = ref(false)
  const changelogRelease = ref<UpdateRelease | null>(null)
  const changelogLoading = ref(false)
  const changelogError = ref('')
  const changelogHasUpdate = ref(false)
  const aboutChecking = ref(false)
  const received = ref(0)
  const total = ref(0)
  const localPath = ref('')

  const progressPercent = computed(() => {
    if (total.value <= 0) return 0
    return Math.min(100, Math.round((received.value / total.value) * 100))
  })

  /** P0 仅 Windows 走应用内下载 Setup；其它平台打开下载链。 */
  const inAppInstallSupported = computed(() => {
    const bridge = useBridgeStore()
    return mapPlatform(bridge.shellInfo?.platform) === 'windows'
  })

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
    if (forceUpdate.value && (phase.value === 'available' || phase.value === 'forced')) return
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
    changelogHasUpdate.value = false
    const { platform, arch, current } = platformArch()
    try {
      const [rel, checkRes] = await Promise.all([
        fetchLatestRelease({ platform, arch }),
        current
          ? checkAppUpdate({ current, platform, arch }).catch(() => null)
          : Promise.resolve(null),
      ])
      changelogRelease.value = rel
      if (checkRes?.updateAvailable && checkRes.latest) {
        changelogHasUpdate.value = true
        latest.value = checkRes.latest
        forceUpdate.value = !!checkRes.forceUpdate
        phase.value = forceUpdate.value ? 'forced' : 'available'
      }
    } catch (e) {
      if (e instanceof CloudApiError && (e.status === 404 || e.code === 'not_found')) {
        changelogRelease.value = null
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
  }

  function snooze() {
    if (forceUpdate.value || !latest.value) return
    writeSnooze(latest.value.version)
    dialogOpen.value = false
    phase.value = 'idle'
  }

  async function check(opts?: { manual?: boolean }) {
    const bridge = useBridgeStore()
    const current = bridge.shellVersion?.trim()
    if (!current) {
      if (opts?.manual) error.value = 'noLocalVersion'
      return
    }
    phase.value = 'checking'
    error.value = ''
    try {
      const platform = mapPlatform(bridge.shellInfo?.platform)
      const arch = (bridge.shellInfo?.arch || 'x64').toLowerCase()
      const res = await checkAppUpdate({ current, platform, arch })
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
      if (!opts?.manual && !forceUpdate.value) {
        const sn = readSnooze()
        if (sn && sn.version === res.latest.version && sn.until > Date.now()) {
          phase.value = 'idle'
          return
        }
      }
      dialogOpen.value = true
    } catch (e) {
      phase.value = 'error'
      error.value = mapUpdateError(e, 'checkFailed')
      if (opts?.manual) dialogOpen.value = true
      else phase.value = 'idle'
    }
  }

  async function startUpdate() {
    if (!latest.value) return
    if (!isBridgeAvailable()) {
      error.value = 'desktopOnly'
      return
    }
    error.value = ''
    // 非 Windows：不走半成品 apply，直接打开发布包 HTTPS 链接
    if (!inAppInstallSupported.value) {
      try {
        await shellApi.openExternal({ url: latest.value.downloadUrl })
      } catch (e) {
        error.value = mapUpdateError(e, 'openDownloadFailed')
      }
      return
    }
    phase.value = 'downloading'
    received.value = 0
    total.value = latest.value.fileSize || 0
    const off = onShellUpdateProgress((p) => {
      received.value = p.received
      total.value = p.total || total.value
    })
    try {
      const dl = await shellUpdateDownload({
        url: latest.value.downloadUrl,
        sha256: latest.value.sha256,
        expectedSize: latest.value.fileSize || undefined,
      })
      localPath.value = dl.path
      phase.value = 'verifying'
      await shellUpdateVerify({ path: dl.path, sha256: latest.value.sha256 })
      phase.value = 'applying'
      await shellUpdateApply({ path: dl.path })
    } catch (e) {
      phase.value = forceUpdate.value ? 'forced' : 'available'
      error.value = mapUpdateError(e, 'updateFailed')
    } finally {
      off()
    }
  }

  async function cancelDownload() {
    try {
      await shellUpdateCancel()
    } catch {
      /* ignore */
    }
    phase.value = forceUpdate.value ? 'forced' : 'available'
  }

  const HOUR_MS = 60 * 60 * 1000
  let hourlyTimer: ReturnType<typeof setInterval> | null = null

  /** 启动后延迟检查一次，之后每小时检查一次（手动检查不受影响）。 */
  function scheduleStartupCheck(delayMs = 10_000) {
    window.setTimeout(() => {
      void check({ manual: false })
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
    cancelDownload,
    scheduleStartupCheck,
  }
})
