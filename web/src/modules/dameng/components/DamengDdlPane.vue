<script setup lang="ts">
import { RsMonacoEditor, useRsToast } from '@niuma/ui'
import type { MonacoLanguage } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { damengApi } from '@/api/dameng'
import { DdlShell, type DdlShellLabels } from '@/modules/database'
import { formatSql } from '@/modules/sql-editor/format'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  schema?: string
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
    copy: t('modules.dameng.ddl.copy'),
    refresh: t('modules.dameng.browse.refresh'),
    needScope: t('modules.dameng.browse.needTable'),
    empty: t('modules.dameng.ddl.empty'),
  }),
)

const monacoLanguage = computed((): MonacoLanguage => 'sql')

const scopeLabel = computed(() => {
  if (props.schema && props.table) return `${props.schema}.${props.table}`
  return props.table || ''
})

const hasScope = computed(() => Boolean(props.schema?.trim() && props.table))

async function loadDDL(): Promise<void> {
  if (!props.sessionId || !props.schema?.trim() || !props.table) return
  loading.value = true
  try {
    const result = await damengApi.metaDDL({
      sessionId: props.sessionId,
      schema: props.schema.trim(),
      table: props.table,
    })
    objectType.value = result.objectType ?? ''
    try {
      ddl.value = formatSql(result.ddl, { dialect: 'dameng' })
    } catch {
      ddl.value = result.ddl
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('modules.dameng.ddl.loadError'))
  } finally {
    loading.value = false
  }
}

async function copyDDL(): Promise<void> {
  if (!ddl.value) return
  try {
    await navigator.clipboard.writeText(ddl.value)
    toast.success(t('modules.dameng.ddl.copied'))
  } catch {
    toast.error(t('modules.dameng.ddl.copyFailed'))
  }
}

watch(
  () => [props.sessionId, props.schema, props.table] as const,
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
    :session-label="sessionLabel || 'Dameng'"
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
