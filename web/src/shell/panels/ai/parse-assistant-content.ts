/** 助手正文里的一段：按出现顺序，思考和可见回复交错。 */
export interface AssistantSegment {
  kind: 'text' | 'think'
  text: string
  /** 仅 think：标签尚未闭合，这是当前正在进行的步骤。 */
  open?: boolean
}

/** 助手正文解析结果。segments 保持原文顺序，不把思考抽到最前。 */
export interface ParsedAssistantContent {
  segments: AssistantSegment[]
  /** 可见正文，不含思考，供复制。 */
  body: string
}

const CLOSED_THINK =
  /<\s*(?:think|thinking)\s*>([\s\S]*?)<\s*\/\s*(?:think|thinking)\s*>/gi
const OPEN_THINK = /<\s*(?:think|thinking)\s*>/i

/**
 * 解析助手正文：`<think>` / `<thinking>` 与可见回复按出现顺序拆成片段。
 */
export function parseAssistantContent(raw = ''): ParsedAssistantContent {
  const segments: AssistantSegment[] = []
  let cursor = 0
  CLOSED_THINK.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CLOSED_THINK.exec(raw)) !== null) {
    pushText(segments, raw.slice(cursor, match.index))
    pushThink(segments, match[1] ?? '', false)
    cursor = match.index + match[0].length
  }

  const rest = raw.slice(cursor)
  const openIdx = rest.search(OPEN_THINK)
  if (openIdx >= 0) {
    const tagEnd = rest.indexOf('>', openIdx)
    if (tagEnd >= 0) {
      pushText(segments, rest.slice(0, openIdx))
      pushThink(segments, rest.slice(tagEnd + 1), true)
    } else {
      pushText(segments, rest)
    }
  } else {
    pushText(segments, rest)
  }

  const body = segments
    .filter((segment) => segment.kind === 'text')
    .map((segment) => segment.text)
    .join('\n\n')
    .trim()
  return { segments, body }
}

function pushText(segments: AssistantSegment[], raw: string): void {
  const text = raw.trim()
  if (!text) {
    return
  }
  segments.push({ kind: 'text', text })
}

function pushThink(segments: AssistantSegment[], raw: string, open: boolean): void {
  const text = raw.trim()
  if (!text && !open) {
    return
  }
  segments.push({ kind: 'think', text, open })
}
