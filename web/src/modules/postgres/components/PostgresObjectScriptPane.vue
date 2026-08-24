<script setup lang="ts">
import { RsLoading, RsMonacoEditor, useRsToast, type RsContextMenuItem } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { postgresApi } from '@/api/postgres'
import {
  ObjectScriptShell,
  buildObjectScriptContextMenuItems,
  type ObjectScriptMessageTone,
  type ObjectScriptShellLabels,
} from '@/modules/database'
import { defaultPostgreSQLProfile } from '@/modules/sql-editor/capabilities'
import { usePostgresSqlEditor } from '@/modules/postgres/composables/usePostgresSqlEditor'
import { basePath } from '@/modules/postgres/conn-tree-shared'
import {
  objectKindIcon,
  objectKindToCategory,
  type PostgresObjectKind,
  type PostgresObjectScriptMode,
} from '@/modules/postgres/types/object-script'
import {
  parsePostgresObjectNameFromSql,
  toReplaceViewSql,
} from '@/modules/postgres/utils/normalize-object-ddl'
import { postgresDropSequenceSql, qualifiedName, quoteIdent } from '@/modules/postgres/sql-seed'
import {
  patchCategoryObjectCount,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import type { ConnItem } from '@/modules/ops/types'
import { useSessionRegistry } from '@/stores/session-registry'
import { useTabStore } from '@/stores/tab'

const props = withDefaults(defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  objectName?: string
  objectKind?: PostgresObjectKind
  /** 触发器所在表（meta.ddl kind=trigger） */
  table?: string
  args?: string
  oid?: number
  designMode?: PostgresObjectScriptMode
  sessionLabel?: string
  tabId?: string
  active?: boolean
}>(), { objectKind: 'view', designMode: 'alter', active: true })

const { t } = useI18n()
const toast = useRsToast()
const tabs = useTabStore()
const sqlText = ref('')
const originalSql = ref('')
const loading = ref(false)
const saving = ref(false)
const lastMessage = ref<string | null>(null)
const lastError = ref<string | null>(null)
const localDesignMode = ref<PostgresObjectScriptMode | null>(null)
const localObjectName = ref<string | null>(null)

const objectKind = computed(() => props.objectKind ?? 'view')
const designMode = computed<PostgresObjectScriptMode>(
  () => localDesignMode.value ?? props.designMode ?? 'alter',
)
const modeCreate = computed(() => designMode.value === 'create')
const objectName = computed(() => localObjectName.value ?? props.objectName)
const hasObject = computed(() => modeCreate.value || Boolean(props.schema && objectName.value))
const kindIcon = computed(() => objectKindIcon(objectKind.value))
const kindLabel = computed(() => kindFeatureLabel(objectKind.value))
const typeLabel = computed(() =>
  modeCreate.value ? t('modules.postgres.objectScript.modeCreate') : kindLabel.value,
)
const scopeLabel = computed(() => {
  if (props.schema && objectName.value) {
    return props.database
      ? `${props.database}.${props.schema}.${objectName.value}`
      : `${props.schema}.${objectName.value}`
  }
  return props.schema || objectName.value || ''
})
const message = computed(() => lastError.value || lastMessage.value)
const messageTone = computed((): ObjectScriptMessageTone | null => {
  if (lastError.value) return 'error'
  if (lastMessage.value) return 'ok'
  return null
})
const applyLabel = computed(() =>
  modeCreate.value
    ? t('modules.postgres.objectScript.create')
    : t('modules.postgres.objectScript.save'),
)
const labels = computed((): ObjectScriptShellLabels => ({
  format: t('modules.postgres.query.format'),
  formatTooltip: t('modules.postgres.query.formatTooltip'),
  copy: t('modules.postgres.ddl.copy'),
  refresh: t('modules.postgres.structure.refresh'),
  create: t('modules.postgres.objectScript.create'),
  save: t('modules.postgres.objectScript.save'),
  needObject: t('modules.postgres.objectScript.needObject'),
  modeCreate: t('modules.postgres.objectScript.modeCreate'),
}))

function kindFeatureLabel(kind: PostgresObjectKind): string {
  if (kind === 'procedure') return t('modules.postgres.session.tabProcedure')
  if (kind === 'function') return t('modules.postgres.session.tabFunction')
  if (kind === 'sequence') return t('modules.postgres.session.tabSequence')
  if (kind === 'materialized_view') return t('modules.postgres.session.tabMatView')
  if (kind === 'trigger') return t('modules.postgres.session.tabTrigger')
  return t('modules.postgres.session.tabView')
}

function resolveTabId(): string | null {
  return props.tabId || tabs.activeTabId || null
}

function createFallbackTemplate(): string {
  const schema = props.schema || 'public'
  const name = objectName.value || `new_${objectKind.value}`
  const qn = qualifiedName(schema, name)
  if (objectKind.value === 'function') {
    return `CREATE OR REPLACE FUNCTION ${qn}()\nRETURNS void\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  -- TODO: implement\nEND;\n$$;`
  }
  if (objectKind.value === 'procedure') {
    return `CREATE OR REPLACE PROCEDURE ${qn}()\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  -- TODO: implement\nEND;\n$$;`
  }
  if (objectKind.value === 'sequence') {
    return `CREATE SEQUENCE ${qn}\n  INCREMENT BY 1\n  MINVALUE 1\n  START WITH 1\n  CACHE 1\n  NO CYCLE;`
  }
  if (objectKind.value === 'materialized_view') {
    return `CREATE MATERIALIZED VIEW ${qn} AS\nSELECT\n  1 AS example_column\nWITH DATA;`
  }
  if (objectKind.value === 'trigger') {
    return `CREATE TRIGGER ${quoteIdent(name)}\n  AFTER INSERT OR UPDATE OR DELETE\n  ON ${qualifiedName(schema, 'target_table')}\n  FOR EACH ROW\n  EXECUTE PROCEDURE ${qualifiedName(schema, 'trigger_fn')}();`
  }
  return `CREATE OR REPLACE VIEW ${qn} AS\nSELECT\n  1 AS example_column;`
}

async function loadCreateTemplate(): Promise<void> {
  if (objectKind.value === 'sequence') {
    sqlText.value = createFallbackTemplate()
    originalSql.value = sqlText.value
    return
  }
  let action:
    | 'create_view'
    | 'create_function'
    | 'create_procedure'
    | 'create_matview'
    | 'create_trigger' = 'create_view'
  if (objectKind.value === 'function') action = 'create_function'
  if (objectKind.value === 'procedure') action = 'create_procedure'
  if (objectKind.value === 'materialized_view') action = 'create_matview'
  if (objectKind.value === 'trigger') action = 'create_trigger'
  const name = objectName.value || `new_${objectKind.value}`
  try {
    if (!props.sessionId) throw new Error('No active session')
    const result = await postgresApi.ddlScript({
      sessionId: props.sessionId,
      database: props.database,
      schema: props.schema || 'public',
      name,
      action,
    })
    sqlText.value = result.sql
  } catch {
    sqlText.value = createFallbackTemplate()
  }
  originalSql.value = sqlText.value
}

async function loadScript(): Promise<void> {
  lastError.value = null
  lastMessage.value = null
  if (modeCreate.value) {
    await loadCreateTemplate()
    return
  }
  if (!props.sessionId || !props.schema || !objectName.value) return
  loading.value = true
  try {
    const result =
      objectKind.value === 'view' ||
      objectKind.value === 'sequence' ||
      objectKind.value === 'materialized_view' ||
      objectKind.value === 'trigger'
        ? await postgresApi.metaDDL({
            sessionId: props.sessionId,
            database: props.database,
            schema: props.schema,
            name: objectName.value,
            kind: objectKind.value === 'trigger' ? 'trigger' : undefined,
            table: objectKind.value === 'trigger' ? props.table : undefined,
          })
        : await postgresApi.metaRoutineSource({
            sessionId: props.sessionId,
            database: props.database,
            schema: props.schema,
            name: objectName.value,
            args: props.args,
            oid: props.oid,
          })
    const definition = 'ddl' in result ? result.ddl : result.definition
    originalSql.value = definition ?? ''
    sqlText.value = originalSql.value
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : t('modules.postgres.objectScript.loadError')
    lastError.value = msg
    toast.error(msg)
  } finally {
    loading.value = false
  }
}

async function refreshTree(updateCounts: boolean): Promise<void> {
  if (!props.profileId || !props.database || !props.schema) return
  const conn = { profileId: props.profileId, kind: 'postgres' } as ConnItem
  const cat = objectKindToCategory(objectKind.value)
  const path = basePath(props.database, props.schema, cat)
  try {
    await refreshResourceIfLoaded(conn, path, { deep: false })
    if (updateCounts) {
      patchCategoryObjectCount(conn, path, { delta: 1 })
    }
  } catch {
    // 刷树失败不影响保存成功提示
  }
}

function switchToAlterAfterCreate(name: string): void {
  localDesignMode.value = 'alter'
  localObjectName.value = name
  const tabId = resolveTabId()
  if (!tabId) return
  const nextProps: Record<string, unknown> = {
    designMode: 'alter',
    objectName: name,
    objectKind: objectKind.value,
  }
  if (objectKind.value === 'view' || objectKind.value === 'materialized_view') {
    nextProps.table = name
    nextProps.isView = true
  } else if (objectKind.value === 'sequence') {
    nextProps.sequence = name
  } else if (objectKind.value === 'trigger') {
    if (props.table) nextProps.table = props.table
  } else {
    nextProps.routine = name
    nextProps.routineKind = objectKind.value
  }
  tabs.updateTabProps(tabId, nextProps)
  const tab = tabs.allTabs.find((item) => item.tabId === tabId)
  if (tab && 'initialSql' in tab.props) {
    delete tab.props.initialSql
  }
  // Tab 只显示真实对象名；完整库.schema.对象放 tip（对齐 MySQL）
  tabs.updateTitle(tabId, name)
  if (tab) {
    const resourcePrefix = `${t('workspace.tabTipResource')}:`
    const featurePrefix = `${t('workspace.tabTipFeature')}:`
    const resource = [props.database, props.schema, name].filter(Boolean).join('.')
    const head = (tab.tooltip ?? '')
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.startsWith(resourcePrefix) && !line.startsWith(featurePrefix))
    const next = [...head]
    if (resource) next.push(`${resourcePrefix} ${resource}`)
    next.push(`${featurePrefix} ${kindFeatureLabel(objectKind.value)}`)
    tab.tooltip = next.join('\n')
  }
}

async function applyScript(): Promise<void> {
  if (!props.sessionId || saving.value) return
  syncSelectionFlag()
  const selectionOnly = hasSelection.value
  const raw = resolveSql().trim()
  if (!raw) {
    lastError.value = t('modules.postgres.objectScript.empty')
    return
  }
  saving.value = true
  lastError.value = null
  lastMessage.value = null
  const wasCreate = modeCreate.value
  const sqlObjectName = parsePostgresObjectNameFromSql(raw, objectKind.value)
  const appliedName = sqlObjectName || objectName.value || ''
  try {
    if (!selectionOnly) {
      // 序列无 OR REPLACE：编辑保存前先 DROP，再 CREATE（对齐 Dameng）
      if (objectKind.value === 'sequence' && !wasCreate && props.schema && appliedName) {
        try {
          await postgresApi.queryExec({
            sessionId: props.sessionId,
            database: props.database,
            sql: postgresDropSequenceSql(props.schema, appliedName),
          })
        } catch {
          // 对象可能不存在；继续 CREATE
        }
      }
    }
    const execSql =
      !selectionOnly && objectKind.value === 'view' ? toReplaceViewSql(raw) : raw
    await postgresApi.queryExec({
      sessionId: props.sessionId,
      database: props.database,
      sql: execSql,
    })
    if (!selectionOnly && objectKind.value === 'view') {
      sqlText.value = toReplaceViewSql(sqlText.value)
    }
    if (!selectionOnly) {
      originalSql.value = sqlText.value
    }
    const okMsg = wasCreate
      ? t('modules.postgres.objectScript.createOk', { name: appliedName })
      : t('modules.postgres.objectScript.saveOk')
    lastMessage.value = okMsg
    toast.success(okMsg)
    await refreshTree(wasCreate)
    if (!selectionOnly && wasCreate && appliedName) {
      switchToAlterAfterCreate(appliedName)
    }
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : t('modules.postgres.objectScript.saveError')
    lastError.value = msg
    toast.error(msg)
  } finally {
    saving.value = false
  }
}

async function copyScript(): Promise<void> {
  if (!sqlText.value) return
  try {
    await navigator.clipboard.writeText(sqlText.value)
    toast.success(t('modules.postgres.ddl.copied'))
  } catch {
    toast.error(t('modules.postgres.ddl.copyFailed'))
  }
}

async function askAiAboutSelection(): Promise<void> {
  const { executeCommand } = await import('@/extensions/contributions/command-registry')
  syncSelectionFlag()
  const sql = resolveSql()
  if (sql) {
    const { publishEditorSelection } = await import('@/shell/panels/ai/workspace-context')
    publishEditorSelection({
      tabId: tabs.activeTabId || undefined,
      text: sql,
      language: 'sql',
      source: 'monaco',
    })
  }
  await executeCommand('workbench.ai.askSelection')
}

const {
  editorRef,
  languageReady,
  sqlLanguage,
  formatSql,
  compressSql,
  copyEditor,
  pasteEditor,
  resolveSql,
  syncSelectionFlag,
  hasSelection,
  onActiveChange,
} = usePostgresSqlEditor({
  sqlText,
  active: () => props.active === true,
  onRun: () => {
    void applyScript()
  },
  getSuggestScope: () =>
    props.sessionId
      ? { sessionId: props.sessionId, database: props.database, schema: props.schema || 'public' }
      : null,
  getDialect: () => {
    if (!props.sessionId) return defaultPostgreSQLProfile()
    return useSessionRegistry().getDialectForSession(props.sessionId) ?? defaultPostgreSQLProfile()
  },
})

const contextMenuItems = computed((): RsContextMenuItem[] =>
  buildObjectScriptContextMenuItems({
    labels: {
      apply: applyLabel.value,
      applySelection: t('modules.postgres.query.runSelection'),
      format: t('modules.postgres.query.format'),
      compress: t('modules.postgres.query.compress'),
      copy: t('modules.postgres.ddl.copy'),
      paste: t('modules.postgres.query.paste'),
      askAi: t('modules.postgres.query.askAi'),
    },
    saving: saving.value,
    hasSelection: hasSelection.value,
    sqlEmpty: !sqlText.value.trim(),
    canApply: Boolean(props.sessionId),
    showAskAi: true,
  }),
)

function onContextMenuSelect(key: string): void {
  syncSelectionFlag()
  if (key === 'apply') void applyScript()
  else if (key === 'format') void formatSql()
  else if (key === 'compress') void compressSql()
  else if (key === 'copy') copyEditor()
  else if (key === 'paste') void pasteEditor()
  else if (key === 'askAi') void askAiAboutSelection()
}

watch(
  () =>
    [
      props.sessionId,
      props.database,
      props.schema,
      props.objectName,
      props.args,
      props.oid,
      props.objectKind,
      props.designMode,
      props.active,
    ] as const,
  (curr, prev) => {
    localDesignMode.value = null
    localObjectName.value = null
    if (props.active === false) return

    // 创建成功后 props：create→alter，保留刚执行的正文
    if (prev && prev[7] === 'create' && curr[7] === 'alter') {
      return
    }

    // 同一对象已有正文时不重灌
    if (
      prev &&
      sqlText.value.trim() &&
      prev[1] === curr[1] &&
      prev[2] === curr[2] &&
      prev[3] === curr[3] &&
      prev[6] === curr[6] &&
      prev[7] === curr[7]
    ) {
      return
    }

    sqlText.value = ''
    originalSql.value = ''
    void loadScript()
  },
  { immediate: true },
)

watch(
  () => props.active,
  (active) => {
    void onActiveChange(active === true)
    if (active && !sqlText.value) void loadScript()
  },
)
</script>

<template>
  <ObjectScriptShell
    :labels="labels"
    :session-label="sessionLabel || 'Postgres'"
    :scope-label="scopeLabel"
    :type-label="typeLabel"
    :icon="kindIcon"
    :mode="designMode"
    :loading="loading"
    :saving="saving"
    :has-object="hasObject"
    :can-copy="Boolean(sqlText)"
    :can-apply="Boolean(sessionId && sqlText.trim())"
    :can-format="!saving && !loading"
    :show-refresh="!modeCreate"
    :message="message"
    :message-tone="messageTone"
    :context-menu-items="contextMenuItems"
    @format="formatSql"
    @copy="copyScript"
    @refresh="loadScript"
    @apply="applyScript"
    @context-select="onContextMenuSelect"
  >
    <template #editor>
      <RsLoading v-if="loading && !sqlText" block class="nm-postgres-object-script__boot" />
      <RsMonacoEditor
        v-else-if="languageReady"
        ref="editorRef"
        v-model="sqlText"
        embedded
        :language="sqlLanguage"
        :options="{
          automaticLayout: active !== false,
          minimap: { enabled: false },
          wordWrap: 'on',
        }"
      />
      <div v-else class="nm-postgres-object-script__boot">
        <RsLoading size="sm" />
      </div>
    </template>
  </ObjectScriptShell>
</template>

<style scoped>
.nm-postgres-object-script__boot {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
