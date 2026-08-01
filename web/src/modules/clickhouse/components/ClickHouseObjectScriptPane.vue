<script setup lang="ts">
import { computed } from 'vue'
import { RsButton, RsLoading, RsMonacoEditor } from '@niuma/ui'
import {
  ObjectScriptShell,
  TableDesignPreviewPopover,
  type ObjectScriptShellLabels,
} from '@/modules/database'
import { useClickHouseObjectScript } from '@/modules/clickhouse/composables/useClickHouseObjectScript'
import type {
  ClickHouseObjectKind,
  ClickHouseObjectScriptMode,
} from '@/modules/clickhouse/types/object-script'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  objectKind: ClickHouseObjectKind
  objectName?: string
  designMode?: ClickHouseObjectScriptMode
  initialSql?: string
  draftSql?: string
  tabId?: string
  sessionLabel?: string
  active?: boolean
}>()

const {
  t,
  sqlText,
  loading,
  saving,
  lastMessage,
  lastError,
  modeCreate,
  designMode,
  objectName,
  kindIcon,
  kindLabel,
  languageReady,
  monacoLanguage,
  editorRef,
  formatEditor,
  onApply,
  copyScript,
  loadScript,
  contextMenuItems,
  onContextMenuSelect,
  showPreview,
  previewLoading,
  previewSqls,
  onPreviewOpenChange,
  copyPreview,
} = useClickHouseObjectScript(props)

const shellLabels = computed((): ObjectScriptShellLabels => ({
  format: t('modules.clickhouse.query.format'),
  formatTooltip: t('modules.clickhouse.query.formatTooltip'),
  copy: t('modules.clickhouse.objectScript.copy'),
  refresh: t('modules.clickhouse.browse.refresh'),
  create: t('modules.clickhouse.objectScript.create'),
  save: t('modules.clickhouse.objectScript.save'),
  needObject: t('modules.clickhouse.objectScript.needObject'),
  modeCreate: t('modules.clickhouse.objectScript.modeCreate'),
}))

const typeLabel = computed(() =>
  modeCreate.value ? shellLabels.value.modeCreate : kindLabel.value,
)

const message = computed(() => lastError.value || lastMessage.value)
const messageTone = computed(() => {
  if (lastError.value) return 'error' as const
  if (lastMessage.value) return 'ok' as const
  return null
})

const hasObject = computed(() => Boolean(props.database && objectName.value))
const scopeLabel = computed(() => {
  if (props.database && objectName.value) return `${props.database}.${objectName.value}`
  return props.database || objectName.value || ''
})
</script>

<template>
  <ObjectScriptShell
    :labels="shellLabels"
    :session-label="sessionLabel || 'ClickHouse'"
    :scope-label="scopeLabel"
    :type-label="typeLabel"
    :icon="kindIcon"
    :mode="designMode"
    :loading="loading"
    :saving="saving"
    :can-apply="Boolean(sessionId) && Boolean(sqlText.trim())"
    :can-copy="Boolean(sqlText)"
    :can-format="!saving && !loading"
    :show-refresh="!modeCreate"
    :has-object="hasObject"
    :message="message"
    :message-tone="messageTone"
    :context-menu-items="contextMenuItems"
    @format="formatEditor"
    @copy="copyScript"
    @refresh="() => loadScript({ force: true })"
    @apply="onApply"
    @context-select="onContextMenuSelect"
  >
    <template #toolbar-start>
      <TableDesignPreviewPopover
        :open="showPreview"
        :title="t('modules.clickhouse.objectScript.previewTitle')"
        :sql="previewSqls"
        :loading="previewLoading"
        :copy-label="t('modules.clickhouse.objectScript.copyPreview')"
        :empty-label="t('modules.clickhouse.objectScript.previewEmpty')"
        @update:open="onPreviewOpenChange"
        @copy="copyPreview"
      >
        <RsButton
          size="sm"
          variant="ghost"
          icon="eye"
          :disabled="!sessionId || !sqlText.trim() || saving || loading"
          :loading="previewLoading"
        >
          {{ t('modules.clickhouse.objectScript.preview') }}
        </RsButton>
      </TableDesignPreviewPopover>
    </template>

    <template #editor>
      <RsLoading v-if="loading && !sqlText" class="nm-clickhouse-object-script__boot" />
      <RsMonacoEditor
        v-else-if="languageReady"
        ref="editorRef"
        v-model="sqlText"
        embedded
        :language="monacoLanguage"
        :options="{
          automaticLayout: active !== false,
          minimap: { enabled: false },
          wordWrap: 'on',
        }"
      />
    </template>
  </ObjectScriptShell>
</template>

<style scoped>
.nm-clickhouse-object-script__boot {
  flex: 1;
  min-height: 0;
}
</style>
