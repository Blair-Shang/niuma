<script setup lang="ts">
import {
  RsButton,
  RsEmpty,
  RsIcon,
  RsMonacoEditor,
  RsTable,
  RsTooltip,
  useRsToast,
  type RsTableColumn,
} from '@niuma/ui'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mysqlApi } from '@/api'
import {
  defaultMySQLProfile,
  resolveMonacoLanguageFromProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import type { SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { useMysqlCatalogCompletion } from '@/modules/mysql/composables/useMysqlCatalogCompletion'
import { useSessionRegistry } from '@/stores/session-registry'

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  initialSql?: string
  autoRunInitialSql?: boolean
  sessionLabel?: string
  active?: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessionRegistry = useSessionRegistry()

const sqlText = ref(props.initialSql?.trim() || 'SELECT 1;\n')
const running = ref(false)
const statusText = ref('')
const requestId = ref<string | null>(null)
const resultSetId = ref<string | null>(null)
const columns = ref<RsTableColumn[]>([])
const rows = ref<Record<string, unknown>[]>([])
const hasMore = ref(false)
const pageLimit = 1000

function dialectProfile() {
  if (!props.sessionId) return defaultMySQLProfile()
  return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultMySQLProfile()
}

const monacoLanguage = computed(
  () => resolveMonacoLanguageFromProfile(dialectProfile()).monacoLanguageId,
)

const suggestScope = computed<SqlSuggestScope | null>(() => {
  if (!props.sessionId) return null
  const db = props.database?.trim() || undefined
  return {
    sessionId: props.sessionId,
    database: db,
    schema: db,
  }
})

useMysqlCatalogCompletion({
  languageId: monacoLanguage,
  scope: suggestScope,
})

function cellKey(i: number): string {
  return `c${i}`
}

function applyResult(result: {
  columns: { name: string; dataType?: string }[]
  rows: unknown[][]
  rowCount: number
  fetchedCount?: number
  hasMore?: boolean
  truncated?: boolean
  durationMs: number
  requestId: string
  resultSetId?: string
  rowsAffected?: number
  commandTag?: string
}): void {
  requestId.value = result.requestId
  resultSetId.value = result.resultSetId ?? null
  hasMore.value = Boolean(result.hasMore)
  columns.value = (result.columns ?? []).map((c, i) => ({
    key: cellKey(i),
    title: c.name || `col${i + 1}`,
    ellipsis: true,
    minWidth: 96,
  }))
  rows.value = (result.rows ?? []).map((r, idx) => {
    const obj: Record<string, unknown> = { __i: idx }
    r.forEach((v, i) => {
      obj[cellKey(i)] = v
    })
    return obj
  })
  const parts = [
    t('modules.mysql.query.rows', { n: result.rowCount }),
    `${result.durationMs} ms`,
  ]
  if (result.rowsAffected != null && result.rowsAffected >= 0 && result.rowCount === 0) {
    parts.unshift(t('modules.mysql.query.affected', { n: result.rowsAffected }))
  }
  if (result.hasMore) parts.push(t('modules.mysql.query.hasMore'))
  if (result.truncated) parts.push(t('modules.mysql.query.truncated'))
  statusText.value = parts.join(' · ')
}

function currentStatement(): string {
  const features = resolveSplitFeaturesFromProfile(dialectProfile())
  const statements = splitSqlStatementsWithFeatures(sqlText.value, features)
    .map((s) => s.sql.trim())
    .filter(Boolean)
  return statements[0] ?? ''
}

async function runSql(): Promise<void> {
  if (!props.sessionId) {
    toast.error(t('modules.mysql.query.noSession'))
    return
  }
  const features = resolveSplitFeaturesFromProfile(dialectProfile())
  const statements = splitSqlStatementsWithFeatures(sqlText.value, features)
    .map((s) => s.sql.trim())
    .filter(Boolean)
  if (statements.length === 0) {
    toast.info(t('modules.mysql.query.empty'))
    return
  }

  running.value = true
  statusText.value = t('modules.mysql.query.running')
  try {
    // P0：严格顺序逐条执行；遇错停止
    let last: Awaited<ReturnType<typeof mysqlApi.queryExec>> | null = null
    for (let i = 0; i < statements.length; i++) {
      const rid = `q-${Date.now()}-${i}`
      requestId.value = rid
      last = await mysqlApi.queryExec({
        sessionId: props.sessionId,
        database: props.database,
        sql: statements[i]!,
        limit: pageLimit,
        requestId: rid,
      })
      applyResult(last)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    statusText.value = msg
    toast.error(msg)
  } finally {
    running.value = false
    requestId.value = null
  }
}

async function runExplain(analyze: boolean): Promise<void> {
  if (!props.sessionId) {
    toast.error(t('modules.mysql.query.noSession'))
    return
  }
  const sql = currentStatement()
  if (!sql) {
    toast.info(t('modules.mysql.query.empty'))
    return
  }
  running.value = true
  statusText.value = t('modules.mysql.query.explaining')
  try {
    const rid = `explain-${Date.now()}`
    requestId.value = rid
    const result = await mysqlApi.queryExplain({
      sessionId: props.sessionId,
      database: props.database,
      sql,
      analyze,
      limit: pageLimit,
      requestId: rid,
    })
    applyResult(result)
    statusText.value = [
      analyze ? t('modules.mysql.query.explainAnalyzeDone') : t('modules.mysql.query.explainDone'),
      statusText.value,
    ].join(' · ')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    statusText.value = msg
    toast.error(msg)
  } finally {
    running.value = false
    requestId.value = null
  }
}

async function loadMore(): Promise<void> {
  if (!props.sessionId || !resultSetId.value) return
  running.value = true
  try {
    const r = await mysqlApi.queryFetch({
      sessionId: props.sessionId,
      resultSetId: resultSetId.value,
      limit: pageLimit,
    })
    const start = rows.value.length
    const more = (r.rows ?? []).map((row, idx) => {
      const obj: Record<string, unknown> = {}
      row.forEach((v, i) => {
        obj[cellKey(i)] = v
      })
      obj.__i = start + idx
      return obj
    })
    rows.value = [...rows.value, ...more]
    hasMore.value = r.hasMore
    resultSetId.value = r.hasMore ? (r.resultSetId ?? resultSetId.value) : null
    statusText.value = t('modules.mysql.query.fetched', {
      n: r.fetchedCount,
      ms: r.durationMs,
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    running.value = false
  }
}

async function cancelRun(): Promise<void> {
  if (!props.sessionId) return
  try {
    await mysqlApi.queryCancel({
      sessionId: props.sessionId,
      requestId: requestId.value ?? undefined,
    })
    statusText.value = t('modules.mysql.query.cancelled')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function formatEditor(): void {
  try {
    sqlText.value = formatSql(sqlText.value, { dialect: 'mysql' })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    void runSql()
  }
}

watch(
  () => props.initialSql,
  (v) => {
    if (typeof v === 'string' && v.trim()) {
      sqlText.value = v
    }
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  if (props.autoRunInitialSql && props.initialSql?.trim()) {
    void runSql()
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (props.sessionId && resultSetId.value) {
    void mysqlApi.queryClose({ sessionId: props.sessionId, resultSetId: resultSetId.value }).catch(() => undefined)
  }
})
</script>

<template>
  <div class="nm-mysql-query">
    <header class="nm-mysql-query__chrome">
      <div class="nm-mysql-query__identity" :title="sessionLabel">
        <RsIcon name="database" :size="16" />
        <span class="nm-mysql-query__session">{{ sessionLabel || 'MySQL' }}</span>
        <span v-if="database" class="nm-mysql-query__db">{{ database }}</span>
      </div>
      <div class="nm-mysql-query__actions">
        <RsTooltip :content="t('modules.mysql.query.runHint')" side="bottom" nowrap>
          <RsButton variant="primary" size="sm" :disabled="running || !sessionId" @click="runSql">
            {{ t('modules.mysql.query.run') }}
          </RsButton>
        </RsTooltip>
        <RsButton size="sm" variant="ghost" :disabled="!running" @click="cancelRun">
          {{ t('modules.mysql.query.cancel') }}
        </RsButton>
        <RsButton size="sm" variant="ghost" :disabled="running" @click="formatEditor">
          {{ t('modules.mysql.query.format') }}
        </RsButton>
        <RsTooltip :content="t('modules.mysql.query.explainHint')" side="bottom" nowrap>
          <RsButton
            size="sm"
            variant="ghost"
            :disabled="running || !sessionId"
            @click="runExplain(false)"
          >
            {{ t('modules.mysql.query.explain') }}
          </RsButton>
        </RsTooltip>
        <RsTooltip :content="t('modules.mysql.query.explainAnalyzeHint')" side="bottom" nowrap>
          <RsButton
            size="sm"
            variant="ghost"
            :disabled="running || !sessionId"
            @click="runExplain(true)"
          >
            {{ t('modules.mysql.query.explainAnalyze') }}
          </RsButton>
        </RsTooltip>
        <RsButton
          v-if="hasMore"
          size="sm"
          variant="ghost"
          :disabled="running"
          @click="loadMore"
        >
          {{ t('modules.mysql.query.loadMore') }}
        </RsButton>
      </div>
    </header>

    <div class="nm-mysql-query__editor">
      <RsMonacoEditor
        v-model="sqlText"
        :language="monacoLanguage"
        :options="{ automaticLayout: active !== false, minimap: { enabled: false } }"
      />
    </div>

    <div class="nm-mysql-query__status">{{ statusText }}</div>

    <div class="nm-mysql-query__result">
      <RsEmpty
        v-if="columns.length === 0 && !running"
        :description="t('modules.mysql.query.emptyResult')"
      />
      <RsTable
        v-else
        :columns="columns"
        :data="rows"
        size="sm"
        fill
        :row-key="(row) => String(row.__i ?? JSON.stringify(row))"
      />
    </div>
  </div>
</template>

<style scoped>
.nm-mysql-query {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--rs-surface);
}

.nm-mysql-query__chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md);
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-mysql-query__identity {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
  font-size: var(--rs-font-size-sm);
}

.nm-mysql-query__session {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mysql-query__db {
  color: var(--rs-fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-mysql-query__actions {
  display: flex;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-mysql-query__editor {
  flex: 0 0 42%;
  min-height: 8rem;
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-mysql-query__status {
  padding: 0.25rem 0.75rem;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-fg-muted);
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-mysql-query__result {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
