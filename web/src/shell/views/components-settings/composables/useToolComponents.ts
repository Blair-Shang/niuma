import { useRsToast } from '@niuma/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { componentsApi, dialogApi, fsApi, shellApi, subscribeBridgeEventByPrefix } from '@/api'
import type {
  ComponentsInstallProgressEvent,
  ToolComponentBundle,
  ToolComponentEntry,
} from '@/api/types/components'
import type { LocalEntry } from '@/api/types/fs'
import { useBridgeStore } from '@/stores/bridge'
import {
  browseAccept,
  browseMode,
  libraryNames,
  rowKey,
  toolDisplayName,
} from '../utils/presentation'

export interface ComponentsInstallProgress {
  bundleId: string
  toolId?: string
  phase: string
  percent: number
  bytesReceived: number
  bytesTotal: number
}

function installBusyKey(bundleId: string, toolId?: string): string {
  return toolId ? `install:${bundleId}:${toolId}` : `install:${bundleId}`
}

function joinLocalPath(dir: string, name: string): string {
  const trimmed = dir.replace(/[/\\]+$/, '')
  const sep = trimmed.includes('\\') ? '\\' : '/'
  return `${trimmed}${sep}${name}`
}

/** 在目录条目中按优先名匹配库文件（支持 libclntsh.so*）。 */
function matchLibraryEntry(entries: LocalEntry[], preferred: string[]): LocalEntry | null {
  const files = entries.filter((e) => e.kind === 'file')
  for (const want of preferred) {
    const lower = want.toLowerCase()
    const exact = files.find((e) => e.name.toLowerCase() === lower)
    if (exact) return exact
    if (lower.endsWith('.so')) {
      const prefix = files.find(
        (e) => e.name.toLowerCase() === lower || e.name.toLowerCase().startsWith(`${lower}.`),
      )
      if (prefix) return prefix
    }
  }
  return null
}

export function useToolComponents() {
  const { t, te } = useI18n()
  const toast = useRsToast()
  const bridgeStore = useBridgeStore()

  const bundles = ref<ToolComponentBundle[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)
  const busyKey = ref<string | null>(null)
  const selectedBundleId = ref<string | null>(null)
  const installProgress = ref<ComponentsInstallProgress | null>(null)
  let offInstallProgress: (() => void) | null = null

  const hasBundles = computed(() => bundles.value.length > 0)

  const selectedBundle = computed(() => {
    if (!selectedBundleId.value) {
      return null
    }
    return bundles.value.find((bundle) => bundle.bundleId === selectedBundleId.value) ?? null
  })

  const bundleInstalling = computed(() => {
    const key = busyKey.value
    if (!key?.startsWith('install:')) return false
    const bundle = selectedBundle.value
    if (!bundle) return false
    return key === installBusyKey(bundle.bundleId) || key.startsWith(`install:${bundle.bundleId}:`)
  })

  watch(
    bundles,
    (list) => {
      if (!list.length) {
        selectedBundleId.value = null
        return
      }
      if (!selectedBundleId.value || !list.some((bundle) => bundle.bundleId === selectedBundleId.value)) {
        selectedBundleId.value = list[0].bundleId
      }
    },
    { immediate: true },
  )

  function selectBundle(bundleId: string): void {
    selectedBundleId.value = bundleId
  }

  async function loadBundles(): Promise<void> {
    if (!bridgeStore.connected) {
      bundles.value = []
      loading.value = false
      return
    }
    loading.value = true
    error.value = null
    try {
      const result = await componentsApi.list()
      bundles.value = result.bundles ?? []
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  async function detectBundle(bundleId: string): Promise<void> {
    busyKey.value = `detect:${bundleId}`
    try {
      const result = await componentsApi.detect({ bundleId })
      const idx = bundles.value.findIndex((b) => b.bundleId === bundleId)
      if (idx >= 0) {
        bundles.value[idx] = result.bundle
      } else {
        bundles.value.push(result.bundle)
      }
      toast.success(t('settings.componentsDetectDone'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      busyKey.value = null
    }
  }

  async function savePath(bundleId: string, toolId: string, path: string): Promise<void> {
    const key = rowKey(bundleId, toolId)
    busyKey.value = `path:${key}`
    try {
      await componentsApi.setPath({ bundleId, toolId, path })
      await loadBundles()
      toast.success(t('settings.componentsPathSaved'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      busyKey.value = null
    }
  }

  async function browsePath(bundle: ToolComponentBundle, tool: ToolComponentEntry): Promise<void> {
    const name = toolDisplayName(t, te, bundle, tool)
    if (browseMode(bundle) === 'folder') {
      const result = await dialogApi.openFolder({
        title: t('settings.componentsBrowseFolderTitle', { name }),
      })
      if (result.canceled || !result.filePaths[0]) {
        return
      }
      const dir = result.filePaths[0]
      const preferred = libraryNames(bundle)
      try {
        const listed = await fsApi.listDir({ path: dir })
        const hit = matchLibraryEntry(listed.entries ?? [], preferred)
        if (!hit) {
          toast.error(
            t('settings.componentsLibraryNotFound', {
              names: preferred.length ? preferred.join(' / ') : 'oci.dll',
              dir,
            }),
          )
          return
        }
        await savePath(bundle.bundleId, tool.toolId, joinLocalPath(dir, hit.name))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      }
      return
    }

    const result = await dialogApi.openFile({
      title: t('settings.componentsBrowseTitle', { name }),
      accept: browseAccept(bundle),
    })
    if (result.canceled || !result.filePaths[0]) {
      return
    }
    await savePath(bundle.bundleId, tool.toolId, result.filePaths[0])
  }

  async function clearPath(bundleId: string, toolId: string): Promise<void> {
    await savePath(bundleId, toolId, '')
  }

  function ensureInstallProgressSub(): void {
    if (offInstallProgress) return
    offInstallProgress = subscribeBridgeEventByPrefix(
      'platform.components.install.',
      (detail) => {
        const ev = detail as ComponentsInstallProgressEvent
        if (!ev?.bundleId || typeof ev.phase !== 'string') return
        const key = busyKey.value
        if (!key?.startsWith(`install:${ev.bundleId}`)) return
        installProgress.value = {
          bundleId: ev.bundleId,
          toolId: typeof ev.toolId === 'string' && ev.toolId ? ev.toolId : undefined,
          phase: ev.phase,
          percent: typeof ev.percent === 'number' ? Math.max(0, Math.min(100, ev.percent)) : 0,
          bytesReceived: typeof ev.bytesReceived === 'number' ? ev.bytesReceived : 0,
          bytesTotal: typeof ev.bytesTotal === 'number' ? ev.bytesTotal : 0,
        }
      },
    )
  }

  async function installBundle(bundleId: string, toolId?: string): Promise<void> {
    busyKey.value = installBusyKey(bundleId, toolId)
    installProgress.value = {
      bundleId,
      toolId,
      phase: 'downloading',
      percent: 0,
      bytesReceived: 0,
      bytesTotal: 0,
    }
    ensureInstallProgressSub()
    try {
      const result = await componentsApi.install({
        bundleId,
        ...(toolId ? { toolId } : {}),
      })
      const idx = bundles.value.findIndex((b) => b.bundleId === bundleId)
      if (idx >= 0) {
        bundles.value[idx] = result.bundle
      } else {
        bundles.value.push(result.bundle)
      }
      toast.success(
        toolId
          ? t('settings.componentsInstallToolDone', { tool: toolId })
          : t('settings.componentsInstallDone'),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      busyKey.value = null
      installProgress.value = null
    }
  }

  async function openDownload(bundleId: string, toolId: string): Promise<void> {
    busyKey.value = `dl:${rowKey(bundleId, toolId)}`
    try {
      const result = await componentsApi.getDownload({ bundleId, toolId })
      if (!result.url) {
        return
      }
      if (bridgeStore.connected) {
        await shellApi.openExternal({ url: result.url })
        return
      }
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      busyKey.value = null
    }
  }

  onMounted(() => {
    void loadBundles()
  })

  onBeforeUnmount(() => {
    offInstallProgress?.()
    offInstallProgress = null
  })

  return {
    bundles,
    loading,
    error,
    busyKey,
    installProgress,
    bundleInstalling,
    selectedBundleId,
    hasBundles,
    selectedBundle,
    bridgeStore,
    selectBundle,
    loadBundles,
    detectBundle,
    browsePath,
    clearPath,
    installBundle,
    openDownload,
  }
}
