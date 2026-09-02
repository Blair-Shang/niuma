/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import {
  extractMathPlaceholders,
  renderAiMarkdown,
  stabilizeStreamingMarkdown,
} from '../shell/panels/ai/markdown'
import { splitMarkdownBlocks } from '../shell/panels/ai/split-markdown-blocks'

describe('stabilizeStreamingMarkdown', () => {
  it('closes an open fence', () => {
    const src = 'before\n```sql\nSELECT 1'
    expect(stabilizeStreamingMarkdown(src)).toBe(`${src}\n\`\`\``)
  })

  it('leaves balanced fences unchanged', () => {
    const src = '```js\nconst a = 1\n```'
    expect(stabilizeStreamingMarkdown(src)).toBe(src)
  })
})

describe('splitMarkdownBlocks', () => {
  it('extracts echarts mermaid and math fences', () => {
    const src = [
      'hello',
      '```echarts',
      '{"title":{"text":"t"}}',
      '```',
      'mid',
      '```mermaid',
      'graph TD; A-->B',
      '```',
      '```math',
      'x^2',
      '```',
    ].join('\n')
    const blocks = splitMarkdownBlocks(src)
    expect(blocks.some((b) => b.kind === 'echarts')).toBe(true)
    expect(blocks.some((b) => b.kind === 'mermaid')).toBe(true)
    expect(blocks.some((b) => b.kind === 'math')).toBe(true)
    expect(blocks.filter((b) => b.kind === 'markdown').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps normal code as markdown', () => {
    const blocks = splitMarkdownBlocks('```json\n{"a":1}\n```')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.kind).toBe('markdown')
  })

  it('routes large json objects to the tree', () => {
    const data: Record<string, string> = {}
    for (let i = 0; i < 47; i += 1) {
      data[`field_${i}`] = `value_${i}`
    }
    const body = JSON.stringify({ code: 200, message: 'success', data }, null, 2)
    expect(body.length).toBeGreaterThan(400)
    const blocks = splitMarkdownBlocks(`\`\`\`json\n${body}\n\`\`\``)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'json-tree' })
  })
})

describe('renderAiMarkdown', () => {
  it('renders headings paragraphs and inline code', () => {
    const html = renderAiMarkdown('# Hello\n\nUse `SELECT 1` please.')
    expect(html).toContain('<h1')
    expect(html).toContain('Hello')
    expect(html).toContain('<code>')
    expect(html).toContain('SELECT 1')
  })

  it('highlights fenced code and exposes copy control', () => {
    const html = renderAiMarkdown('```sql\nSELECT 1;\n```')
    expect(html).toContain('nm-ai-md__codeblock')
    expect(html).toContain('data-nm-ai-copy')
    expect(html).toContain('data-nm-ai-open')
    expect(html).toContain('hljs')
    expect(html).toContain('SELECT')
  })

  it('renders ordered lists as ol', () => {
    const html = renderAiMarkdown('1. **one**\n2. **two**\n')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>')
    expect(html).toContain('one')
    expect(html).toContain('two')
  })

  it('default-wraps plain text fences and hides sql-only open action', () => {
    const html = renderAiMarkdown('```\nThreadPool\n → createMergedStream\n```')
    expect(html).toContain('is-wrap')
    expect(html).toContain('data-nm-ai-wrap')
    expect(html).not.toContain('data-nm-ai-open')
  })

  it('collapses long code blocks', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    const html = renderAiMarkdown('```text\n' + lines + '\n```')
    expect(html).toContain('is-collapsed')
    expect(html).toContain('data-nm-ai-expand')
  })

  it('wraps GFM tables', () => {
    const md = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    const html = renderAiMarkdown(md)
    expect(html).toContain('nm-ai-md__table-wrap')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
  })

  it('forces safe external links', () => {
    const html = renderAiMarkdown('[x](https://example.com)')
    expect(html).toContain('rel="noopener noreferrer"')
    // 不设 target=_blank，避免 CEF Popup 黑屏；点击由 AiMarkdown 转 openExternal
    expect(html).not.toContain('target="_blank"')
    expect(html).toContain('https://example.com')
  })

  it('drops javascript urls', () => {
    const html = renderAiMarkdown('[x](javascript:alert(1))')
    expect(html.toLowerCase()).not.toContain('javascript:')
  })

  it('strips script tags', () => {
    const html = renderAiMarkdown('hi<script>alert(1)</script>')
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html).toContain('hi')
  })

  it('lazy-safe images', () => {
    const html = renderAiMarkdown('![alt](https://example.com/a.png)')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('data-nm-ai-img')
  })

  it('stabilizes streaming fences when requested', () => {
    const html = renderAiMarkdown('```ts\nconst x = 1', { streaming: true })
    expect(html).toContain('nm-ai-md__codeblock')
    expect(html).toContain('const')
  })

  it('keeps GFM task list checkboxes', () => {
    const html = renderAiMarkdown('- [x] done\n- [ ] todo')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked')
  })

  it('extracts math placeholders when not streaming', () => {
    const withPlaceholders = extractMathPlaceholders('energy $E=mc^2$ end')
    expect(withPlaceholders).toContain('data-nm-ai-math="inline"')
    expect(withPlaceholders).toContain('E=mc^2')
    const html = renderAiMarkdown('energy $E=mc^2$ end')
    expect(html).toContain('data-nm-ai-math')
  })

  it('does not treat dollar-quoted SQL as math', () => {
    const src = ['```sql', 'AS $func$', 'BEGIN', 'NULL;', 'END;', '$func$;', '```'].join('\n')
    const withPlaceholders = extractMathPlaceholders(src)
    expect(withPlaceholders).not.toContain('data-nm-ai-math')
    expect(withPlaceholders).toContain('$func$')
    const html = renderAiMarkdown(src)
    expect(html).not.toContain('data-nm-ai-math')
    expect(html).toContain('$func$')
  })

  it('highlights diff additions and deletions', () => {
    const html = renderAiMarkdown('```diff\n+ added\n- removed\n```')
    expect(html).toContain('hljs')
    expect(html).toMatch(/addition|deletion|added|removed/)
  })
})
