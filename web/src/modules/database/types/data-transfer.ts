/** 方言无关的数据传输任务日志行（CSV / SQL dump·exec 共用）。 */
export interface DataTransferLogLine {
  phase: string
  message: string
  ok?: boolean
  outputPath?: string
  at: number
}

/** Shell / Panel 文案由方言注入，便于 MySQL / Vastbase / Oracle 复用同一套 UI。 */
export interface DataTransferShellLabels {
  dockToBottom: string
  popOut: string
  cancelTask: string
  close: string
  confirm: string
}

export interface DataTransferPanelLabels {
  progressLog: string
  progressEmpty: string
  running: string
}

export interface DataTransferFileFieldLabels {
  filePath: string
  browse: string
}
