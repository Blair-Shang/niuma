import { cloudFetch } from './client'

export type UpdateRelease = {
  product: string
  channel: string
  platform: string
  arch: string
  version: string
  title: string
  notesMd: string
  downloadUrl: string
  sha256: string
  fileSize: number
  minSupportedVersion?: string
  forceUpdate?: boolean
  publishedAt?: string
}

export type UpdateCheckResult = {
  updateAvailable: boolean
  forceUpdate: boolean
  current: string
  latest: UpdateRelease | null
}

export type UpdateCheckParams = {
  current: string
  platform: string
  arch: string
  product?: string
  channel?: string
}

export type UpdateLatestParams = {
  platform: string
  arch: string
  product?: string
  channel?: string
}

function updateQuery(params: UpdateLatestParams & { current?: string }): string {
  const q = new URLSearchParams()
  q.set('platform', params.platform)
  q.set('arch', params.arch)
  if (params.current) q.set('current', params.current)
  if (params.product) q.set('product', params.product)
  if (params.channel) q.set('channel', params.channel)
  return q.toString()
}

/** 公开检查更新；失败由调用方吞掉（启动检查勿打扰）。 */
export function checkAppUpdate(params: UpdateCheckParams): Promise<UpdateCheckResult> {
  return cloudFetch<UpdateCheckResult>(`/api/v1/updates/check?${updateQuery(params)}`)
}

/** 最新已发布版本元数据（含更新说明）；无发布时 404。 */
export function fetchLatestRelease(params: UpdateLatestParams): Promise<UpdateRelease> {
  return cloudFetch<UpdateRelease>(`/api/v1/updates/latest?${updateQuery(params)}`)
}
