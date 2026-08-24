/**
 * AI Markdown 渲染管线：GFM + 高亮 + 公式 + 图片 + 流式结构稳定。
 * 重型依赖（KaTeX）动态 import，避免首屏打包膨胀。
 */
import { Marked } from 'marked'
import type { Tokens } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import nginx from 'highlight.js/lib/languages/nginx'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const CODE_COLLAPSE_LINES = 28
const SQL_OPEN_LANGS = new Set([
  'sql',
  'pgsql',
  'postgres',
  'postgresql',
  'mysql',
  'dameng',
  'kingbase',
  'sqlserver',
])

function isSqlOpenLang(lang: string): boolean {
  return SQL_OPEN_LANGS.has(lang)
}

/** 窄面板下纯文本/无语言围栏默认换行，避免调用链等长行被裁切。 */
function shouldDefaultWrap(lang: string): boolean {
  return lang === 'text' || lang === 'plaintext'
}

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('zsh', bash)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('cs', csharp)
hljs.registerLanguage('css', css)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('patch', diff)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('docker', dockerfile)
hljs.registerLanguage('go', go)
hljs.registerLanguage('golang', go)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('toml', ini)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('nginx', nginx)
hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('text', plaintext)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('pgsql', sql)
hljs.registerLanguage('postgres', sql)
hljs.registerLanguage('mysql', sql)
hljs.registerLanguage('dameng', sql)
hljs.registerLanguage('kingbase', sql)
hljs.registerLanguage('postgresql', sql)
hljs.registerLanguage('sqlserver', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('vue', xml)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function sanitizeLang(lang: string | undefined): string {
  const raw = (lang ?? 'text').trim().split(/\s+/)[0] ?? 'text'
  return raw.replace(/[^\w.+#-]/g, '') || 'text'
}

function highlightCode(code: string, lang: string): string {
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    }
  } catch {
    // fall through
  }
  return escapeHtml(code)
}

function isSafeHref(href: string): boolean {
  const value = href.trim()
  if (!value) {
    return false
  }
  if (value.startsWith('#') || value.startsWith('/')) {
    return true
  }
  return /^(https?:|mailto:)/i.test(value)
}

function isSafeImageSrc(src: string): boolean {
  const value = src.trim()
  if (!value) {
    return false
  }
  if (value.startsWith('data:image/')) {
    return true
  }
  return /^(https?:)/i.test(value)
}

/**
 * 流式场景补全未闭合结构：围栏、表格、引用、列表。
 * 仅做轻量修补，避免半截 token 导致整段解析塌陷。
 */
export function stabilizeStreamingMarkdown(source: string): string {
  let text = source
  const lines = text.split('\n')
  let fenceOpen = false
  let fenceMarker = '```'
  for (const line of lines) {
    const m = /^(`{3,}|~{3,})/.exec(line.trimStart())
    if (m) {
      if (!fenceOpen) {
        fenceOpen = true
        fenceMarker = m[1] ?? '```'
      } else if (line.trimStart().startsWith(fenceMarker[0]!)) {
        fenceOpen = false
      }
    }
  }
  if (fenceOpen) {
    text = `${text}\n${fenceMarker}`
  }

  const allLines = text.split('\n')
  let lastNonEmpty = ''
  let lastIdx = -1
  for (let i = allLines.length - 1; i >= 0; i -= 1) {
    const l = allLines[i]?.trim() ?? ''
    if (l) {
      lastNonEmpty = l
      lastIdx = i
      break
    }
  }
  if (!lastNonEmpty || lastNonEmpty.startsWith('```')) {
    return text
  }

  // 表格：半行补换行，避免 GFM 把后续吞进表格
  if (lastNonEmpty.includes('|')) {
    if (!text.endsWith('\n')) {
      text = `${text}\n`
    }
    return text
  }

  // 引用：末行是 > 开头且无空行收束时补空行
  if (lastNonEmpty.startsWith('>') && lastIdx === allLines.length - 1) {
    text = `${text}\n`
    return text
  }

  // 列表：末行是列表项时补空行，减轻下一段粘连
  if (/^([-*+]|\d+\.)\s+/.test(lastNonEmpty) && lastIdx === allLines.length - 1) {
    text = `${text}\n`
  }

  return text
}

const MATH_BLOCK_RE = /\$\$([\s\S]+?)\$\$/g
const MATH_INLINE_RE = /(?<!\$)\$(?!\$)((?:[^$\n\\]|\\.)+?)\$(?!\$)/g
/** 保护围栏/行内代码，避免 PL/pgSQL `$func$` 等被当成公式。 */
const MATH_PROTECT_RE = /```[\s\S]*?```|`[^`\n]+`/g

/** 将 $$ / $ 公式替换为占位标签，供后续 KaTeX 注水。 */
export function extractMathPlaceholders(source: string): string {
  const protectedChunks: string[] = []
  const masked = source.replace(MATH_PROTECT_RE, (chunk) => {
    const idx = protectedChunks.length
    protectedChunks.push(chunk)
    return `\u0000NM_AI_CODE_${idx}\u0000`
  })

  let out = masked.replace(MATH_BLOCK_RE, (_m, expr: string) => {
    return `\n\n<div class="nm-ai-md__math" data-nm-ai-math="display">${escapeHtml(expr.trim())}</div>\n\n`
  })
  out = out.replace(MATH_INLINE_RE, (_m, expr: string) => {
    return `<span class="nm-ai-md__math" data-nm-ai-math="inline">${escapeHtml(expr.trim())}</span>`
  })

  return out.replace(/\u0000NM_AI_CODE_(\d+)\u0000/g, (_m, n: string) => {
    return protectedChunks[Number(n)] ?? ''
  })
}

function renderCodeBlock(text: string, lang: string | undefined): string {
  const language = sanitizeLang(lang)
  const code = text.replace(/\n$/, '')
  const lines = code ? code.split('\n') : ['']
  const lineCount = lines.length
  const collapsed = lineCount > CODE_COLLAPSE_LINES
  const wrapped = shouldDefaultWrap(language)
  const showOpen = isSqlOpenLang(language)
  const highlighted = highlightCode(code, language)
  const lineNos = lines.map((_, i) => `<span class="nm-ai-md__ln">${i + 1}</span>`).join('')
  const blockClass = [
    'nm-ai-md__codeblock',
    collapsed ? 'is-collapsed' : '',
    wrapped ? 'is-wrap' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return [
    `<div class="${blockClass}" data-nm-ai-lang="${escapeHtml(language)}"${collapsed ? ` data-nm-ai-code-lines="${lineCount}"` : ''}>`,
    `<div class="nm-ai-md__code-head">`,
    `<span class="nm-ai-md__code-lang">${escapeHtml(language)}</span>`,
    `<div class="nm-ai-md__code-actions">`,
    `<button type="button" class="nm-ai-md__code-wrap" data-nm-ai-wrap title="wrap"${wrapped ? ' aria-pressed="true"' : ' aria-pressed="false"'}></button>`,
    showOpen
      ? `<button type="button" class="nm-ai-md__code-open" data-nm-ai-open title="open"></button>`
      : '',
    collapsed
      ? `<button type="button" class="nm-ai-md__code-expand" data-nm-ai-expand>${escapeHtml('…')}</button>`
      : '',
    `<button type="button" class="nm-ai-md__copy" data-nm-ai-copy>`,
    `<span class="nm-ai-md__copy-idle"></span>`,
    `<span class="nm-ai-md__copy-done" hidden></span>`,
    `</button>`,
    `</div>`,
    `</div>`,
    `<div class="nm-ai-md__code-body rs-native-scrollbar">`,
    `<div class="nm-ai-md__gutter" aria-hidden="true">${lineNos}</div>`,
    `<pre class="nm-ai-md__pre"><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>`,
    `</div>`,
    collapsed
      ? `<button type="button" class="nm-ai-md__code-more" data-nm-ai-expand></button>`
      : '',
    `</div>`,
  ].join('')
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      return renderCodeBlock(text, lang)
    },
    link(this: { parser: { parseInline: (tokens: Tokens.Link['tokens']) => string } }, token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens)
      const href = token.href?.trim() ?? ''
      if (!isSafeHref(href)) {
        return text
      }
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : ''
      // 不设 target=_blank：CEF 会开 Popup 且 data/外链易黑屏；点击由 AiMarkdown 拦截转 openExternal
      return `<a href="${escapeHtml(href)}"${title} rel="noopener noreferrer">${text}</a>`
    },
    image({ href, title, text }) {
      const src = href?.trim() ?? ''
      if (!isSafeImageSrc(src)) {
        return escapeHtml(text || '')
      }
      const alt = escapeHtml(text || '')
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
      return [
        `<span class="nm-ai-md__img-wrap">`,
        `<img class="nm-ai-md__img" src="${escapeHtml(src)}" alt="${alt}"${titleAttr} loading="lazy" decoding="async" data-nm-ai-img />`,
        `</span>`,
      ].join('')
    },
  },
})

function wrapTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    return `<div class="nm-ai-md__table-wrap rs-native-scrollbar">${table}</div>`
  })
}

export type RenderAiMarkdownOptions = {
  streaming?: boolean
  /** 跳过行内/块级 $ 公式提取（特殊块已单独处理时）。 */
  skipMathExtract?: boolean
}

/**
 * 将 Markdown 转为可安全注入的 HTML（不含 echarts/mermaid 围栏，那些应先分块）。
 */
export function renderAiMarkdown(source = '', options?: RenderAiMarkdownOptions): string {
  if (!source.trim()) {
    return ''
  }
  let input = options?.streaming ? stabilizeStreamingMarkdown(source) : source
  if (!options?.skipMathExtract && !options?.streaming) {
    // 流式时跳过公式提取，避免半截 $ 误伤；结束后再渲染
    input = extractMathPlaceholders(input)
  }
  const dirty = wrapTables(marked.parse(input, { async: false }) as string)
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['button'],
    ADD_ATTR: [
      'class',
      'target',
      'rel',
      'type',
      'disabled',
      'checked',
      'data-nm-ai-copy',
      'data-nm-ai-expand',
      'data-nm-ai-wrap',
      'data-nm-ai-open',
      'data-nm-ai-math',
      'data-nm-ai-img',
      'data-nm-ai-code-lines',
      'data-nm-ai-lang',
      'hidden',
      'loading',
      'decoding',
      'alt',
      'src',
    ],
  })
}

let katexModule: { default: typeof import('katex').default } | typeof import('katex') | null = null
let katexCssLoaded = false

function resolveKatex(mod: typeof import('katex')): typeof import('katex').default {
  return (mod as { default?: typeof import('katex').default }).default ?? (mod as unknown as typeof import('katex').default)
}

async function loadKatex(): Promise<typeof import('katex').default> {
  if (!katexModule) {
    katexModule = await import('katex')
  }
  if (!katexCssLoaded && typeof document !== 'undefined') {
    await import('katex/dist/katex.min.css')
    katexCssLoaded = true
  }
  return resolveKatex(katexModule as typeof import('katex'))
}

/** 将占位公式节点渲染为 KaTeX（失败时保留原文）。 */
export async function hydrateMathInElement(root: HTMLElement): Promise<void> {
  const nodes = root.querySelectorAll<HTMLElement>('[data-nm-ai-math]')
  if (!nodes.length) {
    return
  }
  const katex = await loadKatex()
  for (const el of nodes) {
    if (el.dataset.nmAiMathDone === '1') {
      continue
    }
    const display = el.dataset.nmAiMath === 'display'
    const expr = el.textContent ?? ''
    try {
      katex.render(expr, el, {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        output: 'html',
      })
      el.dataset.nmAiMathDone = '1'
    } catch {
      el.classList.add('is-error')
    }
  }
}

/** 渲染单段 display 公式 HTML（用于 math 围栏块）。 */
export async function renderKatexHtml(expr: string, display = true): Promise<string> {
  const katex = await loadKatex()
  try {
    return katex.renderToString(expr, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      output: 'html',
    })
  } catch {
    return `<code>${escapeHtml(expr)}</code>`
  }
}
