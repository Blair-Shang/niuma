/**
 * 方言无关的 SQL 查询编辑器行为：选区、格式化 / 压缩、剪贴板、快捷键、补全作用域。
 * 方言差异通过 getDialect / prepareLanguage 注入，便于 MySQL / Vastbase / Oracle / PG 复用。
 */
import type { RsMonacoEditorExpose } from '@niuma/ui'
import { computed, nextTick, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  claimSuggestScope,
  clearSuggestScopeIfOwned,
} from '@/modules/sql-editor/completion/create-completion-service'
import type { SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import {
  Cap,
  hasCapability,
  resolveFormatterLanguage,
  resolveMonacoLanguageFromProfile,
  type ResolvedMonacoLanguageId,
  type SqlServerProfile,
} from '@/modules/sql-editor/capabilities'
import type { SqlDialect } from '@/modules/sql-editor/dialect'
import { useTabStore } from '@/stores/tab'
import {
  clearDiagnostic,
  clearEditorSelection,
  publishDiagnostic,
  publishEditorSelection,
} from '@/shell/panels/ai/workspace-context'

type MonacoEditorComponent = RsMonacoEditorExpose

export type SqlQueryEditorPrepareContext = {
  monacoLanguageId: ResolvedMonacoLanguageId
  monacoSqlLanguages: boolean
  useLsp: boolean
}

function formatDialectFromProfile(profile: SqlServerProfile | null | undefined): SqlDialect {
  const family = profile?.family
  if (family === 'mysql') return 'mysql'
  if (family === 'vastbase') return 'vastbase'
  if (family === 'oracle') return 'oracle'
  if (family === 'postgresql') return 'postgresql'
  if (family === 'sqlserver') return 'sqlserver'
  if (family === 'sqlite') return 'sqlite'
  if (family === 'dameng') return 'dameng'
  if (family === 'clickhouse') return 'clickhouse'
  if (family === 'kingbase') return 'kingbase'

  const lang = resolveFormatterLanguage(profile)
  if (lang === 'mysql') return 'mysql'
  if (lang === 'plsql') return 'vastbase'
  if (lang === 'transactsql') return 'sqlserver'
  if (lang === 'sqlite') return 'sqlite'
  return 'postgresql'
}

export function useSqlQueryEditor(options: {
  sqlText: Ref<string>
  active: () => boolean
  onRun: () => void
  getSuggestScope?: () => SqlSuggestScope | null
  getDialect?: () => SqlServerProfile | null
  /**
   * 方言侧语言包初始化（如 Vastbase pgsql Worker）。
   * 未提供时：非 sql-languages 路径立即就绪；sql-languages 路径标记就绪由调用方保证。
   */
  prepareLanguage?: (ctx: SqlQueryEditorPrepareContext) => Promise<void>
  /** Monaco executeEdits source 标记 */
  editSource?: string
  /** 是否同步 AI 选区上下文（默认 true） */
  syncAiSelection?: boolean
  /** 是否根据 Cap.EditorSuppressPgDiag 抑制 pgsql 诊断；默认按能力自动 */
  suppressPgDiagnostics?: boolean | (() => boolean)
  /** 抑制 pgsql 诊断的实现（方言注入，避免公共层依赖 vastbase） */
  bindPgDiagnosticsSuppress?: (model: unknown) => (() => void) | null
}) {
  const editorRef = ref<MonacoEditorComponent | null>(null)
  const hasSelection = ref(false)
  const languageReady = ref(false)
  const suggestOwner = Symbol('sql-query-suggest')
  const editSource = options.editSource ?? 'sql-query-edit'
  const syncAiSelection = options.syncAiSelection !== false

  const monacoResolve = computed(() =>
    resolveMonacoLanguageFromProfile(options.getDialect?.() ?? null),
  )
  const sqlLanguage = computed((): ResolvedMonacoLanguageId => monacoResolve.value.monacoLanguageId)

  let runCommandDisposable: { dispose: () => void } | null = null
  let selectionDisposable: { dispose: () => void } | null = null
  let markersDisposable: { dispose: () => void } | null = null
  let stopSuppressDiagnostics: (() => void) | null = null

  function getEditor() {
    return editorRef.value?.getEditor() ?? null
  }

  function shouldSuppressPgDiag(): boolean {
    if (typeof options.suppressPgDiagnostics === 'function') {
      return options.suppressPgDiagnostics()
    }
    if (typeof options.suppressPgDiagnostics === 'boolean') {
      return options.suppressPgDiagnostics
    }
    return hasCapability(options.getDialect?.() ?? null, Cap.EditorSuppressPgDiag)
  }

  function bindDiagnosticsSuppress(): void {
    stopSuppressDiagnostics?.()
    stopSuppressDiagnostics = null
    if (!shouldSuppressPgDiag()) return
    const model = getEditor()?.getModel()
    if (!model || !options.bindPgDiagnosticsSuppress) return
    stopSuppressDiagnostics = options.bindPgDiagnosticsSuppress(model) ?? null
  }

  function syncSelectionFlag(): void {
    const editor = getEditor()
    const model = editor?.getModel()
    const sel = editor?.getSelection()
    const nonempty = Boolean(sel && !sel.isEmpty())
    hasSelection.value = nonempty
    if (!syncAiSelection || !options.active()) return
    if (editor && model && sel && nonempty) {
      const text = model.getValueInRange(sel)
      publishEditorSelection({
        tabId: useTabStore().activeTabId || undefined,
        text,
        language: 'sql',
        source: 'monaco',
      })
      return
    }
    clearEditorSelection(useTabStore().activeTabId || undefined)
  }

  function applySuggestScope(active: boolean): void {
    if (!active) {
      clearSuggestScopeIfOwned(suggestOwner)
      return
    }
    const scope = options.getSuggestScope?.() ?? null
    claimSuggestScope(suggestOwner, scope)
  }

  async function prepareSqlLanguage(): Promise<void> {
    const ctx: SqlQueryEditorPrepareContext = {
      monacoLanguageId: monacoResolve.value.monacoLanguageId,
      monacoSqlLanguages: monacoResolve.value.monacoSqlLanguages,
      useLsp: monacoResolve.value.useLsp,
    }
    if (options.prepareLanguage) {
      await options.prepareLanguage(ctx)
      languageReady.value = true
      return
    }
    // 默认：内置 sql / LSP 等路径无需 sql-languages Worker，直接就绪
    languageReady.value = true
  }

  void prepareSqlLanguage()
  watch(monacoResolve, () => {
    void prepareSqlLanguage()
  })

  watch(languageReady, async (ready) => {
    if (!ready || !options.active()) return
    applySuggestScope(true)
    await nextTick()
    bindEditorExtras()
    if (!runCommandDisposable) {
      requestAnimationFrame(() => bindEditorExtras())
    }
  }, { immediate: true })

  // 对象脚本等面板 Monaco 晚于 languageReady 挂载：editorRef 到位后再关原生右键并绑快捷键
  watch(
    () => editorRef.value,
    async (comp) => {
      if (!comp || !languageReady.value || !options.active()) return
      await nextTick()
      bindEditorExtras()
    },
  )

  function replaceSql(transform: (text: string) => string): void {
    const editor = getEditor()
    const model = editor?.getModel()
    if (!editor || !model) {
      const next = transform(options.sqlText.value)
      if (next !== options.sqlText.value) options.sqlText.value = next
      return
    }
    const sel = editor.getSelection()
    const range = sel && !sel.isEmpty() ? sel : model.getFullModelRange()
    const text = model.getValueInRange(range)
    const next = transform(text)
    if (next === text) return
    editor.pushUndoStop()
    editor.executeEdits(editSource, [{ range, text: next, forceMoveMarkers: true }])
    editor.pushUndoStop()
    options.sqlText.value = model.getValue()
    editor.focus()
  }

  async function formatSql(): Promise<void> {
    const { formatSql: formatSqlCore } = await import('@/modules/sql-editor/format')
    const dialect = formatDialectFromProfile(options.getDialect?.() ?? null)
    replaceSql((text) => formatSqlCore(text, { dialect }))
  }

  async function compressSql(): Promise<void> {
    const { compressSql: compressSqlCore } = await import('@/modules/sql-editor/format')
    replaceSql(compressSqlCore)
  }

  function copyEditor(): void {
    const editor = getEditor()
    if (!editor) return
    editor.focus()
    editor.trigger('contextmenu', 'editor.action.clipboardCopyAction', null)
  }

  async function pasteEditor(): Promise<void> {
    const editor = getEditor()
    if (!editor) return
    editor.focus()
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        const sel = editor.getSelection()
        const model = editor.getModel()
        if (sel && model) {
          editor.pushUndoStop()
          editor.executeEdits(`${editSource}-paste`, [
            { range: sel, text, forceMoveMarkers: true },
          ])
          editor.pushUndoStop()
          options.sqlText.value = model.getValue()
        }
        return
      }
    } catch {
      // fall through
    }
    editor.trigger('contextmenu', 'editor.action.clipboardPasteAction', null)
  }

  /** 有非空选区则执行选区，否则全文（与 Navicat / DBeaver 一致） */
  function resolveSql(): string {
    const editor = getEditor()
    const model = editor?.getModel()
    const sel = editor?.getSelection()
    if (editor && model && sel && !sel.isEmpty()) {
      const text = model.getValueInRange(sel).trim()
      if (text) return text
    }
    return options.sqlText.value.trim()
  }

  function markersDiagId(): string {
    const tabId = useTabStore().activeTabId || 'session'
    return `diag:sql-markers:${tabId}`
  }

  async function syncSqlMarkersDiagnostic(): Promise<void> {
    if (!options.active()) return
    const editor = getEditor()
    const model = editor?.getModel()
    if (!editor || !model) {
      clearDiagnostic(markersDiagId())
      return
    }
    try {
      const monaco = await import('monaco-editor')
      const markers = monaco.editor
        .getModelMarkers({ resource: model.uri })
        .filter((m) => m.severity >= monaco.MarkerSeverity.Warning)
        .slice(0, 12)
      if (!markers.length) {
        clearDiagnostic(markersDiagId())
        return
      }
      const text = markers
        .map((m) => {
          const sev = m.severity >= monaco.MarkerSeverity.Error ? 'error' : 'warning'
          return `L${m.startLineNumber}:${m.startColumn} [${sev}] ${m.message}`
        })
        .join('\n')
      publishDiagnostic({
        id: markersDiagId(),
        label: `SQL 诊断 ${markers.length} 条`,
        detail: 'monaco markers',
        text,
        tabId: useTabStore().activeTabId || undefined,
        kind: 'sql_markers',
      })
    } catch {
      // ignore
    }
  }

  function disposeExtras(): void {
    runCommandDisposable?.dispose()
    selectionDisposable?.dispose()
    markersDisposable?.dispose()
    runCommandDisposable = null
    selectionDisposable = null
    markersDisposable = null
    stopSuppressDiagnostics?.()
    stopSuppressDiagnostics = null
  }

  function bindEditorExtras(): void {
    disposeExtras()
    const editor = getEditor()
    if (!editor) return

    editor.updateOptions({ contextmenu: false })
    bindDiagnosticsSuppress()

    const enterKeyCode = 3
    const keyF = 36
    runCommandDisposable = editor.onKeyDown((e) => {
      if ((e.ctrlKey || e.metaKey) && e.keyCode === enterKeyCode) {
        e.preventDefault()
        e.stopPropagation()
        options.onRun()
        return
      }
      if (e.shiftKey && e.altKey && e.keyCode === keyF) {
        e.preventDefault()
        e.stopPropagation()
        void formatSql()
      }
    })
    selectionDisposable = editor.onDidChangeCursorSelection(() => {
      syncSelectionFlag()
    })
    void import('monaco-editor').then((monaco) => {
      markersDisposable = monaco.editor.onDidChangeMarkers((uris) => {
        const model = getEditor()?.getModel()
        if (!model || !options.active()) return
        const uri = model.uri.toString()
        if (!uris.some((u) => u.toString() === uri)) return
        void syncSqlMarkersDiagnostic()
      })
      void syncSqlMarkersDiagnostic()
    })
    syncSelectionFlag()
  }

  async function onActiveChange(active: boolean): Promise<void> {
    const editor = getEditor()
    applySuggestScope(active)
    if (!active) {
      disposeExtras()
      if (syncAiSelection) {
        clearEditorSelection(useTabStore().activeTabId || undefined)
      }
      clearDiagnostic(markersDiagId())
      editor?.updateOptions({ automaticLayout: false })
      return
    }
    editor?.updateOptions({ automaticLayout: true })
    editor?.layout()
    await prepareSqlLanguage()
    await nextTick()
    bindEditorExtras()
    if (!runCommandDisposable) {
      requestAnimationFrame(() => bindEditorExtras())
    }
  }

  function refreshSuggestScope(): void {
    if (!options.active()) return
    applySuggestScope(true)
  }

  onUnmounted(() => {
    applySuggestScope(false)
    disposeExtras()
    if (syncAiSelection) {
      clearEditorSelection(useTabStore().activeTabId || undefined)
    }
    clearDiagnostic(markersDiagId())
  })

  return {
    editorRef,
    hasSelection,
    languageReady,
    sqlLanguage,
    prepareSqlLanguage,
    formatSql,
    compressSql,
    copyEditor,
    pasteEditor,
    resolveSql,
    bindEditorExtras,
    onActiveChange,
    refreshSuggestScope,
    disposeExtras,
    syncSelectionFlag,
    syncSqlMarkersDiagnostic,
  }
}
