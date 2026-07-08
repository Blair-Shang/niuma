export type RsVirtualListItemSize = number | ((index: number) => number)

export function resolveItemSize(itemSize: RsVirtualListItemSize, index = 0): number {
  const size = typeof itemSize === 'function' ? itemSize(index) : itemSize
  return Number.isFinite(size) && size > 0 ? size : 32
}

export function resolveVirtualListHeight(height?: number | string, fallback = 240): string {
  if (height === undefined) return `${fallback}px`
  return typeof height === 'number' ? `${height}px` : height
}
