/**
 * Postgres 查询编辑器：Bridge LSP（postgresparser）+ 静默回退。
 *
 * LSP attach 用代数令牌串行化：仅最后一次生效；卸载或抢占时立即 dispose。
 */
import { computed, nextTick, onUnmounted, ref, watch, type Ref } from 'vue'
import {
  resolveMonacoLanguageFromProfile,
  type SqlServerProfile,
} from '@/modules/sql-editor/capabilities'
import type { SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { useSqlQueryEditor } from '@/modules/database/composables/useSqlQueryEditor'
import {
  attachPostgresSqlLsp,
  bootstrapPostgresMonaco,
} from '@/modules/postgres/monaco-bootstrap'

/** 多面板共用：bootstrapPostgresMonaco 内部已幂等 */
let sharedBootstrapped = false
let editorSeq = 0

export function usePostgresSqlEditor(options: {
  sqlText: Ref<string>
  active: () => boolean
  onRun: () => void
  getSuggestScope?: () => SqlSuggestScope | null
  getDialect?: () => SqlServerProfile | null
}) {
  const bootstrapped = ref(sharedBootstrapped)
  const editorId = `postgres-editor-${++editorSeq}`
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
    editSource: 'postgres-sql-edit',
    prepareLanguage: async () => {
      await bootstrapPostgresMonaco()
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

    // 与 MySQL 对齐：database=PG 库；schema=命名空间（缺省 public）
    const database = scope?.database?.trim() || undefined
    const schema = scope?.schema?.trim() || 'public'
    let detach: (() => void) | null = null
    try {
      detach = await attachPostgresSqlLsp({
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
