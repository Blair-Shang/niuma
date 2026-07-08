export type RsScrollbarType = 'auto' | 'always' | 'scroll' | 'hover'

export type RsScrollbarOrientation = 'vertical' | 'horizontal' | 'both'

export function resolveScrollbarSize(size: number | string | undefined): string | undefined {
  if (size === undefined) {
    return undefined
  }
  return typeof size === 'number' ? `${size}px` : size
}
