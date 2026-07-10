export type RsVirtualListItemSize = number | ((index: number) => number)

export function resolveItemSize(itemSize: RsVirtualListItemSize, index = 0): number {
  const size = typeof itemSize === 'function' ? itemSize(index) : itemSize
  return Number.isFinite(size) && size > 0 ? size : 32
}

export function resolveVirtualListHeight(height?: number | string, fallback = 240): string | undefined {
  if (height === 0) return undefined
  if (height === undefined) return `${fallback}px`
  return typeof height === 'number' ? `${height}px` : height
}

/** height 为 0 时由父级 flex 撑满，组件内用 ResizeObserver 测量可视高度 */
export function isVirtualListFillHeight(height?: number | string): boolean {
  return height === 0
}
