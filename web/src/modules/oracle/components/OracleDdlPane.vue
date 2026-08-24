<script setup lang="ts">
/**
 * Oracle DDL 只读页：加载/刷新语义与 MysqlDdlPane 保持一致。
 * - scope（sessionId/schema/table）变化：清空并重拉
 * - keep-alive 切回（active=true）且已有 ddl：不重拉
 */
import { RsMonacoEditor, useRsToast } from '@niuma/ui'
import type { MonacoLanguage } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { oracleApi } from '@/api/oracle'
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
/** Oracle 使用内置 sql 语言，无需额外 bootstrap；与 MySQL boot 分支结构对齐。 */
const languageReady = ref(true)

const labels = computed(
  (): DdlShellLabels => ({
    copy: t('modules.oracle.ddl.copy'),
    refresh: t('modules.oracle.browse.refresh'),
    needScope: t('modules.oracle.browse.needTable'),
    empty: t('modules.oracle.ddl.empty'),
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
    const result = await oracleApi.metaDDL({
      sessionId: props.sessionId,
      schema: props.schema.trim(),
      table: props.table,
    })
    objectType.value = result.objectType ?? ''
    try {
      ddl.value = formatSql(result.ddl, { dialect: 'oracle' })
    } catch {
      ddl.value = result.ddl
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('modules.oracle.ddl.loadError'))
  } finally {
    loading.value = false
  }
}

async function copyDDL(): Promise<void> {
  if (!ddl.value) return
  try {
    await navigator.clipboard.writeText(ddl.value)
    toast.success(t('modules.oracle.ddl.copied'))
  } catch {
    toast.error(t('modules.oracle.ddl.copyFailed'))
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
    if (active && !ddl.value && props.sessionId && props.schema?.trim() && props.table) {
      void loadDDL()
    }
  },
)
</script>

<template>
  <DdlShell
    class="nm-oracle-ddl"
    :labels="labels"
    :session-label="sessionLabel || 'Oracle'"
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
      v-if="languageReady"
      :model-value="ddl"
      class="nm-oracle-ddl__editor"
      height="100%"
      :language="monacoLanguage"
      embedded
      :options="{
        readOnly: true,
        automaticLayout: active !== false,
        minimap: { enabled: false },
      }"
    />
  </DdlShell>
</template>

<style scoped>
.nm-oracle-ddl__editor {
  flex: 1;
  min-height: 0;
  border-radius: 0;
  border: none;
}
</style>
