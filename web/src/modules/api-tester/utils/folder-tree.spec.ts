import { describe, expect, it } from 'vitest'
import {
  canAddChildFolder,
  canNestFolder,
  childFolders,
  collectDescendantFolderIds,
  folderDepth,
  folderSubtreeHeight,
  materializeFolderRequests,
  normalizeFolderGraph,
  parentChainCycles,
  scopeForRequest,
} from './folder-tree'
import type { ApiFolder } from '../types'

function sampleFolders(): ApiFolder[] {
  return [
    { id: 'root', name: 'Root', parentId: null, vars: { org: 'acme' }, requests: [] },
    { id: 'child', name: 'Child', parentId: 'root', vars: { apiPrefix: '/v1' }, requests: [] },
    {
      id: 'leaf',
      name: 'Leaf',
      parentId: 'child',
      vars: {},
      requests: [
        {
          id: 'hit',
          name: 'Hit',
          method: 'GET',
          url: '{{baseUrl}}{{apiPrefix}}/x',
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
}

describe('folder-tree', () => {
  it('builds variable scope from request folder', () => {
    const folders = sampleFolders()
    const scope = scopeForRequest(folders, { vars: { envName: 'dev' } }, 'hit')
    expect(scope.folderId).toBe('leaf')
    expect(scope.globals?.vars.envName).toBe('dev')
  })

  it('measures depth and child eligibility', () => {
    const folders = sampleFolders()
    expect(folderDepth(folders, 'root')).toBe(1)
    expect(folderDepth(folders, 'leaf')).toBe(3)
    expect(canAddChildFolder(folders, 'leaf')).toBe(false)
    expect(canAddChildFolder(folders, 'child')).toBe(true)
    expect(folderSubtreeHeight(folders, 'leaf')).toBe(1)
    expect(folderSubtreeHeight(folders, 'root')).toBe(3)
    expect(canNestFolder(folders, 'root', 'leaf')).toBe(false)
    expect(canNestFolder(folders, 'leaf', 'root')).toBe(true)
  })

  it('collects descendants and requests', () => {
    const folders = sampleFolders()
    expect(collectDescendantFolderIds(folders, 'root')).toEqual(['root', 'child', 'leaf'])
    expect(materializeFolderRequests(folders, 'root')).toHaveLength(1)
    expect(childFolders(folders, 'root').map((item) => item.id)).toEqual(['child'])
  })

  it('breaks parentId cycles instead of hanging', () => {
    const cyclic: ApiFolder[] = [
      { id: 'a', name: 'A', parentId: 'b', vars: {}, requests: [] },
      { id: 'b', name: 'B', parentId: 'a', vars: {}, requests: [] },
    ]
    expect(parentChainCycles(cyclic, 'a')).toBe(true)
    expect(folderDepth(cyclic, 'a')).toBeGreaterThan(3)
    expect(collectDescendantFolderIds(cyclic, 'a')).toEqual(['a', 'b'])
    normalizeFolderGraph(cyclic)
    expect(cyclic.some((folder) => folder.parentId === null)).toBe(true)
    expect(cyclic.every((folder) => !parentChainCycles(cyclic, folder.id))).toBe(true)
  })
})
