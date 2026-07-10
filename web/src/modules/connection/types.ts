import type { ProxyType, TunnelType } from '@/api/types/connection'

/** 连接表单中的代理字段（字符串端口便于绑定输入框） */
export interface ProxyFormState {
  proxyType: ProxyType
  proxyHost: string
  proxyPort: string
  proxyUsername: string
  proxyPassword: string
}

/** 连接表单中的隧道字段。 */
export interface TunnelFormState {
  tunnelType: TunnelType
  tunnelSshProfileId: string
  tunnelTargetHost: string
  tunnelTargetPort: string
}

/** 连接测试反馈 */
export interface ConnectionTestMessage {
  ok: boolean
  text: string
}

export type ConnectionFormMode = 'create' | 'edit'
