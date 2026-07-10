<script setup lang="ts">
import { RsConfirmDialog, RsContextMenu, RsIcon, RsPopover, type RsContextMenuItem } from '@niuma/ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabStore, type WorkspaceTab } from '@/stores/tab'
import { useSessionActionStore } from '@/stores/session-actions'
import { beginTabDrag, draggingGroupId, draggingTabId, endTabDrag } from '../workspace/tab-dnd'

/** 本 TabBar 归属的编辑组 id（分屏后每组各一条 Tab 栏） */
const props = defineProps<{ groupId: string }>()

const tabStore = useTabStore()
const sessionActionStore = useSessionActionStore()
const { t } = useI18n()

/** 本组对象（渲染期间恒存在） */
const group = computed(() => tabStore.groups.find((g) => g.groupId === props.groupId))
/** 本组的 Tab 列表 */
const tabs = computed<WorkspaceTab[]>(() => group.value?.tabs ?? [])
/** 是否为当前激活组（多组时高亮） */
const isActiveGroup = computed(() => tabStore.activeGroupId === props.groupId)
/** 是否已分屏（决定是否显示「关闭本组」按钮） */
const hasSplit = computed(() => tabStore.groups.length > 1)

// 关闭确认：统一「待执行动作 + 描述」模型，单个关闭与批量关闭共用一个对话框
const confirmOpen = ref(false)
const confirmDesc = ref('')
let confirmAction: (() => void) | null = null

/** 拖拽悬停到的目标 Tab id（显示插入指示线） */
const dragOverId = ref<string | null>(null)

const listRef = ref<HTMLElement | null>(null)
const canScrollPrev = ref(false)
const canScrollNext = ref(false)
const hiddenTabs = ref<WorkspaceTab[]>([])
const overflowOpen = ref(false)

let listResizeObserver: ResizeObserver | null = null

/** Tab 显示标题：自定义 title 优先，否则用 i18n 键（随语言切换更新） */
function tabLabel(tab: WorkspaceTab): string {
  if (tab.title) {
    return tab.title
  }
  return tab.titleKey ? t(tab.titleKey) : tab.moduleId
}

/**
 * 有脏 Tab 时弹确认框，否则立即执行。
 *
 * @param dirtyCount - 受影响的脏 Tab 数（>0 才确认）
 * @param desc - 确认框描述文案
 * @param action - 确认后执行的关闭动作
 */
function runOrConfirm(dirtyCount: number, desc: string, action: () => void): void {
  if (dirtyCount > 0) {
    confirmDesc.value = desc
    confirmAction = action
    confirmOpen.value = true
    return
  }
  action()
}

/** 确认框「确定」 */
function onConfirm(): void {
  confirmAction?.()
  confirmAction = null
}

/** 确认框「取消」 */
function onCancel(): void {
  confirmAction = null
}

/**
 * 关闭单个 Tab：脏则确认，干净直接关闭。
 *
 * @param tab - 目标 Tab
 */
function requestClose(tab: WorkspaceTab): void {
  if (!tab.closable) {
    return
  }
  runOrConfirm(
    tab.dirty ? 1 : 0,
    t('workspace.confirmCloseDesc', { name: tabLabel(tab) }),
    () => tabStore.closeTab(tab.tabId),
  )
}

/**
 * 构建某 Tab 的右键菜单项（作用域限本组）。
 *
 * @param tab - 目标 Tab
 */
function menuItems(tab: WorkspaceTab): RsContextMenuItem[] {
  const list = tabs.value
  const index = list.findIndex((t) => t.tabId === tab.tabId)
  const closableOthers = list.filter((t) => t.tabId !== tab.tabId && t.closable).length
  const closableRight = list.filter((t, i) => i > index && t.closable).length
  const closableAll = list.filter((t) => t.closable).length
  const items: RsContextMenuItem[] = []
  if (tab.moduleId === 'ftp' || tab.moduleId === 'ssh') {
    items.push(
      { key: 'reconnect', label: t('workspace.ctxReconnect'), icon: 'refresh-cw' },
      { key: 'sep-reconnect', label: '', separator: true },
    )
  }
  items.push(
    { key: 'close', label: t('workspace.ctxClose'), icon: 'x', disabled: !tab.closable },
    { key: 'closeOthers', label: t('workspace.ctxCloseOthers'), icon: 'circle-minus', disabled: closableOthers === 0 },
    { key: 'closeRight', label: t('workspace.ctxCloseRight'), icon: 'arrow-right-to-line', disabled: closableRight === 0 },
    {
      key: 'closeAll',
      label: t('workspace.ctxCloseAll'),
      icon: 'circle-x',
      danger: true,
      disabled: closableAll === 0,
    },
    { key: 'sep-split', label: '', separator: true },
    { key: 'split', label: t('workspace.ctxSplit'), icon: 'columns-2' },
  )
  return items
}

/** 统计本组满足条件的可关闭脏 Tab 数量（用于批量关闭前的确认） */
function dirtyCountOf(predicate: (tab: WorkspaceTab, index: number) => boolean): number {
  return tabs.value.filter((t, i) => t.closable && t.dirty && predicate(t, i)).length
}

/**
 * 右键菜单选择分发（批量操作前统一走脏 Tab 确认）。
 *
 * @param tab - 触发菜单的 Tab
 * @param key - 选中的菜单项 key
 */
function onMenuSelect(tab: WorkspaceTab, key: string): void {
  const index = tabs.value.findIndex((t) => t.tabId === tab.tabId)
  const manyDesc = (count: number): string => t('workspace.confirmCloseManyDesc', { count })
  if (key === 'reconnect') {
    const profileId = tab.props?.profileId as string | undefined
    if (profileId) sessionActionStore.requestReconnect(profileId)
  } else if (key === 'close') {
    requestClose(tab)
  } else if (key === 'closeOthers') {
    const n = dirtyCountOf((t) => t.tabId !== tab.tabId)
    runOrConfirm(n, manyDesc(n), () => tabStore.closeOthers(tab.tabId))
  } else if (key === 'closeRight') {
    const n = dirtyCountOf((_, i) => i > index)
    runOrConfirm(n, manyDesc(n), () => tabStore.closeToRight(tab.tabId))
  } else if (key === 'closeAll') {
    const n = dirtyCountOf(() => true)
    runOrConfirm(n, manyDesc(n), () => tabStore.closeAll(tab.tabId))
  } else if (key === 'split') {
    tabStore.splitGroup(props.groupId)
  }
}

/**
 * 激活 Tab。设置页现为普通编辑器 Tab，不再需要回退路由的特殊处理——
 * 直接激活即可，路由同步由 ModuleWorkspace 的 Tab→路由 watch 负责。
 *
 * @param tab - 被点击的 Tab
 */
function focusTab(tab: WorkspaceTab): void {
  tabStore.activateTab(tab.tabId)
  void scrollActiveTabIntoView()
}

/** 统计当前视口外（含部分被裁切）的 Tab */
function collectHiddenTabs(): WorkspaceTab[] {
  const el = listRef.value
  if (!el) return []
  const bounds = el.getBoundingClientRect()
  const hidden: WorkspaceTab[] = []
  for (const tab of tabs.value) {
    const tabEl = el.querySelector<HTMLElement>(`[data-tab-id="${tab.tabId}"]`)
    if (!tabEl) continue
    const rect = tabEl.getBoundingClientRect()
    if (rect.right <= bounds.left + 1 || rect.left >= bounds.right - 1) {
      hidden.push(tab)
    }
  }
  return hidden
}

/** 根据滚动位置与容器宽度更新滚动按钮与溢出菜单 */
function updateScrollState(): void {
  const el = listRef.value
  if (!el) {
    canScrollPrev.value = false
    canScrollNext.value = false
    hiddenTabs.value = []
    return
  }
  canScrollPrev.value = el.scrollLeft > 1
  canScrollNext.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
  hiddenTabs.value = collectHiddenTabs()
}

function scheduleLayout(): void {
  nextTick(() => {
    updateScrollState()
    nextTick(updateScrollState)
  })
}

function scrollList(direction: -1 | 1): void {
  listRef.value?.scrollBy({ left: direction * 160, behavior: 'smooth' })
}

async function scrollActiveTabIntoView(): Promise<void> {
  await nextTick()
  const el = listRef.value
  const activeId = group.value?.activeTabId
  if (!el || !activeId) return
  el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`)?.scrollIntoView({
    inline: 'nearest',
    block: 'nearest',
    behavior: 'smooth',
  })
  updateScrollState()
}

/** 标签栏横向滚轮（触控板横向滑动或 Shift+滚轮） */
function onListWheel(event: WheelEvent): void {
  const el = listRef.value
  if (!el || el.scrollWidth <= el.clientWidth) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (delta === 0) return
  event.preventDefault()
  el.scrollBy({ left: delta })
}

const overflowLabel = computed(() => {
  const activeId = group.value?.activeTabId
  if (activeId && hiddenTabs.value.some((tab) => tab.tabId === activeId)) {
    const active = tabs.value.find((tab) => tab.tabId === activeId)
    return active ? tabLabel(active) : t('workspace.tabsMore')
  }
  const count = hiddenTabs.value.length
  return count > 0 ? t('workspace.tabsMoreCount', { count }) : t('workspace.tabsMore')
})

function selectOverflowTab(tab: WorkspaceTab): void {
  overflowOpen.value = false
  focusTab(tab)
}

watch(
  () => [tabs.value.length, tabs.value.map((tab) => tab.tabId).join('\0')] as const,
  () => scheduleLayout(),
)

watch(
  () => group.value?.activeTabId,
  () => {
    scheduleLayout()
    void scrollActiveTabIntoView()
  },
)

onMounted(() => {
  scheduleLayout()
  const el = listRef.value
  if (!el || typeof ResizeObserver === 'undefined') return
  listResizeObserver = new ResizeObserver(() => scheduleLayout())
  listResizeObserver.observe(el)
})

onUnmounted(() => {
  listResizeObserver?.disconnect()
  listResizeObserver = null
})

/** 在本组右侧分屏（打开当前激活 Tab 模块的新实例） */
function splitHere(): void {
  tabStore.splitGroup(props.groupId)
}

/** 关闭本编辑组（脏 Tab 先确认） */
function closeGroupHere(): void {
  const n = dirtyCountOf(() => true)
  runOrConfirm(n, t('workspace.confirmCloseManyDesc', { count: n }), () =>
    tabStore.closeGroup(props.groupId),
  )
}

/**
 * 开始拖拽某 Tab（写入跨组共享状态，供目标组 drop 判定同组/跨组）。
 *
 * @param tab - 被拖拽的 Tab
 * @param event - dragstart 事件
 */
function onDragStart(tab: WorkspaceTab, event: DragEvent): void {
  beginTabDrag(tab.tabId, props.groupId)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    // Firefox 需要写入数据才会真正启动拖拽
    event.dataTransfer.setData('text/plain', tab.tabId)
  }
}

/**
 * 拖拽悬停到某 Tab 上（记录目标以显示指示线）。
 *
 * @param tab - 悬停到的 Tab
 * @param event - dragover 事件
 */
function onDragOver(tab: WorkspaceTab, event: DragEvent): void {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  if (draggingTabId.value && draggingTabId.value !== tab.tabId) {
    dragOverId.value = tab.tabId
  }
}

/**
 * 放到某 Tab 上：同组排序或跨组移动到该位置。
 *
 * @param target - 放置到的目标 Tab
 */
function onDropTab(target: WorkspaceTab): void {
  const dragged = draggingTabId.value
  if (dragged && dragged !== target.tabId) {
    const toIndex = tabs.value.findIndex((t) => t.tabId === target.tabId)
    if (toIndex !== -1) {
      if (draggingGroupId.value === props.groupId) {
        tabStore.moveTab(dragged, toIndex)
      } else {
        tabStore.moveTabToGroup(dragged, props.groupId, toIndex)
      }
    }
  }
  onDragEnd()
}

/** 放到 Tab 栏空白处：把 Tab 追加到本组末尾（跨组时即移动到本组） */
function onDropStrip(): void {
  const dragged = draggingTabId.value
  if (dragged && draggingGroupId.value !== props.groupId) {
    tabStore.moveTabToGroup(dragged, props.groupId)
  }
  onDragEnd()
}

/** 结束拖拽：清理本地与共享状态 */
function onDragEnd(): void {
  dragOverId.value = null
  endTabDrag()
}
</script>

<template>
  <div
    v-if="tabs.length"
    class="nm-tabbar flex shrink-0 items-center border-b"
    :class="{ 'nm-tabbar--active': isActiveGroup && hasSplit }"
    style="height: var(--nm-tabbar-h); border-color: var(--rs-border-subtle); background: var(--nm-frame-bg)"
    @dragover.prevent
    @drop.prevent="onDropStrip"
  >
    <div class="nm-tabbar__nav flex min-w-0 flex-1 items-center">
      <button
        v-if="canScrollPrev"
        type="button"
        class="nm-tabbar__scroll"
        :aria-label="t('workspace.tabsScrollPrev')"
        :title="t('workspace.tabsScrollPrev')"
        @click="scrollList(-1)"
      >
        <RsIcon name="chevron-left" :size="14" />
      </button>

      <div
        ref="listRef"
        class="nm-tabbar__list flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        @scroll="updateScrollState"
        @wheel="onListWheel"
      >
        <RsContextMenu
          v-for="tab in tabs"
          :key="tab.tabId"
          class="nm-tabbar__slot"
          :items="menuItems(tab)"
          @select="(key: string) => onMenuSelect(tab, key)"
        >
          <div
            role="tab"
            tabindex="0"
            draggable="true"
            class="nm-tab"
            :data-tab-id="tab.tabId"
            :class="{
              'nm-tab--active': tab.tabId === group?.activeTabId,
              'nm-tab--dragging': tab.tabId === draggingTabId,
              'nm-tab--dragover': tab.tabId === dragOverId,
            }"
            :aria-selected="tab.tabId === group?.activeTabId"
            :title="tabLabel(tab)"
            @click="focusTab(tab)"
            @keydown.enter="focusTab(tab)"
            @mousedown.middle.prevent="requestClose(tab)"
            @dragstart="onDragStart(tab, $event)"
            @dragover.prevent="onDragOver(tab, $event)"
            @drop.prevent.stop="onDropTab(tab)"
            @dragend="onDragEnd"
          >
            <RsIcon v-if="tab.icon" :name="tab.icon" :size="14" class="nm-tab__icon" />
            <span class="nm-tab__label">{{ tabLabel(tab) }}</span>
            <span v-if="tab.dirty" class="nm-tab__dot" aria-hidden="true" />
            <button
              v-if="tab.closable"
              type="button"
              class="nm-tab__close"
              :aria-label="t('workspace.closeTab')"
              @click.stop="requestClose(tab)"
            >
              <RsIcon name="x" :size="12" />
            </button>
          </div>
        </RsContextMenu>
      </div>

      <button
        v-if="canScrollNext"
        type="button"
        class="nm-tabbar__scroll"
        :aria-label="t('workspace.tabsScrollNext')"
        :title="t('workspace.tabsScrollNext')"
        @click="scrollList(1)"
      >
        <RsIcon name="chevron-right" :size="14" />
      </button>

      <RsPopover
        v-if="hiddenTabs.length"
        v-model:open="overflowOpen"
        side="bottom"
        align="end"
        width="sm"
      >
        <button
          type="button"
          class="nm-tabbar__overflow"
          :class="{ 'nm-tabbar__overflow--active': hiddenTabs.some((tab) => tab.tabId === group?.activeTabId) }"
          :title="overflowLabel"
        >
          <span class="nm-tabbar__overflow-label">{{ overflowLabel }}</span>
          <RsIcon name="chevron-down" :size="12" class="nm-tabbar__overflow-icon" />
        </button>
        <template #content>
          <ul class="nm-tabbar__overflow-menu">
            <li v-for="tab in hiddenTabs" :key="tab.tabId">
              <button
                type="button"
                class="nm-tabbar__overflow-item"
                :class="{ 'nm-tabbar__overflow-item--active': tab.tabId === group?.activeTabId }"
                @click="selectOverflowTab(tab)"
              >
                <RsIcon v-if="tab.icon" :name="tab.icon" :size="14" class="nm-tabbar__overflow-item-icon" />
                <span class="nm-tabbar__overflow-item-label">{{ tabLabel(tab) }}</span>
                <span v-if="tab.dirty" class="nm-tab__dot" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </template>
      </RsPopover>
    </div>

    <div class="nm-tabbar__actions flex shrink-0 items-center gap-0.5 px-1">
      <button
        type="button"
        class="nm-tabbar__btn"
        :aria-label="t('workspace.splitEditor')"
        :title="t('workspace.splitEditor')"
        @click="splitHere"
      >
        <RsIcon name="columns-2" :size="15" />
      </button>
      <button
        v-if="hasSplit"
        type="button"
        class="nm-tabbar__btn"
        :aria-label="t('workspace.closeGroup')"
        :title="t('workspace.closeGroup')"
        @click="closeGroupHere"
      >
        <RsIcon name="x" :size="15" />
      </button>
    </div>

    <RsConfirmDialog
      v-model:open="confirmOpen"
      :title="t('workspace.confirmCloseTitle')"
      :description="confirmDesc"
      :confirm-text="t('workspace.confirmCloseOk')"
      :cancel-text="t('workspace.confirmCloseCancel')"
      @confirm="onConfirm"
      @cancel="onCancel"
    />
  </div>
</template>

<style scoped>
.nm-tabbar {
  position: relative;
  width: 100%;
  min-width: 0;
}

/* 激活组：Tab 栏顶部一条高亮线，指示焦点所在分屏 */
.nm-tabbar--active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--rs-primary);
}

.nm-tabbar__nav {
  min-width: 0;
}

.nm-tabbar__list {
  scrollbar-width: none;
}

.nm-tabbar__list::-webkit-scrollbar {
  height: 0;
}

/* 透传 flex 布局，避免 ContextMenu 根节点占位 */
.nm-tabbar__slot {
  display: contents;
}

.nm-tab {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.375rem;
  max-width: 11rem;
  height: 1.625rem;
  padding: 0 0.5rem 0 0.625rem;
  border: 1px solid transparent;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--nm-font-caption);
  cursor: pointer;
  user-select: none;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast),
    border-color var(--rs-transition-fast);
}

.nm-tab:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-tab--active {
  background: var(--nm-editor-bg);
  border-color: var(--rs-border-subtle);
  color: var(--rs-text);
}

/* 拖拽中的源 Tab 半透明 */
.nm-tab--dragging {
  opacity: 0.4;
}

/* 拖拽悬停目标：左侧插入指示线 */
.nm-tab--dragover {
  box-shadow: inset 2px 0 0 0 var(--rs-primary);
}

.nm-tab__icon {
  flex-shrink: 0;
  color: var(--rs-muted);
}

.nm-tab--active .nm-tab__icon {
  color: var(--rs-primary);
}

.nm-tab__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-tab__dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: var(--rs-radius-full);
  background: var(--rs-primary);
  flex-shrink: 0;
}

.nm-tab__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  margin-right: -0.125rem;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity var(--rs-transition-fast),
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.nm-tab:hover .nm-tab__close,
.nm-tab--active .nm-tab__close {
  opacity: 1;
}

.nm-tab__close:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-tabbar__btn {
  display: flex;
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

.nm-tabbar__btn:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-tabbar__scroll {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
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

.nm-tabbar__scroll:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-tabbar__overflow {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.125rem;
  max-width: 8rem;
  height: 1.625rem;
  margin-right: 0.125rem;
  padding: 0 0.375rem;
  border: 1px solid transparent;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--nm-font-caption);
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast),
    border-color var(--rs-transition-fast);
}

.nm-tabbar__overflow:hover,
.nm-tabbar__overflow--active {
  background: var(--rs-item-hover);
  border-color: var(--rs-border-subtle);
  color: var(--rs-text);
}

.nm-tabbar__overflow-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-tabbar__overflow-icon {
  flex-shrink: 0;
  opacity: 0.72;
}

.nm-tabbar__overflow-menu {
  margin: -0.5rem;
  padding: 0.25rem;
  list-style: none;
}

.nm-tabbar__overflow-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  min-width: 8rem;
  max-width: 16rem;
  padding: 0.375rem 0.5rem;
  border: none;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-text);
  font-size: var(--nm-font-caption);
  text-align: left;
  cursor: pointer;
  transition: background var(--rs-transition-fast);
}

.nm-tabbar__overflow-item:hover {
  background: var(--rs-item-hover);
}

.nm-tabbar__overflow-item--active {
  color: var(--rs-primary);
}

.nm-tabbar__overflow-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-tabbar__overflow-item-icon {
  flex-shrink: 0;
  color: var(--rs-muted);
}

.nm-tabbar__overflow-item--active .nm-tabbar__overflow-item-icon {
  color: var(--rs-primary);
}
</style>
