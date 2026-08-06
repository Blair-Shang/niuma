import { bridgeInvoke, bridgeOnEvent } from '@/api/client'

export type ShellUpdateDownloadResult = {
  path: string
  bytes: number
}

export type ShellUpdateProgress = {
  type: 'shell.update.download.progress'
  received: number
  total: number
}

/** 受限下载安装包（Platform 执行；HTTPS + host allowlist + SHA-256）。 */
export function shellUpdateDownload(params: {
  url: string
  sha256: string
  expectedSize?: number
}): Promise<ShellUpdateDownloadResult> {
  return bridgeInvoke<ShellUpdateDownloadResult>('shell.update.download', params)
}

export function shellUpdateVerify(params: { path: string; sha256: string }): Promise<{ ok: boolean }> {
  return bridgeInvoke<{ ok: boolean }>('shell.update.verify', params)
}

export function shellUpdateApply(params: { path: string }): Promise<{ applied: boolean }> {
  return bridgeInvoke<{ applied: boolean }>('shell.update.apply', params)
}

export function shellUpdateCancel(): Promise<{ cancelled: boolean }> {
  return bridgeInvoke<{ cancelled: boolean }>('shell.update.cancel', {})
}

export function onShellUpdateProgress(handler: (p: ShellUpdateProgress) => void): () => void {
  return bridgeOnEvent((detail) => {
    const d = detail as ShellUpdateProgress
    if (d && d.type === 'shell.update.download.progress') handler(d)
  })
}
