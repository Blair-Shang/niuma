import { describe, expect, it } from 'vitest'
import { getPaginationRange, slicePageData } from '../components/pagination-utils'
import { formatFileSize, validateUploadFiles } from '../components/upload-utils'

describe('new Rs UI utilities', () => {
  it('creates compact pagination ranges', () => {
    expect(getPaginationRange(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10])
    expect(slicePageData([1, 2, 3, 4], 2, 2)).toEqual([3, 4])
  })

  it('validates uploads', () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    const result = validateUploadFiles([file], { accept: '.txt', maxSize: 100 })
    expect(result.accepted).toHaveLength(1)
    expect(formatFileSize(1024)).toBe('1.0 KB')
  })
})
