<script setup lang="ts">
import { RsMonacoEditor, useRsToast } from '@niuma/ui'
import type { MonacoLanguage } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { clickhouseApi } from '@/api/clickhouse'
import { DdlShell, type DdlShellLabels } from '@/modules/database'
import { formatSql } from '@/modules/sql-editor/format'

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
const loading = ref(false)
const ddl = ref('')
const objectType = ref('')

const labels = computed(
  (): DdlShellLabels => ({
    copy: t('modules.clickhouse.ddl.copy'),
    refresh: t('modules.clickhouse.browse.refresh'),
    needScope: t('modules.clickhouse.browse.needTable'),
    empty: t('modules.clickhouse.ddl.empty'),
  }),
)

const monacoLanguage = computed((): MonacoLanguage => 'sql')

const scopeLabel = computed(() => {
  if (props.database && props.table) return `${props.database}.${props.table}`
  return props.table || ''
})

const hasScope = computed(() => Boolean(props.database?.trim() && props.table))

async function loadDDL(): Promise<void> {
  if (!props.sessionId || !props.database?.trim() || !props.table) return
  loading.value = true
  try {
    const result = await clickhouseApi.metaDDL({
      sessionId: props.sessionId,
      database: props.database.trim(),
      table: props.table,
    })
    objectType.value = result.objectType ?? result.type ?? ''
    try {
      ddl.value = formatSql(result.ddl, { dialect: 'clickhouse' })
    } catch {
      ddl.value = result.ddl
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('modules.clickhouse.ddl.loadError'))
  } finally {
    loading.value = false
  }
}

async function copyDDL(): Promise<void> {
  if (!ddl.value) return
  try {
    await navigator.clipboard.writeText(ddl.value)
    toast.success(t('modules.clickhouse.ddl.copied'))
  } catch {
    toast.error(t('modules.clickhouse.ddl.copyFailed'))
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
    if (active && !ddl.value) void loadDDL()
  },
)
</script>

<template>
  <DdlShell
    :labels="labels"
    :session-label="sessionLabel || 'ClickHouse'"
    :scope-label="scopeLabel"
    :type-label="objectType"
    :loading="loading"
    :has-scope="hasScope"
    :has-ddl="Boolean(ddl)"
    :can-copy="Boolean(ddl)"
    @copy="copyDDL"
    @refresh="loadDDL"
  >
    <RsMonacoEditor
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
