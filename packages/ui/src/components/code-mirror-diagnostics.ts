import { Compartment, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import type { RsCodeEditorDiagnostic } from './code-editor-utils'

const setDiagnosticsEffect = StateEffect.define<RsCodeEditorDiagnostic[]>()

function buildLineDecorations(doc: { lines: number; line: (n: number) => { from: number } }, diags: RsCodeEditorDiagnostic[]) {
  const builder = new RangeSetBuilder<Decoration>()
  for (const d of diags) {
    const lineNo = d.line ?? 1
    if (lineNo < 1 || lineNo > doc.lines) continue
    const line = doc.line(lineNo)
    const cls =
      d.severity === 'warning'
        ? 'cm-lintRange cm-lintRange-warning'
        : d.severity === 'info'
          ? 'cm-lintRange cm-lintRange-info'
          : 'cm-lintRange cm-lintRange-error'
    builder.add(line.from, line.from, Decoration.line({ class: cls }))
  }
  return builder.finish()
}

const diagnosticField = StateField.define({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiagnosticsEffect)) {
        return buildLineDecorations(tr.state.doc, e.value)
      }
    }
    if (tr.docChanged) {
      return deco.map(tr.changes)
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

export const diagnosticCompartment = new Compartment()

export function diagnosticExtensions() {
  return diagnosticCompartment.of([diagnosticField])
}

export function setEditorDiagnostics(view: EditorView, diags: RsCodeEditorDiagnostic[]) {
  view.dispatch({
    effects: setDiagnosticsEffect.of(diags),
  })
}
