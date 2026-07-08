export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

export function getPageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize))
}

export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, page), Math.max(1, pageCount))
}

export function getPaginationRange(page: number, pageCount: number, siblingCount = 1): Array<number | 'ellipsis'> {
  const totalNumbers = siblingCount * 2 + 5
  if (pageCount <= totalNumbers) return Array.from({ length: pageCount }, (_, index) => index + 1)

  const leftSibling = Math.max(page - siblingCount, 1)
  const rightSibling = Math.min(page + siblingCount, pageCount)
  const showLeftEllipsis = leftSibling > 2
  const showRightEllipsis = rightSibling < pageCount - 1

  if (!showLeftEllipsis && showRightEllipsis) {
    return [...Array.from({ length: 3 + siblingCount * 2 }, (_, index) => index + 1), 'ellipsis', pageCount]
  }
  if (showLeftEllipsis && !showRightEllipsis) {
    const start = pageCount - (2 + siblingCount * 2)
    return [1, 'ellipsis', ...Array.from({ length: 3 + siblingCount * 2 }, (_, index) => start + index)]
  }
  return [1, 'ellipsis', ...Array.from({ length: rightSibling - leftSibling + 1 }, (_, index) => leftSibling + index), 'ellipsis', pageCount]
}

export function slicePageData<T>(data: readonly T[], page: number, pageSize: number): T[] {
  const start = (clampPage(page, getPageCount(data.length, pageSize)) - 1) * pageSize
  return data.slice(start, start + pageSize)
}

export function createPageSizeSelectOptions(options: readonly number[] = DEFAULT_PAGE_SIZE_OPTIONS) {
  return options.map((value) => ({ label: String(value), value: String(value) }))
}
