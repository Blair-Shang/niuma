import { describe, expect, it } from 'vitest'
import { connTreeKey, resourceTreeKey } from '@/modules/ops/conn-tree/keys'
import { registerBuiltinConnKindLoaders } from '@/modules/ops/register-builtin-conn-kinds'
import { redisConnTreeTabSync } from '@/modules/redis/conn-tree-tab-sync'
import type { ConnItem } from '@/modules/ops/types'
import type { WorkspaceTab } from '@/stores/tab'

function tab(partial: Partial<WorkspaceTab> & Pick<WorkspaceTab, 'moduleId' | 'props'>): WorkspaceTab {
  return {
    tabId: 't1',
    title: 'Redis',
    closable: true,
    ...partial,
  }
}

function redisProfile(connectionOptions: Record<string, unknown>): ConnItem {
  return {
    profileId: 'p1',
    profileName: 'local',
    kind: 'redis',
    hostAddress: '127.0.0.1',
    portNumber: 6379,
    loginAccount: '',
    connectionOptions,
  } as ConnItem
}

describe('redisConnTreeTabSync', () => {
  it('focuses db resource when tab has database prop', () => {
    registerBuiltinConnKindLoaders()
    const key = redisConnTreeTabSync.resolveFocusKey(
      tab({ moduleId: 'redis', props: { profileId: 'p1', database: 3 } }),
      { profiles: [redisProfile({ database: 0 })] },
    )
    expect(key).toBe(resourceTreeKey('p1', { segments: [{ kind: 'db', name: '3' }] }))
  })

  it('uses profile default database when tab omits database', () => {
    registerBuiltinConnKindLoaders()
    const key = redisConnTreeTabSync.resolveFocusKey(
      tab({ moduleId: 'redis', props: { profileId: 'p1' } }),
      { profiles: [redisProfile({ database: 2 })] },
    )
    expect(key).toBe(resourceTreeKey('p1', { segments: [{ kind: 'db', name: '2' }] }))
  })

  it('falls back to connection root when profile missing', () => {
    registerBuiltinConnKindLoaders()
    const key = redisConnTreeTabSync.resolveFocusKey(
      tab({ moduleId: 'redis', props: { profileId: 'missing' } }),
      { profiles: [] },
    )
    expect(key).toBe(connTreeKey('missing'))
  })

  it('returns null for non-redis tabs', () => {
    expect(
      redisConnTreeTabSync.resolveFocusKey(tab({ moduleId: 'mysql', props: { profileId: 'p1' } }), {
        profiles: [],
      }),
    ).toBeNull()
  })
})
