import type { Component } from 'vue'
import type { ApiMethod, ApiRequest } from '../types'

/** 协议 kind。与目录 http/ tcp/ udp/ websocket 对齐；启动只登记 loader。 */
export type ApiPaneKind = 'http' | 'tcp' | 'udp' | 'websocket'

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

/** 启动即可读的协议元数据，对齐 CONN_KIND_DEFS；不含 Vue。 */
export interface ApiPaneKindDef {
  kind: ApiPaneKind
  icon: string
  labelKey: string
  methods: readonly ApiMethod[]
  creates?: readonly ApiPaneCreateAction[]
  applyDefaults: (req: ApiRequest, opts?: ApiPaneCreateOpts) => void
}

/** register() 写入的运行时：只负责解析工作台。 */
export interface ApiPaneRuntime {
  resolvePane: (scope: ApiPaneScope) => ApiPaneDescriptor
}

export interface ApiFeatureDef extends ApiPaneKindDef, ApiPaneRuntime {}
