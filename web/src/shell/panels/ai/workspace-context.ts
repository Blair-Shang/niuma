/**
 * AI 工作区上下文注册表：Monaco 选区、查询诊断等（供 @ 引用 / askSelection）。
 *
 * 编辑器侧主动 publish；context-pack 读取，不依赖 DOM Selection。
 */

export interface AiEditorSelectionSnapshot {
  tabId?: string
  text: string
  language?: string
  source: 'monaco' | 'dom' | 'terminal'
  updatedAt: number
}

export interface AiDiagnosticSnapshot {
  id: string
  label: string
  detail?: string
  text: string
  tabId?: string
  kind?: string
  updatedAt: number
}

let editorSelection: AiEditorSelectionSnapshot | null = null
const diagnostics = new Map<string, AiDiagnosticSnapshot>()

/** 发布当前编辑器选区；传 null / 空文本则清除。 */
export function publishEditorSelection(
  snap: Omit<AiEditorSelectionSnapshot, 'updatedAt' | 'source'> & {
    source?: AiEditorSelectionSnapshot['source']
  } | null,
): void {
  if (!snap || !snap.text.trim()) {
    editorSelection = null
    return
  }
  const text = snap.text.trim()
  if (text.length > 8000) {
    editorSelection = {
      tabId: snap.tabId,
      text: text.slice(0, 8000),
      language: snap.language,
      source: snap.source ?? 'monaco',
      updatedAt: Date.now(),
    }
    return
  }
  editorSelection = {
    tabId: snap.tabId,
    text,
    language: snap.language,
    source: snap.source ?? 'monaco',
    updatedAt: Date.now(),
  }
}

/** 读取最近一次 Monaco/注册表选区。 */
export function getEditorSelection(): AiEditorSelectionSnapshot | null {
  return editorSelection
}

/** 按 tab 清除选区（面板失活时）。 */
export function clearEditorSelection(tabId?: string): void {
  if (!editorSelection) {
    return
  }
  if (!tabId || editorSelection.tabId === tabId) {
    editorSelection = null
  }
}

/** 发布或更新一条诊断（报错 / Explain 失败等）。 */
export function publishDiagnostic(
  snap: Omit<AiDiagnosticSnapshot, 'updatedAt'>,
): void {
  const text = snap.text.trim()
  if (!text) {
    diagnostics.delete(snap.id)
    return
  }
  diagnostics.set(snap.id, {
    ...snap,
    text: text.length > 4000 ? text.slice(0, 4000) : text,
    label: snap.label.trim() || 'diagnostic',
    updatedAt: Date.now(),
  })
}

/** 清除诊断；不传 id 则清空全部。 */
export function clearDiagnostic(id?: string): void {
  if (!id) {
    diagnostics.clear()
    return
  }
  diagnostics.delete(id)
}

/** 列出当前诊断（按时间倒序，最多 8 条）。 */
export function listDiagnostics(): AiDiagnosticSnapshot[] {
  return [...diagnostics.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)
}
