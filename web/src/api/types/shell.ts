/** `ping` Bridge 响应 */
export interface PingResult {
  /** 固定为 `true` 表示 Bridge 可用 */
  pong: boolean
}

/** `shell.version` Bridge 响应 */
export interface ShellVersion {
  /** 语义化版本号 */
  version: string
  /** 架构分层标识（Shell 固定为 3） */
  layer?: number
  /** 构建渠道，如 `cef` */
  build?: string
}

/** `shell.info` Bridge 响应 */
export interface ShellInfo {
  /** 运行时类型，CEF 壳内为 `cef` */
  runtime: string
  /** 宿主操作系统标识 */
  platform: string
  /** 安装目录绝对路径（可为空） */
  installDir: string
  /** Web 资源根 URL，如 `app://niuma/` */
  webPath: string
  /** 是否无边框；Web 据此显示自绘窗口按钮 */
  frameless?: boolean
}
