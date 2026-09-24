<script setup lang="ts">
/**
 * API 管理：集合树。搜索与环境/历史入口在 ApiSideNav。
 */
import {
  RsButton,
  RsConfirmDialog,
  RsContextMenu,
  RsDialog,
  RsInput,
  RsLabel,
} from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { useApiCollectionPanel } from './useApiCollectionPanel'
import ApiCollectionTree from './ApiCollectionTree.vue'

const { t } = useI18n()
const {
  api,
  selectedId,
  expandedKeys,
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
  curlDlgOpen,
  curlDlgValue,
  curlDlgError,
  activeCtxItems,
  onSelect,
  onTreeDrop,
  onNameSave,
  onConfirmDelete,
  onCurlImport,
  onCtxSelect,
} = useApiCollectionPanel()
</script>

<template>
  <RsContextMenu v-model:open="ctxMenuOpen" :items="activeCtxItems" @select="onCtxSelect">
    <div class="nm-api-col" @contextmenu.capture="ctxTarget = null">
      <div class="nm-api-col__body">
        <ApiCollectionTree
          :model-value="selectedId"
          v-model:expanded-keys="expandedKeys"
          :filter="api.treeFilter"
          :folders="api.folders"
          @select="onSelect"
          @row-context="ctxTarget = $event"
          @drop="onTreeDrop"
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

      <RsDialog
        v-model:open="curlDlgOpen"
        :title="t('modules.api.importCurlTitle')"
        width="md"
        layout="form"
        :resizable="false"
        :fullscreenable="false"
        :show-overlay="false"
        :close-on-overlay-click="false"
      >
        <template #body>
          <form class="nm-api-col__form" autocomplete="off" @submit.prevent="onCurlImport">
            <p class="nm-api-col__hint">{{ t('modules.api.importCurlHint') }}</p>
            <div class="nm-api-col__field">
              <RsLabel for="nm-api-curl">{{ t('modules.api.importCurl') }}</RsLabel>
              <textarea
                id="nm-api-curl"
                v-model="curlDlgValue"
                class="nm-api-col__curl"
                rows="8"
                spellcheck="false"
                :placeholder="t('modules.api.importCurlPlaceholder')"
              />
            </div>
            <p v-if="curlDlgError" class="nm-api-col__error" role="alert">{{ curlDlgError }}</p>
            <div class="nm-api-col__actions">
              <span class="nm-api-col__actions-spacer" />
              <RsButton type="button" variant="ghost" @click="curlDlgOpen = false">
                {{ t('common.cancel') }}
              </RsButton>
              <RsButton type="submit" variant="primary">
                {{ t('common.confirm') }}
              </RsButton>
            </div>
          </form>
        </template>
      </RsDialog>
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

.nm-api-col__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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

.nm-api-col__hint {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
}

.nm-api-col__curl {
  width: 100%;
  min-height: 8rem;
  resize: vertical;
  box-sizing: border-box;
  padding: var(--rs-space-sm);
  border: 1px solid var(--rs-border);
  border-radius: 6px;
  background: var(--rs-bg);
  color: var(--rs-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--rs-font-size-sm);
}

.nm-api-col__curl:focus {
  outline: 2px solid color-mix(in srgb, var(--rs-primary) 55%, transparent);
  outline-offset: 1px;
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
