/** 助手正文解析结果：思考过程与可见回复分离。 */
export interface ParsedAssistantContent {
  thinking: string
  body: string
  /** 流式场景下思考标签尚未闭合。 */
  thinkingOpen: boolean
}

/**
 * 解析助手正文：剥离 `<think>` / `<thinking>`，正文与思考过程分开展示。
 */
export function parseAssistantContent(raw = ''): ParsedAssistantContent {
  const blocks: string[] = []
  let thinkingOpen = false

  // 完整闭合块（标签名白名单，避免回溯）
  let body = raw.replace(
    /<\s*(?:think|thinking)\s*>([\s\S]*?)<\s*\/\s*(?:think|thinking)\s*>/gi,
    (_m, inner: string) => {
      const trimmed = String(inner).trim()
      if (trimmed) {
        blocks.push(trimmed)
      }
      return ''
    },
  )

  // 流式未闭合的开标签
  const openIdx = body.search(/<\s*(?:think|thinking)\s*>/i)
  if (openIdx >= 0) {
    const tagEnd = body.indexOf('>', openIdx)
    if (tagEnd >= 0) {
      thinkingOpen = true
      const partial = body.slice(tagEnd + 1).trim()
      if (partial) {
        blocks.push(partial)
      }
      body = body.slice(0, openIdx)
    }
  }

  return {
    thinking: blocks.join('\n\n').trim(),
    body: body.trim(),
    thinkingOpen,
  }
}
