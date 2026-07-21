<script setup lang="ts">
import { RsButton, RsCodeEditor, RsEmpty, RsLoading, useRsToast } from '@niuma/ui'
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { vastbaseApi } from '@/api'
import { VAST_SESSION_HEADER_ACTIONS_KEY } from '@/modules/vastbase/session-chrome'

const props = defineProps<{
  sessionId: string | null
  database?: string
  schema?: string
  table?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

const headerActionsEl = inject(VAST_SESSION_HEADER_ACTIONS_KEY, ref<HTMLElement | null>(null))
const actionsHost = computed(() => headerActionsEl.value)

const loading = ref(false)
const ddl = ref('')
const objectType = ref('')

async function loadDDL(): Promise<void> {
  if (!props.sessionId || !props.schema || !props.table) return
  loading.value = true
  try {
    const result = await vastbaseApi.metaDDL({
      sessionId: props.sessionId,
      database: props.database,
      schema: props.schema,
      table: props.table,
    })
    objectType.value = result.objectType
    try {
      const { formatSql } = await import('@/modules/sql-editor/format')
      ddl.value = formatSql(result.ddl, { dialect: 'vastbase' })
    } catch {
      ddl.value = result.ddl
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.ddl.loadError'))
  } finally {
    loading.value = false
  }
}

async function copyDDL(): Promise<void> {
  if (!ddl.value) return
  try {
    await navigator.clipboard.writeText(ddl.value)
    toast.success(t('modules.vastbase.ddl.copied'))
  } catch {
    toast.error(t('modules.vastbase.ddl.copyFailed'))
  }
}

/** 仅在作用域变化时重拉；keep-alive 切回页签不重复请求。 */
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
    if (active && !ddl.value && props.sessionId && props.schema && props.table) {
      void loadDDL()
    }
  },
)
</script>

<template>
  <div class="nm-vast-ddl">
    <Teleport v-if="actionsHost" :to="actionsHost">
      <span v-if="objectType" class="nm-vast-ddl__type">{{ objectType }}</span>
      <RsButton variant="ghost" size="sm" icon="copy" :disabled="!ddl" @click="copyDDL">
        {{ t('modules.vastbase.ddl.copy') }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        icon="refresh-cw"
        :loading="loading"
        @click="loadDDL"
      >
        {{ t('modules.vastbase.structure.refresh') }}
      </RsButton>
    </Teleport>

    <RsLoading v-if="loading && !ddl" class="nm-vast-ddl__loading" />
    <RsEmpty
      v-else-if="!schema || !table"
      fill
      icon="file-code"
      :description="t('modules.vastbase.structure.needTable')"
    />
    <RsEmpty
      v-else-if="!ddl"
      fill
      icon="file-code"
      :description="t('modules.vastbase.ddl.empty')"
    />
    <RsCodeEditor
      v-else
      v-model="ddl"
      class="nm-vast-ddl__editor"
      language="sql"
      readonly
      :show-toolbar="false"
      height="100%"
    />
  </div>
</template>

<style scoped>
.nm-vast-ddl {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-vast-ddl__type {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-right: var(--rs-space-xs);
}

.nm-vast-ddl__loading {
  flex: 1;
}

.nm-vast-ddl__editor {
  flex: 1;
  min-height: 0;
  border: none;
  border-radius: 0;
}
</style>
