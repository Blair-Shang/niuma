import { describe, expect, it, vi } from 'vitest'
import type { ApiFolder, ApiRequest } from '../types'
import {
  allowApiTreeDrop,
  apiCollectionSearchMatch,
  buildCollectionTreeNodes,
  folderTreeKey,
  handleApiTreeDrop,
  isApiFolderNode,
  isApiRequestNode,
  requestTreeKey,
} from './collection-tree'

function req(id: string, name = id): ApiRequest {
  return {
    id,
    name,
    method: 'GET',
    url: `/${name}`,
    params: [],
    headers: [],
    auth: { type: 'none' },
    bodyMode: 'none',
    body: '',
    bodyForm: [],
  }
}

function folder(id: string, parentId: string | null, requests: ApiRequest[] = []): ApiFolder {
  return { id, name: id, parentId, vars: {}, requests }
}

function sample(): ApiFolder[] {
  return [
    folder('root', null, [req('r1')]),
    folder('child', 'root', [req('r2')]),
    folder('leaf', 'child'),
    folder('other', null, [req('r3')]),
  ]
}

describe('collection-tree', () => {
  it('builds folders then requests, and cuts parentId cycles', () => {
    const nodes = buildCollectionTreeNodes(sample())
    expect(nodes.map((node) => node._folderId)).toEqual(['root', 'other'])
    const root = nodes[0]
    expect(root && isApiFolderNode(root)).toBe(true)
    const kids = root && isApiFolderNode(root) ? root.children ?? [] : []
    expect(kids.some((node) => isApiFolderNode(node) && node._folderId === 'child')).toBe(true)
    expect(kids.some((node) => isApiRequestNode(node) && node._requestId === 'r1')).toBe(true)

    const cyclic: ApiFolder[] = [
      folder('top', null),
      folder('a', 'b'),
      folder('b', 'a'),
    ]
    const cyclicNodes = buildCollectionTreeNodes(cyclic)
    expect(cyclicNodes.map((node) => node._folderId)).toEqual(['top'])
    expect(cyclicNodes[0]?.children ?? []).toEqual([])
  })

  it('matches search on folder name or request haystack', () => {
    const nodes = buildCollectionTreeNodes(sample())
    const root = nodes[0]!
    const request = (root.children ?? []).find(isApiRequestNode)!
    expect(apiCollectionSearchMatch(root, 'root')).toBe(true)
    expect(apiCollectionSearchMatch(request, 'GET')).toBe(true)
    expect(apiCollectionSearchMatch(request, 'nope')).toBe(false)
  })

  it('rejects folder drops that would cycle or exceed depth', () => {
    const folders = sample()
    expect(allowApiTreeDrop(folders, folderTreeKey('root'), folderTreeKey('leaf'), 'inside')).toBe(false)
    expect(allowApiTreeDrop(folders, folderTreeKey('other'), folderTreeKey('leaf'), 'inside')).toBe(false)
    expect(allowApiTreeDrop(folders, folderTreeKey('other'), folderTreeKey('root'), 'inside')).toBe(true)
    expect(allowApiTreeDrop(folders, requestTreeKey('r1'), folderTreeKey('other'), 'inside')).toBe(true)
    expect(allowApiTreeDrop(folders, requestTreeKey('r1'), requestTreeKey('r3'), 'after')).toBe(true)
    expect(allowApiTreeDrop(folders, folderTreeKey('root'), requestTreeKey('r3'), 'after')).toBe(false)
  })

  it('routes drop to the matching mutation', () => {
    const mutations = {
      moveRequest: vi.fn(() => true),
      reorderRequest: vi.fn(() => true),
      moveFolder: vi.fn(() => true),
      reorderFolder: vi.fn(() => true),
    }
    expect(handleApiTreeDrop(mutations, requestTreeKey('r1'), folderTreeKey('other'), 'inside')).toBe(true)
    expect(mutations.moveRequest).toHaveBeenCalledWith('r1', 'other')
    expect(handleApiTreeDrop(mutations, folderTreeKey('other'), folderTreeKey('root'), 'inside')).toBe(true)
    expect(mutations.moveFolder).toHaveBeenCalledWith('other', 'root')
    expect(handleApiTreeDrop(mutations, folderTreeKey('other'), folderTreeKey('root'), 'after')).toBe(true)
    expect(mutations.reorderFolder).toHaveBeenCalledWith('other', 'root', 'after')
    expect(handleApiTreeDrop(mutations, requestTreeKey('r1'), requestTreeKey('r3'), 'before')).toBe(true)
    expect(mutations.reorderRequest).toHaveBeenCalledWith('r1', 'r3', 'before')
  })
})
