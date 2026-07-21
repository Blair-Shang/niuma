<script setup lang="ts">
import * as monaco from 'monaco-editor'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { applyMonacoDebugDecorations } from '../monaco/debug-decorations'
import type { MonacoLanguage } from '../monaco/languages'
import {
  ensureMongodbShellLanguage,
  MONACO_MONGODB_SHELL_LANGUAGE,
  MONACO_PGSQL_LANGUAGE,
} from '../monaco/languages'
/** VS Code 式调试装饰样式（断点 / 当前行）；业务组件勿再自定义 glyph CSS */
import '../monaco/debug-decorations.css'

/** 实例级补全片段（仅作用于当前编辑器 Model）。 */
export interface MonacoCompletionSnippet {
  label: string
  insertText: string
  detail?: string
  documentation?: string
  filterText?: string
  sortText?: string
  kind?: 'snippet' | 'keyword' | 'property' | 'field' | 'function' | 'value'
  preselect?: boolean
}

/** MonacoCompletionContext 描述一次补全请求的编辑器上下文。 */
export interface MonacoCompletionContext {
  text: string
  offset: number
  line: number
  column: number
  prefix: string
  triggerCharacter?: string
}

/** MonacoCompletionRequest 按当前文本和光标位置返回实例级候选。 */
export type MonacoCompletionRequest = (
  context: MonacoCompletionContext,
) => MonacoCompletionSnippet[] | Promise<MonacoCompletionSnippet[]>

/** 补全前缀解析：由业务侧按方言注入，默认按标识符切词。 */
export type MonacoCompletionPrefixResolver = (linePrefix: string) => string

const props = withDefaults(
  defineProps<{
    language?: MonacoLanguage
    /** px 整数或 CSS 字符串如 '100%' / '20rem' */
    height?: number | string
    readonly?: boolean
    /** 深色/浅色主题：auto 跟随 data-rs-theme 属性 */
    theme?: 'auto' | 'vs-dark' | 'light'
    /** 是否显示 minimap */
    minimap?: boolean
    /**
     * 是否显示 glyph margin（VS Code 式断点槽）。
     * Monaco 无完整 DAP；断点/当前行靠 glyphMargin + decorations（与 VS Code 同源）。
     */
    glyphMargin?: boolean
    /**
     * 调试：当前执行行（1-based）。与 debugBreakpoints 一并交给公共装饰层渲染。
     */
    debugCurrentLine?: number
    /** 调试：断点行号列表（1-based，编辑器行号） */
    debugBreakpoints?: number[]
    /** 嵌入面板：无边框/圆角，铺满父级（调试/源码等） */
    embedded?: boolean
    /**
     * JSON Schema 对象（仅 language="json" 有效）。
     * 每个编辑器实例使用独立的 Model URI，schema 通过 fileMatch 精确绑定，
     * 不会污染其他 JSON 编辑器。
     */
    jsonSchema?: object
    /** 实例级补全片段（language="json" 时 Ctrl+Space / 触发字符生效）。 */
    snippets?: MonacoCompletionSnippet[]
    /** 按光标上下文动态生成候选；设置后与 snippets 合并。 */
    completionRequest?: MonacoCompletionRequest
    /** 自动触发动态补全的字符。 */
    completionTriggerCharacters?: string[]
    /**
     * 自定义补全前缀（决定替换范围）。
     * 默认按标识符字符切词；Mongo Shell / SQL 等方言由业务 composable 注入，勿写进本组件。
     */
    completionPrefixResolver?: MonacoCompletionPrefixResolver
  }>(),
  {
    language: 'json',
    height: '100%',
    readonly: false,
    theme: 'auto',
    minimap: false,
    glyphMargin: false,
    debugCurrentLine: 0,
    debugBreakpoints: () => [],
    embedded: false,
    completionTriggerCharacters: () => ['"', '$', '{', ':', ','],
  },
)

const emit = defineEmits<{
  /** glyph 槽点击（仅 glyphMargin=true）；业务据此切换断点 */
  glyphMarginClick: [line: number]
}>()

const model = defineModel<string>({ default: '' })

const editorEl = ref<HTMLElement | null>(null)

let editor: monaco.editor.IStandaloneCodeEditor | null = null
let editorModel: monaco.editor.ITextModel | null = null
/** 每个实例的唯一 schema URI，用于 fileMatch 精确匹配，避免全局污染 */
let schemaUri = ''
let snippetDisposable: monaco.IDisposable | null = null
let glyphClickDisposable: monaco.IDisposable | null = null
let debugDecoIds: string[] = []
let suppressChange = false
let unmounted = false

function syncDebugDecorations(): void {
  if (!editor || !props.glyphMargin) {
    if (editor && debugDecoIds.length) {
      debugDecoIds = editor.deltaDecorations(debugDecoIds, [])
    }
    return
  }
  debugDecoIds = applyMonacoDebugDecorations(editor, monaco, debugDecoIds, {
    currentLine: props.debugCurrentLine ?? 0,
    breakpointLines: props.debugBreakpoints ?? [],
  })
}

function bindGlyphClick(): void {
  glyphClickDisposable?.dispose()
  glyphClickDisposable = null
  if (!editor || !props.glyphMargin) return
  glyphClickDisposable = editor.onMouseDown((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
    const line = e.target.position?.lineNumber
    if (!line) return
    emit('glyphMarginClick', line)
  })
}

// ── Theme ──────────────────────────────────────────────────────────────
function resolveTheme(): string {
  if (props.theme !== 'auto') return props.theme
  return document.documentElement.dataset['rsTheme'] === 'light' ? 'light' : 'vs-dark'
}

function applyTheme(): void {
  monaco.editor.setTheme(resolveTheme())
}

// ── JSON Schema ─────────────────────────────────────────────────────────
/**
 * 将当前 jsonSchema 应用到 JSON Language Defaults。
 * Monaco v0.55+ 使用顶层 `monaco.json` 命名空间（原 `monaco.languages.json` 已废弃）。
 * 每实例使用独立 schemaUri，通过 fileMatch 精确绑定，不污染其他编辑器。
 */
function applyJsonSchema(): void {
  if (props.language !== 'json') return

  // monaco.json 是 v0.55 的顶层 JSON 命名空间
  const defaults = monaco.json.jsonDefaults
  const existing = defaults.diagnosticsOptions
  const schemas = (existing.schemas ?? []).filter(
    (s: { uri: string }) => s.uri !== schemaUri,
  )

  if (props.jsonSchema && schemaUri) {
    schemas.push({
      uri: schemaUri,
      fileMatch: [schemaUri],
      schema: props.jsonSchema,
    })
  }

  defaults.setDiagnosticsOptions({ ...existing, validate: true, schemas })
}

function removeJsonSchema(): void {
  if (!schemaUri) return
  const defaults = monaco.json.jsonDefaults
  const existing = defaults.diagnosticsOptions
  const schemas = (existing.schemas ?? []).filter((s: { uri: string }) => s.uri !== schemaUri)
  defaults.setDiagnosticsOptions({ ...existing, schemas })
}

function disposeSnippets(): void {
  snippetDisposable?.dispose()
  snippetDisposable = null
}

function completionKind(kind: MonacoCompletionSnippet['kind']): monaco.languages.CompletionItemKind {
  switch (kind) {
    case 'keyword': return monaco.languages.CompletionItemKind.Keyword
    case 'property': return monaco.languages.CompletionItemKind.Property
    case 'field': return monaco.languages.CompletionItemKind.Field
    case 'function': return monaco.languages.CompletionItemKind.Function
    case 'value': return monaco.languages.CompletionItemKind.Value
    default: return monaco.languages.CompletionItemKind.Snippet
  }
}

function completionPrefix(line: string): string {
  if (props.completionPrefixResolver) {
    return props.completionPrefixResolver(line)
  }
  // 默认：按标识符字符向前切词（与 JSON / 多数脚本方言够用）
  let start = line.length
  while (start > 0 && /[\w$.-]/.test(line[start - 1] ?? '')) start -= 1
  return line.slice(start)
}

function completionLanguages(): string[] {
  // pgsql 等由 monaco-sql-languages 自己的 completionService 接管，勿再注册实例级 Provider
  if (props.language === MONACO_PGSQL_LANGUAGE) {
    return []
  }
  if (
    props.language === 'javascript' ||
    props.language === 'typescript' ||
    props.language === MONACO_MONGODB_SHELL_LANGUAGE ||
    props.language === 'plaintext' ||
    props.language === 'sql' ||
    props.language === 'yaml'
  ) {
    return [props.language]
  }
  if (props.language === 'json') {
    return ['json']
  }
  return []
}

function applySnippets(): void {
  disposeSnippets()
  const languages = completionLanguages()
  if (
    languages.length === 0 ||
    !editorModel ||
    (!props.snippets?.length && !props.completionRequest)
  ) return

  const modelUri = editorModel.uri.toString()
  for (const language of languages) {
    snippetDisposable = monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: props.completionTriggerCharacters,
      async provideCompletionItems(model, position, context, token) {
        if (model.uri.toString() !== modelUri) {
          return { suggestions: [] }
        }
        const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
        const prefix = completionPrefix(linePrefix)
        const startColumn = position.column - prefix.length
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn,
          endColumn: position.column,
        }
        const dynamic = props.completionRequest
          ? await props.completionRequest({
              text: model.getValue(),
              offset: model.getOffsetAt(position),
              line: position.lineNumber,
              column: position.column,
              prefix,
              triggerCharacter: context.triggerCharacter,
            })
          : []
        if (token.isCancellationRequested) return { suggestions: [] }
        const snippets = [...(props.snippets ?? []), ...dynamic]
        return {
          incomplete: true,
          suggestions: snippets.map((snippet) => ({
            label: snippet.label,
            kind: completionKind(snippet.kind),
            insertText: snippet.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: snippet.detail,
            documentation: snippet.documentation,
            filterText: snippet.filterText ?? snippet.label,
            sortText: snippet.sortText,
            preselect: snippet.preselect,
            range,
          })),
        }
      },
    })
  }
}

function disposeEditor(): void {
  removeJsonSchema()
  disposeSnippets()
  glyphClickDisposable?.dispose()
  glyphClickDisposable = null
  debugDecoIds = []
  editor?.dispose()
  editorModel?.dispose()
  editor = null
  editorModel = null
}

// ── Editor ──────────────────────────────────────────────────────────────
function initEditor(): void {
  if (!editorEl.value || unmounted) return

  disposeEditor()

  if (props.language === MONACO_MONGODB_SHELL_LANGUAGE) {
    ensureMongodbShellLanguage(monaco)
  }

  // 为每个实例生成唯一 URI，使 JSON Schema 精准匹配
  schemaUri = `inmemory://rs-monaco/${crypto.randomUUID()}.json`

  editorModel = monaco.editor.createModel(
    model.value,
    props.language,
    props.language === 'json' ? monaco.Uri.parse(schemaUri) : undefined,
  )

  editor = monaco.editor.create(editorEl.value, {
    model: editorModel,
    theme: resolveTheme(),
    readOnly: props.readonly,
    automaticLayout: true,
    minimap: { enabled: props.minimap },
    scrollBeyondLastLine: false,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace",
    fontSize: 13,
    lineHeight: 20,
    tabSize: 2,
    wordWrap: 'on',
    bracketPairColorization: { enabled: true },
    padding: { top: 8, bottom: 8 },
    renderLineHighlight: 'gutter',
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    folding: true,
    glyphMargin: props.glyphMargin,
    // 行号区域仅保留 3 位宽度（≤999 行绰绰有余），减少左侧空白
    lineNumbersMinChars: 3,
    // glyph 断点 + linesDecorations 执行箭头时需留出装饰槽宽度
    lineDecorationsWidth: props.glyphMargin ? 16 : 4,
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    // Shell：业务 completionRequest；pgsql：monaco-sql-languages Worker；避免 wordBased 抢补全
    quickSuggestions: props.language === MONACO_MONGODB_SHELL_LANGUAGE
      ? { other: true, comments: false, strings: true }
      : true,
    suggestOnTriggerCharacters: true,
    wordBasedSuggestions:
      props.language === MONACO_MONGODB_SHELL_LANGUAGE ||
      props.language === MONACO_PGSQL_LANGUAGE
        ? 'off'
        : 'currentDocument',
    suggest: {
      snippetsPreventQuickSuggestions: false,
      // pgsql catalog 已按前缀检索；关闭宽松模糊，避免短前缀下列表「看起来像乱匹配」
      filterGraceful: props.language !== MONACO_PGSQL_LANGUAGE,
      matchOnWordStartOnly: props.language === MONACO_PGSQL_LANGUAGE,
    },
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
    },
    // Find Widget 等溢出控件使用 fixed 定位，避免被 overflow:hidden 裁剪
    fixedOverflowWidgets: true,
  })

  editorModel.onDidChangeContent(() => {
    if (suppressChange) return
    const value = editorModel?.getValue() ?? ''
    if (value !== model.value) model.value = value
  })

  applyJsonSchema()
  applySnippets()
  bindGlyphClick()
  syncDebugDecorations()
}

// ── Lifecycle ──────────────────────────────────────────────────────────
let themeObserver: MutationObserver | null = null

onMounted(() => {
  unmounted = false
  initEditor()
  themeObserver = new MutationObserver(applyTheme)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-rs-theme'],
  })
})

onUnmounted(() => {
  unmounted = true
  glyphClickDisposable?.dispose()
  glyphClickDisposable = null
  debugDecoIds = []
  disposeEditor()
  themeObserver?.disconnect()
  themeObserver = null
})

// ── Watchers ──────────────────────────────────────────────────────────
watch(
  () => model.value,
  (val) => {
    if (!editorModel) return
    if (editorModel.getValue() === val) return
    suppressChange = true
    editorModel.setValue(val)
    suppressChange = false
  },
)

watch(() => props.readonly, (val) => editor?.updateOptions({ readOnly: val }))
watch(() => props.minimap, (val) => editor?.updateOptions({ minimap: { enabled: val } }))
watch(
  () => props.glyphMargin,
  (val) => {
    editor?.updateOptions({
      glyphMargin: val,
      lineDecorationsWidth: val ? 16 : 4,
    })
    bindGlyphClick()
    syncDebugDecorations()
  },
)
watch(
  () => [props.debugCurrentLine, props.debugBreakpoints] as const,
  () => {
    syncDebugDecorations()
  },
  { deep: true },
)
watch(() => props.language, () => initEditor())
watch(() => props.jsonSchema, () => applyJsonSchema(), { deep: true })
watch(() => props.snippets, () => applySnippets(), { deep: true })
watch(() => props.completionRequest, () => applySnippets())
watch(() => props.completionTriggerCharacters, () => applySnippets(), { deep: true })
watch(() => props.completionPrefixResolver, () => applySnippets())

// ── Expose ────────────────────────────────────────────────────────────
defineExpose({
  /** 格式化文档（等价于 Shift+Alt+F） */
  format(): void {
    editor?.getAction('editor.action.formatDocument')?.run().catch(() => undefined)
  },
  getEditor(): monaco.editor.IStandaloneCodeEditor | null {
    return editor
  },
  /** 将指定行滚入视口中央（调试当前行） */
  revealLine(line: number): void {
    if (!editor || line <= 0) return
    editor.revealLineInCenter(line)
  },
})
</script>

<template>
  <div
    ref="editorEl"
    class="rs-monaco"
    :class="{ 'rs-monaco--embedded': embedded }"
    :style="{ height: typeof height === 'number' ? `${height}px` : height }"
  />
</template>

<style scoped>
.rs-monaco {
  /* hover tooltip 的定位上下文；勿加 overflow:hidden，否则会裁剪 Find Widget 的 tooltip */
  position: relative;
  width: 100%;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface-elevated);
}

.rs-monaco--embedded {
  border: 0;
  border-radius: 0;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

:deep(.monaco-editor) {
  border-radius: inherit;
}

:deep(.monaco-editor .overflow-guard) {
  border-radius: inherit;
  overflow: hidden;
}

/* Find Widget z-index:35；Monaco hover 内联 z-index≈2575，层级本身足够 */
:deep(.monaco-editor .find-widget) {
  z-index: 40;
}
</style>
