export interface CefQueryRequest {
  request: string
  onSuccess: (response: string) => void
  onFailure: (code: number, message: string) => void
}

declare global {
  interface Window {
    cefQuery?: (req: CefQueryRequest) => void
    niuma?: { ready?: boolean; mode?: string }
  }

  // CEF 注入到 renderer 全局；用 globalThis 访问以兼容 lint 与多环境
  var cefQuery: ((req: CefQueryRequest) => void) | undefined
  var niuma: { ready?: boolean; mode?: string } | undefined
}

export {}
