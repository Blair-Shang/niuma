import { describe, expect, it } from 'vitest'
import { materializeTargets, validateRunProfile } from './run-plan'
import type { ApiFolder, ApiRunProfile } from '../types'

const folders: ApiFolder[] = [
  {
    id: 'shop',
    name: 'Shop',
    parentId: null,
    vars: {},
    requests: [
      {
        id: 'list',
        name: 'List',
        method: 'GET',
        url: '/items',
        params: [],
        headers: [],
        auth: { type: 'none' },
        bodyMode: 'none',
        body: '',
        bodyForm: [],
      },
    ],
  },
  {
    id: 'nested',
    name: 'Nested',
    parentId: 'shop',
    vars: {},
    requests: [
      {
        id: 'detail',
        name: 'Detail',
        method: 'GET',
        url: '/items/1',
        params: [],
        headers: [],
        auth: { type: 'none' },
        bodyMode: 'none',
        body: '',
        bodyForm: [],
      },
    ],
  },
]

function profile(partial: Partial<ApiRunProfile>): ApiRunProfile {
  return {
    id: 'run-1',
    name: 'Demo',
    kind: 'request',
    targetIds: [],
    concurrency: 1,
    iterations: 1,
    enabled: true,
    ...partial,
  }
}

describe('run-plan', () => {
  it('validates and materializes request targets', () => {
    const item = profile({ kind: 'request', targetIds: ['list', 'missing'] })
    expect(validateRunProfile(item, folders)).toContain('unknown request')
    const ok = profile({ kind: 'request', targetIds: ['list'] })
    expect(validateRunProfile(ok, folders)).toBeNull()
    expect(materializeTargets(folders, ok).map((req) => req.id)).toEqual(['list'])
  })

  it('materializes folder and collection targets', () => {
    const folderRun = profile({ kind: 'folder', targetIds: ['shop'] })
    expect(materializeTargets(folders, folderRun).map((req) => req.id)).toEqual(['list', 'detail'])
    const collectionRun = profile({ kind: 'collection', targetIds: ['ignored'] })
    expect(materializeTargets(folders, collectionRun).map((req) => req.id)).toEqual(['list', 'detail'])
  })
})
