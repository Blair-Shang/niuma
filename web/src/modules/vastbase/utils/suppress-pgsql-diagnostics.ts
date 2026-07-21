/**
 * monaco-sql-languages 的 dt-sql-parser 按标准 PG 校验。
 * Vastbase 过程体为 openGauss PL/SQL（AS/IS、DECLARE、:=、END IF），会产生误报红线。
 * 查询 / 源码 / 调试面板共用：保留高亮与补全，屏蔽该模型上的 pgsql diagnostics。
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
      // Worker 诊断约 500ms debounce；稍后清掉误报
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
