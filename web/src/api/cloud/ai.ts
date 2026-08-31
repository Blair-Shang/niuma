import { cloudFetch } from './client'

/** 云端系统模型目录（登录后拉取，供本机写入 niuma-system）。 */
export interface CloudAiCatalogModel {
  code: string
  label: string
}

export interface CloudAiCatalog {
  enabled: boolean
  providerName?: string
  defaultModel?: string
  models?: CloudAiCatalogModel[]
  dailyRequestLimit?: number
  dailyTokenLimit?: number
  requestsUsed?: number
  tokensUsed?: number
}

export function fetchAiCatalog(accessToken: string): Promise<CloudAiCatalog> {
  return cloudFetch<CloudAiCatalog>('/api/v1/ai/catalog', { accessToken })
}
