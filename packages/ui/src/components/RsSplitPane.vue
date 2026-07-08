<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRsI18n } from '../composables/useRsI18n'
import RsIcon from './RsIcon.vue'
import {
  applySplitResize,
  collapseSplitPane,
  expandSplitPane,
  isSplitPaneCollapsed,
  normalizeSplitSizes,
  resolveSplitConstraints,
  roundSize,
  splitSizesEqual,
  type RsSplitOrientation,
  type RsSplitPaneItem,
} from './split-pane-utils'

const props = withDefaults(
  defineProps<{
    /** 面板定义列表（顺序即渲染顺序） */
    panes: RsSplitPaneItem[]
    /** horizontal 左右 · vertical 上下 */
    orientation?: RsSplitOrientation
    /** 禁用拖拽 / 键盘调整 */
    disabled?: boolean
    /** 键盘方向键单步调整的百分比 */
    keyboardStep?: number
    /** 在分隔条中央展示抓手（grip）指示 */
    withHandle?: boolean
  }>(),
  {
    orientation: 'horizontal',
    disabled: false,
    keyboardStep: 4,
    withHandle: false,
  },
)

/** 各面板尺寸（百分比，总和 100） */
const model = defineModel<number[]>('sizes', { default: () => [] })

const emit = defineEmits<{
  /** 拖拽 / 键盘调整过程中持续触发 */
  resize: [sizes: number[]]
  /** 一次调整结束时触发（指针抬起、键盘按键或程序化操作） */
  'resize-end': [sizes: number[]]
  collapse: [key: string]
  expand: [key: string]
}>()

const { t } = useRsI18n()

const rootRef = ref<HTMLElement | null>(null)
const sizes = ref<number[]>([])

const constraints = computed(() => resolveSplitConstraints(props.panes))
const resizerCount = computed(() => Math.max(0, props.panes.length - 1))

/** 归一化初始值，作为双击复位的基准 */
let initialSizes: number[] = normalizeSplitSizes(props.panes, modelSeed())
sizes.value = initialSizes.slice()

function modelSeed(): number[] | undefined {
  return model.value && model.value.length === props.panes.length ? model.value : undefined
}

function paneKeySignature(): string {
  return props.panes.map((pane) => pane.key).join('|')
}

watch(
  () => paneKeySignature(),
  () => {
    const provided = sizes.value.length === props.panes.length ? sizes.value : undefined
    initialSizes = normalizeSplitSizes(props.panes, provided)
    sizes.value = initialSizes.slice()
    syncModel(sizes.value)
  },
)

watch(model, (value) => {
  if (!value || value.length !== props.panes.length) return
  if (splitSizesEqual(value, sizes.value)) return
  sizes.value = normalizeSplitSizes(props.panes, value)
})

function syncModel(next: number[]): void {
  if (!splitSizesEqual(model.value ?? [], next)) {
    model.value = next.slice()
  }
}

function commit(next: number[]): void {
  sizes.value = next
  syncModel(next)
  emit('resize', next.slice())
}

function emitBoundaryTransitions(before: number[], after: number[]): void {
  props.panes.forEach((pane, index) => {
    const constraint = constraints.value[index]
    const wasCollapsed = isSplitPaneCollapsed(before[index] ?? 0, constraint)
    const nowCollapsed = isSplitPaneCollapsed(after[index] ?? 0, constraint)
    if (!wasCollapsed && nowCollapsed) emit('collapse', pane.key)
    else if (wasCollapsed && !nowCollapsed) emit('expand', pane.key)
  })
}

// —— 指针拖拽 ——
let dragIndex: number | null = null
let dragOrigin = 0
let dragStartSizes: number[] = []
let flexPx = 0
let pendingDragSizes: number[] | null = null
let dragFrame = 0

function directPaneElements(root: HTMLElement): HTMLElement[] {
  return [...root.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('rs-split__pane'),
  )
}

function paneElements(): HTMLElement[] {
  const root = rootRef.value
  if (!root) return []
  return directPaneElements(root)
}

/** 拖拽过程中直接写 flex-grow，避免每帧触发 Vue 重渲染 */
function applyDragToDom(next: number[]): void {
  const panes = paneElements()
  next.forEach((size, i) => {
    panes[i]?.style.setProperty('flex-grow', String(size))
  })
}

function setDraggingUi(active: boolean, index: number): void {
  const root = rootRef.value
  if (!root) {
    return
  }
  root.classList.toggle('rs-split--dragging', active)
  const host = root.querySelector<HTMLElement>(`[data-resizer-index="${index}"]`)
  if (!host) {
    return
  }
  if (active) {
    host.setAttribute('data-active', '')
  } else {
    host.removeAttribute('data-active')
  }
}

function scheduleDragApply(next: number[]): void {
  pendingDragSizes = next
  if (dragFrame) {
    return
  }
  dragFrame = requestAnimationFrame(() => {
    dragFrame = 0
    if (pendingDragSizes) {
      applyDragToDom(pendingDragSizes)
    }
  })
}

function finishDrag(index: number): void {
  if (dragIndex !== index) {
    return
  }
  dragIndex = null
  if (dragFrame) {
    cancelAnimationFrame(dragFrame)
    dragFrame = 0
  }
  setDraggingUi(false, index)
  const final = pendingDragSizes ?? sizes.value
  pendingDragSizes = null
  commit(final)
  emitBoundaryTransitions(dragStartSizes, final)
  emit('resize-end', final.slice())
}

function axisSize(el: HTMLElement): number {
  return props.orientation === 'horizontal' ? el.offsetWidth : el.offsetHeight
}

/** 可伸缩空间的像素总量（不含分隔条），用于像素→百分比换算 */
function measureFlexPx(): number {
  const root = rootRef.value
  if (!root) return 0
  let sum = 0
  directPaneElements(root).forEach((el) => {
    sum += axisSize(el)
  })
  return sum
}

function onResizerPointerDown(index: number, event: PointerEvent): void {
  if (props.disabled) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)
  dragIndex = index
  dragOrigin = props.orientation === 'horizontal' ? event.clientX : event.clientY
  dragStartSizes = sizes.value.slice()
  pendingDragSizes = dragStartSizes
  flexPx = measureFlexPx()
  setDraggingUi(true, index)
  event.preventDefault()
}

function onResizerPointerMove(index: number, event: PointerEvent): void {
  if (dragIndex !== index || flexPx <= 0) return
  const position = props.orientation === 'horizontal' ? event.clientX : event.clientY
  const deltaPercent = ((position - dragOrigin) / flexPx) * 100
  scheduleDragApply(applySplitResize(dragStartSizes, constraints.value, index, deltaPercent))
}

function endDrag(index: number, event: PointerEvent): void {
  if (dragIndex !== index) return
  const target = event.currentTarget as HTMLElement
  target.releasePointerCapture?.(event.pointerId)
  finishDrag(index)
}

// —— 键盘无障碍 ——
function onResizerKeydown(index: number, event: KeyboardEvent): void {
  if (props.disabled) return
  const horizontal = props.orientation === 'horizontal'
  const step = props.keyboardStep
  let delta = 0
  switch (event.key) {
    case 'ArrowLeft':
      if (horizontal) delta = -step
      break
    case 'ArrowRight':
      if (horizontal) delta = step
      break
    case 'ArrowUp':
      if (!horizontal) delta = -step
      break
    case 'ArrowDown':
      if (!horizontal) delta = step
      break
    case 'Home':
      delta = -100
      break
    case 'End':
      delta = 100
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      toggleCollapseAt(index)
      return
    default:
      return
  }
  if (delta === 0) return
  event.preventDefault()
  const before = sizes.value.slice()
  commit(applySplitResize(sizes.value, constraints.value, index, delta))
  emitBoundaryTransitions(before, sizes.value)
  emit('resize-end', sizes.value.slice())
}

function onResizerDblClick(index: number): void {
  if (props.disabled) return
  const a = sizes.value[index]
  const b = sizes.value[index + 1]
  const initA = initialSizes[index]
  const initB = initialSizes[index + 1]
  if (a === undefined || b === undefined || initA === undefined || initB === undefined) return
  const total = a + b
  const initTotal = initA + initB
  const targetA = initTotal > 0 ? (initA / initTotal) * total : total / 2
  const next = sizes.value.slice()
  next[index] = roundSize(targetA)
  next[index + 1] = roundSize(total - targetA)
  const before = sizes.value.slice()
  commit(next)
  emitBoundaryTransitions(before, sizes.value)
  emit('resize-end', sizes.value.slice())
}

/** 分隔条 index 两侧择一可折叠面板进行折叠/展开切换 */
function collapsibleCandidate(index: number): number {
  if (constraints.value[index]?.collapsible) return index
  if (constraints.value[index + 1]?.collapsible) return index + 1
  return -1
}

function toggleCollapseAt(index: number): void {
  const candidate = collapsibleCandidate(index)
  if (candidate < 0) return
  const before = sizes.value.slice()
  const collapsed = isSplitPaneCollapsed(sizes.value[candidate] ?? 0, constraints.value[candidate])
  const next = collapsed
    ? expandSplitPane(sizes.value, constraints.value, candidate)
    : collapseSplitPane(sizes.value, constraints.value, candidate)
  commit(next)
  emitBoundaryTransitions(before, sizes.value)
  emit('resize-end', sizes.value.slice())
}

function paneStyle(index: number): Record<string, string> {
  const size = sizes.value[index] ?? 0
  return { flexGrow: String(size), flexShrink: '1', flexBasis: '0%' }
}

function paneCollapsed(index: number): boolean {
  return isSplitPaneCollapsed(sizes.value[index] ?? 0, constraints.value[index])
}

/** 分隔条 index（位于 panes[index] 与 panes[index+1] 之间）是否显示抓手 */
function resizerShowsHandle(index: number): boolean {
  const pane = props.panes[index]
  if (pane?.resizerHandle !== undefined) {
    return pane.resizerHandle
  }
  return props.withHandle
}

// —— 程序化 API ——
function indexOfKey(key: string): number {
  return props.panes.findIndex((pane) => pane.key === key)
}

function collapse(key: string): void {
  const index = indexOfKey(key)
  if (index < 0) return
  const before = sizes.value.slice()
  commit(collapseSplitPane(sizes.value, constraints.value, index))
  emitBoundaryTransitions(before, sizes.value)
  emit('resize-end', sizes.value.slice())
}

function expand(key: string, toSize?: number): void {
  const index = indexOfKey(key)
  if (index < 0) return
  const before = sizes.value.slice()
  commit(expandSplitPane(sizes.value, constraints.value, index, toSize))
  emitBoundaryTransitions(before, sizes.value)
  emit('resize-end', sizes.value.slice())
}

function reset(): void {
  initialSizes = normalizeSplitSizes(props.panes)
  commit(initialSizes.slice())
  emit('resize-end', sizes.value.slice())
}

defineExpose({ collapse, expand, reset, getSizes: () => sizes.value.slice() })
</script>

<template>
  <div
    ref="rootRef"
    class="rs-split"
    :class="[
      `rs-split--${orientation}`,
      { 'rs-split--disabled': disabled },
    ]"
  >
    <template v-for="(pane, index) in panes" :key="pane.key">
      <div
        class="rs-split__pane"
        :class="{ 'rs-split__pane--collapsed': paneCollapsed(index) }"
        :style="paneStyle(index)"
        :data-pane-key="pane.key"
      >
        <slot :name="pane.key" :size="sizes[index]" :collapsed="paneCollapsed(index)" />
      </div>

      <div
        v-if="index < resizerCount"
        class="rs-split__resizer-host"
        :class="{ 'rs-split__resizer-host--handle': resizerShowsHandle(index) }"
        :data-resizer-index="index"
        @pointerdown="onResizerPointerDown(index, $event)"
        @pointermove="onResizerPointerMove(index, $event)"
        @pointerup="endDrag(index, $event)"
        @pointercancel="endDrag(index, $event)"
      >
        <hr
          class="rs-split__resizer"
          :class="{ 'rs-split__resizer--handle': resizerShowsHandle(index) }"
          :tabindex="disabled ? -1 : 0"
          :aria-orientation="orientation === 'horizontal' ? 'vertical' : 'horizontal'"
          :aria-valuenow="Math.round(sizes[index] ?? 0)"
          :aria-valuemin="Math.round(constraints[index]?.min ?? 0)"
          :aria-valuemax="Math.round(constraints[index]?.max ?? 100)"
          :aria-label="t('split.resize')"
          :aria-disabled="disabled || undefined"
          @keydown="onResizerKeydown(index, $event)"
          @dblclick="onResizerDblClick(index)"
        />
        <span v-if="resizerShowsHandle(index)" class="rs-split__grip" aria-hidden="true">
          <RsIcon
            :name="orientation === 'horizontal' ? 'grip-vertical' : 'grip-horizontal'"
            :size="12"
          />
        </span>
      </div>
    </template>
  </div>
</template>

<style>
.rs-split {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  isolation: isolate;
  /* macOS 风格 resize 光标：两侧纤细箭头 + 中央分隔竖条，白芯 + 半透明描边，热点居中 */
  --rs-split-cursor-h: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cg fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7,8.5L3,12L7,15.5M3,12H8.5M17,8.5L21,12L17,15.5M21,12H15.5' stroke='%23000' stroke-opacity='.38' stroke-width='2.6'/%3E%3Cpath d='M12,6V18' stroke='%23000' stroke-opacity='.3' stroke-width='2.6'/%3E%3Cpath d='M7,8.5L3,12L7,15.5M3,12H8.5M17,8.5L21,12L17,15.5M21,12H15.5' stroke='%23fff' stroke-width='1.1'/%3E%3Cpath d='M12,6V18' stroke='%23fff' stroke-width='1.1'/%3E%3C/g%3E%3C/svg%3E") 12 12, ew-resize;
  --rs-split-cursor-v: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cg fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8.5,7L12,3L15.5,7M12,3V8.5M8.5,17L12,21L15.5,17M12,21V15.5' stroke='%23000' stroke-opacity='.38' stroke-width='2.6'/%3E%3Cpath d='M6,12H18' stroke='%23000' stroke-opacity='.3' stroke-width='2.6'/%3E%3Cpath d='M8.5,7L12,3L15.5,7M12,3V8.5M8.5,17L12,21L15.5,17M12,21V15.5' stroke='%23fff' stroke-width='1.1'/%3E%3Cpath d='M6,12H18' stroke='%23fff' stroke-width='1.1'/%3E%3C/g%3E%3C/svg%3E") 12 12, ns-resize;
}

.rs-split--horizontal {
  flex-direction: row;
}

.rs-split--vertical {
  flex-direction: column;
}

.rs-split__pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.rs-split__pane--collapsed {
  overflow: hidden;
}

.rs-split__resizer-host {
  position: relative;
  z-index: 10;
  flex: 0 0 1px;
  align-self: stretch;
  min-width: 0;
  min-height: 0;
  touch-action: none;
  user-select: none;
}

.rs-split__resizer {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
  margin: 0;
  padding: 0;
  background: var(--rs-border-subtle);
  opacity: 0.5;
  transition:
    background var(--rs-transition-normal),
    opacity var(--rs-transition-normal);
}

.rs-split__resizer-host:hover .rs-split__resizer,
.rs-split__resizer-host[data-active] .rs-split__resizer {
  opacity: 1;
}

.rs-split--dragging .rs-split__resizer {
  transition: none;
}

.rs-split--dragging .rs-split__grip {
  transition: none;
}

/* 隐形命中区：向两侧扩展，不占布局尺寸 */
.rs-split__resizer-host::before {
  content: '';
  position: absolute;
  z-index: 1;
}

.rs-split--horizontal > .rs-split__resizer-host {
  cursor: var(--rs-split-cursor-h);
}

.rs-split--horizontal > .rs-split__resizer-host::before {
  inset: 0 -4px;
}

.rs-split--vertical > .rs-split__resizer-host {
  cursor: var(--rs-split-cursor-v);
}

.rs-split--vertical > .rs-split__resizer-host::before {
  inset: -4px 0;
}

/* 拖拽中：整个容器沿用同一光标，指针移出细缝也不闪回默认 */
.rs-split--horizontal.rs-split--dragging {
  cursor: var(--rs-split-cursor-h);
}

.rs-split--vertical.rs-split--dragging {
  cursor: var(--rs-split-cursor-v);
}

.rs-split__resizer-host:hover .rs-split__resizer,
.rs-split__resizer:hover,
.rs-split__resizer-host[data-active] .rs-split__resizer {
  background: var(--rs-border);
  opacity: 1;
}

.rs-split__resizer:focus-visible {
  outline: none;
  background: var(--rs-primary);
  opacity: 1;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.rs-split--disabled > .rs-split__resizer-host {
  cursor: default;
}

.rs-split--disabled > .rs-split__resizer-host:hover .rs-split__resizer {
  background: var(--rs-border);
}

/* 抓手指示（仅 withHandle 时常驻显示，悬浮不额外浮现胶囊） */
.rs-split__resizer--handle {
  background: var(--rs-border-subtle);
}

.rs-split__grip {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
  border-radius: var(--rs-radius-full);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-elevated);
  color: var(--rs-placeholder);
  box-shadow: var(--rs-shadow-sm);
  pointer-events: none;
  opacity: 0;
  transition:
    opacity var(--rs-transition-fast),
    color var(--rs-transition-fast),
    background var(--rs-transition-fast),
    border-color var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast);
}

.rs-split--horizontal > .rs-split__resizer-host--handle .rs-split__grip {
  width: 0.875rem;
  height: 1.5rem;
}

.rs-split--vertical > .rs-split__resizer-host--handle .rs-split__grip {
  width: 1.5rem;
  height: 0.875rem;
}

/* 悬浮 / 聚焦 / 拖拽：常驻抓手高亮为主色 */
.rs-split:not(.rs-split--disabled) > .rs-split__resizer-host--handle:hover .rs-split__grip,
.rs-split:not(.rs-split--disabled)
  > .rs-split__resizer-host--handle:has(.rs-split__resizer:focus-visible)
  .rs-split__grip,
.rs-split:not(.rs-split--disabled) > .rs-split__resizer-host--handle[data-active] .rs-split__grip {
  opacity: 1;
  color: var(--rs-primary-foreground);
  border-color: var(--rs-primary);
  background: var(--rs-primary);
  box-shadow: var(--rs-shadow);
}

/* 禁用态：抓手淡化 */
.rs-split--disabled .rs-split__grip {
  opacity: 0.5;
  box-shadow: none;
}

/* 拖拽中：屏蔽子内容命中，避免选中/iframe 抢占指针 */
.rs-split--dragging .rs-split__pane {
  pointer-events: none;
  user-select: none;
}
</style>
