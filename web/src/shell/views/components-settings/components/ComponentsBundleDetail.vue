<script setup lang="ts">
import { RsBadge, RsButton, RsCard, RsEmpty, RsIcon } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ToolComponentBundle } from '@/api/types/components'
import type { ComponentsInstallProgress } from '../composables/useToolComponents'
import { bundleDisplayName, bundleIcon, bundleSummary } from '../utils/presentation'
import ComponentsToolRow from './ComponentsToolRow.vue'

const props = defineProps<{
  bundle: ToolComponentBundle | null
  busyKey: string | null
  installProgress?: ComponentsInstallProgress | null
  /** 当前包是否有安装任务（整包或单个工具） */
  installBusy?: boolean
}>()

const emit = defineEmits<{
  detect: [bundleId: string]
  install: [bundleId: string, toolId?: string]
  browse: [bundle: ToolComponentBundle, toolId: string]
  clear: [bundleId: string, toolId: string]
  download: [bundleId: string, toolId: string]
}>()

const { t, te } = useI18n()

const installing = computed(() => !!props.installBusy)

const bundleHasBundled = computed(
  () => props.bundle?.tools.some((tool) => tool.status === 'bundled') ?? false,
)

const bundleInstallLabel = computed(() => {
  if (installing.value && props.busyKey === `install:${props.bundle?.bundleId}`) {
    return t('settings.componentsInstalling')
  }
  if (bundleHasBundled.value) {
    return t('settings.componentsReinstallAll')
  }
  return t('settings.componentsInstallAll')
})

const progressPercent = computed(() => {
  const p = props.installProgress
  if (!p || !props.bundle || p.bundleId !== props.bundle.bundleId) return 0
  return Math.round(p.percent)
})

const progressLabel = computed(() => {
  const p = props.installProgress
  if (!p || !props.bundle || p.bundleId !== props.bundle.bundleId) {
    return t('settings.componentsInstalling')
  }
  const phaseKey = `settings.componentsInstallPhase.${p.phase}`
  const phase = te(phaseKey) ? t(phaseKey) : t('settings.componentsInstalling')
  const scope = p.toolId
    ? t('settings.componentsInstallScopeTool', { tool: p.toolId })
    : t('settings.componentsInstallScopeBundle')
  if (p.phase === 'downloading' && p.bytesTotal > 0) {
    return t('settings.componentsInstallProgressBytes', {
      scope,
      phase,
      received: formatBytes(p.bytesReceived),
      total: formatBytes(p.bytesTotal),
      percent: progressPercent.value,
    })
  }
  return t('settings.componentsInstallProgress', {
    scope,
    phase,
    percent: progressPercent.value,
  })
})

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="nm-components__detail">
    <template v-if="bundle">
      <RsCard variant="plain" :padding="false" class="nm-components__detail-card">
        <template #header>
          <div class="nm-components__detail-head">
            <div class="nm-components__detail-info min-w-0">
              <div class="nm-components__detail-title-row">
                <span class="nm-components__detail-icon" aria-hidden="true">
                  <RsIcon :name="bundleIcon(bundle)" :size="20" />
                </span>
                <div class="min-w-0">
                  <h2 class="nm-components__detail-title">{{ bundleDisplayName(t, te, bundle) }}</h2>
                  <p class="nm-components__bundle-id truncate">{{ bundle.bundleId }}</p>
                </div>
              </div>
              <div class="nm-components__detail-meta">
                <RsBadge v-if="bundle.module" variant="default">
                  {{ t('settings.componentsModuleLabel') }} · {{ bundle.module }}
                </RsBadge>
                <RsBadge variant="info">
                  {{ t('settings.componentsReadySummary', bundleSummary(bundle)) }}
                </RsBadge>
              </div>
            </div>
            <div class="nm-components__detail-actions">
              <RsButton
                v-if="bundle.installable"
                variant="secondary"
                size="sm"
                :loading="busyKey === `install:${bundle.bundleId}`"
                :disabled="installing"
                @click="emit('install', bundle.bundleId)"
              >
                {{ bundleInstallLabel }}
              </RsButton>
              <RsButton
                variant="secondary"
                size="sm"
                :loading="busyKey === `detect:${bundle.bundleId}`"
                :disabled="installing"
                @click="emit('detect', bundle.bundleId)"
              >
                {{ t('settings.componentsDetectBundle') }}
              </RsButton>
            </div>
          </div>
          <output v-if="installing" class="nm-components__install-progress" aria-live="polite">
            <div class="nm-components__install-progress-label">{{ progressLabel }}</div>
            <div class="nm-components__install-progress-track" aria-hidden="true">
              <div
                class="nm-components__install-progress-bar"
                :class="{ 'is-indeterminate': progressPercent <= 0 }"
                :style="progressPercent > 0 ? { width: `${progressPercent}%` } : undefined"
              />
            </div>
          </output>
        </template>
      </RsCard>

      <div class="nm-components__tool-panel">
        <RsCard variant="grouped" :padding="false">
          <ComponentsToolRow
            v-for="(tool, toolIndex) in bundle.tools"
            :key="tool.toolId"
            :bundle="bundle"
            :tool="tool"
            :divided="toolIndex > 0"
            :busy-key="busyKey"
            :install-busy="installBusy"
            @browse="emit('browse', bundle, tool.toolId)"
            @clear="emit('clear', bundle.bundleId, tool.toolId)"
            @download="emit('download', bundle.bundleId, tool.toolId)"
            @install="emit('install', bundle.bundleId, tool.toolId)"
          />
        </RsCard>
      </div>
    </template>

    <RsEmpty v-else class="nm-components__empty-detail" :description="t('settings.componentsSelectBundle')">
      <template #icon>
        <RsIcon name="wrench" :size="22" />
      </template>
    </RsEmpty>
  </div>
</template>

<style scoped>
.nm-components__detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--rs-space-md);
  min-width: 0;
  min-height: 0;
  padding: var(--rs-space-md) var(--rs-space-lg) var(--rs-space-lg);
  overflow-y: auto;
}

.nm-components__detail-card {
  flex-shrink: 0;
}

.nm-components__detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  width: 100%;
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
  gap: 0.5rem;
  margin-top: 0.375rem;
}

.nm-components__bundle-id {
  margin: 0.125rem 0 0;
  font-size: var(--nm-font-caption);
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  color: var(--rs-muted);
}

.nm-components__detail-actions {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.375rem;
}

.nm-components__install-progress {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 100%;
  margin-top: var(--rs-space-sm);
  padding-top: var(--rs-space-sm);
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-components__install-progress-label {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.35;
}

.nm-components__install-progress-track {
  height: 0.35rem;
  border-radius: 999px;
  background: var(--rs-surface-hover, rgba(127, 127, 127, 0.16));
  overflow: hidden;
}

.nm-components__install-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: var(--rs-primary);
  transition: width 0.15s ease-out;
}

.nm-components__install-progress-bar.is-indeterminate {
  width: 36%;
  animation: nm-components-progress-indeterminate 1.1s ease-in-out infinite;
}

@keyframes nm-components-progress-indeterminate {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

.nm-components__tool-panel {
  flex: 1;
  min-height: 0;
}

.nm-components__empty-detail {
  flex: 1;
  margin: var(--rs-space-lg);
}

@media (max-width: 48rem) {
  .nm-components__detail {
    padding: var(--rs-space-sm) var(--rs-space-md) var(--rs-space-md);
  }

  .nm-components__detail-head {
    flex-direction: column;
  }

  .nm-components__detail-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
