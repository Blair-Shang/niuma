import type { Component } from 'vue'
import type { ApiMethod, ApiRequest } from './types'

export type ApiPaneKind = 'http' | 'socket'

export interface ApiPaneCreateOpts {
  listen?: boolean
}

export interface ApiPaneCreateAction {
  method: ApiMethod
  labelKey: string
  icon: string
  /** 套接字：创建即监听（服务端），否则拨号（客户端）。 */
  listen?: boolean
  /** 新建请求的默认名称 i18n key。 */
  nameKey?: string
  children?: readonly ApiPaneCreateAction[]
}

/** 面板解析所需的静态范围。套接字按 listen 分流客户端 / 服务端面。 */
export interface ApiPaneScope {
  method?: ApiMethod
  listen?: boolean
}

/** 构造面板 props 的页签上下文。会话态由面板自己读 store，壳不拼回调。 */
export interface ApiPaneContext {
  request: ApiRequest
  requestId?: string
  tabId?: string
}

export interface ApiPaneDescriptor {
  loader: () => Promise<{ default: Component }>
  buildProps: (ctx: ApiPaneContext) => Record<string, unknown>
}

export interface ApiFeatureDef {
  icon: string
  labelKey: string
  methods: readonly ApiMethod[]
  creates?: readonly ApiPaneCreateAction[]
  applyDefaults: (req: ApiRequest, opts?: ApiPaneCreateOpts) => void
  resolvePane: (scope: ApiPaneScope) => ApiPaneDescriptor
}
