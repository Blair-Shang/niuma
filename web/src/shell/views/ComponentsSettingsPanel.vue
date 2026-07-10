<script setup lang="ts">
import { RsButton, RsIcon, RsLoading, RsTooltip, useRsToast } from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { componentsApi, dialogApi } from '@/api'
import type { ToolComponentBundle, ToolComponentEntry, ToolComponentStatus } from '@/api/types/components'
import { useBridgeStore } from '@/stores/bridge'

const { t, te } = useI18n()
const toast = useRsToast()
const bridgeStore = useBridgeStore()

const bundles = ref<ToolComponentBundle[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const busyKey = ref<string | null>(null)
const selectedBundleId = ref<string | null>(null)

function bundleLocaleKey(bundleId: string): string {
  return bundleId.replaceAll('.', '_')
}

function rowKey(bundleId: string, toolId: string): string {
  return `${bundleId}:${toolId}`
}

function bundleDisplayName(bundle: ToolComponentBundle): string {
  const key = `settings.componentBundles.${bundleLocaleKey(bundle.bundleId)}.name`
  return te(key) ? t(key) : bundle.name
}

function toolDisplayName(bundle: ToolComponentBundle, tool: ToolComponentEntry): string {
  const key = `settings.componentBundles.${bundleLocaleKey(bundle.bundleId)}.tools.${tool.toolId}`
  return te(key) ? t(key) : tool.displayName
}

function statusLabel(status: ToolComponentStatus): string {
  return t(`settings.componentsStatus.${status}`)
}

function statusClass(status: ToolComponentStatus): string {
  return `nm-components__status--${status}`
}

function bundleIcon(bundle: ToolComponentBundle): string {
  switch (bundle.module) {
    case 'mongodb':
      return 'database'
    case 'redis':
      return 'hard-drive'
    default:
      return 'wrench'
  }
}

function isToolReady(status: ToolComponentStatus): boolean {
  return status !== 'missing'
}

function bundleSummary(bundle: ToolComponentBundle): { ready: number; total: number } {
  const total = bundle.tools.length
  const ready = bundle.tools.filter((tool) => isToolReady(tool.status)).length
  return { ready, total }
}

function bundleHealthClass(bundle: ToolComponentBundle): string {
  const { ready, total } = bundleSummary(bundle)
  if (total === 0 || ready === 0) {
    return 'nm-components__health--none'
  }
  if (ready === total) {
    return 'nm-components__health--full'
  }
  return 'nm-components__health--partial'
}

const hasBundles = computed(() => bundles.value.length > 0)

const selectedBundle = computed(() => {
  if (!selectedBundleId.value) {
    return null
  }
  return bundles.value.find((bundle) => bundle.bundleId === selectedBundleId.value) ?? null
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

async function browsePath(bundle: ToolComponentBundle, tool: ToolComponentEntry): Promise<void> {
  const result = await dialogApi.openFile({
    title: t('settings.componentsBrowseTitle', { name: toolDisplayName(bundle, tool) }),
    accept: ['.exe', '.cmd', '.bat', ''],
  })
  if (result.canceled || !result.filePaths[0]) {
    return
  }
  await savePath(bundle.bundleId, tool.toolId, result.filePaths[0])
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

async function clearPath(bundleId: string, toolId: string): Promise<void> {
  await savePath(bundleId, toolId, '')
}

async function installBundle(bundleId: string): Promise<void> {
  busyKey.value = `install:${bundleId}`
  try {
    const result = await componentsApi.install({ bundleId })
    const idx = bundles.value.findIndex((b) => b.bundleId === bundleId)
    if (idx >= 0) {
      bundles.value[idx] = result.bundle
    } else {
      bundles.value.push(result.bundle)
    }
    toast.success(t('settings.componentsInstallDone'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    busyKey.value = null
  }
}

async function openDownload(bundleId: string, toolId: string): Promise<void> {
  busyKey.value = `dl:${rowKey(bundleId, toolId)}`
  try {
    const result = await componentsApi.getDownload({ bundleId, toolId })
    if (result.url) {
      window.open(result.url, '_blank', 'noopener,noreferrer')
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    busyKey.value = null
  }
}

function pathSummary(tool: ToolComponentEntry): string {
  if (tool.path) {
    return tool.path
  }
  return t('settings.componentsPathEmpty')
}

onMounted(() => {
  void loadBundles()
})

defineExpose({ reload: loadBundles })
</script>

<template>
  <section class="nm-settings__panel nm-components">
      <header class="nm-components__toolbar">
        <div class="nm-components__toolbar-main">
          <div class="nm-components__title-row">
            <h1 class="nm-section-title">{{ t('settings.components') }}</h1>
            <RsTooltip side="bottom" align="start">
              <button
                type="button"
                class="nm-components__info-btn"
                :aria-label="t('settings.componentsTooltip')"
              >
                <RsIcon name="info" :size="14" />
              </button>
              <template #content>
                <div class="nm-components__tooltip">
                  <p>{{ t('settings.componentsDesc') }}</p>
                  <p>{{ t('settings.componentsHint') }}</p>
                </div>
              </template>
            </RsTooltip>
          </div>
        </div>
        <RsTooltip :content="t('settings.componentsRefresh')" side="top">
          <RsButton variant="ghost" size="sm" :disabled="loading" @click="loadBundles">
            {{ t('settings.componentsRefresh') }}
          </RsButton>
        </RsTooltip>
      </header>

      <div class="nm-components__body">
        <div v-if="loading" class="nm-components__workspace" aria-busy="true" :aria-label="t('settings.componentsLoading')">
          <div class="nm-components__loading-banner">
            <RsLoading
              variant="spinner"
              size="sm"
              :label="t('settings.componentsLoading')"
              show-label
            />
          </div>
          <aside
            class="nm-components__sidebar nm-components__sidebar--skeleton"
            :aria-label="t('settings.componentsBundlesTitle')"
            aria-hidden="true"
          >
            <div class="nm-components__sidebar-title">{{ t('settings.componentsBundlesTitle') }}</div>
            <ul class="nm-components__bundle-list">
              <li v-for="item in 2" :key="item">
                <div class="nm-components__bundle-skeleton">
                  <span class="nm-components__skel nm-components__skel--icon" />
                  <span class="nm-components__skel-block">
                    <span class="nm-components__skel nm-components__skel--title" />
                    <span class="nm-components__skel nm-components__skel--meta" />
                  </span>
                </div>
              </li>
            </ul>
          </aside>
          <div class="nm-components__detail nm-components__detail--skeleton" aria-hidden="true">
            <div class="nm-components__detail-head">
              <div class="nm-components__detail-skeleton-head">
                <span class="nm-components__skel nm-components__skel--detail-icon" />
                <span class="nm-components__skel-block">
                  <span class="nm-components__skel nm-components__skel--detail-title" />
                  <span class="nm-components__skel nm-components__skel--detail-meta" />
                </span>
              </div>
              <div class="nm-components__detail-skeleton-actions">
                <span class="nm-components__skel nm-components__skel--btn" />
                <span class="nm-components__skel nm-components__skel--btn" />
              </div>
            </div>
            <ul class="nm-components__tool-grid">
              <li v-for="item in 3" :key="item" class="nm-components__tool-skeleton">
                <span class="nm-components__skel nm-components__skel--tool-title" />
                <span class="nm-components__skel nm-components__skel--tool-path" />
                <span class="nm-components__skel nm-components__skel--tool-actions" />
              </li>
            </ul>
          </div>
        </div>

        <div v-else-if="error" class="nm-components__state nm-components__state--error" role="alert">
          <RsIcon name="circle-alert" :size="28" />
          <p>{{ error }}</p>
          <RsButton variant="secondary" size="sm" @click="loadBundles">
            {{ t('settings.componentsRefresh') }}
          </RsButton>
        </div>

        <div v-else-if="!bridgeStore.connected" class="nm-components__state">
          <RsIcon name="plug-zap" :size="28" />
          <p>{{ t('settings.devHint') }}</p>
        </div>

        <div v-else-if="!hasBundles" class="nm-components__state">
          <RsIcon name="package-open" :size="28" />
          <p>{{ t('settings.componentsEmpty') }}</p>
          <RsButton variant="secondary" size="sm" @click="loadBundles">
            {{ t('settings.componentsRefresh') }}
          </RsButton>
        </div>

        <div v-else class="nm-components__workspace">
          <aside class="nm-components__sidebar" :aria-label="t('settings.componentsBundlesTitle')">
            <div class="nm-components__sidebar-title">{{ t('settings.componentsBundlesTitle') }}</div>
            <ul class="nm-components__bundle-list">
              <li v-for="bundle in bundles" :key="bundle.bundleId">
                <button
                  type="button"
                  class="nm-components__bundle-item"
                  :class="{ 'nm-components__bundle-item--active': selectedBundleId === bundle.bundleId }"
                  @click="selectBundle(bundle.bundleId)"
                >
                  <span class="nm-components__bundle-icon" aria-hidden="true">
                    <RsIcon :name="bundleIcon(bundle)" :size="16" />
                  </span>
                  <span class="nm-components__bundle-text min-w-0">
                    <span class="nm-components__bundle-name truncate">{{ bundleDisplayName(bundle) }}</span>
                    <span class="nm-components__bundle-meta">
                      <span>{{ t('settings.componentsToolCount', { count: bundle.tools.length }) }}</span>
                      <span class="nm-components__bundle-dot" aria-hidden="true">·</span>
                      <span>{{ t('settings.componentsReadySummary', bundleSummary(bundle)) }}</span>
                    </span>
                  </span>
                  <span
                    class="nm-components__health"
                    :class="bundleHealthClass(bundle)"
                    :title="t('settings.componentsReadySummary', bundleSummary(bundle))"
                    aria-hidden="true"
                  />
                </button>
              </li>
            </ul>
          </aside>

          <div class="nm-components__detail">
            <template v-if="selectedBundle">
              <header class="nm-components__detail-head">
                <div class="nm-components__detail-info min-w-0">
                  <div class="nm-components__detail-title-row">
                    <span class="nm-components__detail-icon" aria-hidden="true">
                      <RsIcon :name="bundleIcon(selectedBundle)" :size="20" />
                    </span>
                    <h2 class="nm-components__detail-title">{{ bundleDisplayName(selectedBundle) }}</h2>
                  </div>
                  <div class="nm-components__detail-meta">
                    <code class="nm-components__bundle-id">{{ selectedBundle.bundleId }}</code>
                    <span v-if="selectedBundle.module" class="nm-components__module-badge">
                      {{ t('settings.componentsModuleLabel') }} · {{ selectedBundle.module }}
                    </span>
                    <span class="nm-components__detail-summary">
                      {{ t('settings.componentsReadySummary', bundleSummary(selectedBundle)) }}
                    </span>
                  </div>
                </div>
                <div class="nm-components__detail-actions">
                  <RsButton
                    v-if="selectedBundle.installable"
                    variant="secondary"
                    size="sm"
                    :disabled="busyKey === `install:${selectedBundle.bundleId}`"
                    @click="installBundle(selectedBundle.bundleId)"
                  >
                    {{ t('settings.componentsInstall') }}
                  </RsButton>
                  <RsButton
                    variant="secondary"
                    size="sm"
                    :disabled="busyKey === `detect:${selectedBundle.bundleId}`"
                    @click="detectBundle(selectedBundle.bundleId)"
                  >
                    {{ t('settings.componentsDetectBundle') }}
                  </RsButton>
                </div>
              </header>

              <ul class="nm-components__tool-grid">
                <li
                  v-for="tool in selectedBundle.tools"
                  :key="tool.toolId"
                  class="nm-components__tool-card"
                >
                  <div class="nm-components__tool-card-head">
                    <h3 class="nm-components__tool-name">{{ toolDisplayName(selectedBundle, tool) }}</h3>
                    <div class="nm-components__tool-meta">
                      <span
                        class="nm-components__status"
                        :class="statusClass(tool.status)"
                      >
                        {{ statusLabel(tool.status) }}
                      </span>
                      <span v-if="tool.version" class="nm-caption nm-components__version">{{ tool.version }}</span>
                    </div>
                  </div>

                  <div class="nm-components__path-field">
                    <span class="nm-components__path-label">{{ t('settings.componentsExecutablePath') }}</span>
                    <p
                      class="nm-components__path-value"
                      :class="{ 'nm-components__path-value--empty': !tool.path }"
                      :title="tool.path || undefined"
                    >
                      {{ pathSummary(tool) }}
                    </p>
                  </div>

                  <div class="nm-components__tool-actions">
                    <RsButton
                      variant="ghost"
                      size="sm"
                      :disabled="busyKey === `path:${rowKey(selectedBundle.bundleId, tool.toolId)}`"
                      @click="browsePath(selectedBundle, tool)"
                    >
                      {{ t('settings.componentsBrowse') }}
                    </RsButton>
                    <RsButton
                      v-if="tool.status === 'configured'"
                      variant="ghost"
                      size="sm"
                      @click="clearPath(selectedBundle.bundleId, tool.toolId)"
                    >
                      {{ t('settings.componentsClearPath') }}
                    </RsButton>
                    <RsTooltip :content="t('settings.componentsDownloadTooltip')" side="top" align="end">
                      <RsButton
                        variant="ghost"
                        size="sm"
                        :disabled="busyKey === `dl:${rowKey(selectedBundle.bundleId, tool.toolId)}`"
                        @click="openDownload(selectedBundle.bundleId, tool.toolId)"
                      >
                        <RsIcon name="external-link" :size="14" />
                        <span>{{ t('settings.componentsDownload') }}</span>
                      </RsButton>
                    </RsTooltip>
                  </div>
                </li>
              </ul>
            </template>

            <div v-else class="nm-components__empty-detail">
              <RsIcon name="wrench" :size="28" />
              <p>{{ t('settings.componentsSelectBundle') }}</p>
            </div>
          </div>
        </div>
      </div>
  </section>
</template>

<style scoped>
.nm-components.nm-settings__panel {
  display: flex;
  flex-direction: column;
  max-width: none;
  width: 100%;
  min-height: 0;
  padding: 0;
}

.nm-components__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md);
  flex-shrink: 0;
  padding: var(--rs-space-lg) var(--rs-space-xl);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3%, var(--rs-surface-elevated));
}

.nm-components__toolbar-main {
  min-width: 0;
}

.nm-components__body {
  flex: 1;
  min-height: 0;
  padding: 0;
}

.nm-components__title-row {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.nm-components__info-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  margin: 0;
  padding: 0;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-full);
  background: color-mix(in srgb, var(--rs-text) 4%, transparent);
  color: var(--rs-muted);
  cursor: help;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast),
    border-color var(--rs-transition-fast);
}

.nm-components__info-btn:hover {
  color: var(--rs-text);
  border-color: var(--rs-border);
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
}

.nm-components__tooltip {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-width: 18rem;
  line-height: 1.45;
}

.nm-components__tooltip p {
  margin: 0;
}

.nm-components__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-sm);
  min-height: 18rem;
  padding: var(--rs-space-xl);
  background: var(--rs-surface-elevated);
  color: var(--rs-muted);
  text-align: center;
}

.nm-components__state p {
  margin: 0;
  max-width: 28rem;
  line-height: 1.5;
}

.nm-components__state--error {
  color: var(--rs-danger);
}

.nm-components__loading-banner {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--rs-surface) 78%, transparent);
  backdrop-filter: blur(1px);
}

.nm-components__workspace {
  position: relative;
  display: flex;
  min-height: 22rem;
  overflow: hidden;
  background: var(--rs-surface-elevated);
}

.nm-components__sidebar--skeleton,
.nm-components__detail--skeleton {
  pointer-events: none;
  opacity: 0.72;
}

.nm-components__bundle-skeleton {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm);
}

.nm-components__detail-skeleton-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
}

.nm-components__detail-skeleton-actions {
  display: flex;
  gap: 0.375rem;
  flex-shrink: 0;
}

.nm-components__tool-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: var(--rs-space-md);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface);
}

.nm-components__skel-block {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.nm-components__skel {
  display: block;
  border-radius: var(--rs-radius-sm);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--rs-text) 6%, transparent) 25%,
    color-mix(in srgb, var(--rs-text) 10%, transparent) 50%,
    color-mix(in srgb, var(--rs-text) 6%, transparent) 75%
  );
  background-size: 200% 100%;
  animation: nm-components-shimmer 1.2s ease-in-out infinite;
}

.nm-components__skel--icon {
  width: 1.75rem;
  height: 1.75rem;
  flex-shrink: 0;
}

.nm-components__skel--title {
  width: 72%;
  height: 0.8rem;
}

.nm-components__skel--meta {
  width: 52%;
  height: 0.65rem;
}

.nm-components__skel--detail-icon {
  width: 2.25rem;
  height: 2.25rem;
  flex-shrink: 0;
  border-radius: var(--rs-radius-md);
}

.nm-components__skel--detail-title {
  width: 9rem;
  height: 0.95rem;
}

.nm-components__skel--detail-meta {
  width: 14rem;
  height: 0.7rem;
}

.nm-components__skel--btn {
  width: 5.5rem;
  height: 1.75rem;
}

.nm-components__skel--tool-title {
  width: 45%;
  height: 0.85rem;
}

.nm-components__skel--tool-path {
  width: 100%;
  height: 2.25rem;
}

.nm-components__skel--tool-actions {
  width: 62%;
  height: 1.5rem;
}

@keyframes nm-components-shimmer {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -200% 0;
  }
}

.nm-components__sidebar {
  display: flex;
  flex-direction: column;
  width: 14.5rem;
  flex-shrink: 0;
  border-right: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3%, transparent);
}

.nm-components__sidebar-title {
  padding: var(--rs-space-sm) var(--rs-space-md);
  font-size: var(--nm-font-caption);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rs-muted);
}

.nm-components__bundle-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0 var(--rs-space-sm) var(--rs-space-sm);
  list-style: none;
  overflow-y: auto;
}

.nm-components__bundle-item {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  width: 100%;
  padding: var(--rs-space-sm);
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-text);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.nm-components__bundle-item:hover {
  background: var(--rs-item-hover);
}

.nm-components__bundle-item--active {
  background: color-mix(in srgb, var(--rs-primary) 14%, transparent);
  color: var(--rs-primary);
}

.nm-components__bundle-item--active .nm-components__bundle-meta {
  color: color-mix(in srgb, var(--rs-primary) 72%, var(--rs-muted));
}

.nm-components__bundle-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  flex-shrink: 0;
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-text) 6%, transparent);
}

.nm-components__bundle-item--active .nm-components__bundle-icon {
  background: color-mix(in srgb, var(--rs-primary) 18%, transparent);
}

.nm-components__bundle-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.nm-components__bundle-name {
  font-size: var(--nm-font-body);
  font-weight: 500;
  line-height: 1.3;
}

.nm-components__bundle-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-components__bundle-dot {
  opacity: 0.7;
}

.nm-components__health {
  width: 0.5rem;
  height: 0.5rem;
  flex-shrink: 0;
  border-radius: 999px;
}

.nm-components__health--full {
  background: var(--rs-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-success) 18%, transparent);
}

.nm-components__health--partial {
  background: var(--rs-warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-warning) 18%, transparent);
}

.nm-components__health--none {
  background: var(--rs-muted);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rs-muted) 18%, transparent);
}

.nm-components__detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.nm-components__detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: var(--rs-space-md) var(--rs-space-lg);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 2%, transparent);
}

.nm-components__detail-title-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
}

.nm-components__detail-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--rs-radius-md);
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
  color: var(--rs-primary);
}

.nm-components__detail-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--rs-text);
}

.nm-components__detail-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem var(--rs-space-sm);
  margin-top: 0.375rem;
}

.nm-components__bundle-id {
  font-size: var(--nm-font-caption);
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  color: var(--rs-muted);
}

.nm-components__module-badge {
  font-size: var(--nm-font-caption);
  padding: 0.1rem 0.45rem;
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-text) 6%, transparent);
  color: var(--rs-muted);
}

.nm-components__detail-summary {
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-components__detail-actions {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.375rem;
}

.nm-components__tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
  gap: var(--rs-space-sm);
  margin: 0;
  padding: var(--rs-space-md) var(--rs-space-lg) var(--rs-space-lg);
  list-style: none;
  overflow-y: auto;
}

.nm-components__tool-card {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-md);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  background: var(--rs-surface);
  transition:
    border-color var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast);
}

.nm-components__tool-card:hover {
  border-color: color-mix(in srgb, var(--rs-primary) 24%, var(--rs-border-subtle));
  box-shadow: var(--rs-shadow-sm);
}

.nm-components__tool-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-sm);
}

.nm-components__tool-name {
  font-size: var(--nm-font-body);
  font-weight: 600;
  color: var(--rs-text);
}

.nm-components__tool-meta {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.375rem;
}

.nm-components__status {
  font-size: var(--nm-font-caption);
  font-weight: 500;
  padding: 0.1rem 0.45rem;
  border-radius: var(--rs-radius-sm);
  white-space: nowrap;
}

.nm-components__status--detected,
.nm-components__status--configured,
.nm-components__status--bundled {
  color: var(--rs-success);
  background: color-mix(in srgb, var(--rs-success) 14%, transparent);
}

.nm-components__status--missing {
  color: var(--rs-warning);
  background: color-mix(in srgb, var(--rs-warning) 14%, transparent);
}

.nm-components__version {
  font-family: var(--rs-font-mono, ui-monospace, monospace);
}

.nm-components__path-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.nm-components__path-label {
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-components__path-value {
  margin: 0;
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-text) 3%, transparent);
  font-size: var(--nm-font-caption);
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  color: var(--rs-text);
  line-height: 1.45;
  word-break: break-all;
}

.nm-components__path-value--empty {
  color: var(--rs-muted);
  font-style: italic;
}

.nm-components__tool-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: auto;
  padding-top: 0.25rem;
}

.nm-components__empty-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-xl);
  color: var(--rs-muted);
  text-align: center;
}

@media (max-width: 48rem) {
  .nm-components__workspace {
    flex-direction: column;
    min-height: auto;
  }

  .nm-components__sidebar {
    width: auto;
    border-right: none;
    border-bottom: 1px solid var(--rs-border-subtle);
  }

  .nm-components__bundle-list {
    max-height: 10rem;
  }

  .nm-components__detail-head {
    flex-direction: column;
  }

  .nm-components__detail-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .nm-components__tool-grid {
    grid-template-columns: 1fr;
  }
}
</style>
