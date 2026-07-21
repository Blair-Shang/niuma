import { nextTick, onUnmounted, ref, type Ref } from 'vue'

export const RS_TABLE_TIP_ATTR = 'data-rs-table-tip'
export const RS_TABLE_TIP_MODE_ATTR = 'data-rs-table-tip-mode'
export const RS_TABLE_TIP_TEXT_ATTR = 'data-rs-table-tip-text'
/** 列头 headerTip：整表共享浮层，悬停 th-label 显示 */
export const RS_TABLE_HEADER_TIP_ATTR = 'data-rs-table-header-tip'

const TIP_SIDE_OFFSET = 6
const TIP_VIEWPORT_PAD = 8
const TIP_HIDE_GRACE_MS = 80

export interface TableCellTooltipState {
  visible: boolean
  ready: boolean
  text: string
  kind: 'cell' | 'header'
  style: { left: string; top: string }
}

function isHeaderTipHost(host: HTMLElement): boolean {
  return host.hasAttribute(RS_TABLE_HEADER_TIP_ATTR)
}

function findTipHost(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const header = target.closest(`[${RS_TABLE_HEADER_TIP_ATTR}]`)
  if (header instanceof HTMLElement) return header
  const cell = target.closest(`[${RS_TABLE_TIP_ATTR}], .rs-table__cell-tip`)
  return cell instanceof HTMLElement ? cell : null
}

function resolveMeasureEl(host: HTMLElement): HTMLElement {
  if (host.classList.contains('rs-table__ellipsis-text')) return host
  const inner = host.querySelector('.rs-table__ellipsis-text')
  return inner instanceof HTMLElement ? inner : host
}

function resolveTipText(host: HTMLElement): string | null {
  if (isHeaderTipHost(host)) {
    const text = host.getAttribute(RS_TABLE_HEADER_TIP_ATTR)?.trim()
    return text || null
  }

  if (host.hasAttribute(RS_TABLE_TIP_ATTR)) {
    const text = host.getAttribute(RS_TABLE_TIP_ATTR)?.trim()
    return text || null
  }

  const mode = host.getAttribute(RS_TABLE_TIP_MODE_ATTR)
  if (!mode) return null

  const text = host.getAttribute(RS_TABLE_TIP_TEXT_ATTR)?.trim() ?? ''
  if (mode === 'always') return text || null

  if (mode === 'overflow') {
    const measure = resolveMeasureEl(host)
    if (measure.scrollWidth <= measure.clientWidth) return null
    return text || measure.textContent?.trim() || null
  }

  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function useTableCellTooltip(options: {
  enabled: () => boolean
  /** 列头 headerTip 共享浮层；默认 true */
  headerEnabled?: () => boolean
  delay: () => number
  tipRef: Ref<HTMLElement | null>
}): {
  state: Ref<TableCellTooltipState>
  onPointerOver: (event: PointerEvent) => void
  onPointerOut: (event: PointerEvent) => void
  hide: () => void
} {
  const state = ref<TableCellTooltipState>({
    visible: false,
    ready: false,
    text: '',
    kind: 'cell',
    style: { left: '0', top: '0' },
  })

  let tipHost: HTMLElement | null = null
  let showTimer = 0
  let hideTimer = 0
  let positionRaf = 0

  function clearTimers(): void {
    if (showTimer) {
      clearTimeout(showTimer)
      showTimer = 0
    }
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = 0
    }
  }

  function cancelPositionRaf(): void {
    if (positionRaf) {
      cancelAnimationFrame(positionRaf)
      positionRaf = 0
    }
  }

  function positionTip(host: HTMLElement): void {
    const tipEl = options.tipRef.value
    if (!tipEl) return

    const hostRect = host.getBoundingClientRect()
    const tipRect = tipEl.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left: number
    let top: number

    if (isHeaderTipHost(host)) {
      left = hostRect.left
      top = hostRect.bottom + TIP_SIDE_OFFSET
      if (top + tipRect.height > vh - TIP_VIEWPORT_PAD) {
        top = hostRect.top - tipRect.height - TIP_SIDE_OFFSET
      }
    } else {
      left = hostRect.left + hostRect.width / 2 - tipRect.width / 2
      top = hostRect.top - tipRect.height - TIP_SIDE_OFFSET
      if (top < TIP_VIEWPORT_PAD) {
        top = hostRect.bottom + TIP_SIDE_OFFSET
      }
    }

    left = clamp(left, TIP_VIEWPORT_PAD, Math.max(TIP_VIEWPORT_PAD, vw - tipRect.width - TIP_VIEWPORT_PAD))
    top = clamp(top, TIP_VIEWPORT_PAD, Math.max(TIP_VIEWPORT_PAD, vh - tipRect.height - TIP_VIEWPORT_PAD))

    state.value.style = {
      left: `${left}px`,
      top: `${top}px`,
    }
    state.value.ready = true
  }

  function hide(): void {
    clearTimers()
    cancelPositionRaf()
    tipHost = null
    state.value.visible = false
    state.value.ready = false
    state.value.text = ''
    state.value.kind = 'cell'
  }

  function show(host: HTMLElement, text: string): void {
    tipHost = host
    state.value.text = text
    state.value.kind = isHeaderTipHost(host) ? 'header' : 'cell'
    state.value.ready = false
    state.value.visible = true

    cancelPositionRaf()
    nextTick(() => {
      positionRaf = requestAnimationFrame(() => {
        positionRaf = 0
        if (tipHost === host) positionTip(host)
      })
    })
  }

  function scheduleShow(host: HTMLElement): void {
    const header = isHeaderTipHost(host)
    if (header) {
      if (options.headerEnabled && !options.headerEnabled()) return
    } else if (!options.enabled()) {
      return
    }

    const text = resolveTipText(host)
    if (!text) {
      hide()
      return
    }

    clearTimers()
    if (tipHost !== host) tipHost = host

    const delay = options.delay()
    if (delay <= 0) {
      show(host, text)
      return
    }

    showTimer = window.setTimeout(() => {
      showTimer = 0
      if (tipHost === host) show(host, text)
    }, delay)
  }

  function scheduleHide(): void {
    clearTimers()
    hideTimer = window.setTimeout(hide, TIP_HIDE_GRACE_MS)
  }

  function onPointerOver(event: PointerEvent): void {
    if (event.pointerType === 'touch') return

    const host = findTipHost(event.target)
    if (!host) {
      if (tipHost) scheduleHide()
      return
    }

    if (host === tipHost && state.value.visible) return
    if (tipHost && host !== tipHost) hide()
    scheduleShow(host)
  }

  function onPointerOut(event: PointerEvent): void {
    const related = event.relatedTarget
    if (related instanceof Element && findTipHost(related)) return
    scheduleHide()
  }

  onUnmounted(() => {
    clearTimers()
    cancelPositionRaf()
  })

  return {
    state,
    onPointerOver,
    onPointerOut,
    hide,
  }
}
