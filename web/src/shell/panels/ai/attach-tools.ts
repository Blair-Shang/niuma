/**
 * 按发生顺序安放工具卡片。
 *
 * 工具落在「前一段助手文字之后、后一段文字之前」。
 * 还没有助手文字时，留给流式气泡，出现在尚未落库的正文之前。
 * 已经能挂到某段助手文字上的工具留在原位，不跟进下一段思考。
 */

export interface AiToolMessageRef {
  messageId: string
  messageRole: string
  createdAt?: string
}

export interface AiToolRef {
  invocationId: string
  createdAt?: string
  runId?: string
}

export interface AiToolPlacement<T> {
  /** 出现在这段文字之前（先调用工具，再写回答）。 */
  before: T[]
  /** 出现在这段文字之后（先说明，再调用工具）。 */
  after: T[]
}

export function partitionAiTools<T extends AiToolRef>(
  messages: AiToolMessageRef[],
  tools: T[],
  opts: {
    streaming: boolean
    activeRunId: string | null
    liveIds: ReadonlySet<string>
  },
): { byMessageId: Map<string, AiToolPlacement<T>>; streaming: T[] } {
  const byMessageId = new Map<string, AiToolPlacement<T>>()
  const streaming: T[] = []
  if (!tools.length || !messages.length) {
    return { byMessageId, streaming }
  }

  const sorted = [...tools].sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt))
  for (const tool of sorted) {
    const target = placeTool(messages, tool)
    if (onStreamingBubble(tool, target, opts)) {
      streaming.push(tool)
      continue
    }
    if (!target) {
      continue
    }
    const slot = placementOf(byMessageId, target.messageId)
    slot[target.side].push(tool)
  }
  return { byMessageId, streaming }
}

function onStreamingBubble<T extends AiToolRef>(
  tool: T,
  target: { messageRole: string } | null,
  opts: { streaming: boolean; activeRunId: string | null; liveIds: ReadonlySet<string> },
): boolean {
  if (!opts.streaming || !opts.liveIds.has(tool.invocationId)) {
    return false
  }
  if (opts.activeRunId && tool.runId && tool.runId !== opts.activeRunId) {
    return false
  }
  // 已有助手文字可挂靠时留在那段前后。跟进流式气泡会把新思考画到已完成工具的上面。
  if (target?.messageRole === 'assistant') {
    return false
  }
  return true
}

function placeTool<T extends AiToolRef>(
  messages: AiToolMessageRef[],
  tool: T,
): { messageId: string; messageRole: string; side: keyof AiToolPlacement<T> } | null {
  const at = timeOf(tool.createdAt)
  let userIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].messageRole !== 'user') {
      continue
    }
    if (timeOf(messages[i].createdAt) <= at) {
      userIdx = i
      break
    }
  }
  let nextUserIdx = messages.length
  if (userIdx >= 0) {
    for (let i = userIdx + 1; i < messages.length; i++) {
      if (messages[i].messageRole === 'user') {
        nextUserIdx = i
        break
      }
    }
  }

  let prior: AiToolMessageRef | null = null
  let next: AiToolMessageRef | null = null
  for (let i = Math.max(userIdx, 0) + (userIdx >= 0 ? 1 : 0); i < nextUserIdx; i++) {
    if (messages[i].messageRole !== 'assistant') {
      continue
    }
    if (timeOf(messages[i].createdAt) <= at) {
      prior = messages[i]
      continue
    }
    next = messages[i]
    break
  }
  if (prior) {
    return { messageId: prior.messageId, messageRole: prior.messageRole, side: 'after' }
  }
  if (next) {
    return { messageId: next.messageId, messageRole: next.messageRole, side: 'before' }
  }
  if (userIdx >= 0) {
    return {
      messageId: messages[userIdx].messageId,
      messageRole: messages[userIdx].messageRole,
      side: 'after',
    }
  }
  return null
}

function placementOf<T>(map: Map<string, AiToolPlacement<T>>, messageId: string): AiToolPlacement<T> {
  const existing = map.get(messageId)
  if (existing) {
    return existing
  }
  const created: AiToolPlacement<T> = { before: [], after: [] }
  map.set(messageId, created)
  return created
}

function timeOf(value?: string): number {
  if (!value) {
    return 0
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}
