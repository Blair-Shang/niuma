/**
 * SQL Server 查询编辑器：Bridge LSP（sqlserverparser）+ 静默回退。
 */
import { computed, nextTick, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  resolveMonacoLanguageFromProfile,
  type SqlServerProfile,
} from '@/modules/sql-editor/capabilities'
import type { SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { useSqlQueryEditor } from '@/modules/database/composables/useSqlQueryEditor'
import {
  attachSqlServerSqlLsp,
  bootstrapSqlServerMonaco,
} from '@/modules/sqlserver/monaco-bootstrap'

let sharedBootstrapped = false
let editorSeq = 0

export function useSqlServerSqlEditor(options: {
  sqlText: Ref<string>
  active: () => boolean
  onRun: () => void
  getSuggestScope?: () => SqlSuggestScope | null
  getDialect?: () => SqlServerProfile | null
}) {
  const bootstrapped = ref(sharedBootstrapped)
  const editorId = `sqlserver-editor-${++editorSeq}`
  let detachLsp: (() => void) | null = null
  let attachGen = 0
  let unmounted = false

  const editor = useSqlQueryEditor({
    sqlText: options.sqlText,
    active: options.active,
    onRun: options.onRun,
    getSuggestScope: options.getSuggestScope,
    getDialect: options.getDialect,
    editSource: 'sqlserver-sql-edit',
    prepareLanguage: async () => {
      await bootstrapSqlServerMonaco()
      sharedBootstrapped = true
      bootstrapped.value = true
    },
  })

  function clearDetach(): void {
    detachLsp?.()
    detachLsp = null
  }

  async function syncLspAttachment(): Promise<void> {
    const gen = ++attachGen
    clearDetach()

    const resolve = resolveMonacoLanguageFromProfile(options.getDialect?.() ?? null)
    if (!resolve.useLsp) return
    const scope = options.getSuggestScope?.() ?? null
    const sessionId = scope?.sessionId
    if (!sessionId || !options.active()) return

    let model = editor.editorRef.value?.getEditor?.()?.getModel() ?? null
    if (!model) {
      await nextTick()
      model = editor.editorRef.value?.getEditor?.()?.getModel() ?? null
    }
    if (!model) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      model = editor.editorRef.value?.getEditor?.()?.getModel() ?? null
    }
    if (!model || unmounted || gen !== attachGen) return

    const database = scope?.database?.trim() || undefined
    const schema = scope?.schema?.trim() || 'dbo'
    let detach: (() => void) | null = null
    try {
      detach = await attachSqlServerSqlLsp({
        model,
        sessionId,
        editorId,
        database,
        schema,
      })
    } catch (err) {
      console.warn('[sql-lsp] attach failed', err)
      detach = null
    }

    if (unmounted || gen !== attachGen) {
      detach?.()
      return
    }
    detachLsp = detach
  }

  watch(
    () => [
      editor.languageReady.value,
      editor.editorRef.value,
      options.getSuggestScope?.()?.sessionId ?? null,
      options.getSuggestScope?.()?.database ?? null,
      options.getSuggestScope?.()?.schema ?? null,
      options.active(),
    ],
    () => {
      void syncLspAttachment()
    },
    { flush: 'post', immediate: true },
  )

  onUnmounted(() => {
    unmounted = true
    attachGen += 1
    clearDetach()
  })

  const languageReady = computed(
    () => bootstrapped.value && editor.languageReady.value,
  )

  return {
    ...editor,
    languageReady,
  }
}
