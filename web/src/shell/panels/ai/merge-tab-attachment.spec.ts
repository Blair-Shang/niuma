import { describe, expect, it } from 'vitest'
import { mergeActiveTabAttachment } from './merge-tab-attachment'

describe('mergeActiveTabAttachment', () => {
  it('prepends the active tab when the list is empty', () => {
    const active = { id: 'tab:q1', label: 'ai_coding · 查询 1' }
    expect(mergeActiveTabAttachment([], active)).toEqual([active])
  })

  it('does not duplicate an already attached tab', () => {
    const active = { id: 'tab:q1', label: 'ai_coding · 查询 1' }
    expect(mergeActiveTabAttachment([active], active)).toEqual([active])
  })

  it('keeps other attachments after the active tab', () => {
    const active = { id: 'tab:q1' }
    const sel = { id: 'sel:1' }
    expect(mergeActiveTabAttachment([sel], active).map((a) => a.id)).toEqual(['tab:q1', 'sel:1'])
  })

  it('returns the list unchanged when there is no active tab', () => {
    const sel = { id: 'sel:1' }
    expect(mergeActiveTabAttachment([sel], null)).toEqual([sel])
  })
})
