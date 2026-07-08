import { keymap } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { clearGhostCompletion, setGhostCompletion } from './code-mirror-ghost'
import { posToLineColumn } from './code-mirror-intel'

export interface CodeMirrorCompletionHandlers {
  completionRequest?: (prefix: string, suffix: string, line: number, column: number) => Promise<string | null>
}

export function codeMirrorCompletionExtensions(handlers: () => CodeMirrorCompletionHandlers): Extension[] {
  return [
    keymap.of([
      {
        key: 'Ctrl-Space',
        mac: 'Cmd-Space',
        run: (view) => {
          const h = handlers()
          if (!h.completionRequest) return false
          clearGhostCompletion(view)
          const pos = view.state.selection.main.head
          const prefix = view.state.doc.sliceString(0, pos)
          const suffix = view.state.doc.sliceString(pos)
          const { line, column } = posToLineColumn(view, pos)
          void h.completionRequest(prefix, suffix, line, column).then((text) => {
            if (!text?.trim()) return
            const latestPos = view.state.selection.main.head
            if (view.state.doc.sliceString(latestPos) !== suffix) return
            view.dispatch({
              changes: { from: latestPos, to: latestPos, insert: text },
              selection: { anchor: latestPos + text.length },
              effects: setGhostCompletion.of(null),
            })
            view.focus()
          })
          return true
        },
      },
    ]),
  ]
}
