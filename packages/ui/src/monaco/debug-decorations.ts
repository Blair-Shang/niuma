/**
 * Monaco 调试装饰：glyph 断点 + 行装饰箭头 + 整行高亮。
 * Monaco / VS Code 同源能力；业务只传行号，样式与 decoration 构造在本包。
 */
import type { editor as MonacoEditor } from 'monaco-editor'
import './debug-decorations.css'

export const RS_MONACO_DEBUG = {
  bpGlyph: 'rs-monaco-debug-bp',
  stackDeco: 'rs-monaco-debug-stack',
  currentLine: 'rs-monaco-debug-current-line',
} as const

export interface MonacoDebugDecorationState {
  /** 1-based 当前执行行；0 / 省略表示无 */
  currentLine?: number
  /** 1-based 断点行 */
  breakpointLines?: number[]
}

/** 构造调试 decorations（不调用 editor）。 */
export function buildMonacoDebugDecorations(
  monaco: typeof import('monaco-editor'),
  state: MonacoDebugDecorationState,
): MonacoEditor.IModelDeltaDecoration[] {
  const decos: MonacoEditor.IModelDeltaDecoration[] = []
  const stickiness = monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges

  for (const line of state.breakpointLines ?? []) {
    if (line <= 0) continue
    decos.push({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        glyphMarginClassName: RS_MONACO_DEBUG.bpGlyph,
        glyphMarginHoverMessage: { value: 'Breakpoint' },
        stickiness,
      },
    })
  }

  const cur = state.currentLine ?? 0
  if (cur > 0) {
    decos.push({
      range: new monaco.Range(cur, 1, cur, 1),
      options: {
        isWholeLine: true,
        className: RS_MONACO_DEBUG.currentLine,
        // 箭头放在 linesDecorations，比 glyph 更易与行号垂直对齐
        linesDecorationsClassName: RS_MONACO_DEBUG.stackDeco,
        overviewRuler: {
          color: 'rgba(245, 158, 11, 0.85)',
          position: monaco.editor.OverviewRulerLane.Center,
        },
        stickiness,
      },
    })
  }

  return decos
}

/** 应用调试装饰，返回新的 decoration ids。 */
export function applyMonacoDebugDecorations(
  editor: MonacoEditor.IStandaloneCodeEditor,
  monaco: typeof import('monaco-editor'),
  prevIds: string[],
  state: MonacoDebugDecorationState,
): string[] {
  return editor.deltaDecorations(prevIds, buildMonacoDebugDecorations(monaco, state))
}
