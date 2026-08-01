<script setup lang="ts">
import { computed } from 'vue'
import { RsLoading, RsMonacoEditor } from '@niuma/ui'
import { ObjectScriptShell, type ObjectScriptShellLabels } from '@/modules/database'
import { useMysqlObjectScript } from '@/modules/mysql/composables/useMysqlObjectScript'
import type { MysqlObjectKind, MysqlObjectScriptMode } from '@/modules/mysql/types/object-script'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  objectKind: MysqlObjectKind
  objectName?: string
  designMode?: MysqlObjectScriptMode
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
} = useMysqlObjectScript(props)

const shellLabels = computed((): ObjectScriptShellLabels => ({
  format: t('modules.mysql.query.format'),
  formatTooltip: t('modules.mysql.query.formatTooltip'),
  copy: t('modules.mysql.objectScript.copy'),
  refresh: t('modules.mysql.browse.refresh'),
  create: t('modules.mysql.objectScript.create'),
  save: t('modules.mysql.objectScript.save'),
  needObject: t('modules.mysql.objectScript.needObject'),
  modeCreate: t('modules.mysql.objectScript.modeCreate'),
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
</script>

<template>
  <ObjectScriptShell
    :labels="shellLabels"
    :session-label="sessionLabel || 'MySQL'"
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
      <RsLoading v-if="loading && !sqlText" class="nm-mysql-object-script__boot" />
      <RsMonacoEditor
        v-else-if="languageReady"
        ref="editorRef"
        v-model="sqlText"
        embedded
        :language="monacoLanguage"
        height="100%"
        class="nm-mysql-object-script__editor"
        :options="{
          automaticLayout: active !== false,
          minimap: { enabled: false },
        }"
      />
      <div v-else class="nm-mysql-object-script__boot">
        <RsLoading size="sm" />
      </div>
    </template>
  </ObjectScriptShell>
</template>

<style scoped>
.nm-mysql-object-script__editor {
  flex: 1;
  min-height: 0;
  border-radius: 0;
  border: none;
}

.nm-mysql-object-script__boot {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}
</style>
