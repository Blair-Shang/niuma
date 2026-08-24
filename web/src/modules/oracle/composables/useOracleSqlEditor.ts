/**
 * Oracle 查询编辑器：薄包装公共 useSqlQueryEditor，注入 oracle LSP 语言 + 文档绑定。
 *
 * LSP attach 用代数令牌串行化：仅最后一次生效；卸载或抢占时立即 dispose，避免竞态泄漏。
 */
import { computed, nextTick, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  resolveMonacoLanguageFromProfile,
  type SqlServerProfile,
} from '@/modules/sql-editor/capabilities'
import type { SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { useSqlQueryEditor } from '@/modules/database/composables/useSqlQueryEditor'
import {
  attachOracleSqlLsp,
  bootstrapOracleMonaco,
} from '@/modules/oracle/monaco-bootstrap'

/** 多面板共用：bootstrapOracleMonaco 内部已幂等 */
let sharedBootstrapped = false
let editorSeq = 0

export function useOracleSqlEditor(options: {
  sqlText: Ref<string>
  active: () => boolean
  onRun: () => void
  getSuggestScope?: () => SqlSuggestScope | null
  getDialect?: () => SqlServerProfile | null
}) {
  const bootstrapped = ref(sharedBootstrapped)
  const editorId = `oracle-editor-${++editorSeq}`
  let detachLsp: (() => void) | null = null
  /** 每次 sync / unmount 递增；await 返回后若代数过期则丢掉结果并 dispose */
  let attachGen = 0
  let unmounted = false

  const editor = useSqlQueryEditor({
    sqlText: options.sqlText,
    active: options.active,
    onRun: options.onRun,
    getSuggestScope: options.getSuggestScope,
    getDialect: options.getDialect,
    editSource: 'oracle-sql-edit',
    prepareLanguage: async () => {
      await bootstrapOracleMonaco()
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

    // Oracle：协议 database 字段承载当前 schema
    const database = scope?.schema?.trim() || scope?.database?.trim() || undefined
    let detach: (() => void) | null = null
    try {
      detach = await attachOracleSqlLsp({
        model,
        sessionId,
        editorId,
        database,
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
