import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, WidgetType } from '@codemirror/view'
import { posToLineColumn } from './code-mirror-intel'

export const setGhostCompletion = StateEffect.define<string | null>()

interface GhostMeta {
  text: string
  pos: number
}

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }

  eq(other: GhostWidget) {
    return other.text === this.text
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'rs-code-editor__ghost'
    span.textContent = this.text
    return span
  }

  ignoreEvent() {
    return true
  }
}

const ghostMetaField = StateField.define<GhostMeta | null>({
  create() {
    return null
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhostCompletion)) {
        if (!effect.value) return null
        return { text: effect.value, pos: tr.state.selection.main.head }
      }
    }
    if (tr.docChanged) return null
    if (tr.selection && !tr.effects.some((e) => e.is(setGhostCompletion))) {
      return null
    }
    return value
  },
})

const ghostField = StateField.define<ReturnType<typeof Decoration.set>>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setGhostCompletion)) {
        if (!effect.value) return Decoration.none
        const pos = tr.state.selection.main.head
        return Decoration.set([
          Decoration.widget({
            widget: new GhostWidget(effect.value),
            side: 1,
          }).range(pos),
        ])
      }
    }
    if (tr.docChanged || tr.selection) {
      const hasSet = tr.effects.some((e) => e.is(setGhostCompletion))
      if (!hasSet) return Decoration.none
    }
    return deco
  },
  provide: (field) => EditorView.decorations.from(field),
})

export interface CodeMirrorGhostHandlers {
  completionRequest?: (prefix: string, suffix: string, line: number, column: number) => Promise<string | null>
}

function readGhostAtCursor(view: EditorView): GhostMeta | null {
  const meta = view.state.field(ghostMetaField, false)
  if (!meta) return null
  if (meta.pos !== view.state.selection.main.head) return null
  return meta
}

export function codeMirrorGhostExtensions(
  handlers: () => CodeMirrorGhostHandlers,
  scheduleDebounced: (fn: () => void) => void,
  cancelScheduled?: () => void,
): Extension[] {
  let seq = 0
  return [
    ghostMetaField,
    ghostField,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      const h = handlers()
      if (!h.completionRequest) return
      cancelScheduled?.()
      const id = ++seq
      scheduleDebounced(() => {
        const view = update.view
        const pos = view.state.selection.main.head
        const prefix = view.state.doc.sliceString(0, pos)
        const suffix = view.state.doc.sliceString(pos)
        const { line, column } = posToLineColumn(view, pos)
        void h.completionRequest!(prefix, suffix, line, column).then((text) => {
          if (id !== seq) return
          if (!text?.trim()) {
            view.dispatch({ effects: setGhostCompletion.of(null) })
            return
          }
          const current = view.state.selection.main.head
          if (view.state.doc.sliceString(current) !== suffix) return
          view.dispatch({ effects: setGhostCompletion.of(text) })
        })
      })
    }),
    Prec.highest(
      keymap.of([
        {
          key: 'Tab',
          run: (view) => {
            const ghost = readGhostAtCursor(view)
            if (!ghost) return false
            cancelScheduled?.()
            seq += 1
            const pos = view.state.selection.main.head
            view.dispatch({
              changes: { from: pos, to: pos, insert: ghost.text },
              selection: { anchor: pos + ghost.text.length },
              effects: setGhostCompletion.of(null),
            })
            return true
          },
        },
        {
          key: 'Escape',
          run: (view) => {
            if (!readGhostAtCursor(view)) return false
            cancelScheduled?.()
            seq += 1
            view.dispatch({ effects: setGhostCompletion.of(null) })
            return true
          },
        },
      ]),
    ),
  ]
}

export function clearGhostCompletion(view: EditorView) {
  view.dispatch({ effects: setGhostCompletion.of(null) })
}
