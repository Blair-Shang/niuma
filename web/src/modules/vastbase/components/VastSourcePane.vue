<script setup lang="ts">
import {
  RsButton,
  RsEmpty,
  RsIcon,
  RsLoading,
  RsMonacoEditor,
  useRsToast,
} from '@niuma/ui'
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { vastbaseApi } from '@/api'
import { useVastSqlEditor } from '@/modules/vastbase/composables/useVastSqlEditor'
import { VAST_SESSION_HEADER_ACTIONS_KEY } from '@/modules/vastbase/session-chrome'
import {
  Cap,
  defaultVastbaseProfile,
  hasCapability,
} from '@/modules/sql-editor/capabilities'
import {
  prepareDialectExecSql,
  stripOracleScriptTerminator,
} from '@/modules/vastbase/utils/oracle-terminator'
import { useSessionRegistry } from '@/stores/session-registry'

const props = defineProps<{
  sessionId: string | null
  database?: string
  schema?: string
  routine?: string
  routineKind?: 'function' | 'procedure'
  args?: string
  oid?: number
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

const headerActionsEl = inject(VAST_SESSION_HEADER_ACTIONS_KEY, ref<HTMLElement | null>(null))
const actionsHost = computed(() => headerActionsEl.value)

const loading = ref(false)
const saving = ref(false)
const definition = ref('')
const draft = ref('')

const dirty = computed(() => draft.value !== definition.value)
const canSave = computed(
  () => !!props.sessionId && !!draft.value.trim() && dirty.value && !loading.value && !saving.value,
)

const showEditor = computed(
  () => !!props.schema && !!props.routine && (!!definition.value || !!draft.value),
)

async function applySource(): Promise<void> {
  if (!canSave.value || !props.sessionId) return
  saving.value = true
  try {
    const dialect =
      useSessionRegistry().getDialectForSession(props.sessionId) ?? defaultVastbaseProfile()
    await vastbaseApi.queryExec({
      sessionId: props.sessionId,
      database: props.database,
      sql: prepareDialectExecSql(draft.value, {
        stripOracleSlash: hasCapability(dialect, Cap.ScriptOracleSlash),
      }),
    })
    toast.success(t('modules.vastbase.source.applied'))
    await loadSource()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.source.applyError'))
  } finally {
    saving.value = false
  }
}

const { editorRef, languageReady, sqlLanguage, formatSql, onActiveChange } = useVastSqlEditor({
  sqlText: draft,
  active: () => props.active,
  onRun: () => {
    void applySource()
  },
  getDialect: () =>
    useSessionRegistry().getDialectForSession(props.sessionId) ?? defaultVastbaseProfile(),
  getSuggestScope: () => {
    if (!props.sessionId) return null
    return {
      sessionId: props.sessionId,
      database: props.database,
      schema: props.schema || 'public',
    }
  },
})

function metaParams() {
  return {
    sessionId: props.sessionId ?? undefined,
    database: props.database,
    schema: props.schema,
    name: props.routine,
    args: props.args,
    oid: props.oid,
    kind: props.routineKind,
  }
}

async function loadSource(): Promise<void> {
  if (!props.sessionId || !props.schema || !props.routine) return
  loading.value = true
  try {
    const result = await vastbaseApi.metaRoutineSource(metaParams())
    const def = stripOracleScriptTerminator(result.definition ?? '')
    definition.value = def
    draft.value = def
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.source.loadError'))
  } finally {
    loading.value = false
  }
}

async function copySource(): Promise<void> {
  const text = draft.value || definition.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('modules.vastbase.source.copied'))
  } catch {
    toast.error(t('modules.vastbase.source.copyFailed'))
  }
}

function discardEdits(): void {
  draft.value = definition.value
}

watch(
  () =>
    [
      props.sessionId,
      props.database,
      props.schema,
      props.routine,
      props.args,
      props.oid,
    ] as const,
  () => {
    definition.value = ''
    draft.value = ''
    if (props.active) void loadSource()
  },
  { immediate: true },
)

watch(
  () => props.active,
  (active) => {
    void onActiveChange(active)
    if (
      active &&
      !definition.value &&
      props.sessionId &&
      props.schema &&
      props.routine
    ) {
      void loadSource()
    }
  },
)
</script>

<template>
  <div class="nm-vast-source">
    <!-- 对象名已在 Session 顶栏 scope 展示，此处只挂工具按钮，避免重复 -->
    <Teleport v-if="actionsHost" :to="actionsHost">
      <RsButton
        variant="ghost"
        size="sm"
        :disabled="!draft || saving || loading"
        :tooltip="t('modules.vastbase.session.formatTooltip')"
        @click="formatSql"
      >
        <RsIcon name="braces" :size="13" />
        {{ t('modules.vastbase.session.format') }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        icon="save"
        :disabled="!canSave"
        :loading="saving"
        :tooltip="t('modules.vastbase.source.applyHint')"
        @click="applySource"
      >
        {{ t('modules.vastbase.source.apply') }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        :disabled="!dirty || saving"
        @click="discardEdits"
      >
        {{ t('modules.vastbase.source.discard') }}
      </RsButton>
      <RsButton variant="ghost" size="sm" icon="copy" :disabled="!draft" @click="copySource">
        {{ t('modules.vastbase.ddl.copy') }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        icon="refresh-cw"
        :loading="loading"
        :disabled="saving"
        @click="loadSource"
      >
        {{ t('modules.vastbase.structure.refresh') }}
      </RsButton>
    </Teleport>

    <RsLoading v-if="loading && !definition" class="nm-vast-source__loading" />
    <RsEmpty
      v-else-if="!schema || !routine"
      fill
      icon="square-function"
      :description="t('modules.vastbase.source.needRoutine')"
    />
    <RsEmpty
      v-else-if="!definition && !loading"
      fill
      icon="square-function"
      :description="t('modules.vastbase.source.empty')"
    />
    <div v-else-if="showEditor" class="nm-vast-source__editor">
      <RsMonacoEditor
        v-if="languageReady"
        ref="editorRef"
        v-model="draft"
        :language="sqlLanguage"
        height="100%"
        class="nm-vast-source__monaco"
      />
      <div v-else class="nm-vast-source__editor-boot">
        <RsLoading size="sm" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.nm-vast-source {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 0;
  gap: 0;
}

.nm-vast-source__loading,
.nm-vast-source__editor-boot {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.nm-vast-source__editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 0;
}

.nm-vast-source__monaco {
  flex: 1;
  min-height: 0;
  height: 100%;
  border-radius: 0;
}

/* 贴满父容器：直角、无边框留白（对齐查询结果区编辑器） */
.nm-vast-source__monaco :deep(.rs-monaco) {
  height: 100%;
  border: none;
  border-radius: 0;
}

.nm-vast-source__monaco :deep(.monaco-editor),
.nm-vast-source__monaco :deep(.monaco-editor .overflow-guard) {
  border-radius: 0;
}
</style>
