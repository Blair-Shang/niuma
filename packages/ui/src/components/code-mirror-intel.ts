import { EditorView, hoverTooltip } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

export interface CodeMirrorIntelHandlers {
  hoverRequest?: (line: number, column: number) => Promise<string | null>
  definitionRequest?: (line: number, column: number) => Promise<{
    file: string
    line: number
    column?: number
  } | null>
  currentFilePath?: string
  onGotoDefinition?: (loc: { file: string; line: number; column?: number }) => void
}

export function posToLineColumn(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos)
  return {
    line: line.number,
    column: pos - line.from + 1,
  }
}

export function goToPosition(view: EditorView, line: number, column = 1) {
  const doc = view.state.doc
  const ln = Math.min(Math.max(1, line), doc.lines)
  const lineObj = doc.line(ln)
  const pos = lineObj.from + Math.max(0, column - 1)
  view.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
  })
  view.focus()
}

export function codeMirrorIntelExtensions(handlers: () => CodeMirrorIntelHandlers): Extension[] {
  const hoverExt = hoverTooltip(
    async (view, pos) => {
      const h = handlers()
      if (!h.hoverRequest) return null
      const { line, column } = posToLineColumn(view, pos)
      const text = await h.hoverRequest(line, column)
      if (!text?.trim()) return null
      return {
        pos,
        above: true,
        create() {
          const dom = document.createElement('div')
          dom.className = 'rs-code-editor__hover'
          dom.textContent = text
          return { dom }
        },
      }
    },
    { hoverTime: 450 },
  )

  const clickExt = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.ctrlKey && !event.metaKey) return false
      const h = handlers()
      if (!h.definitionRequest) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos == null) return false
      const { line, column } = posToLineColumn(view, pos)
      void h.definitionRequest(line, column).then((loc) => {
        if (!loc?.line) return
        const current = (h.currentFilePath ?? '').replace(/\\/g, '/')
        const target = (loc.file ?? '').replace(/\\/g, '/')
        if (target && current && target !== current) {
          h.onGotoDefinition?.(loc)
          return
        }
        goToPosition(view, loc.line, loc.column ?? 1)
      })
      event.preventDefault()
      return true
    },
  })

  return [hoverExt, clickExt]
}
