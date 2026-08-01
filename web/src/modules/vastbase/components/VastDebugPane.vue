<script setup lang="ts">
import {
  RsButton,
  RsEmpty,
  RsIcon,
  RsInput,
  RsLoading,
  RsMonacoEditor,
  RsTable,
  RsTabs,
  useRsToast,
} from '@niuma/ui'
import type { RsContextMenuItem, RsTabItem, RsTableColumn } from '@niuma/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { subscribeBridgeEventByPrefix, vastbaseApi } from '@/api'
import type {
  VastDebugBreakpoint,
  VastDebugCodeLine,
  VastDebugControlResult,
  VastDebugPosition,
  VastDebugStackFrame,
  VastDebugVariable,
} from '@/api/types/vastbase'
import { DebugShell, type DebugShellLabels } from '@/modules/database'
import { useVastSqlEditor } from '@/modules/vastbase/composables/useVastSqlEditor'
import { defaultVastbaseProfile } from '@/modules/sql-editor/capabilities'
import { qualifiedName } from '@/modules/vastbase/sql-seed'
import {
  buildCallParams,
  serializeCallParams,
  type RoutineCallParam,
} from '@/modules/vastbase/utils/routine-call'
import { useSessionRegistry } from '@/stores/session-registry'

const props = defineProps<{
  sessionId: string | null
  database?: string
  schema?: string
  routine?: string
  routineKind?: 'function' | 'procedure'
  args?: string
  oid?: number
  active: boolean
}>()

const { t } = useI18n()
const toast = useRsToast()

const probing = ref(false)
const available = ref(false)
const reason = ref('')
const busy = ref(false)
const debugId = ref<string | null>(null)
const state = ref('idle')
/** Navicat 式参数网格：名称 / 类型 / NULL / 值 */
const callParams = ref<RoutineCallParam[]>([])
const currentLine = ref(0)
const currentQuery = ref('')
const sourceLines = ref<VastDebugCodeLine[]>([])
const variables = ref<VastDebugVariable[]>([])
const stack = ref<VastDebugStackFrame[]>([])
const breakpoints = ref<VastDebugBreakpoint[]>([])
/** 观察表达式（会话间保留名称；暂停时用 print_var 刷新值） */
type WatchEntry = {
  expression: string
  name: string
  type: string
  value: string
  error?: string
}
const watches = ref<WatchEntry[]>([])
const watchInput = ref('')
const inspectTab = ref<'variables' | 'watch' | 'stack' | 'breakpoints' | 'output'>('variables')
const sourceText = ref('')

const breakableLines = computed(() => {
  const set = new Set<number>()
  for (const line of sourceLines.value) {
    if (line.canBreak) set.add(line.line)
  }
  return set
})

/** 断点列表里的厂商 lineno → 编辑器行号（装饰用） */
const breakpointLines = computed(() =>
  breakpoints.value.map((b) => editorLineFromDebugLine(b.line)).filter((n) => n > 0),
)

function editorLineFromDebugLine(debugLine: number): number {
  if (debugLine <= 0) return 0
  const hit = sourceLines.value.find((l) => (l.debugLine ?? l.line) === debugLine)
  return hit?.line ?? debugLine
}

function debugLineFromEditorLine(editorLine: number): number {
  const hit = sourceLines.value.find((l) => l.line === editorLine)
  return hit?.debugLine ?? editorLine
}
const sessionActive = computed(() => !!debugId.value)
const controlsEnabled = computed(
  () => sessionActive.value && !busy.value && state.value === 'paused',
)

watch(
  sourceLines,
  (lines) => {
    sourceText.value = lines.map((l) => l.code).join('\n')
  },
  { deep: true, immediate: true },
)

const { editorRef, languageReady, sqlLanguage, onActiveChange } = useVastSqlEditor({
  sqlText: sourceText,
  active: () => props.active,
  getDialect: () =>
    useSessionRegistry().getDialectForSession(props.sessionId) ?? defaultVastbaseProfile(),
  onRun: () => {
    if (!sessionActive.value) void startDebug()
  },
})

function onGlyphMarginClick(line: number): void {
  if (!debugId.value || busy.value) return
  if (!breakableLines.value.has(line)) {
    toast.error(t('modules.vastbase.debug.noBreakHere'))
    return
  }
  void toggleBreakpointAt(line, true)
}

async function scrollCurrentLineIntoView(): Promise<void> {
  await Promise.resolve()
  editorRef.value?.revealLine?.(currentLine.value)
}

const target = computed(() =>
  props.schema && props.routine ? qualifiedName(props.schema, props.routine) : '',
)

const stateLabel = computed(() => {
  const key = `modules.vastbase.debug.state.${state.value}`
  const labeled = t(key)
  return labeled === key ? state.value : labeled
})

const stateTone = computed(() => {
  switch (state.value) {
    case 'paused':
      return 'paused'
    case 'running':
      return 'running'
    case 'aborted':
    case 'stopped':
    case 'finished':
      return 'ended'
    default:
      return 'idle'
  }
})

type VarRow = Record<string, unknown> & { __rowKey: string; name: string }
type WatchRow = Record<string, unknown> & {
  __rowKey: string
  expression: string
  name: string
  type: string
  value: string
  error?: string
}
type StackRow = Record<string, unknown> & { __rowKey: string }
type BpRow = Record<string, unknown> & { __rowKey: string; line: number; number: number }

const varColumns = computed((): RsTableColumn<VarRow>[] => [
  { key: 'name', title: t('modules.vastbase.debug.colVar'), minWidth: 88, ellipsis: true },
  { key: 'type', title: t('modules.vastbase.debug.colType'), width: 88, ellipsis: true },
  { key: 'value', title: t('modules.vastbase.debug.colValue'), minWidth: 100, ellipsis: true },
])

const varRows = computed((): VarRow[] =>
  variables.value.map((v, i) => ({
    __rowKey: `${v.name}-${i}`,
    name: v.name,
    type: v.type,
    value: v.value,
  })),
)

const watchColumns = computed((): RsTableColumn<WatchRow>[] => [
  { key: 'expression', title: t('modules.vastbase.debug.colWatch'), minWidth: 88, ellipsis: true },
  { key: 'type', title: t('modules.vastbase.debug.colType'), width: 88, ellipsis: true },
  { key: 'value', title: t('modules.vastbase.debug.colValue'), minWidth: 100, ellipsis: true },
])

const watchRows = computed((): WatchRow[] =>
  watches.value.map((w) => ({
    __rowKey: w.expression,
    expression: w.expression,
    name: w.name,
    type: w.type,
    value: w.error ? w.error : w.value,
    error: w.error,
  })),
)

const stackColumns = computed((): RsTableColumn<StackRow>[] => [
  { key: 'frameNo', title: '#', width: 36, align: 'right' },
  { key: 'funcname', title: t('modules.vastbase.debug.colFunc'), minWidth: 100, ellipsis: true },
  { key: 'line', title: t('modules.vastbase.debug.colLine'), width: 48, align: 'right' },
])

const stackRows = computed((): StackRow[] =>
  stack.value.map((f) => ({
    __rowKey: String(f.frameNo),
    frameNo: f.frameNo,
    funcname: f.funcname,
    line: f.line,
  })),
)

const bpColumns = computed((): RsTableColumn<BpRow>[] => [
  { key: 'line', title: t('modules.vastbase.debug.colLine'), width: 56, align: 'right' },
  { key: 'number', title: '#', width: 40, align: 'right' },
])

const bpRows = computed((): BpRow[] =>
  breakpoints.value.map((b) => ({
    __rowKey: String(b.number),
    line: b.line,
    number: b.number,
  })),
)

const inspectTabs = computed((): RsTabItem[] => [
  {
    value: 'variables',
    label: t('modules.vastbase.debug.variables'),
    badge: variables.value.length || undefined,
  },
  {
    value: 'watch',
    label: t('modules.vastbase.debug.watch'),
    badge: watches.value.length || undefined,
  },
  {
    value: 'stack',
    label: t('modules.vastbase.debug.stack'),
    badge: stack.value.length || undefined,
  },
  {
    value: 'breakpoints',
    label: t('modules.vastbase.debug.breakpoints'),
    badge: breakpoints.value.length || undefined,
  },
  {
    value: 'output',
    label: t('modules.vastbase.debug.output'),
    badge: outputBadgeCount.value,
  },
])

function varContextMenuItems(row: VarRow | null): RsContextMenuItem[] {
  if (!row?.name) return []
  const exists = watches.value.some((w) => w.expression === row.name)
  return [
    {
      key: 'add-watch',
      label: t('modules.vastbase.debug.addWatch'),
      icon: 'eye',
      disabled: exists,
    },
  ]
}

function watchContextMenuItems(row: WatchRow | null): RsContextMenuItem[] {
  if (!row?.expression) return []
  return [
    {
      key: 'remove-watch',
      label: t('modules.vastbase.debug.removeWatch'),
      icon: 'x',
    },
  ]
}

function onVarContextMenuSelect(key: string, row: VarRow | null): void {
  if (key === 'add-watch' && row?.name) addWatch(row.name)
}

function onWatchContextMenuSelect(key: string, row: WatchRow | null): void {
  if (key === 'remove-watch' && row?.expression) removeWatch(row.expression)
}

function addWatch(expression: string): void {
  const expr = expression.trim()
  if (!expr) return
  if (watches.value.some((w) => w.expression === expr)) {
    toast.info(t('modules.vastbase.debug.watchExists'))
    inspectTab.value = 'watch'
    return
  }
  watches.value = [
    ...watches.value,
    { expression: expr, name: expr, type: '', value: '' },
  ]
  watchInput.value = ''
  inspectTab.value = 'watch'
  if (debugId.value && state.value === 'paused') void refreshWatches()
}

function removeWatch(expression: string): void {
  watches.value = watches.value.filter((w) => w.expression !== expression)
}

function onWatchInputSubmit(): void {
  addWatch(watchInput.value)
}

function clearWatchValues(): void {
  watches.value = watches.value.map((w) => ({
    ...w,
    type: '',
    value: '',
    error: undefined,
  }))
}

/** 串行 print_var；优先用 locals 命中，减少无效调用 */
async function refreshWatches(): Promise<void> {
  if (!debugId.value || watches.value.length === 0) return
  const base = debugSessionParams()
  const locals = new Map(variables.value.map((v) => [v.name, v]))
  const next: WatchEntry[] = []
  for (const w of watches.value) {
    const fromLocal = locals.get(w.expression)
    if (fromLocal && fromLocal.value && fromLocal.value !== '<UNKNOWN>') {
      next.push({
        expression: w.expression,
        name: fromLocal.name,
        type: fromLocal.type,
        value: fromLocal.value,
      })
      continue
    }
    try {
      const v = await vastbaseApi.debugEvaluate({ ...base, name: w.expression })
      next.push({
        expression: w.expression,
        name: v.name || w.expression,
        type: v.type ?? '',
        value: v.value ?? '',
      })
    } catch (e) {
      // 单条失败不中断其余；错误展示在值列
      next.push({
        expression: w.expression,
        name: fromLocal?.name ?? w.expression,
        type: fromLocal?.type ?? '',
        value: fromLocal?.value ?? '',
        error: e instanceof Error ? e.message : t('modules.vastbase.debug.watchError'),
      })
    }
  }
  watches.value = next
}

const statusText = computed(() => {
  const finishedLike = state.value === 'finished' || state.value === 'error' || state.value === 'aborted'
  if (!sessionActive.value) {
    if (finishedLike && currentLine.value > 0) {
      const q = currentQuery.value ? ` · ${currentQuery.value}` : ''
      return (
        t('modules.vastbase.debug.statusFinishedAtLine', { line: currentLine.value }) + q
      )
    }
    if (finishedLike) {
      return stateLabel.value
    }
    return props.routine
      ? t('modules.vastbase.debug.startHint')
      : t('modules.vastbase.debug.readyDescGeneric')
  }
  if (currentLine.value > 0) {
    const q = currentQuery.value ? ` · ${currentQuery.value}` : ''
    return t('modules.vastbase.debug.statusAtLine', { line: currentLine.value }) + q
  }
  return stateLabel.value
})

/** DBMS_OUTPUT / DBE_OUTPUT 缓冲（服务端拉取；与步进轨迹分开） */
const dbmsOutput = ref<string[]>([])
/** 本地调试轨迹（启动/暂停/结束标记） */
const debugTrace = ref<string[]>([])

const outputBadgeCount = computed(() => dbmsOutput.value.length || debugTrace.value.length || undefined)

const dbmsEmptyDescription = computed(() => {
  const s = state.value
  if (s === 'paused' || s === 'running' || s === 'starting' || s === 'attached') {
    return t('modules.vastbase.debug.noDbmsOutputPending')
  }
  return t('modules.vastbase.debug.noDbmsOutput')
})

function appendDebugTrace(line: string): void {
  const text = line.trim()
  if (!text) return
  // 连续相同暂停行去重（避免多次 L18: BEGIN）
  const last = debugTrace.value[debugTrace.value.length - 1]
  if (last === text) return
  debugTrace.value = [...debugTrace.value, text].slice(-500)
}

function mergeServerOutput(lines: string[] | undefined | null): void {
  if (!lines?.length) return
  const existing = new Set(dbmsOutput.value)
  const next = [...dbmsOutput.value]
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line === '' || existing.has(line)) continue
    // 丢弃内部探针残留
    if (line.includes('nm_dbms_probe')) continue
    existing.add(line)
    next.push(line)
  }
  dbmsOutput.value = next.slice(-500)
  if (lines.length > 0) {
    inspectTab.value = 'output'
  }
}

function clearSessionSnapshot(): void {
  currentLine.value = 0
  currentQuery.value = ''
  variables.value = []
  stack.value = []
  breakpoints.value = []
  clearWatchValues()
  dbmsOutput.value = []
  debugTrace.value = []
}

function clearOutputPanel(): void {
  dbmsOutput.value = []
  debugTrace.value = []
}

const callArgsPreview = computed(() => serializeCallParams(callParams.value))

const shellLabels = computed(
  (): DebugShellLabels => ({
    toolbarLabel: t('modules.vastbase.debug.toolbarLabel'),
    noTarget: t('modules.vastbase.debug.noTarget'),
    start: t('modules.vastbase.debug.start'),
    continue: t('modules.vastbase.debug.continue'),
    next: t('modules.vastbase.debug.next'),
    step: t('modules.vastbase.debug.step'),
    finish: t('modules.vastbase.debug.finish'),
    abort: t('modules.vastbase.debug.abort'),
    paramsTitle: t('modules.vastbase.debug.paramsTitle'),
    noParams: t('modules.vastbase.debug.noParams'),
    paramsPreview: t('modules.vastbase.debug.paramsPreview'),
    colParamName: t('modules.vastbase.debug.colParamName'),
    colParamType: t('modules.vastbase.debug.colParamType'),
    colParamValue: t('modules.vastbase.debug.colParamValue'),
    paramValuePh: t('modules.vastbase.debug.paramValuePh'),
    sourceTitle: t('modules.vastbase.debug.sourceTitle'),
    bpHint: t('modules.vastbase.debug.bpHint'),
    unavailable: t('modules.vastbase.debug.unavailable'),
  }),
)

const canStart = computed(
  () => !sessionActive.value && !!props.routine && !busy.value && available.value,
)

const statusMeta = computed(() => {
  if (
    currentLine.value &&
    (sessionActive.value ||
      state.value === 'finished' ||
      state.value === 'error' ||
      state.value === 'aborted')
  ) {
    return `L${currentLine.value}`
  }
  return ''
})

function onParamNullChange(param: RoutineCallParam, checked: boolean): void {
  param.isNull = checked
  if (param.isNull) param.value = ''
}

function onParamValueInput(param: RoutineCallParam, value: string): void {
  param.value = value
  if (param.value.trim()) param.isNull = false
}

function onShellParamNull(index: number, isNull: boolean): void {
  const param = callParams.value.find((p) => p.index === index)
  if (param) onParamNullChange(param, isNull)
}

function onShellParamValue(index: number, value: string): void {
  const param = callParams.value.find((p) => p.index === index)
  if (param) onParamValueInput(param, value)
}

let offEvent: (() => void) | null = null

function ensureEvents(): void {
  if (offEvent) return
  offEvent = subscribeBridgeEventByPrefix('vastbase.debug.', (detail) => {
    if (typeof detail !== 'object' || detail === null) return
    const ev = detail as Record<string, unknown>
    if (ev.debugId !== debugId.value) return
    if (typeof ev.state === 'string') state.value = ev.state
    // 事件里的 line 是厂商 info_code.lineno，须映射到编辑器行号
    if (typeof ev.line === 'number') {
      currentLine.value = editorLineFromDebugLine(ev.line)
    }
    if (typeof ev.query === 'string') currentQuery.value = ev.query
    if (ev.type === 'vastbase.debug.paused' || ev.state === 'paused') {
      if (typeof ev.query === 'string' && ev.query) {
        appendDebugTrace(
          t('modules.vastbase.debug.outputPause', {
            line: typeof ev.line === 'number' ? editorLineFromDebugLine(ev.line) || ev.line : 0,
            query: ev.query,
          }),
        )
      }
      void refreshInspect()
    }
    // 例程跑完 / 出错：合并 DBMS_OUTPUT 后收尾
    if (ev.state === 'finished' || ev.state === 'error') {
      if (Array.isArray(ev.output)) {
        mergeServerOutput(ev.output as string[])
      }
      void endSessionAfterRun(String(ev.state))
    }
  })
}

/** 调试自然结束：释放后端会话，但保留本次变量/堆栈/行号/输出供回顾 */
async function endSessionAfterRun(finalState: string): Promise<void> {
  if (!debugId.value) return
  const id = debugId.value
  const sid = props.sessionId ?? undefined
  debugId.value = null
  state.value = finalState
  appendDebugTrace(
    finalState === 'finished'
      ? t('modules.vastbase.debug.outputFinished')
      : t('modules.vastbase.debug.outputEnded', { state: finalState }),
  )
  if (currentLine.value > 0) {
    appendDebugTrace(
      t('modules.vastbase.debug.outputLastLine', {
        line: currentLine.value,
        query: currentQuery.value || '—',
      }),
    )
  }
  try {
    const stopped = await vastbaseApi.debugStop({ debugId: id, sessionId: sid })
    mergeServerOutput(stopped.output)
  } catch {
    // 服务端可能已随 EXECUTION FINISHED 退出
  }
  toast.success(
    finalState === 'finished'
      ? t('modules.vastbase.debug.finishedHint')
      : t('modules.vastbase.debug.endedHint'),
  )
  // 不再 loadPreviewSource / 清空检查点，避免「调试完结果消失」
}

async function probe(): Promise<void> {
  if (!props.sessionId || !props.active) return
  probing.value = true
  try {
    const caps = await vastbaseApi.debugCapabilities({ sessionId: props.sessionId })
    available.value = caps.available
    reason.value = caps.reason ?? ''
    if (caps.available && !debugId.value) {
      void loadPreviewSource()
    }
  } catch (e) {
    available.value = false
    reason.value = e instanceof Error ? e.message : t('modules.vastbase.debug.probeError')
  } finally {
    probing.value = false
  }
}

/** 启动前用 meta 预览源码；attach 后由 info_code 覆盖（含 canBreak）。 */
async function loadPreviewSource(): Promise<void> {
  if (!props.sessionId || !props.schema || !props.routine || debugId.value) return
  try {
    const result = await vastbaseApi.metaRoutineSource({
      sessionId: props.sessionId,
      database: props.database,
      schema: props.schema,
      name: props.routine,
      args: props.args,
      oid: props.oid,
      kind: props.routineKind,
    })
    if (debugId.value) return
    const def = result.definition ?? ''
    sourceLines.value = def.split(/\r?\n/).map((code, i) => ({
      line: i + 1,
      code,
      canBreak: false,
    }))
  } catch {
    if (!debugId.value) sourceLines.value = []
  }
}

function debugSessionParams(): { debugId: string; sessionId?: string } {
  return {
    debugId: debugId.value!,
    sessionId: props.sessionId ?? undefined,
  }
}

async function refreshInspect(): Promise<void> {
  if (!debugId.value) return
  const base = debugSessionParams()
  // 串行：调试连接独占，并行 RPC 会抢同一后端 conn
  try {
    const vars = await vastbaseApi.debugVariables(base)
    variables.value = vars.variables
    const frames = await vastbaseApi.debugStack(base)
    stack.value = frames.frames
    const bps = await vastbaseApi.debugBreakpointList(base)
    breakpoints.value = bps.breakpoints
    await refreshWatches()
  } catch {
    // inspect optional while running
  }
}

function applyPosition(pos: VastDebugPosition): void {
  currentLine.value = editorLineFromDebugLine(pos.line)
  currentQuery.value = pos.query ?? ''
}

function seedCallParamsFromSignature(): void {
  callParams.value = buildCallParams(props.args)
}


async function startDebug(): Promise<void> {
  if (!props.sessionId || !props.schema || !props.routine) return
  ensureEvents()
  busy.value = true
  clearSessionSnapshot()
  try {
    const result = await vastbaseApi.debugStart({
      sessionId: props.sessionId,
      database: props.database,
      schema: props.schema,
      name: props.routine,
      args: props.args,
      oid: props.oid,
      routineKind: props.routineKind ?? 'procedure',
      callArgs: serializeCallParams(callParams.value),
    })
    debugId.value = result.debugId
    state.value = result.state
    applyPosition(result.position)
    appendDebugTrace(t('modules.vastbase.debug.outputStarted'))
    if (result.position?.query) {
      appendDebugTrace(
        t('modules.vastbase.debug.outputPause', {
          line: editorLineFromDebugLine(result.position.line) || result.position.line,
          query: result.position.query,
        }),
      )
    }
    const src = await vastbaseApi.debugSource({
      debugId: result.debugId,
      sessionId: props.sessionId,
    })
    sourceLines.value = src.lines
    await refreshInspect()
    await scrollCurrentLineIntoView()
    toast.success(t('modules.vastbase.debug.started'))
  } catch (e) {
    toast.error(formatDebugStartError(e))
  } finally {
    busy.value = false
  }
}

function formatDebugStartError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '')
  if (raw.includes('ERR_ATTACH_TIMEOUT')) {
    return t('modules.vastbase.debug.attachTimeout')
  }
  if (raw.includes('ERR_ATTACH_FINISHED_EARLY') || raw.includes('D0011')) {
    return t('modules.vastbase.debug.attachFinishedEarly')
  }
  return raw || t('modules.vastbase.debug.startError')
}

async function control(
  fn: (p: { debugId: string; sessionId?: string }) => Promise<VastDebugControlResult>,
): Promise<void> {
  if (!debugId.value) return
  busy.value = true
  try {
    const result: VastDebugControlResult = await fn(debugSessionParams())
    state.value = result.state
    applyPosition(result.position)
    if (result.state === 'paused' && result.position?.query) {
      appendDebugTrace(
        t('modules.vastbase.debug.outputPause', {
          line: editorLineFromDebugLine(result.position.line) || result.position.line,
          query: result.position.query,
        }),
      )
    }
    mergeServerOutput(result.output ?? undefined)
    if (result.state === 'finished' || result.state === 'error') {
      await endSessionAfterRun(result.state)
      return
    }
    await refreshInspect()
    await scrollCurrentLineIntoView()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.debug.controlError'))
  } finally {
    busy.value = false
  }
}

async function abortDebug(): Promise<void> {
  if (!debugId.value) return
  busy.value = true
  try {
    await vastbaseApi.debugAbort(debugSessionParams())
    state.value = 'aborted'
    debugId.value = null
    appendDebugTrace(t('modules.vastbase.debug.outputAborted'))
    // 保留检查点与输出；仅释放会话
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.debug.controlError'))
  } finally {
    busy.value = false
  }
}

async function toggleBreakpointAt(line: number, canBreak = true): Promise<void> {
  if (!debugId.value || !canBreak || busy.value) return
  if (!breakableLines.value.has(line)) return
  const debugLine = debugLineFromEditorLine(line)
  if (debugLine <= 0) {
    toast.error(t('modules.vastbase.debug.noBreakHere'))
    return
  }
  const existing = breakpoints.value.find((b) => b.line === debugLine)
  const base = debugSessionParams()
  busy.value = true
  try {
    if (existing) {
      await vastbaseApi.debugBreakpointDelete({
        ...base,
        breakpointNo: existing.number,
      })
      breakpoints.value = breakpoints.value.filter((b) => b.number !== existing.number)
    } else {
      const created = await vastbaseApi.debugBreakpointAdd({ ...base, line: debugLine })
      // 先本地写入，保证 glyph 立刻显示（部分版本 info_breakpoints 列名差异会导致 list 行号为 0）
      if (created.line <= 0) created.line = debugLine
      breakpoints.value = [...breakpoints.value.filter((b) => b.number !== created.number), created]
    }
    try {
      const bps = await vastbaseApi.debugBreakpointList(base)
      const normalized = bps.breakpoints.map((b) =>
        b.line > 0 ? b : { ...b, line: debugLine },
      )
      if (normalized.some((b) => b.line > 0)) {
        breakpoints.value = normalized
      }
    } catch {
      // 保留本地断点列表
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.debug.bpError'))
  } finally {
    busy.value = false
  }
}

async function removeBreakpoint(row: BpRow): Promise<void> {
  if (!debugId.value) return
  const base = debugSessionParams()
  busy.value = true
  try {
    await vastbaseApi.debugBreakpointDelete({
      ...base,
      breakpointNo: row.number,
    })
    const bps = await vastbaseApi.debugBreakpointList(base)
    breakpoints.value = bps.breakpoints
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.debug.bpError'))
  } finally {
    busy.value = false
  }
}

function onStackDblclick(row: StackRow): void {
  if (typeof row.line === 'number' && row.line > 0) {
    currentLine.value = editorLineFromDebugLine(row.line)
    void scrollCurrentLineIntoView()
  }
}

function onBpDblclick(row: BpRow): void {
  if (row.line > 0) {
    currentLine.value = editorLineFromDebugLine(row.line)
    void scrollCurrentLineIntoView()
  }
}

watch(
  () => [props.routine, props.args, props.oid] as const,
  () => {
    seedCallParamsFromSignature()
    if (available.value && !debugId.value) void loadPreviewSource()
  },
  { immediate: true },
)

watch(
  () => [props.sessionId, props.active] as const,
  () => {
    if (props.active) void probe()
  },
  { immediate: true },
)

watch(currentLine, () => {
  void scrollCurrentLineIntoView()
})

watch(
  () => props.active,
  (active) => {
    onActiveChange(active)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  offEvent?.()
  offEvent = null
  if (debugId.value) {
    void vastbaseApi
      .debugStop({ debugId: debugId.value, sessionId: props.sessionId ?? undefined })
      .catch(() => undefined)
  }
})
</script>

<template>
  <DebugShell
    class="nm-vast-debug"
    :labels="shellLabels"
    :target-label="target"
    :state-label="stateLabel"
    :state-tone="stateTone"
    :probing="probing"
    :available="available"
    :unavailable-reason="reason"
    :busy="busy"
    :session-active="sessionActive"
    :controls-enabled="controlsEnabled"
    :can-start="canStart"
    :params="callParams"
    :params-preview="callArgsPreview"
    :params-disabled="sessionActive || busy"
    :status-text="statusText"
    :status-meta="statusMeta"
    @start="startDebug"
    @continue="control(vastbaseApi.debugContinue)"
    @next="control(vastbaseApi.debugNext)"
    @step="control(vastbaseApi.debugStep)"
    @finish="control(vastbaseApi.debugFinish)"
    @abort="abortDebug"
    @update:param-null="onShellParamNull"
    @update:param-value="onShellParamValue"
  >
    <template #source>
      <RsEmpty
        v-if="sourceLines.length === 0"
        fill
        icon="bug"
        :description="
          sessionActive
            ? t('modules.vastbase.debug.noSource')
            : t('modules.vastbase.debug.sourcePreviewHint')
        "
      />
      <div v-else class="nm-vast-debug__source">
        <RsMonacoEditor
          v-if="languageReady"
          ref="editorRef"
          v-model="sourceText"
          :language="sqlLanguage"
          height="100%"
          readonly
          embedded
          glyph-margin
          :debug-current-line="currentLine"
          :debug-breakpoints="breakpointLines"
          @glyph-margin-click="onGlyphMarginClick"
        />
        <div v-else class="nm-vast-debug__source-boot">
          <RsLoading size="sm" />
        </div>
      </div>
    </template>

    <template #inspect>
      <div class="nm-vast-debug__inspect-header">
        <RsTabs
          v-model="inspectTab"
          class="nm-vast-debug__inspect-tabs"
          :items="inspectTabs"
          size="sm"
          variant="line"
          panelless
        />
      </div>
      <div class="nm-vast-debug__inspect-body">
              <RsEmpty
                v-if="inspectTab === 'variables' && varRows.length === 0"
                fill
                icon="variable"
                :description="t('modules.vastbase.debug.noVariables')"
              />
              <RsTable
                v-else-if="inspectTab === 'variables'"
                :columns="varColumns"
                :data="varRows"
                row-key="__rowKey"
                size="sm"
                fill
                :context-menu-items="varContextMenuItems"
                @context-menu-select="onVarContextMenuSelect"
              />
              <div v-else-if="inspectTab === 'watch'" class="nm-vast-debug__watch">
                <div class="nm-vast-debug__watch-add">
                  <RsInput
                    v-model="watchInput"
                    size="sm"
                    class="nm-vast-debug__watch-input"
                    :placeholder="t('modules.vastbase.debug.watchPlaceholder')"
                    :disabled="busy"
                    @keydown.enter.prevent="onWatchInputSubmit"
                  />
                  <RsButton
                    variant="secondary"
                    size="sm"
                    :disabled="busy || !watchInput.trim()"
                    @click="onWatchInputSubmit"
                  >
                    {{ t('modules.vastbase.debug.addWatch') }}
                  </RsButton>
                </div>
                <RsEmpty
                  v-if="watchRows.length === 0"
                  fill
                  icon="eye"
                  :description="t('modules.vastbase.debug.noWatches')"
                />
                <RsTable
                  v-else
                  :columns="watchColumns"
                  :data="watchRows"
                  row-key="__rowKey"
                  size="sm"
                  fill
                  :context-menu-items="watchContextMenuItems"
                  @context-menu-select="onWatchContextMenuSelect"
                >
                  <template #cell-expression="{ row }">
                    <div class="nm-vast-debug__watch-expr">
                      <span class="nm-vast-debug__watch-expr-text">{{
                        (row as WatchRow).expression
                      }}</span>
                      <RsButton
                        variant="ghost"
                        size="sm"
                        :tooltip="t('modules.vastbase.debug.removeWatch')"
                        @click.stop="removeWatch((row as WatchRow).expression)"
                      >
                        <RsIcon name="x" :size="12" />
                      </RsButton>
                    </div>
                  </template>
                  <template #cell-value="{ row }">
                    <span
                      :class="{
                        'nm-vast-debug__watch-err': !!(row as WatchRow).error,
                      }"
                      >{{ (row as WatchRow).value }}</span
                    >
                  </template>
                </RsTable>
              </div>
              <RsEmpty
                v-else-if="inspectTab === 'stack' && stackRows.length === 0"
                fill
                icon="layers"
                :description="t('modules.vastbase.debug.noStack')"
              />
              <RsTable
                v-else-if="inspectTab === 'stack'"
                :columns="stackColumns"
                :data="stackRows"
                row-key="__rowKey"
                size="sm"
                fill
                @row-dblclick="(row) => onStackDblclick(row as StackRow)"
              />
              <RsEmpty
                v-else-if="inspectTab === 'breakpoints' && bpRows.length === 0"
                fill
                icon="circle"
                :description="t('modules.vastbase.debug.noBreakpoints')"
              />
              <RsTable
                v-else-if="inspectTab === 'breakpoints'"
                :columns="bpColumns"
                :data="bpRows"
                row-key="__rowKey"
                size="sm"
                fill
                @row-dblclick="(row) => onBpDblclick(row as BpRow)"
              >
                <template #cell-number="{ row }">
                  <div class="nm-vast-debug__bp-row">
                    <span>{{ (row as BpRow).number }}</span>
                    <RsButton
                      variant="ghost"
                      size="sm"
                      :disabled="!sessionActive || busy"
                      :tooltip="t('modules.vastbase.debug.removeBp')"
                      @click.stop="removeBreakpoint(row as BpRow)"
                    >
                      <RsIcon name="x" :size="12" />
                    </RsButton>
                  </div>
                </template>
              </RsTable>
              <div v-else-if="inspectTab === 'output'" class="nm-vast-debug__output">
                <div class="nm-vast-debug__output-toolbar">
                  <span class="nm-vast-debug__output-hint">
                    {{ t('modules.vastbase.debug.outputHint') }}
                  </span>
                  <RsButton
                    variant="ghost"
                    size="sm"
                    :disabled="dbmsOutput.length === 0 && debugTrace.length === 0"
                    @click="clearOutputPanel"
                  >
                    {{ t('modules.vastbase.debug.clearOutput') }}
                  </RsButton>
                </div>
                <div class="nm-vast-debug__output-section">
                  <div class="nm-vast-debug__output-section-title">
                    {{ t('modules.vastbase.debug.dbmsOutputTitle') }}
                  </div>
                  <RsEmpty
                    v-if="dbmsOutput.length === 0"
                    fill
                    icon="message-square"
                    :description="dbmsEmptyDescription"
                  />
                  <pre v-else class="nm-vast-debug__output-log">{{ dbmsOutput.join('\n') }}</pre>
                </div>
                <div v-if="debugTrace.length > 0" class="nm-vast-debug__output-section nm-vast-debug__output-section--trace">
                  <div class="nm-vast-debug__output-section-title">
                    {{ t('modules.vastbase.debug.traceTitle') }}
                  </div>
                  <pre class="nm-vast-debug__output-log nm-vast-debug__output-log--muted">{{
                    debugTrace.join('\n')
                  }}</pre>
                </div>
              </div>
      </div>
    </template>
  </DebugShell>
</template>

<style scoped>
/* 外壳布局见 DebugShell；此处仅保留巡视区方言样式 */
.nm-vast-debug {
  width: 100%;
  height: 100%;
}

.nm-vast-debug__inspect-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
  height: 2rem;
  padding: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface);
}

.nm-vast-debug__source {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--rs-bg-elevated, var(--rs-bg));
}

.nm-vast-debug__source-boot {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-vast-debug__inspect-tabs {
  flex: 1;
  min-width: 0;
  height: 100%;
}

.nm-vast-debug__inspect-tabs :deep(.rs-tabs),
.nm-vast-debug__inspect-tabs :deep(.rs-tabs__shell),
.nm-vast-debug__inspect-tabs :deep(.rs-tabs__body),
.nm-vast-debug__inspect-tabs :deep(.rs-tabs__nav),
.nm-vast-debug__inspect-tabs :deep(.rs-tabs__nav-viewport) {
  height: 100%;
}

.nm-vast-debug__inspect-tabs :deep(.rs-tabs__list) {
  height: 100%;
  align-items: stretch;
  border-bottom: none;
  padding: 0 var(--rs-space-xs);
}

.nm-vast-debug__inspect-tabs :deep(.rs-tabs--line.rs-tabs--sm .rs-tabs__trigger) {
  min-height: 0;
  height: 100%;
  padding: 0 0.65rem;
  font-size: var(--rs-font-size-xs);
}

.nm-vast-debug__inspect-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nm-vast-debug__inspect-body :deep(.rs-table),
.nm-vast-debug__inspect-body :deep(.rs-empty) {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}

.nm-vast-debug__bp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-xs);
  width: 100%;
}

.nm-vast-debug__output {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.nm-vast-debug__output-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--rs-border-subtle, rgba(127, 127, 127, 0.12));
}

.nm-vast-debug__output-hint {
  color: var(--rs-muted);
  font-size: 0.7rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-vast-debug__output-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.nm-vast-debug__output-section--trace {
  flex: 0 1 auto;
  max-height: 40%;
  border-top: 1px solid var(--rs-border-subtle, rgba(127, 127, 127, 0.12));
}

.nm-vast-debug__output-section-title {
  flex-shrink: 0;
  padding: 0.2rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--rs-muted);
}

.nm-vast-debug__output-log {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0.4rem 0.6rem;
  overflow: auto;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: 0.75rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.nm-vast-debug__output-log--muted {
  color: var(--rs-muted);
  max-height: 8rem;
}

.nm-vast-debug__watch {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: var(--rs-space-xs);
}

.nm-vast-debug__watch-add {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
  padding: 0 var(--rs-space-xs);
}

.nm-vast-debug__watch-input {
  flex: 1 1 auto;
  min-width: 0;
}

.nm-vast-debug__watch-expr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-xs);
  width: 100%;
  min-width: 0;
}

.nm-vast-debug__watch-expr-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
}

.nm-vast-debug__watch-err {
  color: var(--rs-danger, #b91c1c);
}
</style>
