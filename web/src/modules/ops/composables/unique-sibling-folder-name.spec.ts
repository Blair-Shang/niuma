import { describe, expect, it } from 'vitest'
import { uniqueSiblingFolderName } from './useConnFolders'

describe('uniqueSiblingFolderName', () => {
  it('keeps the name when no sibling occupies it', () => {
    expect(uniqueSiblingFolderName('新建文件夹', [])).toBe('新建文件夹')
    expect(uniqueSiblingFolderName('新建文件夹', ['其他'])).toBe('新建文件夹')
  })

  it('appends incrementing digits for same-level duplicates', () => {
    expect(uniqueSiblingFolderName('新建文件夹', ['新建文件夹'])).toBe('新建文件夹1')
    expect(uniqueSiblingFolderName('新建文件夹', ['新建文件夹', '新建文件夹1'])).toBe('新建文件夹2')
    expect(uniqueSiblingFolderName('新建文件夹', ['新建文件夹', '新建文件夹2'])).toBe('新建文件夹1')
  })
})
