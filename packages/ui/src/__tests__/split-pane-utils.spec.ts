import { describe, expect, it } from 'vitest'
import {
  applySplitResize,
  collapseSplitPane,
  expandSplitPane,
  isSplitPaneCollapsed,
  normalizeSplitSizes,
  resolveSplitConstraints,
  splitSizesEqual,
  type RsSplitPaneItem,
} from '../components/split-pane-utils'

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0)

describe('resolveSplitConstraints', () => {
  it('applies defaults and clamps ranges', () => {
    const result = resolveSplitConstraints([{ key: 'a' }])
    expect(result[0]).toEqual({ min: 0, max: 100, collapsible: false, collapsedSize: 0 })
  })

  it('orders swapped min/max and caps collapsedSize at min', () => {
    const result = resolveSplitConstraints([
      { key: 'a', min: 60, max: 20, collapsible: true, collapsedSize: 40 },
    ])
    expect(result[0]).toEqual({ min: 20, max: 60, collapsible: true, collapsedSize: 20 })
  })
})

describe('normalizeSplitSizes', () => {
  it('distributes remaining space to unspecified panes', () => {
    const panes: RsSplitPaneItem[] = [{ key: 'a', size: 40 }, { key: 'b' }, { key: 'c' }]
    const sizes = normalizeSplitSizes(panes)
    expect(sum(sizes)).toBeCloseTo(100)
    expect(sizes[0]).toBeCloseTo(40)
    expect(sizes[1]).toBeCloseTo(30)
    expect(sizes[2]).toBeCloseTo(30)
  })

  it('rescales values that do not sum to 100', () => {
    const sizes = normalizeSplitSizes([{ key: 'a', size: 1 }, { key: 'b', size: 3 }])
    expect(sizes).toEqual([25, 75])
  })

  it('prefers provided (controlled) sizes over pane defaults', () => {
    const panes: RsSplitPaneItem[] = [{ key: 'a', size: 20 }, { key: 'b', size: 80 }]
    const sizes = normalizeSplitSizes(panes, [50, 50])
    expect(sizes).toEqual([50, 50])
  })

  it('falls back to equal split when all sizes are zero', () => {
    const sizes = normalizeSplitSizes([{ key: 'a', size: 0 }, { key: 'b', size: 0 }])
    expect(sizes).toEqual([50, 50])
  })
})

describe('applySplitResize', () => {
  const constraints = resolveSplitConstraints([{ key: 'a' }, { key: 'b' }])

  it('moves space between adjacent panes and preserves total', () => {
    const next = applySplitResize([50, 50], constraints, 0, 10)
    expect(next).toEqual([60, 40])
    expect(sum(next)).toBe(100)
  })

  it('is immutable', () => {
    const input = [50, 50]
    const next = applySplitResize(input, constraints, 0, 10)
    expect(input).toEqual([50, 50])
    expect(next).not.toBe(input)
  })

  it('respects min/max of both neighbors', () => {
    const bounded = resolveSplitConstraints([
      { key: 'a', min: 30 },
      { key: 'b', min: 30 },
    ])
    expect(applySplitResize([50, 50], bounded, 0, -40)).toEqual([30, 70])
    expect(applySplitResize([50, 50], bounded, 0, 40)).toEqual([70, 30])
  })

  it('ignores dividers that are out of range', () => {
    expect(applySplitResize([50, 50], constraints, 1, 10)).toEqual([50, 50])
    expect(applySplitResize([50, 50], constraints, -1, 10)).toEqual([50, 50])
  })

  it('snaps a collapsible pane to collapsedSize past the halfway threshold', () => {
    const collapsible = resolveSplitConstraints([
      { key: 'a', min: 20, collapsible: true, collapsedSize: 0 },
      { key: 'b' },
    ])
    // 50 - 45 = 5 < (20+0)/2 = 10 → 折叠到 0
    expect(applySplitResize([50, 50], collapsible, 0, -45)).toEqual([0, 100])
    // 50 - 38 = 12 > 10 → 夹到 min 20
    expect(applySplitResize([50, 50], collapsible, 0, -38)).toEqual([20, 80])
  })
})

describe('collapseSplitPane / expandSplitPane', () => {
  const constraints = resolveSplitConstraints([
    { key: 'a', min: 20, collapsible: true, collapsedSize: 0 },
    { key: 'b' },
  ])

  it('collapses to collapsedSize and gives space to the neighbor', () => {
    expect(collapseSplitPane([40, 60], constraints, 0)).toEqual([0, 100])
  })

  it('expands back to min by default', () => {
    expect(expandSplitPane([0, 100], constraints, 0)).toEqual([20, 80])
  })

  it('expands to an explicit size clamped within bounds', () => {
    expect(expandSplitPane([0, 100], constraints, 0, 35)).toEqual([35, 65])
  })
})

describe('isSplitPaneCollapsed', () => {
  const [collapsible, plain] = resolveSplitConstraints([
    { key: 'a', collapsible: true, collapsedSize: 0 },
    { key: 'b' },
  ])

  it('is true only for collapsible panes at collapsedSize', () => {
    expect(isSplitPaneCollapsed(0, collapsible)).toBe(true)
    expect(isSplitPaneCollapsed(10, collapsible)).toBe(false)
    expect(isSplitPaneCollapsed(0, plain)).toBe(false)
  })
})

describe('splitSizesEqual', () => {
  it('compares with tolerance', () => {
    expect(splitSizesEqual([50, 50], [50.005, 49.995])).toBe(true)
    expect(splitSizesEqual([50, 50], [60, 40])).toBe(false)
    expect(splitSizesEqual([50], [50, 50])).toBe(false)
  })
})
