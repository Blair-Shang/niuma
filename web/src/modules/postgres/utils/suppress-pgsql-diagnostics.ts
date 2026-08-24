/**
 * monaco-sql-languages 的 dt-sql-parser 按标准 PG 校验。
 * 官方 PostgreSQL 默认不抑制诊断；本工具仅在 Cap.EditorSuppressPgDiag 开启时使用。
 */
import type { editor as MonacoEditor } from 'monaco-editor'

const MARKER_OWNER = 'pgsql'

export function suppressPgsqlDiagnostics(
  model: MonacoEditor.ITextModel | null | undefined,
): () => void {
  if (!model) return () => undefined

  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  async function clear(): Promise<void> {
    if (disposed) return
    const monaco = await import('monaco-editor')
    if (disposed) return
    const markers = monaco.editor.getModelMarkers({ resource: model!.uri })
    const hasOwned = markers.some((m) => m.owner === MARKER_OWNER)
    if (!hasOwned) return
    monaco.editor.setModelMarkers(model!, MARKER_OWNER, [])
  }

  void clear()

  let disposable: { dispose: () => void } | null = null
  void import('monaco-editor').then((monaco) => {
    if (disposed) return
    disposable = monaco.editor.onDidChangeMarkers((uris) => {
      if (disposed) return
      if (!uris.some((u) => u.toString() === model.uri.toString())) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void clear()
      }, 0)
    })
  })

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    disposable?.dispose()
    disposable = null
  }
}
