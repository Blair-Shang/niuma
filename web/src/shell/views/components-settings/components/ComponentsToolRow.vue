<script setup lang="ts">
import { RsBadge, RsButton, RsIcon } from '@niuma/ui'
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

const hasPath = computed(() => !!props.tool.path)

const pathText = computed(() => pathSummary(t, props.tool))
</script>

<template>
  <div
    class="nm-components__tool-row"
    :class="{
      'nm-components__tool-row--divided': divided,
      'nm-components__tool-row--missing': tool.status === 'missing',
    }"
  >
    <div class="nm-components__tool-top">
      <div class="nm-components__tool-identity min-w-0">
        <div class="nm-components__tool-title-line">
          <h3 class="nm-components__tool-name truncate">
            {{ toolDisplayName(t, te, bundle, tool) }}
          </h3>
          <RsBadge :variant="statusBadgeVariant(tool.status)">
            {{ statusLabel(t, tool.status) }}
          </RsBadge>
        </div>
        <p v-if="tool.version" class="nm-components__tool-version truncate" :title="tool.version">
          {{ tool.version }}
        </p>
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
      </div>
    </div>

    <div
      class="nm-components__path-bar"
      :class="{ 'nm-components__path-bar--empty': !hasPath }"
      :title="hasPath ? pathText : undefined"
    >
      <span class="nm-components__path-icon" aria-hidden="true">
        <RsIcon :name="hasPath ? 'file-code' : 'folder'" :size="14" />
      </span>
      <code class="nm-components__path-text truncate">{{ pathText }}</code>
    </div>
  </div>
</template>

<style scoped>
.nm-components__tool-row {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.875rem var(--rs-space-md);
  transition: background var(--rs-transition-fast);
}

.nm-components__tool-row:hover {
  background: color-mix(in srgb, var(--rs-text) 2.5%, transparent);
}

.nm-components__tool-row--divided {
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-components__tool-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
}

.nm-components__tool-identity {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.nm-components__tool-title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.nm-components__tool-name {
  margin: 0;
  font-size: var(--nm-font-body);
  font-weight: 600;
  line-height: 1.35;
  color: var(--rs-text);
}

.nm-components__tool-version {
  margin: 0;
  max-width: 100%;
  font-size: var(--nm-font-caption);
  line-height: 1.4;
  color: var(--rs-muted);
  font-family: var(--rs-font-mono, ui-monospace, monospace);
}

.nm-components__tool-actions {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.25rem;
}

.nm-components__path-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: color-mix(in srgb, var(--rs-text) 3.5%, var(--rs-surface-elevated));
}

.nm-components__path-bar--empty {
  border-style: dashed;
  background: transparent;
}

.nm-components__tool-row--missing .nm-components__path-bar {
  border-color: color-mix(in srgb, var(--rs-warning) 28%, var(--rs-border-subtle));
}

.nm-components__path-icon {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--rs-muted);
}

.nm-components__path-text {
  flex: 1;
  min-width: 0;
  font-size: var(--nm-font-caption);
  line-height: 1.4;
  color: var(--rs-text);
  font-family: var(--rs-font-mono, ui-monospace, monospace);
}

.nm-components__path-bar--empty .nm-components__path-text {
  color: var(--rs-muted);
  font-family: inherit;
}

@media (max-width: 48rem) {
  .nm-components__tool-top {
    flex-direction: column;
    gap: var(--rs-space-sm);
  }

  .nm-components__tool-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
