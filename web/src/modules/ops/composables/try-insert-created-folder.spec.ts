import { describe, expect, it } from 'vitest'
import { folderTreeKey } from '@/modules/ops/conn-tree/keys'
import { tryInsertCreatedFolder, type ConnFolderNode, type ConnTreeNode } from './useConnTree'
import type { ConnFolder } from './useConnFolders'
import type { ConnItem } from '../types'

function folder(id: string, name: string, parentId: string | null = null): ConnFolder {
  return { id, name, expanded: true, profileIds: [], parentId }
}

function folderNode(f: ConnFolder, children: ConnTreeNode[] = []): ConnFolderNode {
  return {
    key: folderTreeKey(f.id),
    label: f.name,
    _type: 'folder',
    _folder: { ...f },
    children,
  }
}

describe('tryInsertCreatedFolder', () => {
  const conns: ConnItem[] = []

  it('appends a root folder without rebuilding existing nodes', () => {
    const a = folder('a', 'A')
    const b = folder('b', 'B')
    const nodeA = folderNode(a)
    const prevNodes = [nodeA]
    const next = tryInsertCreatedFolder(
      prevNodes,
      [a],
      [a, b],
      conns,
      conns,
      [folderTreeKey('a')],
      [folderTreeKey('a'), folderTreeKey('b')],
    )
    expect(next).not.toBeNull()
    expect(next).toHaveLength(2)
    expect(next![0]).toBe(nodeA)
    expect(next![1]?.key).toBe(folderTreeKey('b'))
    expect(next![1]?.label).toBe('B')
  })

  it('inserts a subfolder after sibling folders and keeps other branches', () => {
    const parent = folder('p', 'P')
    const sibling = folder('s', 'S', 'p')
    const created = folder('c', 'C', 'p')
    const siblingNode = folderNode(sibling)
    const parentNode = folderNode(parent, [siblingNode])
    const next = tryInsertCreatedFolder(
      [parentNode],
      [parent, sibling],
      [parent, sibling, created],
      conns,
      conns,
      [folderTreeKey('p')],
      [folderTreeKey('p')],
    )
    expect(next).not.toBeNull()
    expect(next![0]).not.toBe(parentNode)
    const children = (next![0] as ConnFolderNode).children as ConnTreeNode[]
    expect(children[0]).toBe(siblingNode)
    expect(children[1]?.key).toBe(folderTreeKey('c'))
  })

  it('falls back when connections change', () => {
    const a = folder('a', 'A')
    expect(
      tryInsertCreatedFolder(
        [folderNode(a)],
        [a],
        [a, folder('b', 'B')],
        conns,
        [{} as ConnItem],
        [folderTreeKey('a')],
        [folderTreeKey('a'), folderTreeKey('b')],
      ),
    ).toBeNull()
  })
})
