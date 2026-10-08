import { describe, expect, it } from 'vitest'
import { parseAssistantContent } from './parse-assistant-content'

describe('parseAssistantContent', () => {
  it('keeps thinking and prose in the order they appeared', () => {
    const parsed = parseAssistantContent(
      '<think>先看配置</think>\n我先查一下。\n<think>再核对结果</think>\n已经好了。',
    )
    expect(parsed.segments.map((segment) => [segment.kind, segment.text, segment.open])).toEqual([
      ['think', '先看配置', false],
      ['text', '我先查一下。', undefined],
      ['think', '再核对结果', false],
      ['text', '已经好了。', undefined],
    ])
    expect(parsed.body).toBe('我先查一下。\n\n已经好了。')
  })

  it('marks only the trailing unclosed think as the live step', () => {
    const parsed = parseAssistantContent('<think>已完成</think>\n接着看\n<think>正在看配置')
    expect(parsed.segments.map((segment) => [segment.kind, segment.open])).toEqual([
      ['think', false],
      ['text', undefined],
      ['think', true],
    ])
    expect(parsed.segments[2]?.text).toBe('正在看配置')
    expect(parsed.body).toBe('接着看')
  })

  it('keeps an empty live think so the current step still shows', () => {
    const parsed = parseAssistantContent('先说明\n<think>')
    expect(parsed.segments.map((segment) => [segment.kind, segment.text, segment.open])).toEqual([
      ['text', '先说明', undefined],
      ['think', '', true],
    ])
  })
})
