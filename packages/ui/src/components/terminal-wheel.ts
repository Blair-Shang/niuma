import type { Terminal } from 'xterm'

export type RsTerminalWheelScrollModifier = 'none' | 'shift'

/** 视口是否已滚入 scrollback（非底部跟随） */
export function isTerminalViewportScrolledUp(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active
  return buffer.viewportY < buffer.baseY
}

/**
 * 滚轮策略：默认滚轮不翻 scrollback，转为方向键发给 PTY（避免 top/vim 类全屏 TUI 错位）；
 * 按住 Shift 时滚轮才滚动历史。
 */
export function attachWheelScrollGuard(
  hostEl: HTMLElement,
  options: {
    modifier: () => RsTerminalWheelScrollModifier
    inputEnabled: () => boolean
    onArrowKeys: (data: string) => void
  },
): () => void {
  const viewport = hostEl.querySelector<HTMLElement>('.xterm-viewport')
  if (!viewport) {
    return () => undefined
  }

  const handler = (ev: WheelEvent): void => {
    if (options.modifier() === 'none') {
      return
    }
    if (ev.shiftKey) {
      return
    }
    ev.preventDefault()
    ev.stopImmediatePropagation()
    if (!options.inputEnabled() || ev.deltaY === 0) {
      return
    }
    const steps = Math.min(5, Math.max(1, Math.round(Math.abs(ev.deltaY) / 40)))
    const seq = ev.deltaY > 0 ? '\x1b[B' : '\x1b[A'
    options.onArrowKeys(seq.repeat(steps))
  }

  viewport.addEventListener('wheel', handler, { capture: true, passive: false })
  return () => {
    viewport.removeEventListener('wheel', handler, { capture: true })
  }
}
