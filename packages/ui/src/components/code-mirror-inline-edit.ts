import { Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

export interface InlineEditTrigger {
  selection: string
  from: number
  to: number
}

/** 提取选区上下各若干行，供 Inline Edit 理解作用域（不含重复包裹选区）。 */
export function extractSurroundingContext(doc: string, from: number, to: number, lineRadius = 20): string {
  if (!doc) return ''
  const lines = doc.split('\n')
  let pos = 0
  let startLine = 0
  let endLine = lines.length - 1
  for (let i = 0; i < lines.length; i++) {
    const lineStart = pos
    const lineEnd = pos + lines[i].length
    if (from >= lineStart && from <= lineEnd + (i < lines.length - 1 ? 1 : 0)) startLine = i
    if (to >= lineStart && to <= lineEnd + (i < lines.length - 1 ? 1 : 0)) endLine = i
    pos = lineEnd + 1
  }
  const contextStart = Math.max(0, startLine - lineRadius)
  const contextEnd = Math.min(lines.length - 1, endLine + lineRadius)
  return lines.slice(contextStart, contextEnd + 1).join('\n')
}

export function codeMirrorInlineEditExtension(
  onTrigger: (view: EditorView, info: InlineEditTrigger) => void,
): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: 'Mod-k',
        run: (view) => {
          const { from, to } = view.state.selection.main
          if (from === to) return false
          const selection = view.state.sliceDoc(from, to)
          if (!selection.trim()) return false
          onTrigger(view, { selection, from, to })
          return true
        },
      },
    ]),
  )
}

export function replaceEditorRange(view: EditorView, from: number, to: number, insert: string) {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  })
  view.focus()
}
