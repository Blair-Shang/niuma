<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
} from './reka'
import { useRsI18n } from '../composables/useRsI18n'
import { useRsTabsNav } from '../composables/useRsTabsNav'
import RsIcon from './RsIcon.vue'
import {
  getNextTabAfterClose,
  isTabClosable,
  isTabRenamable,
  type RsTabItem,
  type RsTabsOverflow,
  type RsTabsSize,
  type RsTabsVariant,
} from './tabs-utils'

const model = defineModel<string>({ required: true })

const props = withDefaults(
  defineProps<{
    items: RsTabItem[]
    size?: RsTabsSize
    variant?: RsTabsVariant
    panelless?: boolean
    closable?: boolean
    addable?: boolean
    maxCount?: number
    /** 双击标签重命名 */
    renamable?: boolean
    /** 拖拽调整标签顺序 */
    draggable?: boolean
    /** 标签过多：scroll 横向滚动 · dropdown 折叠到「更多」 */
    overflow?: RsTabsOverflow | false
  }>(),
  {
    size: 'md',
    variant: 'line',
    panelless: false,
    closable: false,
    addable: false,
    renamable: false,
    draggable: false,
    overflow: false,
  },
)

const emit = defineEmits<{
  close: [value: string]
  add: []
  rename: [value: string, label: string]
  reorder: [dragValue: string, dropValue: string]
}>()

const { t } = useRsI18n()
const itemsRef = computed(() => props.items)
const overflowMode = computed(() => props.overflow)
const canAdd = computed(() => {
  if (!props.addable) return false
  if (props.maxCount == null) return true
  return props.items.length < props.maxCount
})

const navRef = ref<HTMLElement | null>(null)
const measureRef = ref<HTMLElement | null>(null)
const overflowWrapRef = ref<HTMLElement | null>(null)

const {
  navViewportRef,
  useDropdownOverflow,
  useScrollOverflow,
  visibleTabItems,
  hiddenItems,
  overflowMenuItems,
  activeInHidden,
  showOverflowMenu,
  canScrollPrev,
  canScrollNext,
  scrollNav,
  onNavScroll,
  scheduleLayout,
} = useRsTabsNav({
  items: itemsRef,
  activeValue: model,
  overflow: overflowMode,
  canAdd,
  navRef,
  measureRef,
  overflowRef: overflowWrapRef,
  addButtonWidth: 36,
})

const renamingValue = ref<string | null>(null)
const renameDraft = ref('')
const dragValue = ref<string | null>(null)
const dragOverValue = ref<string | null>(null)
let renameInputEl: HTMLInputElement | null = null

function setRenameInputRef(el: unknown, item: RsTabItem) {
  if (!(el instanceof HTMLInputElement) || renamingValue.value !== item.value) return
  renameInputEl = el
  void nextTick(() => {
    renameInputEl?.focus()
    renameInputEl?.select()
  })
}

const tabBarItems = computed(() =>
  useDropdownOverflow.value ? visibleTabItems.value : props.items,
)
const moreLabel = computed(() => {
  if (activeInHidden.value) {
    return props.items.find((item) => item.value === model.value)?.label ?? t('tabs.more')
  }
  if (hiddenItems.value.length > 0) {
    return `${t('tabs.more')} (${hiddenItems.value.length})`
  }
  return t('tabs.more')
})

function closeAriaLabel(item: RsTabItem): string {
  return t('tabs.close', 'Close {label}').replace('{label}', item.label)
}

function onCloseTab(item: RsTabItem): void {
  if (item.disabled || !isTabClosable(item, props.closable)) return
  const next = getNextTabAfterClose(props.items, item.value, model.value)
  if (next && model.value === item.value) {
    model.value = next
  }
  emit('close', item.value)
}

function onAddTab(): void {
  if (!canAdd.value) return
  emit('add')
}

function onOverflowSelect(value: string): void {
  model.value = value
}

async function startRename(item: RsTabItem): Promise<void> {
  if (!isTabRenamable(item, props.renamable) || item.disabled) return
  renamingValue.value = item.value
  renameDraft.value = item.label
}

function cancelRename(): void {
  renamingValue.value = null
  renameDraft.value = ''
  renameInputEl = null
}

function commitRename(item: RsTabItem): void {
  if (renamingValue.value !== item.value) return
  const label = renameDraft.value.trim()
  if (label && label !== item.label) {
    emit('rename', item.value, label)
  }
  cancelRename()
}

function onDragStart(item: RsTabItem, event: DragEvent): void {
  if (!props.draggable || item.disabled) return
  dragValue.value = item.value
  event.dataTransfer?.setData('text/plain', item.value)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(item: RsTabItem, event: DragEvent): void {
  if (!props.draggable || !dragValue.value || dragValue.value === item.value) return
  event.preventDefault()
  dragOverValue.value = item.value
}

function onDragLeave(item: RsTabItem): void {
  if (dragOverValue.value === item.value) dragOverValue.value = null
}

function onDrop(item: RsTabItem, event: DragEvent): void {
  if (!props.draggable || !dragValue.value) return
  event.preventDefault()
  if (dragValue.value !== item.value) {
    emit('reorder', dragValue.value, item.value)
  }
  dragValue.value = null
  dragOverValue.value = null
  scheduleLayout()
}

function onDragEnd(): void {
  dragValue.value = null
  dragOverValue.value = null
}
</script>

<template>
  <TabsRoot
    v-model="model"
    class="rs-tabs"
    :class="[
      `rs-tabs--${variant}`,
      `rs-tabs--${size}`,
      {
        'rs-tabs--panelless': panelless,
        'rs-tabs--scrollable': useScrollOverflow,
        'rs-tabs--dropdown-overflow': useDropdownOverflow,
      },
    ]"
    :aria-label="t('tabs.label')"
  >
    <div :class="panelless ? 'rs-tabs__shell' : 'rs-tabs__body'">
      <div
        v-if="useDropdownOverflow"
        ref="measureRef"
        class="rs-tabs__measure"
        aria-hidden="true"
      >
        <button
          v-for="item in items"
          :key="`measure-${item.value}`"
          type="button"
          class="rs-tabs__trigger rs-tabs__measure-trigger"
          :class="`rs-tabs__trigger--${size}`"
          :data-tab-value="item.value"
          tabindex="-1"
        >
          <RsIcon v-if="item.icon" :name="item.icon" :size="14" class="rs-tabs__icon" />
          <span class="rs-tabs__label">{{ item.label }}</span>
          <span v-if="item.badge != null && item.badge !== ''" class="rs-tabs__badge">
            {{ item.badge }}
          </span>
        </button>
      </div>

      <div ref="navRef" class="rs-tabs__nav">
        <button
          v-if="useScrollOverflow && canScrollPrev"
          type="button"
          class="rs-tabs__scroll-btn rs-tabs__scroll-btn--prev"
          :aria-label="t('tabs.scrollPrev')"
          @click="scrollNav(-1)"
        >
          <RsIcon name="chevron-left" :size="14" />
        </button>

        <div
          ref="navViewportRef"
          class="rs-tabs__nav-viewport"
          @scroll="onNavScroll"
        >
          <TabsList class="rs-tabs__list">
            <TabsTrigger
              v-for="item in tabBarItems"
              :key="item.value"
              :value="item.value"
              :disabled="item.disabled"
              class="rs-tabs__trigger"
              :class="{
                'rs-tabs__trigger--dragging': dragValue === item.value,
                'rs-tabs__trigger--drag-over': dragOverValue === item.value,
              }"
              :data-tab-value="item.value"
              @dragover="onDragOver(item, $event)"
              @dragleave="onDragLeave(item)"
              @drop="onDrop(item, $event)"
            >
              <span
                v-if="draggable"
                class="rs-tabs__drag-handle"
                :aria-label="t('tabs.dragHandle')"
                draggable="true"
                @dragstart="onDragStart(item, $event)"
                @dragend="onDragEnd"
                @mousedown.stop
                @click.stop
              >
                <RsIcon name="grip-vertical" :size="12" />
              </span>
              <RsIcon v-if="item.icon" :name="item.icon" :size="14" class="rs-tabs__icon" />
              <input
                v-if="renamingValue === item.value"
                :ref="(el) => setRenameInputRef(el, item)"
                v-model="renameDraft"
                class="rs-tabs__rename-input"
                :aria-label="t('tabs.rename')"
                :placeholder="t('tabs.renamePlaceholder')"
                @keydown.enter.prevent="commitRename(item)"
                @keydown.escape.prevent="cancelRename"
                @blur="commitRename(item)"
                @mousedown.stop
                @click.stop
                @dblclick.stop
              />
              <span
                v-else
                class="rs-tabs__label"
                @dblclick.stop="startRename(item)"
              >
                {{ item.label }}
              </span>
              <span v-if="item.badge != null && item.badge !== ''" class="rs-tabs__badge">
                {{ item.badge }}
              </span>
              <button
                v-if="isTabClosable(item, closable)"
                type="button"
                class="rs-tabs__close"
                :aria-label="closeAriaLabel(item)"
                :disabled="item.disabled"
                @mousedown.stop.prevent
                @click.stop="onCloseTab(item)"
              >
                <RsIcon name="x" :size="12" />
              </button>
            </TabsTrigger>
          </TabsList>
        </div>

        <div
          v-if="showOverflowMenu"
          ref="overflowWrapRef"
          class="rs-tabs__overflow-wrap"
        >
          <DropdownMenuRoot>
            <DropdownMenuTrigger
              class="rs-tabs__more"
              :class="{ 'rs-tabs__more--active': activeInHidden }"
            >
              <span class="rs-tabs__more-label">{{ moreLabel }}</span>
              <RsIcon name="chevron-down" :size="14" class="rs-tabs__more-icon" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent
                class="rs-tabs__more-menu"
                :side-offset="4"
                align="end"
              >
                <DropdownMenuItem
                  v-for="item in overflowMenuItems"
                  :key="item.value"
                  class="rs-tabs__more-item"
                  :class="{ 'rs-tabs__more-item--active': model === item.value }"
                  @select="onOverflowSelect(item.value)"
                >
                  {{ item.label }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>

        <button
          v-if="canAdd"
          type="button"
          class="rs-tabs__add"
          :aria-label="t('tabs.add')"
          @click="onAddTab"
        >
          <RsIcon name="plus" :size="14" />
        </button>

        <button
          v-if="useScrollOverflow && canScrollNext"
          type="button"
          class="rs-tabs__scroll-btn rs-tabs__scroll-btn--next"
          :aria-label="t('tabs.scrollNext')"
          @click="scrollNav(1)"
        >
          <RsIcon name="chevron-right" :size="14" />
        </button>
      </div>

      <template v-if="!panelless">
        <TabsContent
          v-for="item in items"
          :key="`panel-${item.value}`"
          :value="item.value"
          class="rs-tabs__panel"
        >
          <div class="rs-tabs__panel-inner">
            <slot :name="item.value" />
          </div>
        </TabsContent>
      </template>
    </div>
  </TabsRoot>
</template>

<style>
.rs-tabs {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.rs-tabs__shell,
.rs-tabs__body {
  display: flex;
  flex-direction: column;
  width: 100%;
  position: relative;
}

.rs-tabs__nav {
  display: flex;
  align-items: stretch;
  min-width: 0;
}

.rs-tabs__nav-viewport {
  flex: 1;
  min-width: 0;
}

.rs-tabs--dropdown-overflow .rs-tabs__nav-viewport {
  overflow: hidden;
}

.rs-tabs__measure {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
  height: 0;
  overflow: hidden;
  white-space: nowrap;
}

.rs-tabs__measure-trigger {
  pointer-events: none;
}

.rs-tabs--scrollable .rs-tabs__nav-viewport {
  overflow-x: auto;
  scrollbar-width: none;
}

.rs-tabs--scrollable .rs-tabs__nav-viewport::-webkit-scrollbar {
  display: none;
}

.rs-tabs__list {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rs-tabs--scrollable .rs-tabs__list,
.rs-tabs--dropdown-overflow .rs-tabs__list {
  flex-wrap: nowrap;
}

.rs-tabs__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border: none;
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-tight);
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--rs-transition-fast),
    background var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast);
}

.rs-tabs__trigger:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
  border-radius: var(--rs-radius-xs);
}

.rs-tabs__trigger:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.rs-tabs__trigger--dragging {
  opacity: 0.45;
}

.rs-tabs__trigger--drag-over {
  box-shadow: inset 0 -2px 0 0 var(--rs-primary);
}

.rs-tabs__drag-handle {
  display: inline-flex;
  align-items: center;
  color: var(--rs-placeholder);
  cursor: grab;
}

.rs-tabs__drag-handle:active {
  cursor: grabbing;
}

.rs-tabs__icon {
  flex: 0 0 auto;
  color: currentColor;
}

.rs-tabs__label {
  min-width: 0;
}

.rs-tabs__rename-input {
  width: 6.5rem;
  max-width: 12rem;
  min-height: 1.5rem;
  padding: 0 0.375rem;
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-xs);
  background: var(--rs-bg);
  color: var(--rs-text);
  font: inherit;
}

.rs-tabs__rename-input:focus {
  outline: none;
  border-color: var(--rs-focus-border, var(--rs-primary));
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.rs-tabs__badge {
  padding: 0 0.375rem;
  border-radius: var(--rs-radius-full);
  background: var(--rs-surface-hover);
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
}

.rs-tabs__trigger[data-state='active'] .rs-tabs__badge {
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
  color: var(--rs-primary);
}

.rs-tabs__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  flex: 0 0 auto;
  margin-inline-start: 0.125rem;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  opacity: 0.72;
  transition:
    opacity var(--rs-transition-fast),
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.rs-tabs__trigger:hover .rs-tabs__close,
.rs-tabs__trigger[data-state='active'] .rs-tabs__close {
  opacity: 1;
}

.rs-tabs__close:hover:not(:disabled) {
  background: var(--rs-surface-hover);
  color: var(--rs-text);
}

.rs-tabs__close:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.rs-tabs__close:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.rs-tabs__add,
.rs-tabs__scroll-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin: 0;
  padding: 0 var(--rs-space-sm);
  border: none;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  transition:
    color var(--rs-transition-fast),
    background var(--rs-transition-fast);
}

.rs-tabs__add:focus-visible,
.rs-tabs__scroll-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.rs-tabs__add:hover,
.rs-tabs__scroll-btn:hover {
  color: var(--rs-primary);
  background: var(--rs-surface-hover);
}

.rs-tabs__overflow-wrap {
  display: flex;
  flex: 0 0 auto;
  align-items: stretch;
  align-self: stretch;
  margin-inline-start: var(--rs-space-xs);
  padding-inline-start: var(--rs-space-sm);
  border-inline-start: 1px solid var(--rs-border-subtle);
}

.rs-tabs__more {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-height: var(--rs-control-height-md);
  padding: 0 var(--rs-space-md);
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--rs-muted);
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-tight);
  white-space: nowrap;
  cursor: pointer;
  position: relative;
  transition:
    color var(--rs-transition-fast),
    background var(--rs-transition-fast);
}

.rs-tabs__more:hover {
  color: var(--rs-text);
}

.rs-tabs__more:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
  border-radius: var(--rs-radius-xs);
}

.rs-tabs__more-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 7rem;
}

.rs-tabs__more-icon {
  flex-shrink: 0;
  color: currentColor;
  opacity: 0.72;
}

.rs-tabs__more--active {
  color: var(--rs-primary);
  font-weight: 500;
}

.rs-tabs__more-menu {
  z-index: var(--rs-z-dropdown);
  min-width: 8rem;
  max-width: 14rem;
  padding: var(--rs-space-xs);
  border-radius: var(--rs-radius);
  border: 1px solid var(--rs-border);
  background: var(--rs-surface-elevated);
  box-shadow: var(--rs-shadow);
  outline: none;
}

.rs-tabs__more-item {
  display: flex;
  align-items: center;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-radius: var(--rs-radius-sm);
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-tight);
  color: var(--rs-text);
  cursor: pointer;
  outline: none;
}

.rs-tabs__more-item[data-highlighted] {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.rs-tabs__more-item--active {
  color: var(--rs-primary);
  font-weight: 500;
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
}

/* —— line —— */
.rs-tabs--line .rs-tabs__body {
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface);
  overflow: hidden;
}

.rs-tabs--line .rs-tabs__list {
  gap: 0;
  padding: 0 var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.rs-tabs--dropdown-overflow.rs-tabs--line .rs-tabs__nav {
  align-items: stretch;
  padding-inline: 0;
}

.rs-tabs--dropdown-overflow.rs-tabs--line .rs-tabs__list {
  flex: 1;
  min-width: 0;
  padding-inline: var(--rs-space-sm);
  border-bottom: none;
}

.rs-tabs--dropdown-overflow.rs-tabs--line .rs-tabs__body {
  padding-top: 0;
}

.rs-tabs--dropdown-overflow.rs-tabs--line .rs-tabs__more {
  margin-bottom: -1px;
}

.rs-tabs--dropdown-overflow.rs-tabs--line .rs-tabs__more--active::after {
  content: '';
  position: absolute;
  inset-inline: var(--rs-space-sm);
  bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--rs-primary);
}

.rs-tabs--dropdown-overflow.rs-tabs--line .rs-tabs__nav {
  border-bottom: 1px solid var(--rs-border-subtle);
}

.rs-tabs--line.rs-tabs--sm .rs-tabs__more {
  min-height: var(--rs-control-height-sm);
  padding: 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
}

.rs-tabs--line .rs-tabs__trigger {
  position: relative;
  margin-bottom: -1px;
  border-radius: 0;
}

.rs-tabs--line.rs-tabs--sm .rs-tabs__trigger {
  min-height: var(--rs-control-height-sm);
  padding: 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
}

.rs-tabs--line.rs-tabs--md .rs-tabs__trigger {
  min-height: var(--rs-control-height-md);
  padding: 0 var(--rs-space-md);
}

.rs-tabs--line .rs-tabs__add,
.rs-tabs--line .rs-tabs__scroll-btn {
  min-height: var(--rs-control-height-md);
}

.rs-tabs--line.rs-tabs--sm .rs-tabs__add,
.rs-tabs--line.rs-tabs--sm .rs-tabs__scroll-btn {
  min-height: var(--rs-control-height-sm);
}

.rs-tabs--line .rs-tabs__trigger:hover:not(:disabled):not([data-state='active']) {
  color: var(--rs-text);
}

.rs-tabs--line .rs-tabs__trigger[data-state='active'] {
  color: var(--rs-primary);
  font-weight: 500;
}

.rs-tabs--line .rs-tabs__trigger[data-state='active']::after {
  content: '';
  position: absolute;
  inset-inline: var(--rs-space-sm);
  bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--rs-primary);
}

.rs-tabs--line .rs-tabs__panel-inner {
  padding: var(--rs-space-md) var(--rs-space-lg);
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-normal);
}

.rs-tabs--line.rs-tabs--sm .rs-tabs__panel-inner {
  padding: var(--rs-space-sm) var(--rs-space-md);
  font-size: var(--rs-font-size-xs);
}

.rs-tabs--line.rs-tabs--panelless .rs-tabs__list {
  border-bottom: 1px solid var(--rs-border);
}

/* —— segmented —— */
.rs-tabs--segmented .rs-tabs__body {
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface);
  overflow: hidden;
}

.rs-tabs--segmented .rs-tabs__list {
  gap: 0.25rem;
  width: fit-content;
  max-width: 100%;
  margin: var(--rs-space-sm);
  padding: 0.25rem;
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface-hover);
}

.rs-tabs--segmented .rs-tabs__trigger {
  border-radius: var(--rs-radius-xs);
}

.rs-tabs--segmented.rs-tabs--sm .rs-tabs__trigger {
  min-height: var(--rs-control-height-sm);
  padding: 0 0.5rem;
  font-size: var(--rs-font-size-xs);
}

.rs-tabs--segmented.rs-tabs--md .rs-tabs__trigger {
  min-height: var(--rs-control-height-md);
  padding: 0 0.75rem;
}

.rs-tabs--segmented .rs-tabs__trigger:hover:not(:disabled):not([data-state='active']) {
  color: var(--rs-text);
  background: var(--rs-surface);
}

.rs-tabs--segmented .rs-tabs__trigger[data-state='active'] {
  color: var(--rs-primary);
  background: var(--rs-surface);
  font-weight: 500;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--rs-text) 8%, transparent);
}

.rs-tabs--segmented .rs-tabs__panel-inner {
  padding: var(--rs-space-md) var(--rs-space-lg);
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-normal);
}

.rs-tabs--segmented.rs-tabs--panelless .rs-tabs__list {
  margin: 0;
  background: var(--rs-surface-hover);
}

/* —— card（Ant editable-card） —— */
.rs-tabs--card .rs-tabs__body {
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius);
  background: var(--rs-surface);
  overflow: hidden;
}

.rs-tabs--card .rs-tabs__list {
  gap: 0.25rem;
  padding: var(--rs-space-sm) var(--rs-space-sm) 0;
}

.rs-tabs--card .rs-tabs__trigger {
  position: relative;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--rs-radius-sm) var(--rs-radius-sm) 0 0;
  background: var(--rs-surface-hover);
}

.rs-tabs--card.rs-tabs--sm .rs-tabs__trigger {
  min-height: var(--rs-control-height-sm);
  padding: 0 var(--rs-space-sm);
  font-size: var(--rs-font-size-xs);
}

.rs-tabs--card.rs-tabs--md .rs-tabs__trigger {
  min-height: var(--rs-control-height-md);
  padding: 0 var(--rs-space-md);
}

.rs-tabs--card .rs-tabs__trigger:hover:not(:disabled):not([data-state='active']) {
  color: var(--rs-text);
  background: var(--rs-surface);
  border-color: var(--rs-border-subtle);
}

.rs-tabs--card .rs-tabs__trigger[data-state='active'] {
  color: var(--rs-primary);
  font-weight: 500;
  background: var(--rs-surface);
  border-color: var(--rs-border);
  margin-bottom: -1px;
  z-index: 1;
}

.rs-tabs--card .rs-tabs__panel-inner {
  padding: var(--rs-space-md) var(--rs-space-lg);
  border-top: 1px solid var(--rs-border-subtle);
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  line-height: var(--rs-line-height-normal);
}

.rs-tabs--card.rs-tabs--panelless .rs-tabs__list {
  padding-bottom: var(--rs-space-sm);
}
</style>
