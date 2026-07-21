<script setup lang="ts">
import {
  RsButton,
  RsEmpty,
  RsIcon,
  RsLoading,
  RsMonacoEditor,
  useRsToast,
} from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mysqlApi } from '@/api'
import {
  defaultMySQLProfile,
  resolveMonacoLanguageFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import { useSessionRegistry } from '@/stores/session-registry'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  routine?: string
  routineKind?: 'procedure' | 'function'
  sessionLabel?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessionRegistry = useSessionRegistry()

const loading = ref(false)
const source = ref('')
const kind = ref('')

const monacoLanguage = computed(() => {
  if (!props.sessionId) {
    return resolveMonacoLanguageFromProfile(defaultMySQLProfile()).monacoLanguageId
  }
  const profile = sessionRegistry.getDialectForSession(props.sessionId) ?? defaultMySQLProfile()
  return resolveMonacoLanguageFromProfile(profile).monacoLanguageId
})

async function loadSource(): Promise<void> {
  if (!props.sessionId || !props.database || !props.routine || !props.routineKind) return
  loading.value = true
  try {
    const result = await mysqlApi.metaRoutineSource({
      sessionId: props.sessionId,
      database: props.database,
      name: props.routine,
      kind: props.routineKind,
    })
    kind.value = result.kind
    try {
      source.value = formatSql(result.definition, { dialect: 'mysql' })
    } catch {
      source.value = result.definition
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.source.loadError'))
  } finally {
    loading.value = false
  }
}

async function copySource(): Promise<void> {
  if (!source.value) return
  try {
    await navigator.clipboard.writeText(source.value)
    toast.success(t('modules.mysql.source.copied'))
  } catch {
    toast.error(t('modules.mysql.source.copyFailed'))
  }
}

watch(
  () => [props.sessionId, props.database, props.routine, props.routineKind] as const,
  () => {
    source.value = ''
    kind.value = ''
    if (props.active) void loadSource()
  },
  { immediate: true },
)

watch(
  () => props.active,
  (active) => {
    if (
      active &&
      !source.value &&
      props.sessionId &&
      props.database &&
      props.routine &&
      props.routineKind
    ) {
      void loadSource()
    }
  },
)
</script>

<template>
  <div class="nm-mysql-source">
    <header class="nm-mysql-source__chrome">
      <div class="nm-mysql-source__identity" :title="sessionLabel">
        <RsIcon :name="routineKind === 'function' ? 'square-function' : 'workflow'" :size="16" />
        <span class="nm-mysql-source__session">{{ sessionLabel || 'MySQL' }}</span>
        <span v-if="database && routine" class="nm-mysql-source__scope">
          {{ database }}.{{ routine }}
        </span>
        <span v-if="kind" class="nm-mysql-source__type">{{ kind }}</span>
      </div>
      <div class="nm-mysql-source__actions">
        <RsButton variant="ghost" size="sm" icon="copy" :disabled="!source" @click="copySource">
          {{ t('modules.mysql.ddl.copy') }}
        </RsButton>
        <RsButton
          variant="ghost"
          size="sm"
          icon="refresh-cw"
          :loading="loading"
          @click="loadSource"
        >
          {{ t('modules.mysql.browse.refresh') }}
        </RsButton>
      </div>
    </header>

    <RsLoading v-if="loading && !source" class="nm-mysql-source__loading" />
    <RsEmpty
      v-else-if="!database || !routine || !routineKind"
      icon="file-code"
      :description="t('modules.mysql.source.needRoutine')"
    />
    <RsEmpty
      v-else-if="!source"
      icon="file-code"
      :description="t('modules.mysql.source.empty')"
    />
    <div v-else class="nm-mysql-source__editor">
      <RsMonacoEditor
        :model-value="source"
        :language="monacoLanguage"
        :options="{
          readOnly: true,
          automaticLayout: active !== false,
          minimap: { enabled: false },
        }"
      />
    </div>
  </div>
</template>

<style scoped>
.nm-mysql-source {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-mysql-source__chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-mysql-source__identity {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-mysql-source__session {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mysql-source__scope,
.nm-mysql-source__type {
  color: var(--rs-fg-muted);
  font-weight: 400;
}

.nm-mysql-source__type {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: var(--rs-font-size-xs);
}

.nm-mysql-source__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-mysql-source__loading {
  flex: 1;
}

.nm-mysql-source__editor {
  flex: 1;
  min-height: 0;
}
</style>
