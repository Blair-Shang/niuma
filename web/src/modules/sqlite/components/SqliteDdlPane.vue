<script setup lang="ts">
import { RsLoading, RsMonacoEditor, useRsToast } from '@niuma/ui'
import type { MonacoLanguage } from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sqliteApi } from '@/api/sqlite'
import { DdlShell, type DdlShellLabels } from '@/modules/database'
import { formatSql } from '@/modules/sql-editor/format'
import { useSessionRegistry } from '@/stores/session-registry'
import {
  defaultSqliteProfile,
  resolveMonacoLanguageFromProfile,
} from '@/modules/sql-editor/capabilities'
import { bootstrapSqliteMonaco } from '@/modules/sqlite/monaco-bootstrap'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  schema?: string
  table?: string
  /** table | view | index | trigger */
  objectType?: string
  sessionLabel?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessionRegistry = useSessionRegistry()

const loading = ref(false)
const ddl = ref('')
const resolvedObjectType = ref('')
const languageReady = ref(false)

const labels = computed(
  (): DdlShellLabels => ({
    copy: t('modules.sqlite.ddl.copy'),
    refresh: t('modules.sqlite.browse.refresh'),
    needScope: t('modules.sqlite.browse.needTable'),
    empty: t('modules.sqlite.ddl.empty'),
  }),
)

const dialectProfile = computed(() =>
  props.sessionId
    ? (sessionRegistry.getDialectForSession(props.sessionId) ?? defaultSqliteProfile())
    : defaultSqliteProfile(),
)

const monacoLanguage = computed((): MonacoLanguage =>
  resolveMonacoLanguageFromProfile(dialectProfile.value).monacoLanguageId,
)

const scopeLabel = computed(() => {
  if (props.schema && props.table) return `${props.schema}.${props.table}`
  return props.table || ''
})

const hasScope = computed(() => Boolean(props.table))

onMounted(async () => {
  try {
    await bootstrapSqliteMonaco()
  } catch {
    // 语言包失败时仍允许只读展示
  } finally {
    languageReady.value = true
  }
})

async function loadDDL(): Promise<void> {
  if (!props.sessionId || !props.table) return
  loading.value = true
  try {
    const result = await sqliteApi.metaDDL({
      sessionId: props.sessionId,
      schema: props.schema || undefined,
      table: props.table,
      name: props.table,
      type: props.objectType || undefined,
    })
    resolvedObjectType.value = result.objectType ?? result.type ?? props.objectType ?? ''
    try {
      ddl.value = formatSql(result.ddl, { dialect: 'sqlite' })
    } catch {
      ddl.value = result.ddl
    }
  } catch {
    toast.error(t('modules.sqlite.ddl.loadError'))
  } finally {
    loading.value = false
  }
}

async function copyDDL(): Promise<void> {
  if (!ddl.value) return
  try {
    await navigator.clipboard.writeText(ddl.value)
    toast.success(t('modules.sqlite.ddl.copied'))
  } catch {
    toast.error(t('modules.sqlite.ddl.copyFailed'))
  }
}

watch(
  () => [props.sessionId, props.schema, props.table, props.objectType] as const,
  () => {
    ddl.value = ''
    resolvedObjectType.value = ''
    if (props.active) void loadDDL()
  },
  { immediate: true },
)

watch(
  () => props.active,
  (active) => {
    if (active && !ddl.value && props.sessionId && props.table) {
      void loadDDL()
    }
  },
)
</script>

<template>
  <DdlShell
    :labels="labels"
    :session-label="sessionLabel || 'SQLite'"
    :scope-label="scopeLabel"
    :type-label="resolvedObjectType"
    :loading="loading"
    :has-scope="hasScope"
    :has-ddl="Boolean(ddl)"
    :can-copy="Boolean(ddl)"
    @copy="copyDDL"
    @refresh="loadDDL"
  >
    <RsLoading v-if="!languageReady" size="sm" block class="nm-sqlite-ddl__boot" />
    <RsMonacoEditor
      v-else
      :model-value="ddl"
      :language="monacoLanguage"
      :options="{
        readOnly: true,
        automaticLayout: active !== false,
        minimap: { enabled: false },
      }"
    />
  </DdlShell>
</template>

<style scoped>
.nm-sqlite-ddl__boot {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
