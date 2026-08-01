<script setup lang="ts">
/**
 * 数据传输任务外壳：浮动窗 + 底部 Dock 内联两种呈现。
 * 方言只提供表单 slot 与确认逻辑，样式与 chrome 统一。
 */
import { RsButton, RsDialog } from '@niuma/ui'
import { computed } from 'vue'
import { dataTaskDockMountSelector } from '@/shell/data-tasks/mount'
import type { DataTransferShellLabels } from '../types/data-transfer'

const props = withDefaults(
  defineProps<{
    labels: DataTransferShellLabels
    title: string
    description?: string
    busy?: boolean
    canConfirm?: boolean
    presentation?: 'float' | 'inline'
    floatOpen?: boolean
    activeInDock?: boolean
    /** 底部 Dock 是否可作为 Teleport 目标 */
    dockReady?: boolean
  }>(),
  {
    description: '',
    busy: false,
    canConfirm: false,
    presentation: 'float',
    floatOpen: false,
    activeInDock: false,
    dockReady: false,
  },
)

const emit = defineEmits<{
  'update:floatOpen': [value: boolean]
  dock: []
  popOut: []
  close: []
  cancel: []
  confirm: []
}>()

const isInline = computed(() => props.presentation === 'inline')
const canTeleportToDock = computed(() => props.activeInDock && props.dockReady)
</script>

<template>
  <RsDialog
    v-if="!isInline"
    :open="floatOpen"
    :title="title"
    :description="description"
    width="lg"
    layout="window"
    tone="default"
    :modal="false"
    :show-overlay="false"
    :draggable="true"
    :resizable="true"
    :fullscreenable="true"
    :show-close="!busy"
    :close-on-overlay-click="false"
    @update:open="emit('update:floatOpen', $event)"
  >
    <template #body>
      <div class="nm-dt-shell__body">
        <slot />
      </div>
    </template>
    <template #footer>
      <RsButton variant="ghost" @click.stop="emit('dock')">{{ labels.dockToBottom }}</RsButton>
      <RsButton v-if="busy" variant="ghost" @click="emit('cancel')">{{ labels.cancelTask }}</RsButton>
      <RsButton v-else variant="ghost" @click="emit('close')">{{ labels.close }}</RsButton>
      <RsButton
        variant="primary"
        :disabled="!canConfirm"
        :loading="busy"
        @click="emit('confirm')"
      >
        {{ labels.confirm }}
      </RsButton>
    </template>
  </RsDialog>

  <Teleport
    v-else
    :to="dataTaskDockMountSelector()"
    :disabled="!canTeleportToDock"
  >
    <div v-show="canTeleportToDock" class="nm-dt-inline">
      <header class="nm-dt-inline__head">
        <div class="nm-dt-inline__meta">
          <div class="nm-dt-inline__title">{{ title }}</div>
          <div v-if="description" class="nm-dt-inline__desc">{{ description }}</div>
        </div>
        <div class="nm-dt-inline__actions">
          <RsButton variant="ghost" size="sm" @click="emit('popOut')">{{ labels.popOut }}</RsButton>
          <RsButton v-if="!busy" variant="ghost" size="sm" @click="emit('close')">
            {{ labels.close }}
          </RsButton>
        </div>
      </header>
      <div class="nm-dt-inline__body">
        <slot />
      </div>
      <footer class="nm-dt-inline__footer">
        <RsButton v-if="busy" variant="ghost" @click="emit('cancel')">{{ labels.cancelTask }}</RsButton>
        <RsButton v-else variant="ghost" @click="emit('close')">{{ labels.close }}</RsButton>
        <RsButton
          variant="primary"
          :disabled="!canConfirm"
          :loading="busy"
          @click="emit('confirm')"
        >
          {{ labels.confirm }}
        </RsButton>
      </footer>
    </div>
  </Teleport>
</template>

<style scoped>
.nm-dt-shell__body {
  flex: 1 1 auto;
  align-self: stretch;
  min-height: 0;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.nm-dt-inline {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--rs-text);
}

.nm-dt-inline__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: 10px 14px;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
  background: color-mix(in srgb, var(--rs-surface) 92%, var(--rs-primary) 8%);
}

.nm-dt-inline__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nm-dt-inline__title {
  font-weight: 600;
  font-size: var(--rs-font-size-sm);
  line-height: 1.3;
}

.nm-dt-inline__desc {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-dt-inline__actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.nm-dt-inline__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.nm-dt-inline__footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 14px;
  border-top: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
  background: var(--rs-surface, #fff);
}
</style>
