/**
 * 例程调试外壳：工具栏 / 参数网格 / 源码+巡视分栏 / 状态条。
 * 方言侧注入 labels 与交互；通过 #source / #inspect 挂编辑器与巡视内容。
 */

/** 调试会话状态（展示徽章；具体状态机由方言实现） */
export type DebugShellState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'finished'
  | 'aborted'
  | 'error'

/** 状态徽章色调 */
export type DebugShellStateTone = 'idle' | 'paused' | 'running' | 'ended'

/** 参数网格行（与 Vastbase RoutineCallParam / MySQL 形参对齐） */
export interface DebugShellParamRow {
  index: number
  name: string
  type: string
  /** in / out / inout / variadic（展示用，可选） */
  mode?: string
  value: string
  isNull: boolean
}

/** 外壳文案（方言 i18n 注入） */
export interface DebugShellLabels {
  toolbarLabel: string
  noTarget: string
  start: string
  continue: string
  next: string
  step: string
  finish: string
  abort: string
  paramsTitle: string
  noParams: string
  paramsPreview: string
  colParamName: string
  colParamType: string
  colParamValue: string
  paramValuePh: string
  sourceTitle: string
  bpHint: string
  unavailable: string
}
