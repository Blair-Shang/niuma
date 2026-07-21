/**
 * Vastbase 查询编辑器：选区、格式化 / 压缩、剪贴板、Ctrl+Enter、SQL 对象补全作用域。
 * 编辑器行为读会话 Capability（如 editor.suppress_pg_diagnostics），禁止写死 if vastbase。
 */
import { RsMonacoEditor } from '@niuma/ui'
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
import { vastbaseCatalogClient } from '@/modules/vastbase/completion/catalog-client'
import { suppressPgsqlDiagnostics } from '@/modules/vastbase/utils/suppress-pgsql-diagnostics'
import { useTabStore } from '@/stores/tab'
import {
  clearDiagnostic,
  clearEditorSelection,
  publishDiagnostic,
  publishEditorSelection,
} from '@/shell/panels/ai/workspace-context'

type MonacoEditorComponent = InstanceType<typeof RsMonacoEditor>

/** 多面板共用：仅首次注册带 catalog 的 completionService（pgsql Worker 路径） */
let sharedLanguagePromise: Promise<void> | null = null
let sharedLanguageReady = false

export function useVastSqlEditor(options: {
  sqlText: Ref<string>
  active: () => boolean
  onRun: () => void
  getSuggestScope?: () => SqlSuggestScope | null
  /** 会话方言能力；缺省不 suppress、格式化走 plsql 默认 */
  getDialect?: () => SqlServerProfile | null
}) {
  const editorRef = ref<MonacoEditorComponent | null>(null)
  const hasSelection = ref(false)
  const languageReady = ref(sharedLanguageReady)
  const suggestOwner = Symbol('vast-sql-suggest')
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

  function bindDiagnosticsSuppress(): void {
    stopSuppressDiagnostics?.()
    stopSuppressDiagnostics = null
    // genericsql 路径已无 pgsql Worker；仍清残留 markers 作兜底
    if (!hasCapability(options.getDialect?.() ?? null, Cap.EditorSuppressPgDiag)) return
    const model = getEditor()?.getModel()
    if (!model) return
    stopSuppressDiagnostics = suppressPgsqlDiagnostics(model)
  }

  function syncSelectionFlag(): void {
    const editor = getEditor()
    const model = editor?.getModel()
    const sel = editor?.getSelection()
    const nonempty = Boolean(sel && !sel.isEmpty())
    hasSelection.value = nonempty
    if (!options.active()) {
      return
    }
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

  function prepareSqlLanguage(): Promise<void> {
    // 有 suppress 能力时不挂 pgsql Worker，直接内置 sql
    if (!monacoResolve.value.monacoSqlLanguages) {
      languageReady.value = true
      return Promise.resolve()
    }
    if (sharedLanguageReady) {
      languageReady.value = true
      return Promise.resolve()
    }
    if (!sharedLanguagePromise) {
      sharedLanguagePromise = (async () => {
        const [{ ensureVastbasePgsqlLanguage }, monaco, sqlLang, completion] =
          await Promise.all([
            import('@/modules/sql-editor/monaco/pgsql'),
            import('monaco-editor'),
            import('monaco-sql-languages'),
            import('@/modules/sql-editor/completion/create-completion-service'),
          ])
        const service = completion.createSqlCatalogCompletionService(
          vastbaseCatalogClient,
          sqlLang.defaultCompletionService,
          monaco.languages.CompletionItemKind,
        )
        await ensureVastbasePgsqlLanguage(service)
        sharedLanguageReady = true
        languageReady.value = true
      })().catch((err) => {
        sharedLanguagePromise = null
        throw err
      })
    }
    return sharedLanguagePromise.then(() => {
      languageReady.value = true
    })
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
  })

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
    editor.executeEdits('vast-sql-edit', [{ range, text: next, forceMoveMarkers: true }])
    editor.pushUndoStop()
    options.sqlText.value = model.getValue()
    editor.focus()
  }

  async function formatSql(): Promise<void> {
    const { formatSql: formatSqlCore } = await import('@/modules/sql-editor/format')
    const dialectLang = resolveFormatterLanguage(options.getDialect?.() ?? null)
    replaceSql((text) =>
      formatSqlCore(text, {
        dialect: dialectLang === 'plsql' ? 'vastbase' : 'postgresql',
      }),
    )
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
          editor.executeEdits('vast-sql-paste', [{ range: sel, text, forceMoveMarkers: true }])
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
    if (!options.active()) {
      return
    }
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
      // ignore marker sync failures
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
        if (!model || !options.active()) {
          return
        }
        const uri = model.uri.toString()
        if (!uris.some((u) => u.toString() === uri)) {
          return
        }
        // pgsql Worker 误报已 suppress；仅同步仍残留的真实 markers（若有）
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
      clearEditorSelection(useTabStore().activeTabId || undefined)
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
    clearEditorSelection(useTabStore().activeTabId || undefined)
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
