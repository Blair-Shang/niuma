<script setup lang="ts">
import { useBridgeStore } from '@/stores/bridge'
import { useShellStore } from '@/stores/shell'
import { useTransferHubStore } from '@/stores/transfer-hub'
import { useDataTaskHubStore } from '@/stores/data-task-hub'
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

const bridgeStore = useBridgeStore()
const shellStore = useShellStore()
const transferHub = useTransferHubStore()
const dataTaskHub = useDataTaskHubStore()
const { t } = useI18n()

const leftText = computed(() =>
  bridgeStore.connected ? t('shell.statusReady') : t('shell.statusOffline'),
)

const transferLabel = computed(() => {
  const count = transferHub.activeCount
  if (count <= 0) {
    return t('shell.bottomDock.transfers')
  }
  return t('shell.bottomDock.transfersActive', { count })
})

const dataTasksLabel = computed(() => {
  const running = dataTaskHub.activeCount
  if (running > 0) {
    return t('shell.bottomDock.dataTasksActive', { count: running })
  }
  if (dataTaskHub.tasks.length > 0) {
    return t('shell.bottomDock.dataTasksCount', { count: dataTaskHub.tasks.length })
  }
  return t('shell.bottomDock.dataTasks')
})

function onTransferClick(): void {
  if (shellStore.bottomDockOpen && shellStore.bottomDockTab === 'transfers') {
    shellStore.closeBottomDock()
    return
  }
  shellStore.openBottomDock('transfers')
}

function onDataTasksClick(): void {
  if (shellStore.bottomDockOpen && shellStore.bottomDockTab === 'dataTasks') {
    shellStore.closeBottomDock()
    return
  }
  shellStore.openBottomDock('dataTasks')
}
</script>

<template>
  <footer class="nm-statusbar shrink-0">
    <span class="flex items-center gap-2">
      <span
        class="nm-status-dot"
        :class="bridgeStore.connected ? 'nm-status-dot--online' : 'nm-status-dot--offline'"
      />
      {{ leftText }}
    </span>

    <span class="nm-statusbar__right flex items-center gap-3">
      <button
        type="button"
        class="nm-statusbar__chip"
        :class="{
          'nm-statusbar__chip--active': transferHub.hasActiveTransfers,
          'nm-statusbar__chip--open':
            shellStore.bottomDockOpen && shellStore.bottomDockTab === 'transfers',
        }"
        @click="onTransferClick"
      >
        {{ transferLabel }}
      </button>
      <button
        v-if="dataTaskHub.hasTasks"
        type="button"
        class="nm-statusbar__chip"
        :class="{
          'nm-statusbar__chip--active': dataTaskHub.activeCount > 0,
          'nm-statusbar__chip--open':
            shellStore.bottomDockOpen && shellStore.bottomDockTab === 'dataTasks',
        }"
        @click="onDataTasksClick"
      >
        {{ dataTasksLabel }}
      </button>
      <span class="tabular-nums opacity-80">NiuMa {{ bridgeStore.shellVersion || '—' }}</span>
    </span>
  </footer>
</template>

<style scoped>
.nm-statusbar__right {
  min-width: 0;
}

.nm-statusbar__chip {
  padding: 0 0.5rem;
  border: none;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  font-size: inherit;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.nm-statusbar__chip:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.nm-statusbar__chip--active {
  color: var(--rs-primary);
}

.nm-statusbar__chip--open {
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
  color: var(--rs-text);
}
</style>
