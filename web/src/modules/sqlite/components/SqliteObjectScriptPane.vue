<script setup lang="ts">
import { computed } from 'vue'
import { RsButton, RsLoading, RsMonacoEditor } from '@niuma/ui'
import {
  ObjectScriptShell,
  TableDesignPreviewPopover,
  type ObjectScriptShellLabels,
} from '@/modules/database'
import { useSqliteObjectScript } from '@/modules/sqlite/composables/useSqliteObjectScript'
import type { SqliteObjectKind, SqliteObjectScriptMode } from '@/modules/sqlite/types/object-script'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  schema?: string
  objectKind: SqliteObjectKind
  objectName?: string
  designMode?: SqliteObjectScriptMode
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
} = useSqliteObjectScript(props)

const shellLabels = computed((): ObjectScriptShellLabels => ({
  format: t('modules.sqlite.query.format'),
  formatTooltip: t('modules.sqlite.query.formatTooltip'),
  copy: t('modules.sqlite.objectScript.copy'),
  refresh: t('modules.sqlite.browse.refresh'),
  create: t('modules.sqlite.objectScript.create'),
  save: t('modules.sqlite.objectScript.save'),
  needObject: t('modules.sqlite.objectScript.needObject'),
  modeCreate: t('modules.sqlite.objectScript.modeCreate'),
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

const hasObject = computed(() => Boolean(objectName.value || modeCreate.value))
</script>

<template>
  <ObjectScriptShell
    :labels="shellLabels"
    :session-label="sessionLabel || 'SQLite'"
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
    @refresh="() => loadScript()"
    @apply="onApply"
    @context-select="onContextMenuSelect"
  >
    <template #toolbar-start>
      <TableDesignPreviewPopover
        :open="showPreview"
        :sql="previewSqls"
        :loading="previewLoading"
        :empty-label="t('modules.sqlite.objectScript.previewEmpty')"
        @update:open="onPreviewOpenChange"
      >
        <RsButton
          size="sm"
          variant="ghost"
          icon="eye"
          :disabled="!sessionId || !sqlText.trim() || saving || loading"
          :loading="previewLoading"
        >
          {{ t('modules.sqlite.objectScript.preview') }}
        </RsButton>
      </TableDesignPreviewPopover>
    </template>

    <template #editor>
      <RsLoading v-if="loading && !sqlText" class="nm-sqlite-object-script__boot" />
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
.nm-sqlite-object-script__boot {
  flex: 1;
  min-height: 0;
}
</style>
