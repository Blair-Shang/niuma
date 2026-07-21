import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { dialogViewportSize, readDialogViewportInsets } from './dialog-viewport'

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

export function useRsDialogWindow(options: {
  open: Ref<boolean>
  widthPreset: Ref<RsDialogWidth>
  draggable: Ref<boolean>
  resizable: Ref<boolean>
  compact?: Ref<boolean>
  /** 全屏/还原时是否播放 left/top/width/height 过渡（含编辑器时建议 false） */
  boundsTransition?: Ref<boolean>
}) {
  const isFullscreen = ref(false)
  const boundsTransitionEnabled = ref(false)
  const bounds = ref<RsDialogBounds>({ x: 0, y: 0, width: widthMap.md, height: minHeight })
  const restoreBounds = ref<RsDialogBounds | null>(null)
  const resizeHandles: RsDialogResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  let boundsTransitionTimer: ReturnType<typeof setTimeout> | null = null
  let cachedInsets = readDialogViewportInsets()

  let dragState: { startX: number; startY: number; origin: RsDialogBounds } | null = null
  let resizeState: {
    handle: RsDialogResizeHandle
    startX: number
    startY: number
    origin: RsDialogBounds
  } | null = null

  function defaultWindowSize(): Pick<RsDialogBounds, 'width' | 'height'> {
    const { width: maxW, height: maxH } = dialogViewportSize()
    return {
      width: Math.min(maxW, Math.max(minWidth, Math.round(maxW * defaultWidthRatio))),
      height: Math.min(maxH, Math.max(minHeight, Math.round(maxH * defaultHeightRatio))),
    }
  }

  function refreshCachedInsets(): void {
    cachedInsets = readDialogViewportInsets()
  }

  function clampBounds(next: RsDialogBounds): RsDialogBounds {
    const insets = cachedInsets
    const maxW = window.innerWidth - insets.left - insets.right
    const maxH = window.innerHeight - insets.top - insets.bottom
    const width = Math.min(maxW, Math.max(minWidth, next.width))
    const height = Math.min(maxH, Math.max(minHeight, next.height))
    return {
      x: Math.min(window.innerWidth - width - insets.right, Math.max(insets.left, next.x)),
      y: Math.min(window.innerHeight - height - insets.bottom, Math.max(insets.top, next.y)),
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
    refreshCachedInsets()
    const insets = cachedInsets
    const { width, height } = defaultWindowSize()
    const availableH = window.innerHeight - insets.top - insets.bottom
    bounds.value = clampBounds({
      x: insets.left + (window.innerWidth - insets.left - insets.right - width) / 2,
      y: insets.top + (availableH - height) / 2,
      width,
      height,
    })
  }

  watch(
    options.open,
    (value) => {
      if (value) resetOnOpen()
      else stopInteractions()
    },
    // 弹出等场景：组件挂载时 open 已为 true，需立即居中，不能只等 false→true
    { immediate: true },
  )

  const dialogStyle = computed(() => {
    const insets = cachedInsets
    if (isFullscreen.value) {
      return {
        left: `${insets.left}px`,
        top: `${insets.top}px`,
        width: `calc(100vw - ${insets.left + insets.right}px)`,
        height: `calc(100vh - ${insets.top + insets.bottom}px)`,
        transform: 'none',
      }
    }
    if (options.compact?.value) {
      const width = widthMap[options.widthPreset.value]
      return {
        left: '50%',
        top: `calc(${insets.top}px + (100vh - ${insets.top + insets.bottom}px) / 2)`,
        width: `${width}px`,
        maxWidth: `calc(100vw - ${insets.left + insets.right}px)`,
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

  function clearBoundsTransitionTimer(): void {
    if (!boundsTransitionTimer) return
    clearTimeout(boundsTransitionTimer)
    boundsTransitionTimer = null
  }

  function enableBoundsTransition(): void {
    boundsTransitionEnabled.value = true
    clearBoundsTransitionTimer()
    boundsTransitionTimer = setTimeout(() => {
      boundsTransitionEnabled.value = false
      boundsTransitionTimer = null
    }, 280)
  }

  function toggleFullscreen(): void {
    refreshCachedInsets()
    if (options.boundsTransition?.value) {
      enableBoundsTransition()
    }
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
    boundsTransitionEnabled.value = false
    clearBoundsTransitionTimer()
    refreshCachedInsets()
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

  onBeforeUnmount(() => {
    stopInteractions()
    clearBoundsTransitionTimer()
  })

  return {
    isFullscreen,
    boundsTransitionEnabled,
    dialogStyle,
    resizeHandles,
    toggleFullscreen,
    onHeaderPointerDown,
    onResizePointerDown,
  }
}
