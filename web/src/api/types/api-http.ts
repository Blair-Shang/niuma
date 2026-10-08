/** api.http.exchange：TLS、重定向和 Cookie 由 api-service 完成。 */

export interface ApiHttpHeader {
  name: string
  value: string
}

export interface ApiHttpCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  hostOnly: boolean
  expires?: string
}

export interface ApiHttpRedirect {
  status: number
  url: string
}

export interface ApiHttpFormPart {
  name: string
  value?: string
  filePath?: string
}

export interface ApiHttpExchangeParams {
  cancelId?: string
  method: string
  url: string
  headers?: ApiHttpHeader[]
  body?: string
  timeoutMs?: number
  followRedirects?: boolean
  insecure?: boolean
  cookies?: ApiHttpCookie[]
  parts?: ApiHttpFormPart[]
  proxy?: string
  certPath?: string
  keyPath?: string
  ntlmUser?: string
  ntlmPassword?: string
  ntlmDomain?: string
}

export interface ApiHttpExchangeResult {
  status: number
  statusText: string
  protocol: string
  finalUrl: string
  headers: ApiHttpHeader[]
  body: string
  bodyBase64?: string
  binary: boolean
  sizeBytes: number
  durationMs: number
  redirects: ApiHttpRedirect[]
  cookies: ApiHttpCookie[]
}

export interface ApiHttpCancelParams {
  cancelId: string
}

export interface ApiHttpCancelResult {
  cancelled: boolean
}
