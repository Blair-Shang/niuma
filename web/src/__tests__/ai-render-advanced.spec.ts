/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { liteToOption, parseAiChartOption } from '../shell/panels/ai/echarts-lite'
import { splitMarkdownBlocks } from '../shell/panels/ai/split-markdown-blocks'

describe('echarts-lite', () => {
  it('parses nm:1 bar chart', () => {
    const raw = JSON.stringify({
      nm: 1,
      type: 'bar',
      title: 't',
      x: ['a', 'b'],
      series: [{ name: 's', data: [1, 2] }],
    })
    const { option, error } = parseAiChartOption(raw)
    expect(error).toBeNull()
    expect(option?.series).toBeTruthy()
  })

  it('maps pie lite', () => {
    const opt = liteToOption({
      nm: 1,
      type: 'pie',
      data: [
        { name: 'a', value: 1 },
        { name: 'b', value: 2 },
      ],
    })
    const series = opt.series
    const first = Array.isArray(series) ? series[0] : series
    expect(first).toMatchObject({ type: 'pie' })
  })

  it('keeps title and legend from overlapping', () => {
    const opt = liteToOption({
      nm: 1,
      type: 'bar',
      title: '2024年全国各省GDP分布TOP10（单位：亿元）',
      x: ['广东', '江苏'],
      series: [{ name: 'GDP', data: [1, 2] }],
    })
    const title = opt.title as { top?: number }
    const legend = opt.legend as { top?: number }
    const grid = opt.grid as { top?: number }
    expect(title.top).toBeLessThan(Number(legend.top))
    expect(Number(grid.top)).toBeGreaterThanOrEqual(56)
  })

  it('parses compact chart when nm is not 1', () => {
    const raw = JSON.stringify({
      nm: 2,
      type: 'bar',
      title: 'Top 进程 RSS(GB)',
      x: ['mongod', 'mysqld'],
      series: [{ name: 'RSS(GB)', data: [10.5, 8.1] }],
    })
    const { option, error } = parseAiChartOption(raw)
    expect(error).toBeNull()
    expect(option?.series).toBeTruthy()
    expect((option?.title as { text?: string }).text).toBe('Top 进程 RSS(GB)')
  })

  it('does not throw when full option title is a string', () => {
    const { option, error } = parseAiChartOption(
      JSON.stringify({ title: 'Top 进程 RSS(GB)', series: [{ type: 'bar', data: [1] }] }),
    )
    expect(error).toBeNull()
    expect((option?.title as { text?: string }).text).toBe('Top 进程 RSS(GB)')
  })

  it('accepts full option wrapper', () => {
    const { option, error } = parseAiChartOption(
      JSON.stringify({ option: { series: [{ type: 'line', data: [1] }] } }),
    )
    expect(error).toBeNull()
    expect(option?.series).toBeTruthy()
  })
})

describe('split result and tool blocks', () => {
  it('extracts result and tool fences', () => {
    const src = [
      '```tool',
      '{"name":"list","status":"ok"}',
      '```',
      '```result',
      '{"columns":["a"],"rows":[[1]]}',
      '```',
    ].join('\n')
    const blocks = splitMarkdownBlocks(src)
    expect(blocks.some((b) => b.kind === 'tool')).toBe(true)
    expect(blocks.some((b) => b.kind === 'result')).toBe(true)
  })
})
