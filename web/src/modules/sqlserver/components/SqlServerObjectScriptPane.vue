<script setup lang="ts">
import { computed } from 'vue'
import { RsLoading, RsMonacoEditor } from '@niuma/ui'
import { ObjectScriptShell, type ObjectScriptShellLabels } from '@/modules/database'
import { useSqlServerObjectScript } from '@/modules/sqlserver/composables/useSqlServerObjectScript'
import type { SqlServerObjectKind, SqlServerObjectScriptMode } from '@/modules/sqlserver/types/object-script'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  objectKind?: SqlServerObjectKind
  objectName?: string
  designMode?: SqlServerObjectScriptMode
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
  schemaName,
} = useSqlServerObjectScript(props)

const shellLabels = computed(
  (): ObjectScriptShellLabels => ({
    format: t('modules.sqlserver.query.format'),
    formatTooltip: t('modules.sqlserver.query.formatTooltip'),
    copy: t('modules.sqlserver.objectScript.copy'),
    refresh: t('modules.sqlserver.browse.refresh'),
    create: t('modules.sqlserver.objectScript.create'),
    save: t('modules.sqlserver.objectScript.save'),
    needObject: t('modules.sqlserver.objectScript.needObject'),
    modeCreate: t('modules.sqlserver.objectScript.modeCreate'),
  }),
)

const typeLabel = computed(() =>
  modeCreate.value ? shellLabels.value.modeCreate : kindLabel.value,
)

const scopeLabel = computed(() => {
  if (props.database && schemaName.value && objectName.value) {
    return `${props.database}.${schemaName.value}.${objectName.value}`
  }
  return [props.database, schemaName.value, objectName.value].filter(Boolean).join('.')
})

const message = computed(() => lastError.value || lastMessage.value)
const messageTone = computed(() => {
  if (lastError.value) return 'error' as const
  if (lastMessage.value) return 'ok' as const
  return null
})

const hasObject = computed(() => Boolean(props.database && (modeCreate.value || objectName.value)))
</script>

<template>
  <ObjectScriptShell
    :labels="shellLabels"
    :session-label="sessionLabel || 'SQL Server'"
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
    <template #editor>
      <RsLoading v-if="loading && !sqlText" class="nm-sqlserver-object-script__boot" />
      <RsMonacoEditor
        v-else-if="languageReady"
        ref="editorRef"
        v-model="sqlText"
        embedded
        :language="monacoLanguage"
        height="100%"
        class="nm-sqlserver-object-script__editor"
        :options="{
          automaticLayout: active !== false,
          minimap: { enabled: false },
        }"
      />
      <div v-else class="nm-sqlserver-object-script__boot">
        <RsLoading size="sm" />
      </div>
    </template>
  </ObjectScriptShell>
</template>

<style scoped>
.nm-sqlserver-object-script__editor {
  flex: 1;
  min-height: 0;
  border-radius: 0;
  border: none;
}
.nm-sqlserver-object-script__boot {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
