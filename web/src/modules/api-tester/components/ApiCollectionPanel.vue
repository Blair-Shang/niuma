<script setup lang="ts">
/**
 * API 集合侧栏 — 挂在 Shell SideNav。
 * 交互对齐运维树：面板级右键、空白回落到根菜单、文件夹管分类。
 * 导入导出是请求文档 JSON，不走连接凭据对话框。
 */
import {
  RsButton,
  RsConfirmDialog,
  RsContextMenu,
  RsDialog,
  RsIcon,
  RsInput,
  RsLabel,
} from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { useApiCollectionPanel } from '../composables/useApiCollectionPanel'
import ApiCollectionTree from './ApiCollectionTree.vue'
import ApiHistoryPane from './ApiHistoryPane.vue'

const { t } = useI18n()
const {
  api,
  selectedId,
  ctxTarget,
  ctxMenuOpen,
  nameDlgOpen,
  nameDlgValue,
  nameDlgError,
  nameForm,
  nameDlgTitle,
  confirmOpen,
  confirmTitle,
  confirmDesc,
  activeCtxItems,
  setSideView,
  onSelect,
  onNewRequest,
  openNameDialog,
  onNameSave,
  onConfirmDelete,
  onCtxSelect,
} = useApiCollectionPanel()
</script>

<template>
  <RsContextMenu v-model:open="ctxMenuOpen" :items="activeCtxItems" @select="onCtxSelect">
    <div class="nm-api-col" @contextmenu.capture="ctxTarget = null">
      <div class="nm-api-col__switch">
        <button
          type="button"
          class="nm-api-col__switch-btn"
          :class="{ 'nm-api-col__switch-btn--on': api.sideView === 'collection' }"
          @click="setSideView('collection')"
        >
          {{ t('modules.api.collections') }}
        </button>
        <button
          type="button"
          class="nm-api-col__switch-btn"
          :class="{ 'nm-api-col__switch-btn--on': api.sideView === 'history' }"
          @click="setSideView('history')"
        >
          {{ t('modules.api.history') }}
        </button>
      </div>
      <div class="nm-api-col__searchbar">
        <RsInput
          :model-value="api.sideView === 'history' ? api.historyFilter : api.treeFilter"
          size="sm"
          class="nm-api-col__search"
          :placeholder="api.sideView === 'history' ? t('modules.api.searchHistory') : t('modules.api.search')"
          clearable
          @update:model-value="api.sideView === 'history' ? (api.historyFilter = $event) : (api.treeFilter = $event)"
        >
          <template #prefix>
            <RsIcon name="search" :size="12" class="nm-api-col__search-icon" />
          </template>
        </RsInput>
        <template v-if="api.sideView === 'collection'">
          <RsButton
            variant="ghost"
            size="sm"
            icon-only
            icon="folder-plus"
            radius="sm"
            :aria-label="t('modules.api.newFolder')"
            @click="openNameDialog('folder', 'create', '', t('modules.api.newFolder'))"
          />
          <RsButton
            variant="ghost"
            size="sm"
            icon-only
            icon="plus"
            radius="sm"
            :aria-label="t('modules.api.newRequest')"
            @click="onNewRequest()"
          />
        </template>
      </div>
      <div class="nm-api-col__body">
        <ApiCollectionTree
          v-if="api.sideView === 'collection'"
          :model-value="selectedId"
          v-model:filter="api.treeFilter"
          :folders="api.folders"
          hide-filter
          @select="onSelect"
          @row-context="ctxTarget = $event"
        />
        <ApiHistoryPane
          v-else
          :items="api.history"
          :filter="api.historyFilter"
          @open="api.openHistory($event)"
          @row-context="ctxTarget = { kind: 'history', historyId: $event }"
        />
      </div>

      <RsDialog
        v-model:open="nameDlgOpen"
        :title="nameDlgTitle"
        width="sm"
        layout="form"
        :resizable="false"
        :fullscreenable="false"
        :show-overlay="false"
        :close-on-overlay-click="false"
      >
        <template #body>
          <form ref="nameForm" class="nm-api-col__form" autocomplete="off" @submit.prevent="onNameSave">
            <div class="nm-api-col__field">
              <RsLabel required>{{ t('modules.api.name') }}</RsLabel>
              <RsInput
                v-model="nameDlgValue"
                autocomplete="off"
                :placeholder="t('modules.api.namePlaceholder')"
              />
            </div>
            <p v-if="nameDlgError" class="nm-api-col__error" role="alert">{{ nameDlgError }}</p>
            <div class="nm-api-col__actions">
              <span class="nm-api-col__actions-spacer" />
              <RsButton type="button" variant="ghost" @click="nameDlgOpen = false">
                {{ t('common.cancel') }}
              </RsButton>
              <RsButton type="submit" variant="primary">
                {{ t('common.confirm') }}
              </RsButton>
            </div>
          </form>
        </template>
      </RsDialog>

      <RsConfirmDialog
        v-model:open="confirmOpen"
        :title="confirmTitle"
        :description="confirmDesc"
        :confirm-text="confirmTitle"
        :cancel-text="t('common.cancel')"
        confirm-variant="danger"
        @confirm="onConfirmDelete"
      />
    </div>
  </RsContextMenu>
</template>

<style scoped>
.nm-api-col {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.nm-api-col__switch {
  flex-shrink: 0;
  display: flex;
  gap: 0.15rem;
  padding: 0.3rem var(--rs-space-sm) 0;
}

.nm-api-col__switch-btn {
  flex: 1;
  height: 1.5rem;
  border: 0;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-text-muted);
  font-size: 12px;
  cursor: pointer;
}

.nm-api-col__switch-btn--on {
  background: var(--rs-fill-hover);
  color: var(--rs-text);
}

.nm-api-col__searchbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  height: var(--nm-tabbar-h);
  padding: 0 var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
  box-sizing: border-box;
}

.nm-api-col__search {
  flex: 1;
  min-width: 0;
}

.nm-api-col__search-icon {
  color: var(--rs-placeholder);
}

.nm-api-col__body {
  flex: 1;
  min-height: 0;
  padding: 0.25rem;
  overflow: hidden;
}

.nm-api-col__form {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding-top: var(--rs-space-xs);
}

.nm-api-col__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-api-col__error {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-danger);
}

.nm-api-col__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
}

.nm-api-col__actions-spacer {
  flex: 1;
}
</style>
