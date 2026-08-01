<script setup lang="ts">
import { RsLoading, RsMonacoEditor, useRsToast } from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mysqlApi } from '@/api'
import { DdlShell, type DdlShellLabels } from '@/modules/database'
import {
  defaultMySQLProfile,
  resolveMonacoLanguageFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import {
  bootstrapMysqlMonaco,
  MYSQL_MONACO_LANGUAGE_ID,
} from '@/modules/mysql/monaco-bootstrap'
import { useSessionRegistry } from '@/stores/session-registry'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  table?: string
  sessionLabel?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessionRegistry = useSessionRegistry()

const loading = ref(false)
const ddl = ref('')
const objectType = ref('')
const languageReady = ref(false)

const labels = computed(
  (): DdlShellLabels => ({
    copy: t('modules.mysql.ddl.copy'),
    refresh: t('modules.mysql.browse.refresh'),
    needScope: t('modules.mysql.browse.needTable'),
    empty: t('modules.mysql.ddl.empty'),
  }),
)

const monacoLanguage = computed(() => {
  if (!props.sessionId) {
    return resolveMonacoLanguageFromProfile(defaultMySQLProfile()).monacoLanguageId
  }
  const profile = sessionRegistry.getDialectForSession(props.sessionId) ?? defaultMySQLProfile()
  return resolveMonacoLanguageFromProfile(profile).monacoLanguageId || MYSQL_MONACO_LANGUAGE_ID
})

const scopeLabel = computed(() => {
  if (props.database && props.table) return `${props.database}.${props.table}`
  return props.table || ''
})

const hasScope = computed(() => Boolean(props.database && props.table))

onMounted(async () => {
  try {
    await bootstrapMysqlMonaco()
  } catch {
    // 语言包失败时仍允许只读展示
  } finally {
    languageReady.value = true
  }
})

async function loadDDL(): Promise<void> {
  if (!props.sessionId || !props.database || !props.table) return
  loading.value = true
  try {
    const result = await mysqlApi.metaDDL({
      sessionId: props.sessionId,
      database: props.database,
      table: props.table,
    })
    objectType.value = result.objectType
    try {
      ddl.value = formatSql(result.ddl, { dialect: 'mysql' })
    } catch {
      ddl.value = result.ddl
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.ddl.loadError'))
  } finally {
    loading.value = false
  }
}

async function copyDDL(): Promise<void> {
  if (!ddl.value) return
  try {
    await navigator.clipboard.writeText(ddl.value)
    toast.success(t('modules.mysql.ddl.copied'))
  } catch {
    toast.error(t('modules.mysql.ddl.copyFailed'))
  }
}

watch(
  () => [props.sessionId, props.database, props.table] as const,
  () => {
    ddl.value = ''
    objectType.value = ''
    if (props.active) void loadDDL()
  },
  { immediate: true },
)

watch(
  () => props.active,
  (active) => {
    if (active && !ddl.value && props.sessionId && props.database && props.table) {
      void loadDDL()
    }
  },
)
</script>

<template>
  <DdlShell
    :labels="labels"
    :session-label="sessionLabel || 'MySQL'"
    :scope-label="scopeLabel"
    :type-label="objectType"
    :loading="loading"
    :has-scope="hasScope"
    :has-ddl="Boolean(ddl)"
    :can-copy="Boolean(ddl)"
    @copy="copyDDL"
    @refresh="loadDDL"
  >
    <RsLoading v-if="!languageReady" size="sm" block class="nm-mysql-ddl__boot" />
    <RsMonacoEditor
      v-else
      :model-value="ddl"
      :language="monacoLanguage"
      embedded
      height="100%"
      :options="{
        readOnly: true,
        automaticLayout: active !== false,
        minimap: { enabled: false },
      }"
    />
  </DdlShell>
</template>

<style scoped>
.nm-mysql-ddl__boot {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
