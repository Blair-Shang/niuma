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

const monacoLanguage = computed(() => {
  if (!props.sessionId) {
    return resolveMonacoLanguageFromProfile(defaultMySQLProfile()).monacoLanguageId
  }
  const profile = sessionRegistry.getDialectForSession(props.sessionId) ?? defaultMySQLProfile()
  return resolveMonacoLanguageFromProfile(profile).monacoLanguageId
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
  <div class="nm-mysql-ddl">
    <header class="nm-mysql-ddl__chrome">
      <div class="nm-mysql-ddl__identity" :title="sessionLabel">
        <RsIcon name="file-code" :size="16" />
        <span class="nm-mysql-ddl__session">{{ sessionLabel || 'MySQL' }}</span>
        <span v-if="database && table" class="nm-mysql-ddl__scope">{{ database }}.{{ table }}</span>
        <span v-if="objectType" class="nm-mysql-ddl__type">{{ objectType }}</span>
      </div>
      <div class="nm-mysql-ddl__actions">
        <RsButton variant="ghost" size="sm" icon="copy" :disabled="!ddl" @click="copyDDL">
          {{ t('modules.mysql.ddl.copy') }}
        </RsButton>
        <RsButton
          variant="ghost"
          size="sm"
          icon="refresh-cw"
          :loading="loading"
          @click="loadDDL"
        >
          {{ t('modules.mysql.browse.refresh') }}
        </RsButton>
      </div>
    </header>

    <RsLoading v-if="loading && !ddl" class="nm-mysql-ddl__loading" />
    <RsEmpty
      v-else-if="!database || !table"
      icon="file-code"
      :description="t('modules.mysql.browse.needTable')"
    />
    <RsEmpty
      v-else-if="!ddl"
      icon="file-code"
      :description="t('modules.mysql.ddl.empty')"
    />
    <div v-else class="nm-mysql-ddl__editor">
      <RsMonacoEditor
        :model-value="ddl"
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
.nm-mysql-ddl {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-mysql-ddl__chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-mysql-ddl__identity {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-mysql-ddl__session {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mysql-ddl__scope,
.nm-mysql-ddl__type {
  color: var(--rs-fg-muted);
  font-weight: 400;
}

.nm-mysql-ddl__type {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: var(--rs-font-size-xs);
}

.nm-mysql-ddl__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-mysql-ddl__loading {
  flex: 1;
}

.nm-mysql-ddl__editor {
  flex: 1;
  min-height: 0;
}
</style>
