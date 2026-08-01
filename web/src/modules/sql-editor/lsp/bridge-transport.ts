/**
 * Bridge 隧道化 LSP 传输：上行 mysql.lsp.rpc，下行 mysql.lsp 事件。
 */
import { subscribeBridgeEventByPrefix } from '@/api/event-bus'
import type { JsonRpcMessage, SqlLspBridgeApi } from './types'

export type LspServerMessageHandler = (message: JsonRpcMessage) => void

/**
 * 订阅 `{ns}.lsp` 事件；仅转发匹配 connectionId 的 JSON-RPC 消息。
 */
export function subscribeLspEvents(
  namespace: string,
  connectionId: string,
  onMessage: LspServerMessageHandler,
): () => void {
  const typeExact = `${namespace}.lsp`
  return subscribeBridgeEventByPrefix(typeExact, (detail) => {
    if (typeof detail !== 'object' || detail === null) return
    const ev = detail as {
      type?: string
      connectionId?: string
      message?: JsonRpcMessage
    }
    if (ev.type !== typeExact) return
    if (ev.connectionId !== connectionId) return
    if (!ev.message || typeof ev.message !== 'object') return
    onMessage(ev.message)
  })
}

/** 经 Bridge 发送一帧 JSON-RPC，并解析服务端回包中的 message。 */
export async function lspRpcRoundTrip(
  api: SqlLspBridgeApi,
  connectionId: string,
  sessionId: string,
  message: JsonRpcMessage,
): Promise<JsonRpcMessage | null> {
  const result = await api.lspRpc({ connectionId, sessionId, message })
  if (result?.message) return result.message
  return null
}
