<script setup lang="ts">
/**
 * SQL Server 例程执行面板（对齐 MySQL MysqlDebugPane）：
 * 左侧填参 + 运行调用 + 右侧结果/消息；源码/日志点仅编辑器草稿，永不写回服务器。
 */
import {
  RsButton,
  RsEmpty,
  RsLoading,
  RsMonacoEditor,
  RsTabs,
  useRsToast,
  type RsTableColumn,
  type RsTabItem,
} from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sqlserverApi } from '@/api/sqlserver'
import type { SqlServerQueryColumn, SqlServerQueryExecResult } from '@/api/types/sqlserver'
import {
  DebugHelpPanel,
  DebugMessagesPanel,
  DebugResultPanel,
  DebugShell,
  type DebugResultGrid,
  type DebugResultPanelLabels,
  type DebugShellLabels,
  type DebugShellParamRow,
  type DebugShellStateTone,
} from '@/modules/database'
import {
  defaultSqlServerProfile,
  resolveMonacoLanguageFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import {
  bootstrapSqlServerMonaco,
  SQLSERVER_MONACO_LANGUAGE_ID,
} from '@/modules/sqlserver/monaco-bootstrap'
import { qualifiedName } from '@/modules/sqlserver/sql-seed'
import {
  buildSqlServerRoutineCallSql,
  type SqlServerRoutineParam,
} from '@/modules/sqlserver/utils/routine-call'
import {
  countSqlServerDebugLogPoints,
  insertSqlServerDebugLogPoint,
  insertSqlServerDebugLogPointAtLine,
  wrapSqlServerCallWithDebugSession,
} from '@/modules/sqlserver/utils/sqlserver-debug-assist'
import { useSessionRegistry } from '@/stores/session-registry'

type InspectTab = 'result' | 'messages' | 'help'
type ResultRow = Record<string, unknown> & { __rowKey: string }

const props = defineProps<{
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  routine?: string
  routineKind?: 'procedure' | 'function'
  sessionLabel?: string
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()
const sessionRegistry = useSessionRegistry()

const probing = ref(false)
const loadingSource = ref(false)
const running = ref(false)
const params = ref<DebugShellParamRow[]>([])
const paramMeta = ref<SqlServerRoutineParam[]>([])
const returnType = ref('')
const isTableValued = ref(false)
const sourceText = ref('')
const languageReady = ref(false)
const enableDebugSession = ref(true)
const editorRef = ref<{
  getEditor: () => { getPosition: () => { lineNumber: number } | null } | null
} | null>(null)

const inspectTab = ref<InspectTab>('help')
const messages = ref<string[]>([])
const resultGrids = ref<DebugResultGrid[]>([])
const activeGridId = ref('')

const kind = computed<'procedure' | 'function'>(() =>
  props.routineKind === 'function' ? 'function' : 'procedure',
)

const schemaName = computed(() => props.schema?.trim() || 'dbo')

const targetLabel = computed(() => {
  if (!props.routine) return ''
  return qualifiedName(props.database, schemaName.value, props.routine)
})

const logPointCount = computed(() => countSqlServerDebugLogPoints(sourceText.value))
const busy = computed(() => running.value)

const dialectProfile = computed(() => {
  if (!props.sessionId) return defaultSqlServerProfile()
  return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultSqlServerProfile()
})

const monacoLanguage = computed(
  () =>
    resolveMonacoLanguageFromProfile(dialectProfile.value).monacoLanguageId ||
    SQLSERVER_MONACO_LANGUAGE_ID,
)

const stateTone = computed((): DebugShellStateTone => {
  if (running.value) return 'running'
  if (messages.value.some((m) => m.startsWith('ERR'))) return 'ended'
  if (resultGrids.value.length > 0) return 'paused'
  return 'idle'
})

const stateLabel = computed(() => {
  if (running.value) return t('modules.sqlserver.debug.stateRunning')
  if (messages.value.some((m) => m.startsWith('ERR'))) return t('modules.sqlserver.debug.stateError')
  if (resultGrids.value.length > 0) return t('modules.sqlserver.debug.stateDone')
  return t('modules.sqlserver.debug.stateAssist')
})

const shellLabels = computed(
  (): DebugShellLabels => ({
    toolbarLabel: t('modules.sqlserver.debug.toolbarLabel'),
    noTarget: t('modules.sqlserver.debug.noTarget'),
    start: t('modules.sqlserver.debug.runCall'),
    continue: t('modules.sqlserver.debug.continue'),
    next: t('modules.sqlserver.debug.next'),
    step: t('modules.sqlserver.debug.step'),
    finish: t('modules.sqlserver.debug.finish'),
    abort: t('modules.sqlserver.debug.abort'),
    paramsTitle: t('modules.sqlserver.debug.paramsTitle'),
    noParams: t('modules.sqlserver.debug.noParams'),
    paramsPreview: t('modules.sqlserver.debug.paramsPreview'),
    colParamName: t('modules.sqlserver.debug.colParamName'),
    colParamType: t('modules.sqlserver.debug.colParamType'),
    colParamValue: t('modules.sqlserver.debug.colParamValue'),
    paramValuePh: t('modules.sqlserver.debug.paramValuePh'),
    sourceTitle: t('modules.sqlserver.debug.sourceTitle'),
    bpHint: t('modules.sqlserver.debug.assistHint'),
    unavailable: t('modules.sqlserver.debug.unavailable'),
  }),
)

const paramsPreview = computed(() =>
  params.value.map((p) => `${p.mode ? p.mode + ' ' : ''}${p.name}`).join(', '),
)

const canRun = computed(
  () => Boolean(props.sessionId && props.database && props.routine) && !busy.value,
)

const statusText = computed(() => {
  if (!props.routine) return t('modules.sqlserver.debug.noTarget')
  return t('modules.sqlserver.debug.statusAssist', { name: targetLabel.value })
})

const statusMeta = computed(() => t('modules.sqlserver.debug.statusPoints', { n: logPointCount.value }))

const inspectTabs = computed((): RsTabItem[] => [
  { value: 'result', label: t('modules.sqlserver.debug.tabResult') },
  { value: 'messages', label: t('modules.sqlserver.debug.tabMessages') },
  { value: 'help', label: t('modules.sqlserver.debug.tabHelp') },
])

const resultPanelLabels = computed(
  (): DebugResultPanelLabels => ({
    empty: t('modules.sqlserver.debug.noResult'),
    emptyTable: t('modules.sqlserver.debug.resultEmpty'),
    rows: (n) => t('modules.sqlserver.debug.resultRows', { n }),
    duration: (ms) => t('modules.sqlserver.debug.resultDuration', { ms }),
    outName: t('modules.sqlserver.debug.resultOutName'),
    outValue: t('modules.sqlserver.debug.resultOutValue'),
  }),
)

const helpTips = computed(() => [
  t('modules.sqlserver.debug.tipRun'),
  t('modules.sqlserver.debug.tipSafe'),
  t('modules.sqlserver.debug.tipLog'),
])

onMounted(async () => {
  try {
    await bootstrapSqlServerMonaco()
  } catch {
    // ignore
  } finally {
    languageReady.value = true
  }
})

async function loadAll(): Promise<void> {
  probing.value = true
  try {
    await Promise.all([loadParams(), loadSource()])
  } finally {
    probing.value = false
  }
}

async function loadParams(): Promise<void> {
  params.value = []
  paramMeta.value = []
  returnType.value = ''
  isTableValued.value = false
  if (!props.sessionId || !props.database || !props.routine) return
  try {
    const result = await sqlserverApi.metaRoutineParameters({
      sessionId: props.sessionId,
      database: props.database,
      schema: schemaName.value,
      name: props.routine,
      kind: kind.value,
    })
    returnType.value = result.returnType ?? ''
    isTableValued.value = result.isTableValued === true
    paramMeta.value = (result.parameters ?? []).map((p) => ({
      ordinal: p.ordinal,
      name: p.name,
      mode: p.mode || 'IN',
      dataType: p.dataType,
      dtdIdentifier: p.dtdIdentifier,
      isReturn: p.isReturn,
      hasDefault: p.hasDefault,
      isTableType: p.isTableType,
      isCursor: p.isCursor,
    }))
    params.value = paramMeta.value.map((p, i) => ({
      index: p.ordinal > 0 ? p.ordinal : i + 1,
      name: p.name || `@p${i + 1}`,
      type: p.dtdIdentifier || p.dataType || '',
      mode: p.mode === 'OUTPUT' || p.mode === 'OUT' ? 'OUT' : p.mode || 'IN',
      value: '',
      isNull: false,
    }))
  } catch {
    params.value = []
    paramMeta.value = []
  }
}

async function loadSource(): Promise<void> {
  sourceText.value = ''
  if (!props.sessionId || !props.database || !props.routine) return
  loadingSource.value = true
  try {
    const result = await sqlserverApi.metaRoutineSource({
      sessionId: props.sessionId,
      database: props.database,
      schema: schemaName.value,
      name: props.routine,
      kind: kind.value,
    })
    const raw = result.definition || ''
    try {
      sourceText.value = formatSql(raw, { dialect: 'sqlserver' })
    } catch {
      sourceText.value = raw
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.sqlserver.debug.loadSourceFailed'))
  } finally {
    loadingSource.value = false
  }
}

function toCallParams(): SqlServerRoutineParam[] {
  return params.value.map((p) => {
    const meta = paramMeta.value.find((m) => (m.name || '') === p.name) ?? paramMeta.value.find((m) => m.ordinal === p.index)
    return {
      ordinal: p.index,
      name: p.name,
      mode: p.mode || meta?.mode || 'IN',
      dataType: p.type || meta?.dataType || '',
      dtdIdentifier: p.type || meta?.dtdIdentifier,
      value: p.value,
      isNull: p.isNull,
      isTableType: meta?.isTableType,
      isCursor: meta?.isCursor,
      hasDefault: meta?.hasDefault,
    }
  })
}

function buildCallSql(): string {
  if (!props.routine) return ''
  return buildSqlServerRoutineCallSql({
    schema: schemaName.value,
    name: props.routine,
    kind: kind.value,
    parameters: toCallParams(),
    returnType: returnType.value,
    isTableValued: isTableValued.value,
  })
}

function cellText(v: unknown): string {
  if (v == null) return 'NULL'
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

function toGridFromSet(
  columnsIn: SqlServerQueryColumn[] | undefined,
  rowsIn: unknown[][] | undefined,
  index: number,
  sqlPreview: string,
  durationMs: number,
): DebugResultGrid | null {
  if (!columnsIn?.length) return null
  const columns: RsTableColumn<ResultRow>[] = columnsIn.map((c: SqlServerQueryColumn, i) => ({
    key: `c${i}`,
    title: c.name || `col${i + 1}`,
    dataIndex: `c${i}`,
    ellipsis: true,
  }))
  const rows: ResultRow[] = (rowsIn ?? []).map((row, r) => {
    const out: ResultRow = { __rowKey: `${index}-${r}` }
    for (let i = 0; i < columns.length; i++) {
      out[`c${i}`] = cellText(row[i])
    }
    return out
  })
  return {
    id: `r-${index}-${Date.now()}`,
    title: t('modules.sqlserver.debug.resultTitle', { n: index + 1 }),
    columns,
    rows,
    sqlPreview,
    rowCount: rows.length,
    durationMs,
  }
}

function resultSetsOf(result: SqlServerQueryExecResult): Array<{
  columns?: SqlServerQueryColumn[]
  rows?: unknown[][]
}> {
  if (result.resultSets && result.resultSets.length > 0) {
    return result.resultSets
  }
  if (result.columns?.length) {
    return [{ columns: result.columns, rows: result.rows ?? [] }]
  }
  return []
}

async function closeResultQuiet(resultSetId?: string): Promise<void> {
  if (!props.sessionId || !resultSetId) return
  await sqlserverApi.queryClose({ sessionId: props.sessionId, resultSetId }).catch(() => undefined)
}

async function runCall(): Promise<void> {
  if (!canRun.value || !props.sessionId || !props.routine) return

  running.value = true
  messages.value = []
  resultGrids.value = []
  activeGridId.value = ''
  inspectTab.value = 'result'

  const preview = `${kind.value === 'function' ? 'SELECT' : 'RPC'} ${qualifiedName(schemaName.value, props.routine)}`

  try {
    const result = await sqlserverApi.routineCall({
      sessionId: props.sessionId,
      database: props.database,
      schema: schemaName.value,
      name: props.routine,
      kind: kind.value,
      isTableValued: isTableValued.value,
      args: toCallParams().map((p) => ({
        ordinal: p.ordinal,
        name: p.name,
        mode: p.mode,
        dataType: p.dataType,
        dtdIdentifier: p.dtdIdentifier,
        value: p.value,
        isNull: p.isNull,
        hasDefault: p.hasDefault,
        isTableType: p.isTableType,
        isCursor: p.isCursor,
      })),
      limit: 200,
      requestId: `sqlserver-call-${Date.now()}`,
    })
    const sets = resultSetsOf(result)
    let gridIndex = 0
    for (const set of sets) {
      const grid = toGridFromSet(set.columns, set.rows, gridIndex, preview, result.durationMs)
      gridIndex += 1
      if (!grid) continue
      resultGrids.value.push(grid)
      activeGridId.value = grid.id
      messages.value.push(
        `OK  routine.call  ${preview}  → ${grid.rows.length} row(s)  ${result.durationMs}ms`,
      )
    }
    if (result.returnValue != null) {
      messages.value.push(`RETURN ${result.returnValue}`)
    }
    if (resultGrids.value.length === 0) {
      const tag = result.commandTag || 'done'
      messages.value.push(`OK  routine.call  ${preview}  → ${tag}  ${result.durationMs}ms`)
      inspectTab.value = 'messages'
    }
    await closeResultQuiet(result.resultSetId)
    toast.success(t('modules.sqlserver.debug.runOk'))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    messages.value.push(`ERR  ${msg}`)
    inspectTab.value = 'messages'
    toast.error(msg)
  } finally {
    running.value = false
  }
}

function cursorLine(): number {
  try {
    const pos = editorRef.value?.getEditor()?.getPosition()
    return pos?.lineNumber ?? 0
  } catch {
    return 0
  }
}

function onInsertLogPoint(): void {
  if (!sourceText.value.trim()) return
  const line = cursorLine()
  sourceText.value =
    line > 0
      ? insertSqlServerDebugLogPointAtLine(sourceText.value, { kind: kind.value, line })
      : insertSqlServerDebugLogPoint(sourceText.value, { kind: kind.value })
  toast.success(t('modules.sqlserver.debug.logPointInserted'))
}

function onGlyphInsert(line: number): void {
  if (!sourceText.value.trim()) return
  sourceText.value = insertSqlServerDebugLogPointAtLine(sourceText.value, {
    kind: kind.value,
    line,
  })
  toast.success(t('modules.sqlserver.debug.logPointInserted'))
}

function onParamNull(index: number, isNull: boolean): void {
  const row = params.value.find((p) => p.index === index)
  if (!row) return
  row.isNull = isNull
  if (isNull) row.value = ''
}

function onParamValue(index: number, value: string): void {
  const row = params.value.find((p) => p.index === index)
  if (row) row.value = value
}

function openCallScript(): void {
  let sql = buildCallSql()
  if (!sql.trim()) return
  if (enableDebugSession.value) {
    sql = wrapSqlServerCallWithDebugSession(sql)
  }
  void navigator.clipboard.writeText(sql).then(
    () => toast.success(t('modules.sqlserver.debug.callCopied')),
    () => toast.error(t('modules.sqlserver.tree.copyFailed')),
  )
}

function debugScopeKey(): string {
  return [props.sessionId ?? '', props.database ?? '', schemaName.value, props.routine ?? '', kind.value].join('\0')
}

let loadedDebugScope = ''

function resetDebugWorkspace(): void {
  messages.value = []
  resultGrids.value = []
  activeGridId.value = ''
  inspectTab.value = 'help'
}

function ensureDebugLoaded(): void {
  void loadAll().then(() => {
    loadedDebugScope = debugScopeKey()
  })
}

watch(
  () => [props.sessionId, props.database, props.schema, props.routine, props.routineKind] as const,
  () => {
    if (debugScopeKey() !== loadedDebugScope) {
      resetDebugWorkspace()
      params.value = []
      paramMeta.value = []
      sourceText.value = ''
      loadedDebugScope = ''
    }
    if (!props.active) return
    ensureDebugLoaded()
  },
  { immediate: true },
)

watch(
  () => props.active,
  (active) => {
    if (!active) return
    if (loadedDebugScope === debugScopeKey() && (params.value.length > 0 || sourceText.value)) {
      return
    }
    ensureDebugLoaded()
  },
)
</script>

<template>
  <DebugShell
    class="nm-sqlserver-debug"
    :labels="shellLabels"
    :target-label="targetLabel"
    :probing="probing"
    :available="true"
    :state-label="stateLabel"
    :state-tone="stateTone"
    :busy="busy"
    :params="params"
    :params-preview="paramsPreview"
    :params-disabled="busy"
    :can-start="canRun"
    :show-step-controls="false"
    :controls-enabled="false"
    :session-active="false"
    :status-text="statusText"
    :status-meta="statusMeta"
    @start="runCall"
    @update:param-null="onParamNull"
    @update:param-value="onParamValue"
  >
    <template #toolbar-end>
      <RsButton
        variant="ghost"
        size="sm"
        icon="plus"
        :disabled="!sourceText.trim() || busy"
        @click="onInsertLogPoint"
      >
        {{ t('modules.sqlserver.debug.insertLogPoint') }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        icon="clipboard"
        :disabled="!canRun"
        @click="openCallScript"
      >
        {{ t('modules.sqlserver.debug.openCall') }}
      </RsButton>
    </template>

    <template #source>
      <RsLoading v-if="loadingSource && !sourceText" class="nm-sqlserver-debug__boot" />
      <RsEmpty
        v-else-if="!sourceText.trim()"
        fill
        icon="bug"
        :description="t('modules.sqlserver.debug.noSource')"
      />
      <RsMonacoEditor
        v-else-if="languageReady"
        ref="editorRef"
        v-model="sourceText"
        :language="monacoLanguage"
        height="100%"
        embedded
        glyph-margin
        @glyph-margin-click="onGlyphInsert"
      />
      <div v-else class="nm-sqlserver-debug__boot">
        <RsLoading size="sm" />
      </div>
    </template>

    <template #inspect>
      <div class="nm-sqlserver-debug__inspect">
        <div class="nm-sqlserver-debug__inspect-header">
          <RsTabs
            v-model="inspectTab"
            class="nm-sqlserver-debug__inspect-tabs"
            :items="inspectTabs"
            size="sm"
            variant="line"
            panelless
          />
        </div>

        <div v-if="inspectTab === 'result'" class="nm-sqlserver-debug__inspect-body">
          <DebugResultPanel
            v-model:active-grid-id="activeGridId"
            :grids="resultGrids"
            :labels="resultPanelLabels"
            :running="running"
          />
        </div>

        <div v-else-if="inspectTab === 'messages'" class="nm-sqlserver-debug__inspect-body">
          <DebugMessagesPanel
            :messages="messages"
            :empty="t('modules.sqlserver.debug.noMessages')"
          />
        </div>

        <div v-else class="nm-sqlserver-debug__inspect-body">
          <DebugHelpPanel
            v-model:enable-session="enableDebugSession"
            :enable-label="t('modules.sqlserver.debug.enableSessionVar')"
            :enable-disabled="busy"
            :tips="helpTips"
          />
        </div>
      </div>
    </template>
  </DebugShell>
</template>

<style scoped>
.nm-sqlserver-debug {
  width: 100%;
  height: 100%;
}

.nm-sqlserver-debug__boot {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-sqlserver-debug__inspect {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.nm-sqlserver-debug__inspect-header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
  padding: 0 var(--rs-space-sm);
}

.nm-sqlserver-debug__inspect-tabs {
  min-width: 0;
}

.nm-sqlserver-debug__inspect-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
