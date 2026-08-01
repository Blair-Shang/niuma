<script setup lang="ts">
/**
 * Kingbase 例程调试辅助：复用公共 DebugShell。
 * 面板内运行调用并展示结果；左侧源码/日志点仅编辑器草稿，永不写回服务器。
 * （不做 Vastbase 级 pldebugger 断点状态机。）
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
import { kingbaseApi } from '@/api/kingbase'
import type { KingbaseQueryColumn, KingbaseQueryExecResult } from '@/api/types/kingbase'
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
  defaultKingbaseProfile,
  resolveMonacoLanguageFromProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import {
  bootstrapKingbaseMonaco,
  KINGBASE_MONACO_LANGUAGE_ID,
} from '@/modules/kingbase/monaco-bootstrap'
import { qualifiedName } from '@/modules/kingbase/sql-seed'
import {
  countKingbaseDebugLogPoints,
  insertKingbaseDebugLogPoint,
  insertKingbaseDebugLogPointAtLine,
  isKingbaseDebugSessionScaffoldSql,
  wrapKingbaseCallWithDebugSession,
} from '@/modules/kingbase/utils/kingbase-debug-assist'
import { hasBatchExecMarker } from '@/modules/kingbase/utils/query-exec-mode'
import {
  buildCallParams,
  buildRoutineCallSql,
  type RoutineCallParam,
} from '@/modules/kingbase/utils/routine-call'
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
  args?: string
  oid?: number
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

const targetLabel = computed(() => {
  if (!props.schema || !props.routine) return ''
  return qualifiedName(props.schema, props.routine)
})

const logPointCount = computed(() => countKingbaseDebugLogPoints(sourceText.value))
const busy = computed(() => running.value)

const dialectProfile = computed(() => {
  if (!props.sessionId) return defaultKingbaseProfile()
  return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultKingbaseProfile()
})

const monacoLanguage = computed(
  () =>
    resolveMonacoLanguageFromProfile(dialectProfile.value).monacoLanguageId ||
    KINGBASE_MONACO_LANGUAGE_ID,
)

const stateTone = computed((): DebugShellStateTone => {
  if (running.value) return 'running'
  if (messages.value.some((m) => m.startsWith('ERR'))) return 'ended'
  if (resultGrids.value.length > 0) return 'paused'
  return 'idle'
})

const stateLabel = computed(() => {
  if (running.value) return t('modules.kingbase.debug.stateRunning')
  if (messages.value.some((m) => m.startsWith('ERR'))) return t('modules.kingbase.debug.stateError')
  if (resultGrids.value.length > 0) return t('modules.kingbase.debug.stateDone')
  return t('modules.kingbase.debug.stateAssist')
})

const shellLabels = computed(
  (): DebugShellLabels => ({
    toolbarLabel: t('modules.kingbase.debug.toolbarLabel'),
    noTarget: t('modules.kingbase.debug.noTarget'),
    start: t('modules.kingbase.debug.runCall'),
    continue: t('modules.kingbase.debug.continue'),
    next: t('modules.kingbase.debug.next'),
    step: t('modules.kingbase.debug.step'),
    finish: t('modules.kingbase.debug.finish'),
    abort: t('modules.kingbase.debug.abort'),
    paramsTitle: t('modules.kingbase.debug.paramsTitle'),
    noParams: t('modules.kingbase.debug.noParams'),
    paramsPreview: t('modules.kingbase.debug.paramsPreview'),
    colParamName: t('modules.kingbase.debug.colParamName'),
    colParamType: t('modules.kingbase.debug.colParamType'),
    colParamValue: t('modules.kingbase.debug.colParamValue'),
    paramValuePh: t('modules.kingbase.debug.paramValuePh'),
    sourceTitle: t('modules.kingbase.debug.sourceTitle'),
    bpHint: t('modules.kingbase.debug.assistHint'),
    unavailable: t('modules.kingbase.debug.unavailable'),
  }),
)

const paramsPreview = computed(() =>
  params.value.map((p) => `${p.mode ? p.mode + ' ' : ''}${p.name}`).join(', '),
)

const canRun = computed(
  () => Boolean(props.sessionId && props.schema && props.routine) && !busy.value,
)

const statusText = computed(() => {
  if (!props.routine) return t('modules.kingbase.debug.noTarget')
  return t('modules.kingbase.debug.statusAssist', { name: targetLabel.value })
})

const statusMeta = computed(() =>
  t('modules.kingbase.debug.statusPoints', { n: logPointCount.value }),
)

const inspectTabs = computed((): RsTabItem[] => [
  { value: 'result', label: t('modules.kingbase.debug.tabResult') },
  { value: 'messages', label: t('modules.kingbase.debug.tabMessages') },
  { value: 'help', label: t('modules.kingbase.debug.tabHelp') },
])

const resultPanelLabels = computed(
  (): DebugResultPanelLabels => ({
    empty: t('modules.kingbase.debug.noResult'),
    emptyTable: t('modules.kingbase.debug.resultEmpty'),
    rows: (n) => t('modules.kingbase.debug.resultRows', { n }),
    duration: (ms) => t('modules.kingbase.debug.resultDuration', { ms }),
    outName: t('modules.kingbase.debug.resultOutName'),
    outValue: t('modules.kingbase.debug.resultOutValue'),
  }),
)

const helpTips = computed(() => [
  t('modules.kingbase.debug.tipRun'),
  t('modules.kingbase.debug.tipSafe'),
  t('modules.kingbase.debug.tipLog'),
  t('modules.kingbase.debug.tipOut'),
])

onMounted(async () => {
  try {
    await bootstrapKingbaseMonaco()
  } catch {
    // ignore
  } finally {
    languageReady.value = true
  }
})

async function loadAll(): Promise<void> {
  probing.value = true
  try {
    loadParams()
    await loadSource()
  } finally {
    probing.value = false
  }
}

function loadParams(): void {
  params.value = buildCallParams(props.args).map((p) => ({
    index: p.index,
    name: p.name,
    type: p.type,
    mode: p.mode.toUpperCase(),
    value: '',
    isNull: false,
  }))
}

async function loadSource(): Promise<void> {
  sourceText.value = ''
  if (!props.sessionId || !props.schema || !props.routine) return
  loadingSource.value = true
  try {
    const result = await kingbaseApi.metaRoutineSource({
      sessionId: props.sessionId,
      database: props.database,
      schema: props.schema,
      name: props.routine,
      args: props.args,
      oid: props.oid,
      kind: kind.value,
    })
    const cleaned = (result.definition || '').trim()
    try {
      sourceText.value = formatSql(cleaned, { dialect: 'kingbase' })
    } catch {
      sourceText.value = cleaned
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.kingbase.debug.loadSourceFailed'))
  } finally {
    loadingSource.value = false
  }
}

function toRoutineParams(): RoutineCallParam[] {
  return params.value.map((p) => ({
    index: p.index,
    name: p.name,
    type: p.type,
    mode: (p.mode || 'IN').toLowerCase() as RoutineCallParam['mode'],
    value: p.value ?? '',
    isNull: p.isNull === true,
  }))
}

function buildCallSql(): string {
  if (!props.schema || !props.routine) return ''
  let sql = buildRoutineCallSql({
    schema: props.schema,
    name: props.routine,
    kind: kind.value,
    params: toRoutineParams(),
    qualify: qualifiedName,
  })
  if (enableDebugSession.value) {
    sql = wrapKingbaseCallWithDebugSession(sql)
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

function toGrid(result: KingbaseQueryExecResult, index: number, sqlPreview: string): DebugResultGrid | null {
  if (!result.columns?.length) return null
  const columns: RsTableColumn<ResultRow>[] = result.columns.map((c: KingbaseQueryColumn, i) => ({
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
    title: t('modules.kingbase.debug.resultTitle', { n: index + 1 }),
    columns,
    rows,
    sqlPreview,
    rowCount: n,
    durationMs: result.durationMs,
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
    const hasOut = params.value.some((p) => /out/i.test(p.mode || ''))
    // 带 OUT 的过程：服务端 routine.call（同连接临时表），不依赖 NOTICE / 多语句脚本
    if (kind.value === 'procedure' && hasOut) {
      const result = await kingbaseApi.routineCall({
        sessionId: props.sessionId,
        database: props.database,
        schema: props.schema,
        name: props.routine,
        args: toRoutineParams().map((p) => ({
          name: p.name,
          type: p.type,
          mode: p.mode,
          value: p.value,
          isNull: p.isNull,
        })),
        requestId: `kingbase-routine-${Date.now()}`,
      })
      const grid = toGrid(result, 0, `CALL ${qualifiedName(props.schema, props.routine)}`)
      if (grid) {
        resultGrids.value.push(grid)
        activeGridId.value = grid.id
        messages.value.push(
          `OK  routine.call  → ${grid.rows.length} row(s)  ${result.durationMs}ms`,
        )
        toast.success(t('modules.kingbase.debug.runOk'))
      } else {
        inspectTab.value = 'messages'
        messages.value.push(`OK  routine.call  → ${result.commandTag || 'done'}`)
        toast.success(t('modules.kingbase.debug.runOkNoResult'))
      }
      return
    }

    // 函数 / 无 OUT 过程：生成 SQL 执行；debug wrap 或多语句 / batch 标识时同连接批跑
    const sql = buildCallSql().trim()
    if (!sql) return
    const features = resolveSplitFeaturesFromProfile(dialectProfile.value)
    const statements = splitSqlStatementsWithFeatures(sql, features)
      .map((s) => s.sql.trim())
      .filter(Boolean)

    let results: KingbaseQueryExecResult[] = []
    const useBatch = statements.length > 1 || hasBatchExecMarker(sql)
    if (useBatch) {
      const batch = await kingbaseApi.queryExecBatch({
        sessionId: props.sessionId,
        database: props.database,
        statements,
        limit: 200,
        requestId: `kingbase-debug-${Date.now()}`,
      })
      results = batch.results ?? []
      for (const n of batch.notices ?? []) messages.value.push(`NOTICE  ${n}`)
    } else {
      results = [
        await kingbaseApi.queryExec({
          sessionId: props.sessionId,
          database: props.database,
          sql: statements[0]!,
          limit: 200,
          requestId: `kingbase-debug-${Date.now()}`,
        }),
      ]
    }

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      for (const n of result.notices ?? []) messages.value.push(`NOTICE  ${n}`)
      const stmt = statements[i] ?? ''
      const preview = stmt.length > 72 ? `${stmt.slice(0, 72)}…` : stmt
      // 调试包装的 set_config / SET 只记消息，不进结果页
      if (isKingbaseDebugSessionScaffoldSql(stmt)) {
        messages.value.push(`OK  #${i + 1}  ${preview}  → scaffold`)
        continue
      }
      const grid = toGrid(result, resultGrids.value.length, preview)
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
    }

    if (resultGrids.value.length === 0) {
      inspectTab.value = 'messages'
      toast.success(t('modules.kingbase.debug.runOkNoResult'))
    } else {
      toast.success(t('modules.kingbase.debug.runOk'))
    }
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
      ? insertKingbaseDebugLogPointAtLine(sourceText.value, { line })
      : insertKingbaseDebugLogPoint(sourceText.value)
  toast.success(t('modules.kingbase.debug.logPointInserted'))
}

function onGlyphInsert(line: number): void {
  if (!sourceText.value.trim()) return
  sourceText.value = insertKingbaseDebugLogPointAtLine(sourceText.value, { line })
  toast.success(t('modules.kingbase.debug.logPointInserted'))
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
  if (!props.schema || !props.routine) return
  const sql = buildRoutineCallSql({
    schema: props.schema,
    name: props.routine,
    kind: kind.value,
    params: toRoutineParams(),
    qualify: qualifiedName,
  })
  void navigator.clipboard.writeText(sql).then(
    () => toast.success(t('modules.kingbase.debug.callCopied')),
    () => toast.error(t('modules.kingbase.tree.copyFailed')),
  )
}

function debugScopeKey(): string {
  return [
    props.sessionId ?? '',
    props.database ?? '',
    props.schema ?? '',
    props.routine ?? '',
    props.routineKind ?? '',
    props.args ?? '',
    props.oid ?? '',
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
  () =>
    [
      props.sessionId,
      props.database,
      props.schema,
      props.routine,
      props.routineKind,
      props.args,
      props.oid,
    ] as const,
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
    class="nm-kingbase-debug"
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
        icon="clipboard"
        :disabled="!canRun"
        @click="openCallScript"
      >
        {{ t('modules.kingbase.debug.openCall') }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        icon="plus"
        :disabled="!sourceText.trim() || busy"
        @click="onInsertLogPoint"
      >
        {{ t('modules.kingbase.debug.insertLogPoint') }}
      </RsButton>
    </template>

    <template #source>
      <RsEmpty
        v-if="!sourceText.trim()"
        fill
        icon="bug"
        :description="t('modules.kingbase.debug.noSource')"
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
      <div v-else class="nm-kingbase-debug__boot">
        <RsLoading size="sm" />
      </div>
    </template>

    <template #inspect>
      <div class="nm-kingbase-debug__inspect">
        <div class="nm-kingbase-debug__inspect-header">
          <RsTabs
            v-model="inspectTab"
            class="nm-kingbase-debug__inspect-tabs"
            :items="inspectTabs"
            size="sm"
            variant="line"
            panelless
          />
        </div>

        <div v-if="inspectTab === 'result'" class="nm-kingbase-debug__inspect-body">
          <DebugResultPanel
            v-model:active-grid-id="activeGridId"
            :grids="resultGrids"
            :labels="resultPanelLabels"
            :running="running"
          />
        </div>

        <div v-else-if="inspectTab === 'messages'" class="nm-kingbase-debug__inspect-body">
          <DebugMessagesPanel
            :messages="messages"
            :empty="t('modules.kingbase.debug.noMessages')"
          />
        </div>

        <div v-else class="nm-kingbase-debug__inspect-body">
          <DebugHelpPanel
            v-model:enable-session="enableDebugSession"
            :enable-label="t('modules.kingbase.debug.enableSessionVar')"
            :enable-disabled="busy"
            :tips="helpTips"
          />
        </div>
      </div>
    </template>
  </DebugShell>
</template>

<style scoped>
.nm-kingbase-debug {
  height: 100%;
  min-height: 0;
}

.nm-kingbase-debug__boot {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
}

.nm-kingbase-debug__inspect {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-kingbase-debug__inspect-header {
  flex: 0 0 auto;
  padding: 0 8px;
  border-bottom: 1px solid var(--rs-border-subtle, rgba(0, 0, 0, 0.08));
}

.nm-kingbase-debug__inspect-tabs {
  width: 100%;
}

.nm-kingbase-debug__inspect-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
