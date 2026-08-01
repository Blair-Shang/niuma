/**
 * 薄 SQL LSP 客户端（前端侧）。
 *
 * 架构位置：
 *   Monaco Provider → SqlLspClient → Bridge(mysql.lsp.*) → 方言 service 内嵌 Language Server
 *
 * 本类只做协议薄封装，不做方言解析：
 *   - 上行：initialize / 文档同步 / completion / 自定义通知
 *   - 下行：经 subscribeLspEvents 收服务端通知（如 publishDiagnostics）
 *
 * 语法分析在服务端 DialectParser（MySQL=TiDB parser）完成；客户端只消费结果。
 */
import { lspRpcRoundTrip, subscribeLspEvents } from './bridge-transport'
import type {
  JsonRpcMessage,
  LspCompletionList,
  LspDocumentSymbol,
  LspHover,
  LspLocation,
  LspPosition,
  LspSignatureHelp,
  SqlLspBridgeApi,
} from './types'

/** 服务端 → 客户端通知回调（method + params）。 */
type NotifyHandler = (method: string, params: unknown) => void

/** 生成 lspOpen 的 clientId，便于日志区分多编辑器实例。 */
let clientSeq = 0

/**
 * 单个方言命名空间下的 LSP 会话客户端。
 * 同一 sessionId 可由上层复用一个实例（见 register-monaco-lsp acquireClient）。
 */
export class SqlLspClient {
  /** 方言命名空间，如 `mysql`；决定 Bridge 方法前缀与 languageId。 */
  readonly namespace: string
  private readonly api: SqlLspBridgeApi
  /** 服务端 lsp.open 返回的连接 id；RPC 均挂此连接。 */
  private connectionId: string | null = null
  /** 绑定的数据库会话 id（与 catalog / 默认库解析共用）。 */
  private sessionId: string | null = null
  /** JSON-RPC 请求 id 递增计数。 */
  private nextId = 1
  /** 是否已完成 initialize + initialized 握手。 */
  private initialized = false
  /** 取消 Bridge 事件订阅。 */
  private unsubEvents: (() => void) | null = null
  private readonly notifyHandlers = new Set<NotifyHandler>()

  constructor(namespace: string, api: SqlLspBridgeApi) {
    this.namespace = namespace
    this.api = api
  }

  /** 是否已 open 且持有 connectionId/sessionId（不保证已 initialize）。 */
  get connected(): boolean {
    return Boolean(this.connectionId && this.sessionId)
  }

  getConnectionId(): string | null {
    return this.connectionId
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  /**
   * 订阅服务端通知（典型：`textDocument/publishDiagnostics`）。
   * @returns 取消订阅函数
   */
  onNotification(handler: NotifyHandler): () => void {
    this.notifyHandlers.add(handler)
    return () => this.notifyHandlers.delete(handler)
  }

  /**
   * 打开 LSP 连接并完成握手。
   * 若已对同一 sessionId 初始化，则仅按需更新补全默认库，避免重复 open。
   *
   * @param sessionId 方言 service 会话
   * @param database  编辑器当前库（SuggestDatabase）；可空，服务端回退会话默认库
   */
  async connect(sessionId: string, database?: string): Promise<void> {
    if (this.connectionId && this.sessionId === sessionId && this.initialized) {
      if (database !== undefined) {
        await this.setSuggestDatabase(database)
      }
      return
    }
    await this.disconnect()
    const clientId = `web-${++clientSeq}`
    const db = database?.trim() || undefined
    console.info(
      `[sql-lsp] open dialect=${this.namespace} sessionId=${sessionId} clientId=${clientId} database=${db ?? ''}`,
    )
    const { connectionId } = await this.api.lspOpen({
      sessionId,
      clientId,
      database: db,
    })
    this.connectionId = connectionId
    this.sessionId = sessionId
    console.info(
      `[sql-lsp] ready dialect=${this.namespace} connectionId=${connectionId} sessionId=${sessionId}`,
    )
    // 下行诊断等通知：Bridge 事件 → 本客户端 handlers（Monaco markers）
    this.unsubEvents = subscribeLspEvents(this.namespace, connectionId, (msg) => {
      if (msg.method) {
        for (const h of this.notifyHandlers) {
          h(msg.method, msg.params)
        }
      }
    })
    await this.request('initialize', {
      processId: null,
      capabilities: {},
      clientInfo: { name: 'niuma-web', version: '0.1' },
    })
    await this.notify('initialized', {})
    this.initialized = true
  }

  /** 关闭 LSP 连接并清空本地状态；会话已关时忽略 lspClose 错误。 */
  async disconnect(): Promise<void> {
    const connectionId = this.connectionId
    const sessionId = this.sessionId
    const namespace = this.namespace
    this.unsubEvents?.()
    this.unsubEvents = null
    this.connectionId = null
    this.sessionId = null
    this.initialized = false
    if (connectionId) {
      console.info(
        `[sql-lsp] close dialect=${namespace} connectionId=${connectionId} sessionId=${sessionId ?? ''}`,
      )
      try {
        await this.api.lspClose({ connectionId, sessionId: sessionId ?? undefined })
      } catch {
        // 会话已关时忽略
      }
    }
  }

  /**
   * 打开文档。服务端会跑语法诊断并可能推送 publishDiagnostics。
   * Full sync：整份 text 随通知带上（非增量）。
   */
  async didOpen(uri: string, text: string, version = 1): Promise<void> {
    await this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: this.namespace === 'mysql' ? 'mysql' : this.namespace === 'dameng' ? 'dameng' : 'sql',
        version,
        text,
      },
    })
  }

  /**
   * 文档变更（Full textDocumentSync）。
   * 每次变更服务端重新诊断；前端侧通常防抖后再调用。
   */
  async didChange(uri: string, text: string, version: number): Promise<void> {
    await this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    })
  }

  /** 关闭文档；服务端清文档态并清空该 uri 的诊断。 */
  async didClose(uri: string): Promise<void> {
    await this.notify('textDocument/didClose', {
      textDocument: { uri },
    })
  }

  /**
   * 更新补全默认库（自定义通知 `niuma/setSuggestDatabase`）。
   * 传入 uri 时按文档隔离，避免同 session 多编辑器互相覆盖。
   * schema：金仓/PG 系默认 schema；MySQL/达梦可省略。
   */
  async setSuggestDatabase(database: string, uri?: string, schema?: string): Promise<void> {
    await this.notify('niuma/setSuggestDatabase', {
      database: database.trim(),
      ...(schema?.trim() ? { schema: schema.trim() } : {}),
      ...(uri ? { uri } : {}),
    })
  }

  /**
   * 请求补全。服务端按槽位合并关键字 / 片段 / catalog（schema·表·列）。
   * 兼容 LSP 两种返回：CompletionList 或 CompletionItem[]。
   */
  async completion(uri: string, position: LspPosition): Promise<LspCompletionList> {
    const result = await this.request('textDocument/completion', {
      textDocument: { uri },
      position,
    })
    if (!result || typeof result !== 'object') {
      return { items: [] }
    }
    const list = result as LspCompletionList | LspCompletionList['items']
    if (Array.isArray(list)) {
      return { items: list }
    }
    return {
      isIncomplete: Boolean(list.isIncomplete),
      items: Array.isArray(list.items) ? list.items : [],
    }
  }

  /**
   * 悬停信息（表/列类型说明）。无结果时返回 null。
   */
  async hover(uri: string, position: LspPosition): Promise<LspHover | null> {
    const result = await this.request('textDocument/hover', {
      textDocument: { uri },
      position,
    })
    if (!result || typeof result !== 'object') {
      return null
    }
    const hover = result as LspHover
    if (!hover.contents) {
      return null
    }
    return hover
  }

  /** 文档大纲（例程 / 顶层语句）。 */
  async documentSymbol(uri: string): Promise<LspDocumentSymbol[]> {
    const result = await this.request('textDocument/documentSymbol', {
      textDocument: { uri },
    })
    if (!Array.isArray(result)) {
      return []
    }
    return result as LspDocumentSymbol[]
  }

  /** 跳转定义；无结果时返回 null。 */
  async definition(uri: string, position: LspPosition): Promise<LspLocation | null> {
    const result = await this.request('textDocument/definition', {
      textDocument: { uri },
      position,
    })
    if (!result || typeof result !== 'object') {
      return null
    }
    const loc = result as LspLocation
    if (!loc.uri || !loc.range) {
      return null
    }
    return loc
  }

  /** 函数/过程签名提示；无结果时返回 null。 */
  async signatureHelp(uri: string, position: LspPosition): Promise<LspSignatureHelp | null> {
    const result = await this.request('textDocument/signatureHelp', {
      textDocument: { uri },
      position,
    })
    if (!result || typeof result !== 'object') {
      return null
    }
    const help = result as LspSignatureHelp
    if (!Array.isArray(help.signatures) || help.signatures.length === 0) {
      return null
    }
    return help
  }

  /** 带 id 的 JSON-RPC request；失败抛错。 */
  private async request(method: string, params: unknown): Promise<unknown> {
    this.assertConnected()
    const id = this.nextId++
    const message: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }
    const resp = await lspRpcRoundTrip(
      this.api,
      this.connectionId!,
      this.sessionId!,
      message,
    )
    if (!resp) {
      throw new Error(`lsp rpc empty response for ${method}`)
    }
    if (resp.error) {
      throw new Error(resp.error.message || `lsp error ${resp.error.code}`)
    }
    return resp.result
  }

  /** 无 id 的 JSON-RPC notification（Bridge 仍走 rpc 往返，但无 LSP result）。 */
  private async notify(method: string, params: unknown): Promise<void> {
    this.assertConnected()
    const message: JsonRpcMessage = {
      jsonrpc: '2.0',
      method,
      params,
    }
    await lspRpcRoundTrip(this.api, this.connectionId!, this.sessionId!, message)
  }

  private assertConnected(): void {
    if (!this.connectionId || !this.sessionId) {
      throw new Error('sql lsp not connected')
    }
  }
}
