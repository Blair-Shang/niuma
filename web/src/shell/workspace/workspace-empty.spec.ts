import { describe, expect, it } from 'vitest'
import type { ConnItem } from '@/modules/ops/types'
import { chordKeys, isConnKind, profileHostLabel, sortRecentProfiles } from './workspace-empty'

function item(partial: Partial<ConnItem> & Pick<ConnItem, 'profileId' | 'kind'>): ConnItem {
  return {
    workspaceId: 'ws',
    profileName: partial.profileName ?? partial.profileId,
    connectionKind: partial.kind,
    hostAddress: partial.hostAddress ?? '127.0.0.1',
    portNumber: partial.portNumber ?? 22,
    loginAccount: '',
    connectionOptions: {},
    recordStatus: 'active',
    rowVersion: 1,
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00Z',
    credentialIds: [],
    ...partial,
  }
}

describe('workspace-empty', () => {
  it('recognizes registered connection kinds', () => {
    expect(isConnKind('ssh')).toBe(true)
    expect(isConnKind('unknown')).toBe(false)
  })

  it('sorts recent profiles by updatedAt then createdAt', () => {
    const recent = sortRecentProfiles(
      [
        item({ profileId: 'a', kind: 'ssh', updatedAt: '2026-01-01T00:00:00Z' }),
        item({ profileId: 'b', kind: 'mysql', updatedAt: '2026-03-01T00:00:00Z' }),
        item({ profileId: 'c', kind: 'redis', updatedAt: '2026-02-01T00:00:00Z' }),
      ],
      2,
    )
    expect(recent.map((row) => row.profileId)).toEqual(['b', 'c'])
  })

  it('builds a modifier chord for the watermark', () => {
    const keys = chordKeys('K')
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe('K')
    expect(['Ctrl', '⌘']).toContain(keys[0])
  })

  it('formats host labels for tcp and sqlite', () => {
    expect(
      profileHostLabel(item({ profileId: 's', kind: 'ssh', hostAddress: '10.0.0.1', portNumber: 22 })),
    ).toBe('10.0.0.1:22')
    expect(
      profileHostLabel(
        item({ profileId: 'q', kind: 'sqlite', hostAddress: 'D:\\data\\app.db', portNumber: 0 }),
      ),
    ).toBe('D:\\data\\app.db')
  })
})
