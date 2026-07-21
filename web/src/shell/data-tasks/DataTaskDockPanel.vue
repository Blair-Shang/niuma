<script setup lang="ts">
import { RsEmpty, RsIcon, useRsToast } from '@niuma/ui'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useDataTaskHubStore, type DataTask } from '@/stores/data-task-hub'
import { DATA_TASK_DOCK_MOUNT_ID } from '@/shell/data-tasks/mount'

const { t } = useI18n()
const toast = useRsToast()
const hub = useDataTaskHubStore()
const { tasks, dockTasks, activeId } = storeToRefs(hub)

const active = computed(() => {
  const id = activeId.value
  if (id) {
    const hit = dockTasks.value.find((item) => item.id === id)
    if (hit) return hit
  }
  return dockTasks.value[0] ?? null
})

const showEmpty = computed(() => dockTasks.value.length === 0)
const showTabs = computed(() => tasks.value.length > 0)

watch(
  dockTasks,
  (list) => {
    if (list.length === 0) return
    if (!list.some((item) => item.id === activeId.value)) {
      hub.focusInDock(list[0]!.id)
    }
  },
  { immediate: true },
)

function isTabActive(taskId: string, surface: string): boolean {
  if (surface === 'float') return false
  return active.value?.id === taskId
}

function onSelectTab(task: DataTask): void {
  if (task.surface === 'dock') {
    hub.focusInDock(task.id)
    return
  }
  hub.dockTask(task.id)
}

function onCloseTab(task: DataTask, event: Event): void {
  event.stopPropagation()
  event.preventDefault()
  if (task.busy) {
    toast.warning(t('shell.bottomDock.closeTaskBusy'))
    return
  }
  hub.close(task.id)
}
</script>

<template>
  <div class="nm-data-task-dock">
    <div v-if="showTabs" class="nm-data-task-dock__tabs" role="tablist">
      <button
        v-for="task in tasks"
        :key="task.id"
        type="button"
        role="tab"
        class="nm-data-task-dock__tab"
        :class="{
          'nm-data-task-dock__tab--active': isTabActive(task.id, task.surface),
          'nm-data-task-dock__tab--float': task.surface === 'float',
          'nm-data-task-dock__tab--busy': task.busy,
        }"
        :aria-selected="isTabActive(task.id, task.surface)"
        :title="task.title"
        @click="onSelectTab(task)"
      >
        <RsIcon
          v-if="task.surface === 'float'"
          name="app-window"
          :size="12"
          class="nm-data-task-dock__tab-icon"
        />
        <span class="nm-data-task-dock__tab-label">{{ task.title }}</span>
        <span v-if="task.busy" class="nm-data-task-dock__dot" aria-hidden="true" />
        <span
          class="nm-data-task-dock__tab-close"
          role="button"
          tabindex="0"
          :aria-label="t('shell.bottomDock.closeTask')"
          :title="t('shell.bottomDock.closeTask')"
          @click="onCloseTab(task, $event)"
          @keydown.enter.prevent="onCloseTab(task, $event)"
        >
          <RsIcon name="x" :size="12" />
        </span>
      </button>
    </div>

    <div class="nm-data-task-dock__body">
      <RsEmpty
        v-if="showEmpty"
        :title="t('shell.bottomDock.dataTasksEmpty')"
        :description="t('shell.bottomDock.dataTasksEmptyDesc')"
      />
      <!-- 实际表单由 DataTaskHost 经 Teleport 挂到此处，保持实例不销毁 -->
      <div
        v-show="!showEmpty"
        :id="DATA_TASK_DOCK_MOUNT_ID"
        class="nm-data-task-dock__mount"
      />
    </div>
  </div>
</template>

<style scoped>
.nm-data-task-dock {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.nm-data-task-dock__tabs {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 6px 8px 0;
  overflow-x: auto;
  flex-shrink: 0;
  background: var(--nm-frame-bg, var(--rs-bg-muted, #f4f4f5));
  border-bottom: 1px solid var(--rs-border-subtle);
}
.nm-data-task-dock__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 16rem;
  height: 1.875rem;
  padding: 0 0.625rem;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--rs-radius-xs) var(--rs-radius-xs) 0 0;
  background: transparent;
  color: var(--rs-muted);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast),
    border-color var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast);
}
.nm-data-task-dock__tab:hover {
  color: var(--rs-text);
  background: color-mix(in srgb, var(--rs-item-hover) 80%, transparent);
  border-color: var(--rs-border-subtle);
}
.nm-data-task-dock__tab--active {
  color: var(--rs-text);
  background: var(--rs-surface, #fff);
  border-color: var(--rs-border-subtle);
  box-shadow: inset 0 2px 0 0 var(--rs-primary);
  font-weight: 600;
}
.nm-data-task-dock__tab--float {
  border-style: dashed;
  border-color: var(--rs-border-subtle);
  color: var(--rs-muted);
  opacity: 0.9;
}
.nm-data-task-dock__tab--float:hover {
  opacity: 1;
  color: var(--rs-text);
  border-color: var(--rs-primary);
}
.nm-data-task-dock__tab--busy {
  color: var(--rs-primary);
}
.nm-data-task-dock__tab-icon {
  flex-shrink: 0;
  opacity: 0.75;
}
.nm-data-task-dock__tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.nm-data-task-dock__tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  margin-left: 2px;
  border-radius: var(--rs-radius-xs);
  color: var(--rs-muted);
  flex-shrink: 0;
  opacity: 0.55;
}
.nm-data-task-dock__tab-close:hover {
  opacity: 1;
  color: var(--rs-text);
  background: var(--rs-item-hover);
}
.nm-data-task-dock__tab--active .nm-data-task-dock__tab-close,
.nm-data-task-dock__tab:hover .nm-data-task-dock__tab-close {
  opacity: 0.85;
}
.nm-data-task-dock__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--rs-primary);
  flex-shrink: 0;
}
.nm-data-task-dock__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  background: var(--rs-surface, #fff);
  display: flex;
  flex-direction: column;
}
.nm-data-task-dock__mount {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.nm-data-task-dock__mount > :deep(.nm-vast-io-inline) {
  min-height: 100%;
  height: auto;
}
</style>
