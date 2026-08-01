/** SQL LSP（Bridge 隧道）共享类型。 */
export type JsonRpcId = string | number

export type JsonRpcMessage = {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type LspPosition = { line: number; character: number }

export type LspRange = { start: LspPosition; end: LspPosition }

export type LspDiagnostic = {
  range: LspRange
  severity?: number
  source?: string
  message: string
}

export type LspCompletionItem = {
  label: string
  kind?: number
  detail?: string
  insertText?: string
  documentation?: string
  sortText?: string
}

export type LspCompletionList = {
  isIncomplete?: boolean
  items: LspCompletionItem[]
}

/** textDocument/hover 精简结果 */
export type LspHover = {
  contents: string | { kind?: string; value: string }
  range?: LspRange
}

/** textDocument/documentSymbol 精简结果 */
export type LspDocumentSymbol = {
  name: string
  detail?: string
  kind: number
  range: LspRange
  selectionRange: LspRange
  children?: LspDocumentSymbol[]
}

/** textDocument/definition 位置 */
export type LspLocation = {
  uri: string
  range: LspRange
}

/** textDocument/signatureHelp */
export type LspParameterInformation = {
  label: string | [number, number]
  documentation?: string | { kind?: string; value: string }
}

export type LspSignatureInformation = {
  label: string
  documentation?: string | { kind?: string; value: string }
  parameters?: LspParameterInformation[]
}

export type LspSignatureHelp = {
  signatures: LspSignatureInformation[]
  activeSignature?: number
  activeParameter?: number
}

export type SqlLspBridgeApi = {
  lspOpen(params: {
    sessionId: string
    clientId: string
    database?: string
  }): Promise<{ connectionId: string }>
  lspRpc(params: {
    connectionId: string
    sessionId: string
    message: JsonRpcMessage
  }): Promise<{ ok?: boolean; message?: JsonRpcMessage }>
  lspClose(params: { connectionId: string; sessionId?: string }): Promise<{ closed: boolean }>
}

/** Document URI：niuma-sql://{ns}/{sessionId}/{editorId} */
export function buildSqlDocumentUri(namespace: string, sessionId: string, editorId: string): string {
  return `niuma-sql://${namespace}/${encodeURIComponent(sessionId)}/${encodeURIComponent(editorId)}`
}

export function parseSqlDocumentUri(
  uri: string,
): { namespace: string; sessionId: string; editorId: string } | null {
  if (!uri.startsWith('niuma-sql://')) return null
  const rest = uri.slice('niuma-sql://'.length)
  const parts = rest.split('/')
  if (parts.length < 3) return null
  const [namespace, sessionId, ...editorParts] = parts
  return {
    namespace: decodeURIComponent(namespace),
    sessionId: decodeURIComponent(sessionId),
    editorId: decodeURIComponent(editorParts.join('/')),
  }
}
