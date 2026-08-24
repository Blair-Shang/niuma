<script setup lang="ts">
/**
 * Oracle 例程调试辅助：复用公共 DebugShell。
 * 面板内运行调用并展示结果；左侧源码/日志点仅编辑器草稿，永不写回服务器。
 */
import {
  RsButton,
  RsEmpty,
  RsLoading,
  RsMonacoEditor,
  RsTabs,
  useRsToast,
  type MonacoLanguage,
  type RsTableColumn,
  type RsTabItem,
} from '@niuma/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { oracleApi } from '@/api/oracle'
import type { OracleQueryColumn, OracleQueryExecResult } from '@/api/types/oracle'
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
  defaultOracleProfile,
  resolveMonacoLanguageFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import {
  bootstrapOracleMonaco,
  ORACLE_MONACO_LANGUAGE_ID,
} from '@/modules/oracle/monaco-bootstrap'
import { qualifiedName } from '@/modules/oracle/sql-seed'
import { normalizeOracleObjectDdlForEdit } from '@/modules/oracle/utils/normalize-object-ddl'
import {
  countOracleDebugLogPoints,
  insertOracleDebugLogPoint,
  insertOracleDebugLogPointAtLine,
  wrapOracleCallWithDebugSession,
} from '@/modules/oracle/utils/oracle-debug-assist'
import {
  buildOracleRoutineCallSql,
  parseOracleRoutineParamsFromDdl,
} from '@/modules/oracle/utils/routine-call'
import {
  buildOracleRoutineErrorsSql,
  buildOracleRoutineStatusSql,
  formatOracleRoutineErrors,
  isOracleInvalidObjectError,
  oracleObjectStatusI18nKey,
} from '@/modules/oracle/utils/oracle-routine-status'
import {
  compileFunctionSql,
  compileProcedureSql,
} from '@/modules/oracle/utils/script-templates'
import { useSessionRegistry } from '@/stores/session-registry'

type InspectTab = 'result' | 'messages' | 'help'
type ResultRow = Record<string, unknown> & { __rowKey: string }

const props = defineProps<{
  sessionId: string | null
  profileId?: string
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
const returnType = ref('')
const sourceText = ref('')
const languageReady = ref(false)
const enableDebugSession = ref(true)
const editorRef = ref<{ getEditor: () => { getPosition: () => { lineNumber: number } | null } | null } | null>(
  null,
)

/** 默认落在结果页，对齐 Navicat/DBeaver 执行对话框（出参 | 值） */
const inspectTab = ref<InspectTab>('result')
const messages = ref<string[]>([])
const resultGrids = ref<DebugResultGrid[]>([])
const activeGridId = ref('')

const kind = computed<'procedure' | 'function'>(() =>
  props.routineKind === 'function' ? 'function' : 'procedure',
)

const targetLabel = computed(() => {
  if (!props.schema || !props.routine) return ''
  return qualifiedName(props.schema, props.routine)
})

const logPointCount = computed(() => countOracleDebugLogPoints(sourceText.value))
const busy = computed(() => running.value)

const dialectProfile = computed(() => {
  if (!props.sessionId) return defaultOracleProfile()
  return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultOracleProfile()
})

const monacoLanguage = computed(
  (): MonacoLanguage =>
    resolveMonacoLanguageFromProfile(dialectProfile.value).monacoLanguageId ||
    ORACLE_MONACO_LANGUAGE_ID,
)

const stateTone = computed((): DebugShellStateTone => {
  if (running.value) return 'running'
  if (messages.value.some((m) => m.startsWith('ERR'))) return 'ended'
  if (resultGrids.value.length > 0) return 'paused'
  return 'idle'
})

const stateLabel = computed(() => {
  if (running.value) return t('modules.oracle.debug.stateRunning')
  if (messages.value.some((m) => m.startsWith('ERR'))) return t('modules.oracle.debug.stateError')
  if (resultGrids.value.length > 0) return t('modules.oracle.debug.stateDone')
  return t('modules.oracle.debug.stateAssist')
})

const shellLabels = computed(
  (): DebugShellLabels => ({
    toolbarLabel: t('modules.oracle.debug.toolbarLabel'),
    noTarget: t('modules.oracle.debug.noTarget'),
    start: t('modules.oracle.debug.runCall'),
    continue: t('modules.oracle.debug.continue'),
    next: t('modules.oracle.debug.next'),
    step: t('modules.oracle.debug.step'),
    finish: t('modules.oracle.debug.finish'),
    abort: t('modules.oracle.debug.abort'),
    paramsTitle: t('modules.oracle.debug.paramsTitle'),
    noParams: t('modules.oracle.debug.noParams'),
    paramsPreview: t('modules.oracle.debug.paramsPreview'),
    colParamName: t('modules.oracle.debug.colParamName'),
    colParamType: t('modules.oracle.debug.colParamType'),
    colParamValue: t('modules.oracle.debug.colParamValue'),
    paramValuePh: t('modules.oracle.debug.paramValuePh'),
    sourceTitle: t('modules.oracle.debug.sourceTitle'),
    bpHint: t('modules.oracle.debug.assistHint'),
    unavailable: t('modules.oracle.debug.unavailable'),
  }),
)

const paramsPreview = computed(() =>
  params.value
    .map((p) => `${p.mode ? p.mode + ' ' : ''}${p.name}`)
    .join(', '),
)

const canRun = computed(
  () =>
    Boolean(props.sessionId && props.schema && props.routine) &&
    !busy.value,
)

const statusText = computed(() => {
  if (!props.routine) return t('modules.oracle.debug.noTarget')
  return t('modules.oracle.debug.statusAssist', { name: targetLabel.value })
})

const statusMeta = computed(() =>
  t('modules.oracle.debug.statusPoints', { n: logPointCount.value }),
)

const inspectTabs = computed((): RsTabItem[] => [
  { value: 'result', label: t('modules.oracle.debug.tabResult') },
  { value: 'messages', label: t('modules.oracle.debug.tabMessages') },
  { value: 'help', label: t('modules.oracle.debug.tabHelp') },
])

const resultPanelLabels = computed(
  (): DebugResultPanelLabels => ({
    empty: t('modules.oracle.debug.noResult'),
    emptyTable: t('modules.oracle.debug.resultEmpty'),
    rows: (n) => t('modules.oracle.debug.resultRows', { n }),
    duration: (ms) => t('modules.oracle.debug.resultDuration', { ms }),
    outName: t('modules.oracle.debug.resultOutName'),
    outValue: t('modules.oracle.debug.resultOutValue'),
  }),
)

const helpTips = computed(() => [
  t('modules.oracle.debug.tipRun'),
  t('modules.oracle.debug.tipSafe'),
  t('modules.oracle.debug.tipLog'),
  t('modules.oracle.debug.tipInvalid'),
])

onMounted(async () => {
  try {
    await bootstrapOracleMonaco()
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
  returnType.value = ''
  if (!props.sessionId || !props.schema || !props.routine) return
  try {
    const result = await oracleApi.metaRoutineParameters({
      sessionId: props.sessionId,
      schema: props.schema,
      name: props.routine,
      kind: kind.value,
    })
    returnType.value = result.returnType ?? ''
    let list: Array<{
      ordinal: number
      name: string
      mode: string
      dataType: string
      dtdIdentifier?: string
      isReturn?: boolean
    }> = (result.parameters ?? []).filter((p) => !p.isReturn && p.ordinal > 0)
    if (list.length === 0) {
      const src = await oracleApi.metaRoutineSource({
        sessionId: props.sessionId,
        schema: props.schema,
        name: props.routine,
        kind: kind.value,
      })
      list = parseOracleRoutineParamsFromDdl(src.definition || '', kind.value)
    }
    params.value = list.map((p, i) => ({
      // 必须 1..n 唯一：重复 ordinal 会导致网格 :key 冲突、改一参串改另一参
      index: i + 1,
      name: p.name || `p${i + 1}`,
      type: p.dtdIdentifier || p.dataType || '',
      mode: p.mode || 'IN',
      value: '',
      isNull: false,
    }))
  } catch {
    params.value = []
  }
}

async function loadSource(options?: { keepDraftUntilLoaded?: boolean }): Promise<void> {
  if (!props.sessionId || !props.schema || !props.routine) return
  if (!options?.keepDraftUntilLoaded) {
    sourceText.value = ''
  }
  loadingSource.value = true
  try {
    const result = await oracleApi.metaRoutineSource({
      sessionId: props.sessionId,
      schema: props.schema,
      name: props.routine,
      kind: kind.value,
    })
    const cleaned = normalizeOracleObjectDdlForEdit(
      result.definition || '',
      props.schema,
      kind.value,
    )
    try {
      sourceText.value = formatSql(cleaned, { dialect: 'oracle' })
    } catch {
      sourceText.value = cleaned
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.oracle.debug.loadSourceFailed'))
  } finally {
    loadingSource.value = false
  }
}

/** 从服务器重新拉取源码与形参（覆盖本地草稿）。 */
async function refreshFromServer(): Promise<void> {
  if (!props.sessionId || !props.schema || !props.routine || busy.value) return
  probing.value = true
  try {
    await Promise.all([loadParams(), loadSource({ keepDraftUntilLoaded: true })])
    toast.success(t('modules.oracle.debug.refreshOk'))
  } finally {
    probing.value = false
  }
}

/** 生成查询面板可执行的调用脚本（OUT 靠 DBMS_OUTPUT；「运行调用」走 bind）。 */
function buildCallSql(): string {
  if (!props.schema || !props.routine) return ''
  let sql = buildOracleRoutineCallSql({
    schema: props.schema,
    name: props.routine,
    kind: kind.value,
    parameters: params.value.map((p) => ({
      ordinal: p.index,
      name: p.name,
      mode: p.mode || 'IN',
      dataType: p.type,
      dtdIdentifier: p.type,
      value: p.value,
      isNull: p.isNull,
    })),
    returnType: returnType.value,
  })
  if (enableDebugSession.value) {
    sql = wrapOracleCallWithDebugSession(sql)
  }
  return sql
}

async function copyCallScript(): Promise<void> {
  const sql = buildCallSql().trim()
  if (!sql) return
  try {
    await navigator.clipboard.writeText(sql)
    toast.success(t('modules.oracle.debug.callCopied'))
  } catch {
    toast.error(t('modules.oracle.tree.copyFailed'))
  }
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

function toGrid(result: OracleQueryExecResult, index: number, sqlPreview: string): DebugResultGrid | null {
  if (!result.columns?.length) return null
  const columns: RsTableColumn<ResultRow>[] = result.columns.map((c: OracleQueryColumn, i) => ({
    key: `c${i}`,
    title: c.name || `col${i + 1}`,
    dataIndex: `c${i}`,
    ellipsis: true,
  }))
  const rows: ResultRow[] = (result.rows ?? []).map((row, r) => {
    const out: ResultRow = { __rowKey: `${index}-${r}` }
    for (let i = 0; i < columns.length; i++) {
      out[`c${i}`] = cellText(row[i])
    }
    return out
  })
  const n = result.fetchedCount ?? result.rowCount ?? rows.length
  return {
    id: `r-${index}-${Date.now()}`,
    title: t('modules.oracle.debug.resultTitle', { n: index + 1 }),
    columns,
    rows,
    sqlPreview,
    rowCount: n,
    durationMs: result.durationMs,
  }
}

async function closeResultQuiet(resultSetId?: string): Promise<void> {
  if (!props.sessionId || !resultSetId) return
  await oracleApi.queryClose({ sessionId: props.sessionId, resultSetId }).catch(() => undefined)
}

function friendlyExecError(msg: string): string {
  if (!isOracleInvalidObjectError(msg)) return msg
  return `${msg}\n${t('modules.oracle.debug.compileHint')}`
}

/** 已有 ALL_ERRORS 行号明细时不再重复查询。 */
function hasAllErrorsDetail(msg: string): boolean {
  return /L\d+\s*:\s*C\d+/i.test(msg)
}

/** 拉取 ALL_ERRORS 文本（ORA-24344 抛错后 assert 可能未执行，需在 catch 补查）。 */
async function fetchRoutineErrorsDetail(): Promise<string> {
  if (!props.sessionId || !props.schema || !props.routine) return ''
  const errSql = buildOracleRoutineErrorsSql(props.schema, props.routine, kind.value)
  const errRes = await oracleApi.queryExec({
    sessionId: props.sessionId,
    schema: props.schema,
    sql: errSql,
    limit: 50,
    requestId: `oracle-errors-${Date.now()}`,
  })
  await closeResultQuiet(errRes.resultSetId)
  return formatOracleRoutineErrors(errRes.rows)
}

async function enrichInvalidMessage(msg: string): Promise<string> {
  if (!isOracleInvalidObjectError(msg) || hasAllErrorsDetail(msg)) return msg
  try {
    const detail = await fetchRoutineErrorsDetail()
    return detail ? `${msg}\n${detail}` : msg
  } catch {
    return msg
  }
}

/** ALTER COMPILE 后查 STATUS；仍 INVALID 则带出 ALL_ERRORS。 */
async function assertRoutineValidAfterCompile(): Promise<void> {
  if (!props.sessionId || !props.schema || !props.routine) return
  const statusSql = buildOracleRoutineStatusSql(props.schema, props.routine, kind.value)
  const statusRes = await oracleApi.queryExec({
    sessionId: props.sessionId,
    schema: props.schema,
    sql: statusSql,
    limit: 5,
    requestId: `oracle-status-${Date.now()}`,
  })
  await closeResultQuiet(statusRes.resultSetId)
  const status = cellText(statusRes.rows?.[0]?.[0]).toUpperCase()
  if (!status || status === 'VALID') return

  const detail = await fetchRoutineErrorsDetail()
  const statusKey = oracleObjectStatusI18nKey(status)
  const statusLabel = statusKey ? t(`modules.oracle.debug.${statusKey}`) : status
  const base = t('modules.oracle.debug.compileStillInvalid', { status: statusLabel })
  throw new Error(detail ? `${base}\n${detail}` : base)
}

async function compileObject(): Promise<void> {
  if (!canRun.value || !props.sessionId || !props.schema || !props.routine) return
  const sql =
    kind.value === 'function'
      ? compileFunctionSql(props.schema, props.routine)
      : compileProcedureSql(props.schema, props.routine)
  running.value = true
  try {
    // ORA-24344：dpi 对带编译错误的 ALTER COMPILE 仍 SUCCESS，服务端升为错误；catch 里补 ALL_ERRORS
    const result = await oracleApi.queryExec({
      sessionId: props.sessionId,
      schema: props.schema,
      sql: sql.trim(),
      limit: 1,
      requestId: `oracle-compile-${Date.now()}`,
    })
    await closeResultQuiet(result.resultSetId)
    await assertRoutineValidAfterCompile()
    messages.value.push(`OK  COMPILE  ${sql.trim()}  ${result.durationMs}ms`)
    inspectTab.value = 'messages'
    toast.success(t('modules.oracle.debug.compileOk'))
    await Promise.all([loadParams(), loadSource({ keepDraftUntilLoaded: true })])
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    const msg = await enrichInvalidMessage(raw)
    messages.value.push(`ERR  ${friendlyExecError(msg)}`)
    inspectTab.value = 'messages'
    toast.error(msg)
  } finally {
    running.value = false
  }
}

async function runCall(): Promise<void> {
  if (!canRun.value || !props.sessionId) return
  if (!props.schema || !props.routine) return

  running.value = true
  messages.value = []
  resultGrids.value = []
  activeGridId.value = ''
  inspectTab.value = 'result'

  try {
    // 专业化路径：ODPI bind OUT → 单行宽表 → DebugResultPanel 出参/值
    // 始终 ENABLE DBMS_OUTPUT（对齐 Navicat/DBeaver Server Output），便于过程内 PUT_LINE；
    // CLIENT_INFO 仅在勾选调试开关时设置（供草稿日志点过滤）。
    {
      const enableLines = ['BEGIN', '  DBMS_OUTPUT.ENABLE(NULL);']
      if (enableDebugSession.value) {
        enableLines.push("  DBMS_APPLICATION_INFO.SET_CLIENT_INFO('nm_debug=1');")
      }
      enableLines.push('END;')
      await oracleApi.queryExec({
        sessionId: props.sessionId,
        schema: props.schema,
        sql: enableLines.join('\n'),
        limit: 1,
        requestId: `oracle-debug-enable-${Date.now()}`,
      }).catch(() => undefined)
    }

    const result = await oracleApi.routineCall({
      sessionId: props.sessionId,
      schema: props.schema,
      name: props.routine,
      kind: kind.value,
      returnType: returnType.value || undefined,
      args: params.value.map((p) => ({
        name: p.name,
        type: p.type,
        mode: p.mode || 'IN',
        value: p.value,
        isNull: p.isNull,
      })),
      requestId: `oracle-routine-${Date.now()}`,
    })

    const preview = `CALL ${qualifiedName(props.schema, props.routine)}`
    const grid = toGrid(result, 0, preview)
    if (grid) {
      resultGrids.value.push(grid)
      activeGridId.value = grid.id
      messages.value.push(
        `OK  routine.call  → ${grid.rows.length} row(s) · ${grid.columns.length} out  ${result.durationMs}ms`,
      )
    } else {
      messages.value.push(
        `OK  routine.call  → ${result.commandTag || 'CALL'}  ${result.durationMs}ms`,
      )
    }
    for (const line of result.dbmsOutput ?? []) {
      messages.value.push(`DBMS_OUTPUT  ${line}`)
    }

    if (enableDebugSession.value) {
      await oracleApi.queryExec({
        sessionId: props.sessionId,
        schema: props.schema,
        sql: 'BEGIN DBMS_APPLICATION_INFO.SET_CLIENT_INFO(NULL); END;',
        limit: 1,
        requestId: `oracle-debug-clear-${Date.now()}`,
      }).catch(() => undefined)
    }

    if (resultGrids.value.length === 0) {
      inspectTab.value = 'messages'
      toast.success(t('modules.oracle.debug.runOkNoResult'))
    } else {
      toast.success(t('modules.oracle.debug.runOk'))
    }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    const msg = await enrichInvalidMessage(raw)
    messages.value.push(`ERR  ${friendlyExecError(msg)}`)
    inspectTab.value = 'messages'
    toast.error(isOracleInvalidObjectError(msg) ? t('modules.oracle.debug.compileHint') : msg)
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
      ? insertOracleDebugLogPointAtLine(sourceText.value, { line })
      : insertOracleDebugLogPoint(sourceText.value)
  toast.success(t('modules.oracle.debug.logPointInserted'))
}

function onGlyphInsert(line: number): void {
  if (!sourceText.value.trim()) return
  sourceText.value = insertOracleDebugLogPointAtLine(sourceText.value, { line })
  toast.success(t('modules.oracle.debug.logPointInserted'))
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

function debugScopeKey(): string {
  return [
    props.sessionId ?? '',
    props.schema ?? '',
    props.routine ?? '',
    props.routineKind ?? '',
  ].join('\0')
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

/** 仅作用域变化时重拉；keep-alive 切回 Shell Tab 保留参数/源码与上次运行结果。 */
watch(
  () => [props.sessionId, props.schema, props.routine, props.routineKind] as const,
  () => {
    if (debugScopeKey() !== loadedDebugScope) {
      resetDebugWorkspace()
      params.value = []
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
    class="nm-oracle-debug"
    :labels="shellLabels"
    :target-label="targetLabel"
    :probing="probing || (loadingSource && !sourceText)"
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
        icon="refresh-cw"
        :disabled="!canRun || loadingSource"
        :loading="loadingSource && Boolean(sourceText)"
        @click="refreshFromServer"
      >
        {{ t('modules.oracle.debug.refresh') }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        icon="code-2"
        :disabled="!canRun"
        @click="copyCallScript"
      >
        {{ t('modules.oracle.debug.openCall') }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        icon="wrench"
        :disabled="!canRun"
        @click="compileObject"
      >
        {{ t('modules.oracle.debug.compileObject') }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        icon="plus"
        :disabled="!sourceText.trim() || busy"
        @click="onInsertLogPoint"
      >
        {{ t('modules.oracle.debug.insertLogPoint') }}
      </RsButton>
    </template>

    <template #source-header-extra>
      <RsButton
        variant="ghost"
        size="sm"
        icon="refresh-cw"
        class="nm-oracle-debug__source-refresh"
        :disabled="!canRun || loadingSource"
        :title="t('modules.oracle.debug.refreshSourceTip')"
        @click="refreshFromServer"
      />
    </template>

    <template #source>
      <RsEmpty
        v-if="!sourceText.trim()"
        fill
        icon="bug"
        :description="t('modules.oracle.debug.noSource')"
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
      <div v-else class="nm-oracle-debug__boot">
        <RsLoading size="sm" />
      </div>
    </template>

    <template #inspect>
      <div class="nm-oracle-debug__inspect">
        <div class="nm-oracle-debug__inspect-header">
          <RsTabs
            v-model="inspectTab"
            class="nm-oracle-debug__inspect-tabs"
            :items="inspectTabs"
            size="sm"
            variant="line"
            panelless
          />
        </div>

        <div v-if="inspectTab === 'result'" class="nm-oracle-debug__inspect-body">
          <DebugResultPanel
            v-model:active-grid-id="activeGridId"
            :grids="resultGrids"
            :labels="resultPanelLabels"
            :running="running"
          />
        </div>

        <div v-else-if="inspectTab === 'messages'" class="nm-oracle-debug__inspect-body">
          <DebugMessagesPanel
            :messages="messages"
            :empty="t('modules.oracle.debug.noMessages')"
          />
        </div>

        <div v-else class="nm-oracle-debug__inspect-body">
          <DebugHelpPanel
            v-model:enable-session="enableDebugSession"
            :enable-label="t('modules.oracle.debug.enableSessionVar')"
            :enable-disabled="busy"
            :tips="helpTips"
          />
        </div>
      </div>
    </template>
  </DebugShell>
</template>

<style scoped>
.nm-oracle-debug {
  width: 100%;
  height: 100%;
}

.nm-oracle-debug__boot {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-oracle-debug__source-refresh {
  flex-shrink: 0;
  margin-left: var(--rs-space-xs);
}

.nm-oracle-debug__inspect {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.nm-oracle-debug__inspect-header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
  padding: 0 var(--rs-space-sm);
}

.nm-oracle-debug__inspect-tabs {
  min-width: 0;
}

.nm-oracle-debug__inspect-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
