import { describe, expect, it } from 'vitest'
import type { ConnItem } from '@/modules/ops/types'
import { connTreeKey, resourceTreeKey } from '@/modules/ops/conn-tree/keys'
import {
  catalogFromResourcePath,
  hasObjectHint,
  snapshotFromTreeKey,
} from './ai-focus'

function profile(kind: ConnItem['kind'], profileId = 'p1'): ConnItem {
  return {
    profileId,
    profileName: 'local',
    kind,
    hostAddress: '127.0.0.1',
    portNumber: 6379,
    loginAccount: '',
    connectionOptions: {},
  } as ConnItem
}

describe('catalogFromResourcePath', () => {
  it('maps Redis db segment', () => {
    expect(catalogFromResourcePath('redis', { segments: [{ kind: 'db', name: '3' }] })).toEqual({
      database: '3',
    })
  })

  it('maps SQL database / schema / table', () => {
    expect(
      catalogFromResourcePath('postgres', {
        segments: [
          { kind: 'database', name: 'app' },
          { kind: 'schema', name: 'public' },
          { kind: 'table', name: 'orders' },
        ],
      }),
    ).toEqual({ database: 'app', schema: 'public', table: 'orders' })
  })

  it('skips category and hint segments', () => {
    expect(
      catalogFromResourcePath('mysql', {
        segments: [
          { kind: 'database', name: 'shop' },
          { kind: 'category', name: 'tables' },
          { kind: 'hint', name: '__truncated_tables' },
        ],
      }),
    ).toEqual({ database: 'shop' })
  })

  it('keeps Mongo collection off the table slot', () => {
    expect(
      catalogFromResourcePath('mongodb', {
        segments: [
          { kind: 'database', name: 'app' },
          { kind: 'collection', name: 'users' },
        ],
      }),
    ).toEqual({ database: 'app', collection: 'users' })
  })
})

describe('snapshotFromTreeKey', () => {
  it('returns null for folders', () => {
    expect(snapshotFromTreeKey('folder:f1', [profile('redis')])).toBeNull()
  })

  it('returns connection-only focus without path', () => {
    const snap = snapshotFromTreeKey(connTreeKey('p1'), [profile('mysql')])
    expect(snap).toEqual({
      key: 'conn:p1',
      profileId: 'p1',
      moduleId: 'mysql',
      label: 'local',
      path: [],
    })
    expect(hasObjectHint(snap)).toBe(false)
  })

  it('maps Redis db key to DB label and path', () => {
    const key = resourceTreeKey('p1', { segments: [{ kind: 'db', name: '2' }] })
    const snap = snapshotFromTreeKey(key, [profile('redis')])
    expect(snap?.path).toEqual([{ kind: 'db', name: '2' }])
    expect(snap?.label).toBe('DB 2')
    expect(hasObjectHint(snap)).toBe(true)
  })

  it('maps SQL table key onto path', () => {
    const key = resourceTreeKey('p1', {
      segments: [
        { kind: 'database', name: 'app' },
        { kind: 'schema', name: 'public' },
        { kind: 'table', name: 'orders' },
      ],
    })
    const snap = snapshotFromTreeKey(key, [profile('postgres')])
    expect(snap).toMatchObject({
      path: [
        { kind: 'database', name: 'app' },
        { kind: 'schema', name: 'public' },
        { kind: 'table', name: 'orders' },
      ],
      label: 'app.public.orders',
    })
  })

  it('maps Mongo collection onto path', () => {
    const key = resourceTreeKey('p1', {
      segments: [
        { kind: 'database', name: 'app' },
        { kind: 'collection', name: 'users' },
      ],
    })
    const snap = snapshotFromTreeKey(key, [profile('mongodb')])
    expect(snap?.path).toEqual([
      { kind: 'database', name: 'app' },
      { kind: 'collection', name: 'users' },
    ])
    expect(snap?.label).toBe('app.users')
  })

  it('returns null when profile is missing', () => {
    expect(
      snapshotFromTreeKey(resourceTreeKey('missing', { segments: [{ kind: 'db', name: '0' }] }), [
        profile('redis'),
      ]),
    ).toBeNull()
  })
})
