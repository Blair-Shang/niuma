import { cloudFetch } from './client'

export type UpdateRelease = {
  product: string
  channel: string
  platform: string
  arch: string
  version: string
  title: string
  notesMd: string
  notesExcerpt?: string
  notesTruncated?: boolean
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

/** 已发布版本目录（无全文）。单条完整说明请用 fetchPublishedRelease。 */
export async function fetchReleaseHistory(
  params: UpdateLatestParams & { limit?: number; offset?: number },
): Promise<UpdateRelease[]> {
  const q = new URLSearchParams(updateQuery(params))
  if (params.limit && params.limit > 0) {
    q.set('limit', String(params.limit))
  }
  if (params.offset && params.offset > 0) {
    q.set('offset', String(params.offset))
  }
  const data = await cloudFetch<{ items?: UpdateRelease[] }>(`/api/v1/updates/releases?${q}`)
  return Array.isArray(data.items) ? data.items : []
}

/** 某一已发布版本的完整说明。 */
export function fetchPublishedRelease(
  params: UpdateLatestParams & { version: string },
): Promise<UpdateRelease> {
  const q = new URLSearchParams(updateQuery(params))
  q.set('version', params.version)
  return cloudFetch<UpdateRelease>(`/api/v1/updates/releases?${q}`)
}

export type UpdateHitParams = {
  platform: string
  arch: string
  product?: string
  channel?: string
  version?: string
}

/** 记录一次拉起/下载安装包；失败由调用方吞掉。 */
export function recordUpdateHit(params: UpdateHitParams): Promise<{ ok: boolean; hits: number }> {
  return cloudFetch<{ ok: boolean; hits: number }>('/api/v1/updates/hit', {
    method: 'POST',
    body: JSON.stringify({
      platform: params.platform,
      arch: params.arch,
      product: params.product,
      channel: params.channel,
      version: params.version,
    }),
  })
}
