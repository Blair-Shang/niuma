<script setup lang="ts">
/**
 * 达梦例程调试辅助：复用公共 DebugShell。
 * 面板内运行调用并展示结果；左侧源码/日志点仅编辑器草稿，永不写回服务器。
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
import { damengApi } from '@/api/dameng'
import type { DamengQueryColumn, DamengQueryExecResult } from '@/api/types/dameng'
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
  defaultDamengProfile,
  resolveMonacoLanguageFromProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import {
  bootstrapDamengMonaco,
  DAMENG_MONACO_LANGUAGE_ID,
} from '@/modules/dameng/monaco-bootstrap'
import { qualifiedName } from '@/modules/dameng/sql-seed'
import { normalizeDamengRoutineDdlForEdit } from '@/modules/dameng/utils/normalize-object-ddl'
import {
  countDamengDebugLogPoints,
  insertDamengDebugLogPoint,
  insertDamengDebugLogPointAtLine,
  wrapDamengCallWithDebugSession,
} from '@/modules/dameng/utils/dameng-debug-assist'
import { buildDamengRoutineCallSql } from '@/modules/dameng/utils/routine-call'
import {
  compileFunctionSql,
  compileProcedureSql,
} from '@/modules/dameng/utils/script-templates'
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

const inspectTab = ref<InspectTab>('help')
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

const logPointCount = computed(() => countDamengDebugLogPoints(sourceText.value))
const busy = computed(() => running.value)

const dialectProfile = computed(() => {
  if (!props.sessionId) return defaultDamengProfile()
  return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultDamengProfile()
})

const monacoLanguage = computed(
  () =>
    resolveMonacoLanguageFromProfile(dialectProfile.value).monacoLanguageId ||
    DAMENG_MONACO_LANGUAGE_ID,
)

const stateTone = computed((): DebugShellStateTone => {
  if (running.value) return 'running'
  if (messages.value.some((m) => m.startsWith('ERR'))) return 'ended'
  if (resultGrids.value.length > 0) return 'paused'
  return 'idle'
})

const stateLabel = computed(() => {
  if (running.value) return t('modules.dameng.debug.stateRunning')
  if (messages.value.some((m) => m.startsWith('ERR'))) return t('modules.dameng.debug.stateError')
  if (resultGrids.value.length > 0) return t('modules.dameng.debug.stateDone')
  return t('modules.dameng.debug.stateAssist')
})

const shellLabels = computed(
  (): DebugShellLabels => ({
    toolbarLabel: t('modules.dameng.debug.toolbarLabel'),
    noTarget: t('modules.dameng.debug.noTarget'),
    start: t('modules.dameng.debug.runCall'),
    continue: t('modules.dameng.debug.continue'),
    next: t('modules.dameng.debug.next'),
    step: t('modules.dameng.debug.step'),
    finish: t('modules.dameng.debug.finish'),
    abort: t('modules.dameng.debug.abort'),
    paramsTitle: t('modules.dameng.debug.paramsTitle'),
    noParams: t('modules.dameng.debug.noParams'),
    paramsPreview: t('modules.dameng.debug.paramsPreview'),
    colParamName: t('modules.dameng.debug.colParamName'),
    colParamType: t('modules.dameng.debug.colParamType'),
    colParamValue: t('modules.dameng.debug.colParamValue'),
    paramValuePh: t('modules.dameng.debug.paramValuePh'),
    sourceTitle: t('modules.dameng.debug.sourceTitle'),
    bpHint: t('modules.dameng.debug.assistHint'),
    unavailable: t('modules.dameng.debug.unavailable'),
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
  if (!props.routine) return t('modules.dameng.debug.noTarget')
  return t('modules.dameng.debug.statusAssist', { name: targetLabel.value })
})

const statusMeta = computed(() =>
  t('modules.dameng.debug.statusPoints', { n: logPointCount.value }),
)

const inspectTabs = computed((): RsTabItem[] => [
  { value: 'result', label: t('modules.dameng.debug.tabResult') },
  { value: 'messages', label: t('modules.dameng.debug.tabMessages') },
  { value: 'help', label: t('modules.dameng.debug.tabHelp') },
])

const resultPanelLabels = computed(
  (): DebugResultPanelLabels => ({
    empty: t('modules.dameng.debug.noResult'),
    emptyTable: t('modules.dameng.debug.resultEmpty'),
    rows: (n) => t('modules.dameng.debug.resultRows', { n }),
    duration: (ms) => t('modules.dameng.debug.resultDuration', { ms }),
    outName: t('modules.dameng.debug.resultOutName'),
    outValue: t('modules.dameng.debug.resultOutValue'),
  }),
)

const helpTips = computed(() => [
  t('modules.dameng.debug.tipRun'),
  t('modules.dameng.debug.tipSafe'),
  t('modules.dameng.debug.tipLog'),
  t('modules.dameng.debug.tipInvalid'),
])

onMounted(async () => {
  try {
    await bootstrapDamengMonaco()
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
    const result = await damengApi.metaRoutineParameters({
      sessionId: props.sessionId,
      schema: props.schema,
      name: props.routine,
      kind: kind.value,
    })
    returnType.value = result.returnType ?? ''
    params.value = (result.parameters ?? [])
      .filter((p) => !p.isReturn && p.ordinal > 0)
      .map((p, i) => ({
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

async function loadSource(): Promise<void> {
  sourceText.value = ''
  if (!props.sessionId || !props.schema || !props.routine) return
  loadingSource.value = true
  try {
    const result = await damengApi.metaRoutineSource({
      sessionId: props.sessionId,
      schema: props.schema,
      name: props.routine,
      kind: kind.value,
    })
    const cleaned = normalizeDamengRoutineDdlForEdit(result.definition || '')
    try {
      sourceText.value = formatSql(cleaned, { dialect: 'dameng' })
    } catch {
      sourceText.value = cleaned
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.dameng.debug.loadSourceFailed'))
  } finally {
    loadingSource.value = false
  }
}

function buildCallSql(): string {
  if (!props.schema || !props.routine) return ''
  // 始终调用线上原对象；左侧源码改动不会落库
  let sql = buildDamengRoutineCallSql({
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
    sql = wrapDamengCallWithDebugSession(sql)
  }
  return sql
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

function toGrid(result: DamengQueryExecResult, index: number, sqlPreview: string): DebugResultGrid | null {
  if (!result.columns?.length) return null
  const columns: RsTableColumn<ResultRow>[] = result.columns.map((c: DamengQueryColumn, i) => ({
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
    title: t('modules.dameng.debug.resultTitle', { n: index + 1 }),
    columns,
    rows,
    sqlPreview,
    rowCount: n,
    durationMs: result.durationMs,
  }
}

async function closeResultQuiet(resultSetId?: string): Promise<void> {
  if (!props.sessionId || !resultSetId) return
  await damengApi.queryClose({ sessionId: props.sessionId, resultSetId }).catch(() => undefined)
}

function isInvalidObjectError(msg: string): boolean {
  return /-\s*7160|-\s*7106|无效状态|invalid\s+state/i.test(msg)
}

function friendlyExecError(msg: string): string {
  if (!isInvalidObjectError(msg)) return msg
  return `${msg}\n${t('modules.dameng.debug.compileHint')}`
}

async function compileObject(): Promise<void> {
  if (!canRun.value || !props.sessionId || !props.schema || !props.routine) return
  const sql =
    kind.value === 'function'
      ? compileFunctionSql(props.schema, props.routine)
      : compileProcedureSql(props.schema, props.routine)
  running.value = true
  try {
    const result = await damengApi.queryExec({
      sessionId: props.sessionId,
      schema: props.schema,
      sql: sql.trim(),
      limit: 1,
      requestId: `dameng-compile-${Date.now()}`,
    })
    await closeResultQuiet(result.resultSetId)
    messages.value.push(`OK  COMPILE  ${sql.trim()}  ${result.durationMs}ms`)
    inspectTab.value = 'messages'
    toast.success(t('modules.dameng.debug.compileOk'))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    messages.value.push(`ERR  ${friendlyExecError(msg)}`)
    inspectTab.value = 'messages'
    toast.error(msg)
  } finally {
    running.value = false
  }
}

async function runCall(): Promise<void> {
  if (!canRun.value || !props.sessionId) return
  const sql = buildCallSql().trim()
  if (!sql) return

  running.value = true
  messages.value = []
  resultGrids.value = []
  activeGridId.value = ''
  inspectTab.value = 'result'

  const features = resolveSplitFeaturesFromProfile(dialectProfile.value)
  const statements = splitSqlStatementsWithFeatures(sql, features)
    .map((s) => s.sql.trim())
    .filter(Boolean)

  try {
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]!
      const preview = stmt.length > 72 ? `${stmt.slice(0, 72)}…` : stmt
      const result = await damengApi.queryExec({
        sessionId: props.sessionId,
        schema: props.schema,
        sql: stmt,
        limit: 200,
        requestId: `dameng-debug-${Date.now()}-${i}`,
      })
      const grid = toGrid(result, i, preview)
      if (grid) {
        resultGrids.value.push(grid)
        activeGridId.value = grid.id
        messages.value.push(
          `OK  #${i + 1}  ${preview}  → ${grid.rows.length} row(s)  ${result.durationMs}ms`,
        )
      } else {
        const affected = result.rowsAffected ?? result.rowCount
        messages.value.push(
          `OK  #${i + 1}  ${preview}  → ${result.commandTag || 'done'}${
            affected != null ? ` (${affected})` : ''
          }  ${result.durationMs}ms`,
        )
      }
      await closeResultQuiet(result.resultSetId)
    }
    if (resultGrids.value.length === 0) {
      inspectTab.value = 'messages'
      toast.success(t('modules.dameng.debug.runOkNoResult'))
    } else {
      toast.success(t('modules.dameng.debug.runOk'))
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    messages.value.push(`ERR  ${friendlyExecError(msg)}`)
    inspectTab.value = 'messages'
    toast.error(isInvalidObjectError(msg) ? t('modules.dameng.debug.compileHint') : msg)
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
      ? insertDamengDebugLogPointAtLine(sourceText.value, { line })
      : insertDamengDebugLogPoint(sourceText.value)
  toast.success(t('modules.dameng.debug.logPointInserted'))
}

function onGlyphInsert(line: number): void {
  if (!sourceText.value.trim()) return
  sourceText.value = insertDamengDebugLogPointAtLine(sourceText.value, { line })
  toast.success(t('modules.dameng.debug.logPointInserted'))
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
    class="nm-dameng-debug"
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
        icon="wrench"
        :disabled="!canRun"
        @click="compileObject"
      >
        {{ t('modules.dameng.debug.compileObject') }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        icon="plus"
        :disabled="!sourceText.trim() || busy"
        @click="onInsertLogPoint"
      >
        {{ t('modules.dameng.debug.insertLogPoint') }}
      </RsButton>
    </template>

    <template #source>
      <RsEmpty
        v-if="!sourceText.trim()"
        fill
        icon="bug"
        :description="t('modules.dameng.debug.noSource')"
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
      <div v-else class="nm-dameng-debug__boot">
        <RsLoading size="sm" />
      </div>
    </template>

    <template #inspect>
      <div class="nm-dameng-debug__inspect">
        <div class="nm-dameng-debug__inspect-header">
          <RsTabs
            v-model="inspectTab"
            class="nm-dameng-debug__inspect-tabs"
            :items="inspectTabs"
            size="sm"
            variant="line"
            panelless
          />
        </div>

        <div v-if="inspectTab === 'result'" class="nm-dameng-debug__inspect-body">
          <DebugResultPanel
            v-model:active-grid-id="activeGridId"
            :grids="resultGrids"
            :labels="resultPanelLabels"
            :running="running"
          />
        </div>

        <div v-else-if="inspectTab === 'messages'" class="nm-dameng-debug__inspect-body">
          <DebugMessagesPanel
            :messages="messages"
            :empty="t('modules.dameng.debug.noMessages')"
          />
        </div>

        <div v-else class="nm-dameng-debug__inspect-body">
          <DebugHelpPanel
            v-model:enable-session="enableDebugSession"
            :enable-label="t('modules.dameng.debug.enableSessionVar')"
            :enable-disabled="busy"
            :tips="helpTips"
          />
        </div>
      </div>
    </template>
  </DebugShell>
</template>

<style scoped>
.nm-dameng-debug {
  width: 100%;
  height: 100%;
}

.nm-dameng-debug__boot {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-dameng-debug__inspect {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.nm-dameng-debug__inspect-header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
  padding: 0 var(--rs-space-sm);
}

.nm-dameng-debug__inspect-tabs {
  min-width: 0;
}

.nm-dameng-debug__inspect-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
