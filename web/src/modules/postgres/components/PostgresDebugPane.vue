<script setup lang="ts">
/**
 * Postgres 例程执行面板（对齐 MySQL MysqlDebugPane）：
 * 左侧填参 + 运行调用 + 右侧结果/消息；源码/日志点仅编辑器草稿，永不写回服务器。
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
import { postgresApi } from '@/api/postgres'
import type { PostgresQueryColumn, PostgresQueryExecResult } from '@/api/types/postgres'
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
  defaultPostgreSQLProfile,
  resolveMonacoLanguageFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import {
  bootstrapPostgresMonaco,
  POSTGRES_MONACO_LANGUAGE_ID,
} from '@/modules/postgres/monaco-bootstrap'
import { qualifiedName } from '@/modules/postgres/sql-seed'
import {
  countPostgresDebugLogPoints,
  insertPostgresDebugLogPoint,
  insertPostgresDebugLogPointAtLine,
} from '@/modules/postgres/utils/postgres-debug-assist'
import {
  buildCallParams,
  buildRoutineCallSql,
  type RoutineCallParam,
} from '@/modules/postgres/utils/routine-call'
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

const logPointCount = computed(() => countPostgresDebugLogPoints(sourceText.value))
const busy = computed(() => running.value)

const dialectProfile = computed(() => {
  if (!props.sessionId) return defaultPostgreSQLProfile()
  return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultPostgreSQLProfile()
})

const monacoLanguage = computed(
  () =>
    resolveMonacoLanguageFromProfile(dialectProfile.value).monacoLanguageId ||
    POSTGRES_MONACO_LANGUAGE_ID,
)

const stateTone = computed((): DebugShellStateTone => {
  if (running.value) return 'running'
  if (messages.value.some((m) => m.startsWith('ERR'))) return 'ended'
  if (resultGrids.value.length > 0) return 'paused'
  return 'idle'
})

const stateLabel = computed(() => {
  if (running.value) return t('modules.postgres.debug.stateRunning')
  if (messages.value.some((m) => m.startsWith('ERR'))) return t('modules.postgres.debug.stateError')
  if (resultGrids.value.length > 0) return t('modules.postgres.debug.stateDone')
  return t('modules.postgres.debug.stateAssist')
})

const shellLabels = computed(
  (): DebugShellLabels => ({
    toolbarLabel: t('modules.postgres.debug.toolbarLabel'),
    noTarget: t('modules.postgres.debug.noTarget'),
    start: t('modules.postgres.debug.runCall'),
    continue: t('modules.postgres.debug.continue'),
    next: t('modules.postgres.debug.next'),
    step: t('modules.postgres.debug.step'),
    finish: t('modules.postgres.debug.finish'),
    abort: t('modules.postgres.debug.abort'),
    paramsTitle: t('modules.postgres.debug.paramsTitle'),
    noParams: t('modules.postgres.debug.noParams'),
    paramsPreview: t('modules.postgres.debug.paramsPreview'),
    colParamName: t('modules.postgres.debug.colParamName'),
    colParamType: t('modules.postgres.debug.colParamType'),
    colParamValue: t('modules.postgres.debug.colParamValue'),
    paramValuePh: t('modules.postgres.debug.paramValuePh'),
    sourceTitle: t('modules.postgres.debug.sourceTitle'),
    bpHint: t('modules.postgres.debug.assistHint'),
    unavailable: t('modules.postgres.debug.unavailable'),
  }),
)

const paramsPreview = computed(() =>
  params.value.map((p) => `${p.mode ? p.mode + ' ' : ''}${p.name}`).join(', '),
)

const canRun = computed(
  () => Boolean(props.sessionId && props.schema && props.routine) && !busy.value,
)

const statusText = computed(() => {
  if (!props.routine) return t('modules.postgres.debug.noTarget')
  return t('modules.postgres.debug.statusAssist', { name: targetLabel.value })
})

const statusMeta = computed(() =>
  t('modules.postgres.debug.statusPoints', { n: logPointCount.value }),
)

const inspectTabs = computed((): RsTabItem[] => [
  { value: 'result', label: t('modules.postgres.debug.tabResult') },
  { value: 'messages', label: t('modules.postgres.debug.tabMessages') },
  { value: 'help', label: t('modules.postgres.debug.tabHelp') },
])

const resultPanelLabels = computed(
  (): DebugResultPanelLabels => ({
    empty: t('modules.postgres.debug.noResult'),
    emptyTable: t('modules.postgres.debug.resultEmpty'),
    rows: (n) => t('modules.postgres.debug.resultRows', { n }),
    duration: (ms) => t('modules.postgres.debug.resultDuration', { ms }),
    outName: t('modules.postgres.debug.resultOutName'),
    outValue: t('modules.postgres.debug.resultOutValue'),
  }),
)

const helpTips = computed(() => [
  t('modules.postgres.debug.tipRun'),
  t('modules.postgres.debug.tipSafe'),
  t('modules.postgres.debug.tipLog'),
  t('modules.postgres.debug.tipOut'),
])

onMounted(async () => {
  try {
    await bootstrapPostgresMonaco()
  } catch {
    // ignore
  } finally {
    languageReady.value = true
  }
})

async function loadAll(): Promise<void> {
  probing.value = true
  try {
    applyParams(props.args)
    await loadSource()
  } finally {
    probing.value = false
  }
}

function applyParams(identityArgs: string | undefined | null): void {
  params.value = buildCallParams(identityArgs).map((p) => ({
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
    const result = await postgresApi.metaRoutineSource({
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
      sourceText.value = formatSql(cleaned, { dialect: 'postgresql' })
    } catch {
      sourceText.value = cleaned
    }
    // 树节点未带 identity args 时，用源码元数据补全参数网格（对齐 MySQL meta.routineParameters）
    if (!props.args?.trim() && result.args?.trim()) {
      applyParams(result.args)
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.postgres.debug.loadSourceFailed'))
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

async function runCall(): Promise<void> {
  if (!canRun.value || !props.sessionId) return
  if (!props.schema || !props.routine) return

  running.value = true
  messages.value = []
  resultGrids.value = []
  activeGridId.value = ''
  inspectTab.value = 'result'

  try {
    const result = await postgresApi.routineCall({
      sessionId: props.sessionId,
      database: props.database,
      schema: props.schema,
      name: props.routine,
      kind: kind.value,
      oid: props.oid,
      args: toRoutineParams().map((p) => ({
        name: p.name,
        type: p.type,
        mode: p.mode,
        value: p.value,
        isNull: p.isNull,
      })),
      debugSession: enableDebugSession.value,
      limit: 200,
      requestId: `postgres-routine-${Date.now()}`,
    })
    for (const n of result.notices ?? []) messages.value.push(`NOTICE  ${n}`)
    const preview = `${kind.value === 'function' ? 'SELECT' : 'CALL'} ${qualifiedName(props.schema, props.routine)}`
    const grid = toGrid(result, 0, preview)
    if (grid) {
      resultGrids.value.push(grid)
      activeGridId.value = grid.id
      messages.value.push(
        `OK  routine.call  → ${grid.rows.length} row(s)  ${result.durationMs}ms`,
      )
      toast.success(t('modules.postgres.debug.runOk'))
    } else {
      inspectTab.value = 'messages'
      messages.value.push(`OK  routine.call  → ${result.commandTag || 'done'}`)
      toast.success(t('modules.postgres.debug.runOkNoResult'))
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

function toGrid(result: PostgresQueryExecResult, index: number, sqlPreview: string): DebugResultGrid | null {
  if (!result.columns?.length) return null
  const columns: RsTableColumn<ResultRow>[] = result.columns.map((c: PostgresQueryColumn, i) => ({
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
    title: t('modules.postgres.debug.resultTitle', { n: index + 1 }),
    columns,
    rows,
    sqlPreview,
    rowCount: n,
    durationMs: result.durationMs,
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
      ? insertPostgresDebugLogPointAtLine(sourceText.value, { line })
      : insertPostgresDebugLogPoint(sourceText.value)
  toast.success(t('modules.postgres.debug.logPointInserted'))
}

function onGlyphInsert(line: number): void {
  if (!sourceText.value.trim()) return
  sourceText.value = insertPostgresDebugLogPointAtLine(sourceText.value, { line })
  toast.success(t('modules.postgres.debug.logPointInserted'))
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
    () => toast.success(t('modules.postgres.debug.callCopied')),
    () => toast.error(t('modules.postgres.tree.copyFailed')),
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
    class="nm-postgres-debug"
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
        {{ t('modules.postgres.debug.openCall') }}
      </RsButton>
      <RsButton
        variant="ghost"
        size="sm"
        icon="plus"
        :disabled="!sourceText.trim() || busy"
        @click="onInsertLogPoint"
      >
        {{ t('modules.postgres.debug.insertLogPoint') }}
      </RsButton>
    </template>

    <template #source>
      <RsEmpty
        v-if="!sourceText.trim()"
        fill
        icon="bug"
        :description="t('modules.postgres.debug.noSource')"
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
      <div v-else class="nm-postgres-debug__boot">
        <RsLoading size="sm" />
      </div>
    </template>

    <template #inspect>
      <div class="nm-postgres-debug__inspect">
        <div class="nm-postgres-debug__inspect-header">
          <RsTabs
            v-model="inspectTab"
            class="nm-postgres-debug__inspect-tabs"
            :items="inspectTabs"
            size="sm"
            variant="line"
            panelless
          />
        </div>

        <div v-if="inspectTab === 'result'" class="nm-postgres-debug__inspect-body">
          <DebugResultPanel
            v-model:active-grid-id="activeGridId"
            :grids="resultGrids"
            :labels="resultPanelLabels"
            :running="running"
          />
        </div>

        <div v-else-if="inspectTab === 'messages'" class="nm-postgres-debug__inspect-body">
          <DebugMessagesPanel
            :messages="messages"
            :empty="t('modules.postgres.debug.noMessages')"
          />
        </div>

        <div v-else class="nm-postgres-debug__inspect-body">
          <DebugHelpPanel
            v-model:enable-session="enableDebugSession"
            :enable-label="t('modules.postgres.debug.enableSessionVar')"
            :enable-disabled="busy"
            :tips="helpTips"
          />
        </div>
      </div>
    </template>
  </DebugShell>
</template>

<style scoped>
.nm-postgres-debug {
  height: 100%;
  min-height: 0;
}

.nm-postgres-debug__boot {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
}

.nm-postgres-debug__inspect {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-postgres-debug__inspect-header {
  flex: 0 0 auto;
  padding: 0 8px;
  border-bottom: 1px solid var(--rs-border-subtle, rgba(0, 0, 0, 0.08));
}

.nm-postgres-debug__inspect-tabs {
  width: 100%;
}

.nm-postgres-debug__inspect-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
