/** 文件打开规格（各模块 → Platform 文件工作台） */
export interface FileOpenSpec {
  provider: string
  label?: string
  readonly?: boolean
  context: Record<string, unknown>
}

/** `platform.fileEditor.openTab` 返回 */
export interface FileEditorOpenTabResult {
  /** create：需打开首个工作台；queue：工作台创建中，仅入队；append：聚焦已有窗口 */
  action: 'create' | 'queue' | 'append'
  windowId?: number
}

/** `platform.fileEditor.registerWindow` 入参 */
export interface FileEditorRegisterWindowParams {
  windowId: number
}

/** `platform.fileEditor.registerWindow` 返回 */
export interface FileEditorRegisterWindowResult {
  windowId: number
  pending: FileOpenSpec[]
}

/** `platform.fileEditor.unregisterWindow` 入参 */
export interface FileEditorUnregisterWindowParams {
  /** 可选；仅当与已注册窗口 id 一致时才注销 */
  windowId?: number
}
