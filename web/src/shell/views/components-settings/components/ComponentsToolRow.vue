<script setup lang="ts">
import { RsBadge, RsButton, RsInput, RsLabel, RsTooltip } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ToolComponentBundle, ToolComponentEntry } from '@/api/types/components'
import {
  pathSummary,
  rowKey,
  statusBadgeVariant,
  statusLabel,
  toolDisplayName,
} from '../utils/presentation'

const props = defineProps<{
  bundle: ToolComponentBundle
  tool: ToolComponentEntry
  divided: boolean
  busyKey: string | null
  /** 当前组件包是否有安装任务进行中（整包或任一工具） */
  installBusy?: boolean
}>()

const emit = defineEmits<{
  browse: []
  clear: []
  download: []
  install: []
}>()

const { t, te } = useI18n()

const toolInstalling = computed(
  () => props.busyKey === `install:${props.bundle.bundleId}:${props.tool.toolId}`,
)

const installLabel = computed(() => {
  if (toolInstalling.value) {
    return t('settings.componentsInstalling')
  }
  if (props.tool.status === 'bundled' || props.tool.status === 'configured') {
    return t('settings.componentsReinstall')
  }
  return t('settings.componentsInstall')
})
</script>

<template>
  <div class="nm-components__tool-row" :class="{ 'nm-components__tool-row--divided': divided }">
    <div class="nm-components__tool-row-main">
      <div class="nm-components__tool-row-head">
        <h3 class="nm-components__tool-name">{{ toolDisplayName(t, te, bundle, tool) }}</h3>
        <div class="nm-components__tool-meta">
          <RsBadge :variant="statusBadgeVariant(tool.status)">
            {{ statusLabel(t, tool.status) }}
          </RsBadge>
          <RsBadge v-if="tool.version" variant="default">{{ tool.version }}</RsBadge>
        </div>
      </div>

      <div class="nm-components__path-field">
        <RsLabel :for-id="`tool-path-${tool.toolId}`">
          {{ t('settings.componentsExecutablePath') }}
        </RsLabel>
        <RsInput
          :id="`tool-path-${tool.toolId}`"
          :model-value="pathSummary(t, tool)"
          size="sm"
          readonly
          class="nm-components__path-input"
        />
      </div>
    </div>

    <div class="nm-components__tool-actions">
      <RsButton
        v-if="tool.installable"
        variant="secondary"
        size="sm"
        :loading="toolInstalling"
        :disabled="!!installBusy && !toolInstalling"
        @click="emit('install')"
      >
        {{ installLabel }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        :loading="busyKey === `path:${rowKey(bundle.bundleId, tool.toolId)}`"
        :disabled="!!installBusy"
        @click="emit('browse')"
      >
        {{ t('settings.componentsBrowse') }}
      </RsButton>
      <RsButton
        v-if="tool.status === 'configured'"
        variant="ghost"
        size="sm"
        :disabled="!!installBusy"
        @click="emit('clear')"
      >
        {{ t('settings.componentsClearPath') }}
      </RsButton>
      <RsTooltip :content="t('settings.componentsDownloadTooltip')" side="top" align="end">
        <RsButton
          variant="ghost"
          size="sm"
          icon="external-link"
          :loading="busyKey === `dl:${rowKey(bundle.bundleId, tool.toolId)}`"
          :disabled="!!installBusy"
          @click="emit('download')"
        >
          {{ t('settings.componentsDownload') }}
        </RsButton>
      </RsTooltip>
    </div>
  </div>
</template>

<style scoped>
.nm-components__tool-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: var(--rs-space-md);
}

.nm-components__tool-row--divided {
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-components__tool-row-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--rs-space-sm);
  min-width: 0;
}

.nm-components__tool-row-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-sm);
}

.nm-components__tool-name {
  margin: 0;
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

.nm-components__path-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.nm-components__path-input :deep(.rs-input-group__input) {
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--nm-font-caption);
}

.nm-components__tool-actions {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.25rem;
  padding-top: 1.35rem;
}

@media (max-width: 48rem) {
  .nm-components__tool-row {
    flex-direction: column;
  }

  .nm-components__tool-actions {
    width: 100%;
    justify-content: flex-start;
    padding-top: 0;
  }
}
</style>
