/**
 * Monaco 0.55+ 与旧语言包（monaco-sql-languages 等）的 createWebWorker 兼容。
 *
 * 0.55 起 `editor.createWebWorker` 只接受 `{ worker, host?, keepIdleModels? }`；
 * 旧包仍传 `{ moduleId, label, createData }`，会导致 `'then' in undefined`，
 * 并回退到主线程 EditorWorker（无 doValidation）。
 *
 * 入口包 `monaco-editor`（editor.main）另导出顶层 `createWebWorker`（workers.js），
 * 可将旧参数适配为新的 worker Promise 协议。
 */
const PATCH_KEY = '__rsMonacoCreateWebWorkerCompat'

/** 幂等：在 setupLanguageFeatures / createWebWorker(moduleId) 之前调用。 */
export function patchMonacoCreateWebWorkerCompat(
  monaco: typeof import('monaco-editor'),
): void {
  const editorBag = monaco.editor as typeof monaco.editor & {
    [PATCH_KEY]?: boolean
  }
  if (editorBag[PATCH_KEY]) return

  const createLegacy = monaco.createWebWorker
  if (typeof createLegacy !== 'function') {
    console.warn(
      '[monaco] missing monaco.createWebWorker；无法兼容 monaco-sql-languages（请确认从 monaco-editor 主入口导入）',
    )
    return
  }

  const original = monaco.editor.createWebWorker.bind(monaco.editor)
  monaco.editor.createWebWorker = ((opts: { worker?: unknown }) => {
    if (opts && Object.hasOwn(opts, 'worker') && opts.worker != null) {
      return original(opts as Parameters<typeof original>[0])
    }
    return createLegacy(opts as Parameters<typeof createLegacy>[0])
  }) as typeof monaco.editor.createWebWorker

  editorBag[PATCH_KEY] = true
}
