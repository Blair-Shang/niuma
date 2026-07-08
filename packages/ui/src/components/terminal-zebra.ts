import type { Terminal } from 'xterm'

export type TerminalZebraStripesHandle = {
  refresh: () => void
  dispose: () => void
}

function readRowHeight(hostEl: HTMLElement, fallbackRowHeight: number): number {
  const rowEl = hostEl.querySelector<HTMLElement>('.xterm-rows > div, .xterm-row')
  if (!rowEl) {
    return fallbackRowHeight
  }
  const height = rowEl.getBoundingClientRect().height
  return height > 0 ? height : fallbackRowHeight
}

/**
 * 斑马纹：CSS repeating-linear-gradient 铺满整行（含行尾空白），
 * 与视口滚动偏移同步；xterm 默认格 allowTransparency 透出底层条纹。
 */
export function createTerminalZebraStripes(
  terminal: Terminal,
  layerEl: HTMLElement,
  hostEl: HTMLElement,
  options: {
    enabled: () => boolean
    fallbackRowHeight: number
  },
): TerminalZebraStripesHandle {
  const disposables = [
    terminal.onRender(() => refresh()),
    terminal.onScroll(() => refresh()),
  ]

  function refresh(): void {
    if (!options.enabled()) {
      layerEl.style.display = 'none'
      return
    }
    layerEl.style.display = 'block'
    const rowHeight = readRowHeight(hostEl, options.fallbackRowHeight)
    const offsetY = -(terminal.buffer.active.viewportY % 2) * rowHeight
    layerEl.style.setProperty('--rs-terminal-zebra-step', `${rowHeight}px`)
    layerEl.style.setProperty('--rs-terminal-zebra-offset', `${offsetY}px`)
  }

  refresh()

  return {
    refresh,
    dispose() {
      layerEl.style.display = 'none'
      for (const disposable of disposables) {
        disposable.dispose()
      }
    },
  }
}
