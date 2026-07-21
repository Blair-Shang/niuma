/** AI Markdown 分块：普通 MD / 图表 / Mermaid / 公式 / 引用 / 工具 / 结果 / JSON 树。 */

export type AiMarkdownBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'echarts'; text: string }
  | { kind: 'mermaid'; text: string }
  | { kind: 'math'; text: string; display: boolean }
  | { kind: 'ref'; text: string }
  | { kind: 'tool'; text: string; lang: string }
  | { kind: 'result'; text: string }
  | { kind: 'json-tree'; text: string }

const SPECIAL_LANGS = new Set([
  'echarts',
  'chart',
  'mermaid',
  'math',
  'latex',
  'katex',
  'ref',
  'nm-ref',
  'tool',
  'toolcall',
  'result',
  'query-result',
  'json-tree',
])

function classifyFence(langRaw: string, body: string): AiMarkdownBlock {
  const lang = langRaw.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (lang === 'echarts' || lang === 'chart') {
    return { kind: 'echarts', text: body }
  }
  if (lang === 'mermaid') {
    return { kind: 'mermaid', text: body }
  }
  if (lang === 'math' || lang === 'latex' || lang === 'katex') {
    return { kind: 'math', text: body, display: true }
  }
  if (lang === 'ref' || lang === 'nm-ref') {
    return { kind: 'ref', text: body }
  }
  if (lang === 'tool' || lang === 'toolcall') {
    return { kind: 'tool', text: body, lang }
  }
  if (lang === 'result' || lang === 'query-result') {
    return { kind: 'result', text: body }
  }
  if (lang === 'json-tree') {
    return { kind: 'json-tree', text: body }
  }
  // 较大 JSON 对象自动走树（> 400 字符）
  if (lang === 'json' && body.trim().length > 400) {
    try {
      const v = JSON.parse(body)
      if (v && typeof v === 'object') {
        return { kind: 'json-tree', text: body }
      }
    } catch {
      // fallthrough
    }
  }
  const fence = lang ? `\`\`\`${lang}\n${body}\n\`\`\`` : `\`\`\`\n${body}\n\`\`\``
  return { kind: 'markdown', text: fence }
}

/**
 * 将 Markdown 按围栏切成块；特殊语言单独抽出以便 Vue 挂载。
 */
export function splitMarkdownBlocks(source: string): AiMarkdownBlock[] {
  if (!source) {
    return []
  }
  const lines = source.split('\n')
  const blocks: AiMarkdownBlock[] = []
  let mdBuf: string[] = []
  let i = 0

  const flushMd = () => {
    if (!mdBuf.length) {
      return
    }
    const text = mdBuf.join('\n')
    if (text.trim()) {
      blocks.push({ kind: 'markdown', text })
    }
    mdBuf = []
  }

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const fenceMatch = /^(\s*)(`{3,}|~{3,})(\S*)\s*$/.exec(line)
    if (!fenceMatch) {
      mdBuf.push(line)
      i += 1
      continue
    }
    const indent = fenceMatch[1] ?? ''
    const marker = fenceMatch[2] ?? '```'
    const lang = fenceMatch[3] ?? ''
    const langKey = lang.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const isJsonAuto = langKey === 'json'
    if (!SPECIAL_LANGS.has(langKey) && !isJsonAuto) {
      mdBuf.push(line)
      i += 1
      const closeRe = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`)
      while (i < lines.length) {
        const cur = lines[i] ?? ''
        mdBuf.push(cur)
        i += 1
        if (closeRe.test(cur)) {
          break
        }
      }
      continue
    }

    flushMd()
    i += 1
    const bodyLines: string[] = []
    const closeRe = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`)
    while (i < lines.length) {
      const cur = lines[i] ?? ''
      if (closeRe.test(cur)) {
        i += 1
        break
      }
      bodyLines.push(indent && cur.startsWith(indent) ? cur.slice(indent.length) : cur)
      i += 1
    }
    blocks.push(classifyFence(lang, bodyLines.join('\n').replace(/\n$/, '')))
  }

  flushMd()
  return blocks.length ? blocks : [{ kind: 'markdown', text: source }]
}
