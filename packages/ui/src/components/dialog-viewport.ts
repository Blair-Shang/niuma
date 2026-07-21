const viewportGap = 16

export interface RsDialogViewportInsets {
  top: number
  right: number
  bottom: number
  left: number
}

function parseCssPx(value: string, fallback: number): number {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  const num = Number.parseFloat(trimmed)
  if (Number.isNaN(num)) return fallback
  if (trimmed.endsWith('rem')) {
    const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    return num * rootPx
  }
  return num
}

/** 读取对话框可用视口 inset（px），未设置时回退 viewportGap。 */
export function readDialogViewportInsets(): RsDialogViewportInsets {
  if (typeof document === 'undefined') {
    return { top: viewportGap, right: viewportGap, bottom: viewportGap, left: viewportGap }
  }
  const root = getComputedStyle(document.documentElement)
  const x = parseCssPx(root.getPropertyValue('--rs-dialog-inset-x'), viewportGap)
  return {
    top: parseCssPx(root.getPropertyValue('--rs-dialog-inset-top'), viewportGap),
    right: x,
    bottom: parseCssPx(root.getPropertyValue('--rs-dialog-inset-bottom'), viewportGap),
    left: x,
  }
}

export function dialogViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 800, height: 600 }
  }
  const insets = readDialogViewportInsets()
  return {
    width: window.innerWidth - insets.left - insets.right,
    height: window.innerHeight - insets.top - insets.bottom,
  }
}

export { viewportGap }
