import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

export type RsDialogWidth = 'sm' | 'md' | 'lg'
export type RsDialogResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface RsDialogBounds {
  x: number
  y: number
  width: number
  height: number
}

const widthMap: Record<RsDialogWidth, number> = {
  sm: 384,
  md: 448,
  lg: 512,
}

const defaultWidthRatio = 0.8
const defaultHeightRatio = 0.75
const minWidth = 320
const minHeight = 240
const viewportGap = 16

export function useRsDialogWindow(options: {
  open: Ref<boolean>
  widthPreset: Ref<RsDialogWidth>
  draggable: Ref<boolean>
  resizable: Ref<boolean>
  compact?: Ref<boolean>
}) {
  const isFullscreen = ref(false)
  const bounds = ref<RsDialogBounds>({ x: 0, y: 0, width: widthMap.md, height: minHeight })
  const restoreBounds = ref<RsDialogBounds | null>(null)
  const resizeHandles: RsDialogResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  let dragState: { startX: number; startY: number; origin: RsDialogBounds } | null = null
  let resizeState: {
    handle: RsDialogResizeHandle
    startX: number
    startY: number
    origin: RsDialogBounds
  } | null = null

  function defaultWindowSize(): Pick<RsDialogBounds, 'width' | 'height'> {
    const maxW = window.innerWidth - viewportGap * 2
    const maxH = window.innerHeight - viewportGap * 2
    return {
      width: Math.min(maxW, Math.max(minWidth, Math.round(window.innerWidth * defaultWidthRatio))),
      height: Math.min(maxH, Math.max(minHeight, Math.round(window.innerHeight * defaultHeightRatio))),
    }
  }

  function clampBounds(next: RsDialogBounds): RsDialogBounds {
    const maxW = window.innerWidth - viewportGap * 2
    const maxH = window.innerHeight - viewportGap * 2
    const width = Math.min(maxW, Math.max(minWidth, next.width))
    const height = Math.min(maxH, Math.max(minHeight, next.height))
    return {
      x: Math.min(window.innerWidth - width - viewportGap, Math.max(viewportGap, next.x)),
      y: Math.min(window.innerHeight - height - viewportGap, Math.max(viewportGap, next.y)),
      width,
      height,
    }
  }

  function resetOnOpen(): void {
    isFullscreen.value = false
    restoreBounds.value = null
    if (options.compact?.value) {
      bounds.value = { x: bounds.value.x, y: bounds.value.y, width: widthMap[options.widthPreset.value], height: 0 }
      return
    }
    const { width, height } = defaultWindowSize()
    bounds.value = clampBounds({
      x: (window.innerWidth - width) / 2,
      y: (window.innerHeight - height) / 2,
      width,
      height,
    })
  }

  watch(options.open, (value) => {
    if (value) resetOnOpen()
    else stopInteractions()
  })

  const dialogStyle = computed(() => {
    if (isFullscreen.value) {
      return {
        left: `${viewportGap}px`,
        top: `${viewportGap}px`,
        width: `calc(100vw - ${viewportGap * 2}px)`,
        height: `calc(100vh - ${viewportGap * 2}px)`,
        transform: 'none',
      }
    }
    if (options.compact?.value) {
      const width = widthMap[options.widthPreset.value]
      return {
        left: '50%',
        top: '50%',
        width: `${width}px`,
        maxWidth: `calc(100vw - ${viewportGap * 2}px)`,
        height: 'auto',
        transform: 'translate(-50%, -50%)',
      }
    }
    const b = bounds.value
    return {
      left: `${b.x}px`,
      top: `${b.y}px`,
      width: `${b.width}px`,
      height: `${b.height}px`,
      transform: 'none',
    }
  })

  function toggleFullscreen(): void {
    if (isFullscreen.value) {
      isFullscreen.value = false
      bounds.value = restoreBounds.value ? { ...restoreBounds.value } : bounds.value
      restoreBounds.value = null
      return
    }
    restoreBounds.value = { ...bounds.value }
    isFullscreen.value = true
  }

  function onPointerMove(event: PointerEvent): void {
    if (dragState) {
      const dx = event.clientX - dragState.startX
      const dy = event.clientY - dragState.startY
      bounds.value = clampBounds({ ...dragState.origin, x: dragState.origin.x + dx, y: dragState.origin.y + dy })
      return
    }

    if (!resizeState) return
    const dx = event.clientX - resizeState.startX
    const dy = event.clientY - resizeState.startY
    const next = { ...resizeState.origin }
    if (resizeState.handle.includes('e')) next.width = resizeState.origin.width + dx
    if (resizeState.handle.includes('w')) {
      next.width = resizeState.origin.width - dx
      next.x = resizeState.origin.x + dx
    }
    if (resizeState.handle.includes('s')) next.height = resizeState.origin.height + dy
    if (resizeState.handle.includes('n')) {
      next.height = resizeState.origin.height - dy
      next.y = resizeState.origin.y + dy
    }
    bounds.value = clampBounds(next)
  }

  function stopInteractions(): void {
    dragState = null
    resizeState = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', stopInteractions)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }

  function startInteraction(cursor: string): void {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopInteractions)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = cursor
  }

  function onHeaderPointerDown(event: PointerEvent): void {
    if (!options.draggable.value || isFullscreen.value) return
    const target = event.target as HTMLElement
    if (target.closest('button,a,input,textarea,select')) return
    event.preventDefault()
    dragState = { startX: event.clientX, startY: event.clientY, origin: { ...bounds.value } }
    startInteraction('grabbing')
  }

  const resizeCursor: Record<RsDialogResizeHandle, string> = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
  }

  function onResizePointerDown(handle: RsDialogResizeHandle, event: PointerEvent): void {
    if (!options.resizable.value || isFullscreen.value) return
    event.preventDefault()
    resizeState = { handle, startX: event.clientX, startY: event.clientY, origin: { ...bounds.value } }
    startInteraction(resizeCursor[handle])
  }

  onBeforeUnmount(stopInteractions)

  return {
    isFullscreen,
    dialogStyle,
    resizeHandles,
    toggleFullscreen,
    onHeaderPointerDown,
    onResizePointerDown,
  }
}
