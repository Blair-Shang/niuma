import { describe, expect, it } from 'vitest'
import { groupHistoryByDay, historyDayKind, localDayKey, shiftLocalDay } from './history-groups'

describe('history-groups', () => {
  it('keys a local calendar day', () => {
    expect(localDayKey(new Date(2026, 2, 12, 23, 30))).toBe('2026-03-12')
  })

  it('groups newest-first items by day without mixing dates', () => {
    const groups = groupHistoryByDay([
      { createdAt: '2026-03-12T10:00:00' },
      { createdAt: '2026-03-12T08:00:00' },
      { createdAt: '2026-03-11T22:00:00' },
    ])
    expect(groups.map((g) => g.day)).toEqual(['2026-03-12', '2026-03-11'])
    expect(groups[0]?.items).toHaveLength(2)
  })

  it('classifies today and yesterday from a local now', () => {
    const now = new Date(2026, 8, 12, 1, 0)
    expect(historyDayKind(localDayKey(now), now)).toBe('today')
    expect(historyDayKind(localDayKey(shiftLocalDay(now, -1)), now)).toBe('yesterday')
    expect(historyDayKind('2026-01-01', now)).toBe('date')
  })
})
