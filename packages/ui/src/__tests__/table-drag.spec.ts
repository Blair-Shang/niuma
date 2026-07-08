import { describe, expect, it } from 'vitest'
import {
  resolveDragRowKeys,
  resolveTableRowDropPosition,
} from '../components/table-drag'

describe('table-drag', () => {
  it('resolves reorder drop position from pointer', () => {
    const element = {
      getBoundingClientRect: () => ({ top: 0, height: 100 }),
    } as HTMLElement

    expect(
      resolveTableRowDropPosition({ clientY: 20 } as MouseEvent, element, 'reorder'),
    ).toBe('before')
    expect(
      resolveTableRowDropPosition({ clientY: 80 } as MouseEvent, element, 'reorder'),
    ).toBe('after')
  })

  it('uses into position for folder drop mode', () => {
    const element = {
      getBoundingClientRect: () => ({ top: 0, height: 100 }),
    } as HTMLElement

    expect(
      resolveTableRowDropPosition({ clientY: 20 } as MouseEvent, element, 'into'),
    ).toBe('into')
  })

  it('drags all selected rows when dragging a selected row', () => {
    expect(resolveDragRowKeys('b', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(resolveDragRowKeys('d', ['a', 'b', 'c'])).toEqual(['d'])
  })
})
