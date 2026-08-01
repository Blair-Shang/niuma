<script setup lang="ts">
import { RsLoading, RsMonacoEditor, useRsToast } from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { kingbaseApi } from '@/api/kingbase'
import { DdlShell, type DdlShellLabels } from '@/modules/database'
import { formatSql } from '@/modules/sql-editor/format'
import {
  defaultKingbaseProfile,
  resolveMonacoLanguageFromProfile,
} from '@/modules/sql-editor/capabilities'
import {
  bootstrapKingbaseMonaco,
  KINGBASE_MONACO_LANGUAGE_ID,
} from '@/modules/kingbase/monaco-bootstrap'
import { useSessionRegistry } from '@/stores/session-registry'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  table?: string
  sessionLabel?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessions = useSessionRegistry()
const loading = ref(false)
const ddl = ref('')
const objectType = ref('')
const languageReady = ref(false)

const labels = computed(
  (): DdlShellLabels => ({
    copy: t('modules.kingbase.ddl.copy'),
    refresh: t('modules.kingbase.browse.refresh'),
    needScope: t('modules.kingbase.browse.needTable'),
    empty: t('modules.kingbase.ddl.empty'),
  }),
)

const monacoLanguage = computed(() => {
  if (!props.sessionId) {
    return resolveMonacoLanguageFromProfile(defaultKingbaseProfile()).monacoLanguageId
  }
  const profile = sessions.getDialectForSession(props.sessionId) ?? defaultKingbaseProfile()
  return resolveMonacoLanguageFromProfile(profile).monacoLanguageId || KINGBASE_MONACO_LANGUAGE_ID
})

const scopeLabel = computed(() => {
  if (props.database && props.schema && props.table) {
    return `${props.database}.${props.schema}.${props.table}`
  }
  return props.table || ''
})

const hasScope = computed(
  () => Boolean(props.database?.trim() && props.schema?.trim() && props.table),
)

onMounted(async () => {
  try {
    await bootstrapKingbaseMonaco()
  } catch {
    // 语言包失败时仍允许只读展示
  } finally {
    languageReady.value = true
  }
})

async function loadDDL(): Promise<void> {
  if (!props.sessionId || !props.database?.trim() || !props.schema?.trim() || !props.table) return
  loading.value = true
  try {
    const result = await kingbaseApi.metaDDL({
      sessionId: props.sessionId,
      database: props.database.trim(),
      schema: props.schema.trim(),
      table: props.table,
    })
    objectType.value = result.objectType ?? ''
    try {
      ddl.value = formatSql(result.ddl, { dialect: 'kingbase' })
    } catch {
      ddl.value = result.ddl
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('modules.kingbase.ddl.loadError'))
  } finally {
    loading.value = false
  }
}

async function copyDDL(): Promise<void> {
  if (!ddl.value) return
  try {
    await navigator.clipboard.writeText(ddl.value)
    toast.success(t('modules.kingbase.ddl.copied'))
  } catch {
    toast.error(t('modules.kingbase.ddl.copyFailed'))
  }
}

watch(
  () => [props.sessionId, props.database, props.schema, props.table] as const,
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
    if (active && !ddl.value && props.sessionId && props.database && props.schema && props.table) {
      void loadDDL()
    }
  },
)
</script>

<template>
  <DdlShell
    :labels="labels"
    :session-label="sessionLabel || 'Kingbase'"
    :scope-label="scopeLabel"
    :type-label="objectType"
    :loading="loading"
    :has-scope="hasScope"
    :has-ddl="Boolean(ddl)"
    :can-copy="Boolean(ddl)"
    @copy="copyDDL"
    @refresh="loadDDL"
  >
    <RsLoading v-if="!languageReady" size="sm" block class="nm-kingbase-ddl__boot" />
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
.nm-kingbase-ddl__boot {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
