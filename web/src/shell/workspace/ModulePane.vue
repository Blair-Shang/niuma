<script setup lang="ts">
/**
 * 模块工作区内部布局脚手架 —— 为单个工具提供「内部导航（module-sidebar）+ 主区
 * + 输出/日志（bottom-panel）」三区容器，对齐 VS Code 的视图容器概念。
 *
 * 与全局 SideNav/ActivityBar 无关：那是跨模块导航，本组件是**模块内部**的次级导航
 * 与输出区。侧栏、面板均可折叠 + 拖拽调整尺寸；开合状态支持 `v-model` 由模块控制。
 *
 * 用法：
 * ```vue
 * <ModulePane :sidebar-title="t('...')" panel-title="Output" v-model:panel-open="showLog">
 *   <template #sidebar>...内部导航...</template>
 *   <template #toolbar>...主区工具条...</template>
 *   ...主区内容...
 *   <template #panel>...输出/日志...</template>
 * </ModulePane>
 * ```
 *
 * @see docs/09-web-app-shell.md 第 7 节「模块工作区约定」
 */
import { RsIcon } from '@niuma/ui'
import { onBeforeUnmount, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 侧栏标题 */
    sidebarTitle?: string
    /** 面板标题 */
    panelTitle?: string
    /** 侧栏初始宽度(px) */
    sidebarWidth?: number
    /** 面板初始高度(px) */
    panelHeight?: number
  }>(),
  {
    sidebarTitle: '',
    panelTitle: '',
    sidebarWidth: 240,
    panelHeight: 200,
  },
)

/** 侧栏开合（可由模块 v-model 控制） */
const sidebarOpen = defineModel<boolean>('sidebarOpen', { default: true })
/** 底部面板开合（可由模块 v-model 控制） */
const panelOpen = defineModel<boolean>('panelOpen', { default: false })

const sidebarW = ref(props.sidebarWidth)
const panelH = ref(props.panelHeight)

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480
const PANEL_MIN = 96
const PANEL_MAX = 560

/** 当前拖拽的清理函数（组件卸载时兜底移除监听） */
let stopDrag: (() => void) | null = null

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/**
 * 通用拖拽：按 pointer 位移更新尺寸。
 *
 * @param event - pointerdown 事件
 * @param onMove - 依据位移量计算并写入新尺寸
 */
function beginDrag(event: PointerEvent, onMove: (dx: number, dy: number) => void): void {
  event.preventDefault()
  const startX = event.clientX
  const startY = event.clientY
  const move = (ev: PointerEvent): void => onMove(ev.clientX - startX, ev.clientY - startY)
  const up = (): void => {
    globalThis.removeEventListener('pointermove', move)
    globalThis.removeEventListener('pointerup', up)
    stopDrag = null
    document.body.style.removeProperty('cursor')
  }
  stopDrag = up
  globalThis.addEventListener('pointermove', move)
  globalThis.addEventListener('pointerup', up)
}

/** 拖拽调整侧栏宽度 */
function resizeSidebar(event: PointerEvent): void {
  const start = sidebarW.value
  document.body.style.cursor = 'col-resize'
  beginDrag(event, (dx) => {
    sidebarW.value = clamp(start + dx, SIDEBAR_MIN, SIDEBAR_MAX)
  })
}

/** 拖拽调整面板高度（面板在底部，向上拖增高） */
function resizePanel(event: PointerEvent): void {
  const start = panelH.value
  document.body.style.cursor = 'row-resize'
  beginDrag(event, (_dx, dy) => {
    panelH.value = clamp(start - dy, PANEL_MIN, PANEL_MAX)
  })
}

onBeforeUnmount(() => stopDrag?.())
</script>

<template>
  <div class="nm-pane">
    <div class="nm-pane__body">
      <!-- 内部导航（module-sidebar） -->
      <aside v-if="sidebarOpen" class="nm-pane__sidebar" :style="{ width: `${sidebarW}px` }">
        <header class="nm-pane__sidebar-head">
          <span class="nm-pane__sidebar-title">{{ sidebarTitle }}</span>
          <span class="nm-pane__sidebar-actions">
            <slot name="sidebar-actions" />
            <button
              type="button"
              class="nm-pane__icon-btn"
              :aria-label="'collapse sidebar'"
              @click="sidebarOpen = false"
            >
              <RsIcon name="chevron-left" :size="14" />
            </button>
          </span>
        </header>
        <div class="nm-pane__sidebar-body">
          <slot name="sidebar" />
        </div>
      </aside>

      <!-- 侧栏折叠后的展开轨 -->
      <button
        v-else
        type="button"
        class="nm-pane__rail"
        :aria-label="'expand sidebar'"
        @click="sidebarOpen = true"
      >
        <RsIcon name="chevron-right" :size="14" />
      </button>

      <!-- 侧栏 ↔ 主区 拖拽条 -->
      <div
        v-if="sidebarOpen"
        class="nm-pane__resizer nm-pane__resizer--x"
        @pointerdown="resizeSidebar"
      />

      <!-- 主区 -->
      <div class="nm-pane__main">
        <div v-if="$slots.toolbar || panelTitle" class="nm-pane__toolbar">
          <div class="nm-pane__toolbar-slot">
            <slot name="toolbar" />
          </div>
          <button
            v-if="panelTitle"
            type="button"
            class="nm-pane__icon-btn"
            :class="{ 'nm-pane__icon-btn--active': panelOpen }"
            :aria-label="'toggle panel'"
            @click="panelOpen = !panelOpen"
          >
            <RsIcon :name="panelOpen ? 'chevron-down' : 'chevron-up'" :size="14" />
          </button>
        </div>
        <div class="nm-pane__content">
          <slot />
        </div>
      </div>
    </div>

    <!-- 主区 ↔ 面板 拖拽条 -->
    <div v-if="panelOpen" class="nm-pane__resizer nm-pane__resizer--y" @pointerdown="resizePanel" />

    <!-- 输出/日志（bottom-panel） -->
    <section v-if="panelOpen" class="nm-pane__panel" :style="{ height: `${panelH}px` }">
      <header class="nm-pane__panel-head">
        <span class="nm-pane__panel-title">{{ panelTitle }}</span>
        <span class="nm-pane__panel-actions">
          <slot name="panel-actions" />
          <button
            type="button"
            class="nm-pane__icon-btn"
            :aria-label="'close panel'"
            @click="panelOpen = false"
          >
            <RsIcon name="x" :size="14" />
          </button>
        </span>
      </header>
      <div class="nm-pane__panel-body">
        <slot name="panel" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.nm-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.nm-pane__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.nm-pane__sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  border-right: 1px solid var(--rs-border-subtle);
  background: var(--nm-frame-bg);
}

.nm-pane__sidebar-head,
.nm-pane__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  height: 2rem;
  padding: 0 0.25rem 0 0.75rem;
  flex-shrink: 0;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.nm-pane__sidebar-title,
.nm-pane__panel-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-pane__sidebar-actions,
.nm-pane__panel-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  flex-shrink: 0;
}

.nm-pane__sidebar-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.25rem;
}

.nm-pane__rail {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: 1.5rem;
  padding-top: 0.5rem;
  flex-shrink: 0;
  border: none;
  border-right: 1px solid var(--rs-border-subtle);
  background: var(--nm-frame-bg);
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-pane__rail:hover {
  color: var(--rs-text);
  background: var(--rs-item-hover);
}

.nm-pane__main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.nm-pane__toolbar {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  height: 2rem;
  padding: 0 0.375rem 0 0.75rem;
  flex-shrink: 0;
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-pane__toolbar-slot {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex: 1;
  min-width: 0;
}

.nm-pane__content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.nm-pane__panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
  border-top: 1px solid var(--rs-border-subtle);
  background: var(--nm-editor-bg);
}

.nm-pane__panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.5rem 0.75rem;
}

.nm-pane__resizer {
  flex-shrink: 0;
  background: transparent;
  transition: background var(--rs-transition-fast);
}

.nm-pane__resizer:hover {
  background: var(--rs-primary);
}

.nm-pane__resizer--x {
  width: 3px;
  margin: 0 -1px;
  cursor: col-resize;
}

.nm-pane__resizer--y {
  height: 3px;
  margin: -1px 0;
  cursor: row-resize;
}

.nm-pane__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.nm-pane__icon-btn:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-pane__icon-btn--active {
  color: var(--rs-primary);
}
</style>
