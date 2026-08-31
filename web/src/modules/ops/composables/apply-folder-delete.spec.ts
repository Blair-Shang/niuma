import { describe, expect, it } from 'vitest'
import { connTreeKey, folderTreeKey } from '@/modules/ops/conn-tree/keys'
import { applyFolderDelete, type ConnFolder } from './useConnFolders'

function folder(
  id: string,
  parentId: string | null,
  profileIds: string[] = [],
): ConnFolder {
  return { id, name: id, expanded: true, profileIds, parentId }
}

describe('applyFolderDelete', () => {
  it('moves connections of a root folder to that slot in rootOrder', () => {
    const folders = [folder('a', null, ['p1', 'p2']), folder('b', null)]
    const rootOrder = [folderTreeKey('a'), folderTreeKey('b')]
    const next = applyFolderDelete(folders, rootOrder, 'a')
    expect(next.folders.map((f) => f.id)).toEqual(['b'])
    expect(next.rootOrder).toEqual([connTreeKey('p1'), connTreeKey('p2'), folderTreeKey('b')])
  })

  it('moves connections of a nested folder into the parent', () => {
    const folders = [folder('p', null, ['keep']), folder('c', 'p', ['x'])]
    const next = applyFolderDelete(folders, [folderTreeKey('p')], 'c')
    expect(next.folders).toHaveLength(1)
    expect(next.folders[0]?.profileIds).toEqual(['keep', 'x'])
    expect(next.rootOrder).toEqual([folderTreeKey('p')])
  })
})
