import { bridgeInvoke } from '@/api/client'
import type {
  PingResult,
  ShellInfo,
  ShellOpenExternalParams,
  ShellOpenExternalResult,
  ShellVersion,
} from '@/api/types/shell'

/** Shell 元信息与连通性（`ping` / `shell.version` / `shell.info`） */
export const shellApi = {
  /**
   * 探测 Shell Bridge 是否在线。
   *
   * @returns `{ pong: true }` 表示连通
   */
  ping(): Promise<PingResult> {
    return bridgeInvoke<PingResult>('ping')
  },

  /**
   * 读取 Shell 版本与构建信息。
   *
   * @returns 版本号及 layer / build 等元数据
   */
  getVersion(): Promise<ShellVersion> {
    return bridgeInvoke<ShellVersion>('shell.version')
  },

  /**
   * 读取运行时环境信息（平台、Web 路径、是否无边框等）。
   *
   * @returns Shell 安装与 chrome 配置摘要
   */
  getInfo(): Promise<ShellInfo> {
    return bridgeInvoke<ShellInfo>('shell.info')
  },

  /**
   * 使用系统默认浏览器打开 http(s) 链接（不占用 CEF 窗口）。
   *
   * @param params - 目标 URL
   */
  openExternal(params: ShellOpenExternalParams): Promise<ShellOpenExternalResult> {
    return bridgeInvoke<ShellOpenExternalResult>('shell.openExternal', params)
  },
} as const
