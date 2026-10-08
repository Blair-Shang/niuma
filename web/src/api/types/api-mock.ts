export interface ApiMockWireHeader {
  name: string
  value: string
}

export interface ApiMockWireRoute {
  id: string
  method: string
  path: string
  match: 'exact' | 'prefix'
  status: number
  headers: ApiMockWireHeader[]
  body: string
  delayMs: number
  script?: string
}

export interface ApiMockStartParams {
  serverId: string
  host: string
  port: number
  routes: ApiMockWireRoute[]
}

export interface ApiMockStartResult {
  serverId: string
  listenAddr: string
  port: number
}

export interface ApiMockServerParams {
  serverId: string
  routes?: ApiMockWireRoute[]
}

export interface ApiMockHit {
  at: string
  method: string
  path: string
  routeId?: string
  status: number
  matched: boolean
}
