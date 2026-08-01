/**
 * 浏览过滤条：CodeMirror SQL 字段补全是否打开。
 * 打开时 Enter 应交给编辑器接受选项，不能触发「应用过滤」。
 * 仅在 Enter 键处理路径调用，开销可忽略。
 */
export function isBrowseFilterCompletionOpen(ev: KeyboardEvent): boolean {
  const target = ev.target
  if (target instanceof HTMLElement) {
    // 补全对话框打开时，CM 会在 .cm-content 上挂 aria-haspopup / aria-controls
    if (target.getAttribute('aria-haspopup') === 'listbox') return true
    if (target.hasAttribute('aria-activedescendant')) return true
    const editor = target.closest('.cm-editor')
    if (editor?.querySelector('.cm-tooltip-autocomplete, ul[role="listbox"][aria-expanded="true"]')) {
      return true
    }
  }
  return Boolean(document.querySelector('.cm-tooltip-autocomplete'))
}
