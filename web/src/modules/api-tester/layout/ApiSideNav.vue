<script setup lang="ts">
/**
 * API 侧栏：API 管理树常驻，环境配置开 Shell Tab，历史同栏展开。
 */
import { RsButton, RsConfirmDialog, RsContextMenu, RsIcon, RsInput, type RsContextMenuItem } from '@niuma/ui'
import { computed, defineAsyncComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiTesterStore } from '../stores/api-tester'
import ApiCollectionPanel from './ApiCollectionPanel.vue'
import { useApiSideNav } from './useApiSideNav'

const ApiHistoryPane = defineAsyncComponent(() => import('./ApiHistoryPane.vue'))

const { t } = useI18n()
const api = useApiTesterStore()
const { historyOpen, historySeen, openEnvironments, toggleHistory } = useApiSideNav()

const histTarget = ref('')
const histMenuOpen = ref(false)
const histConfirmOpen = ref(false)
const histConfirmAll = ref(false)

const histCtxItems = computed<RsContextMenuItem[]>(() => [
  { key: 'open-history', label: t('modules.api.openHistory'), icon: 'send' },
  { key: 'sep-hist', label: '', separator: true },
  { key: 'delete-history', label: t('modules.api.deleteHistory'), icon: 'trash-2', danger: true },
])

const histConfirmTitle = computed(() =>
  histConfirmAll.value ? t('modules.api.clearHistory') : t('modules.api.deleteHistory'),
)

const histConfirmDesc = computed(() => {
  if (histConfirmAll.value) return t('modules.api.clearHistoryConfirm')
  const name = api.history.find((row) => row.historyId === histTarget.value)?.requestName ?? ''
  return t('modules.api.deleteHistoryConfirm', { name })
})

function onOpenHistory(historyId: string): void {
  void api.openHistory(historyId)
}

function onHistCtxSelect(key: string): void {
  if (key === 'open-history') {
    onOpenHistory(histTarget.value)
    return
  }
  if (key === 'delete-history') {
    histConfirmAll.value = false
    histConfirmOpen.value = true
  }
}

function onHistConfirm(): void {
  if (histConfirmAll.value) {
    void api.clearHistory()
  } else if (histTarget.value) {
    void api.deleteHistory(histTarget.value)
  }
  histConfirmOpen.value = false
}

function openClearHistory(): void {
  histConfirmAll.value = true
  histConfirmOpen.value = true
}
</script>

<template>
  <div class="nm-api-sidenav">
    <div class="nm-api-sidenav__bar">
      <RsInput
        v-model="api.treeFilter"
        size="sm"
        class="nm-api-sidenav__search"
        :placeholder="t('modules.api.search')"
        clearable
      >
        <template #prefix>
          <RsIcon name="search" :size="12" class="nm-api-sidenav__search-icon" />
        </template>
      </RsInput>
      <RsButton
        variant="ghost"
        size="sm"
        icon-only
        icon="globe"
        radius="sm"
        class="nm-api-sidenav__env-btn"
        :aria-label="t('modules.api.sideEnvironment')"
        :title="t('modules.api.sideEnvironment')"
        @click="openEnvironments"
      />
    </div>

    <section class="nm-api-sidenav__section nm-api-sidenav__section--main">
      <header class="nm-api-sidenav__head nm-api-sidenav__head--api">
        <RsIcon name="send" :size="13" class="nm-api-sidenav__tone" />
        <span class="nm-api-sidenav__head-title">{{ t('modules.api.sideCollection') }}</span>
      </header>
      <div class="nm-api-sidenav__section-body">
        <ApiCollectionPanel />
      </div>
    </section>

    <section class="nm-api-sidenav__section">
      <button
        type="button"
        class="nm-api-sidenav__head nm-api-sidenav__head--btn nm-api-sidenav__head--env"
        @click="openEnvironments"
      >
        <RsIcon name="globe" :size="13" class="nm-api-sidenav__tone" />
        <span class="nm-api-sidenav__head-title">{{ t('modules.api.sideEnvironment') }}</span>
        <RsIcon name="external-link" :size="12" class="nm-api-sidenav__jump" />
      </button>
    </section>

    <section class="nm-api-sidenav__section" :class="{ 'nm-api-sidenav__section--dock': historyOpen }">
      <button
        type="button"
        class="nm-api-sidenav__head nm-api-sidenav__head--btn nm-api-sidenav__head--hist"
        @click="toggleHistory"
      >
        <RsIcon :name="historyOpen ? 'chevron-down' : 'chevron-right'" :size="12" />
        <RsIcon name="history" :size="13" class="nm-api-sidenav__tone" />
        <span class="nm-api-sidenav__head-title">{{ t('modules.api.sideHistory') }}</span>
        <RsButton
          v-if="historyOpen"
          variant="ghost"
          size="sm"
          icon-only
          icon="trash-2"
          radius="sm"
          :aria-label="t('modules.api.clearHistory')"
          @click.stop="openClearHistory"
        />
      </button>
      <div v-if="historySeen" v-show="historyOpen" class="nm-api-sidenav__section-body">
        <RsInput
          v-model="api.historyFilter"
          size="sm"
          class="nm-api-sidenav__hist-search"
          :placeholder="t('modules.api.searchHistory')"
          clearable
        >
          <template #prefix>
            <RsIcon name="search" :size="12" class="nm-api-sidenav__search-icon" />
          </template>
        </RsInput>
        <RsContextMenu v-model:open="histMenuOpen" :items="histCtxItems" @select="onHistCtxSelect">
          <div class="nm-api-sidenav__hist">
            <ApiHistoryPane
              :items="api.history"
              :filter="api.historyFilter"
              @open="onOpenHistory"
              @row-context="histTarget = $event"
            />
          </div>
        </RsContextMenu>
      </div>
    </section>

    <RsConfirmDialog
      v-model:open="histConfirmOpen"
      :title="histConfirmTitle"
      :description="histConfirmDesc"
      :confirm-text="histConfirmTitle"
      :cancel-text="t('common.cancel')"
      confirm-variant="danger"
      @confirm="onHistConfirm"
    />
  </div>
</template>

<style scoped>
.nm-api-sidenav {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.nm-api-sidenav__bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.2rem;
  height: var(--nm-tabbar-h);
  padding: 0 var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
  box-sizing: border-box;
}

.nm-api-sidenav__search,
.nm-api-sidenav__hist-search {
  flex: 1;
  min-width: 0;
}

.nm-api-sidenav__hist-search {
  margin: var(--rs-space-xs) var(--rs-space-sm);
}

.nm-api-sidenav__search-icon {
  color: var(--rs-placeholder);
}

.nm-api-sidenav__env-btn {
  color: var(--rs-info, var(--rs-primary));
}

.nm-api-sidenav__section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex-shrink: 0;
}

.nm-api-sidenav__section--main {
  flex: 1;
  min-height: 8rem;
}

.nm-api-sidenav__section--dock {
  flex: 0 1 38%;
  min-height: 8rem;
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-api-sidenav__head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 1.75rem;
  padding: 0 var(--rs-space-sm);
  color: var(--rs-muted);
}

.nm-api-sidenav__head--btn {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.nm-api-sidenav__head--btn:hover {
  color: var(--rs-text);
  background: var(--rs-item-hover);
}

.nm-api-sidenav__head--api {
  color: var(--rs-info, var(--rs-primary));
}

.nm-api-sidenav__head--env {
  color: var(--rs-success);
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-api-sidenav__head--hist {
  color: var(--rs-warning);
  border-top: 1px solid var(--rs-border-subtle);
}

.nm-api-sidenav__tone {
  flex-shrink: 0;
}

.nm-api-sidenav__jump {
  flex-shrink: 0;
  opacity: 0.7;
}

.nm-api-sidenav__head-title {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.nm-api-sidenav__section-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-api-sidenav__hist {
  flex: 1;
  min-height: 0;
}
</style>
