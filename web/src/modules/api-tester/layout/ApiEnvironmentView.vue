<script setup lang="ts">
/**
 * 环境配置工作台：对齐设置「模型接入」左列表 + 右详情。
 * 列表只负责选中编辑；请求栏用的当前环境由详情「设为当前」切换。
 */
import { RsButton, RsIcon, RsInput } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import ApiEnvironmentPanel from './ApiEnvironmentPanel.vue'
import { useApiEnvironmentPanel } from './useApiEnvironmentPanel'

const { t } = useI18n()
const {
  focus,
  selectedEnvId,
  listFilter,
  envList,
  globalVarCount,
  selectEnvironment,
  selectGlobal,
  createEnvironment,
} = useApiEnvironmentPanel()
</script>

<template>
  <div class="nm-api-env-view">
    <header class="nm-api-env-view__toolbar">
      <div class="nm-api-env-view__toolbar-main">
        <h1 class="nm-api-env-view__title">{{ t('modules.api.sideEnvironment') }}</h1>
        <p class="nm-api-env-view__hint">{{ t('modules.api.envTabHint') }}</p>
      </div>
      <RsButton size="sm" variant="primary" icon="plus" @click="createEnvironment">
        {{ t('modules.api.newEnvironment') }}
      </RsButton>
    </header>

    <div class="nm-api-env-view__workspace">
      <aside class="nm-api-env-view__sidebar">
        <div class="nm-api-env-view__sidebar-head">{{ t('modules.api.envListTitle') }}</div>
        <RsInput
          v-model="listFilter"
          size="sm"
          class="nm-api-env-view__filter"
          :placeholder="t('modules.api.envSearch')"
          clearable
        >
          <template #prefix>
            <RsIcon name="search" :size="12" class="nm-api-env-view__filter-icon" />
          </template>
        </RsInput>
        <nav class="nm-api-env-view__nav">
          <button
            v-for="item in envList"
            :key="item.id"
            type="button"
            class="nm-api-env-view__nav-item"
            :class="{
              'nm-api-env-view__nav-item--active':
                focus === 'environment' && selectedEnvId === item.id,
            }"
            @click="selectEnvironment(item.id)"
          >
            <RsIcon name="globe" :size="14" class="nm-api-env-view__nav-icon" />
            <span class="nm-api-env-view__nav-text">
              <span class="nm-api-env-view__nav-name">{{ item.name }}</span>
              <span class="nm-api-env-view__nav-meta">
                {{ item.baseUrl || t('modules.api.envNoBaseUrl') }}
              </span>
            </span>
            <span v-if="item.current" class="nm-api-env-view__badge">{{ t('modules.api.envUsing') }}</span>
          </button>
        </nav>

        <div class="nm-api-env-view__sidebar-head">{{ t('modules.api.envSharedTitle') }}</div>
        <nav class="nm-api-env-view__nav">
          <button
            type="button"
            class="nm-api-env-view__nav-item"
            :class="{ 'nm-api-env-view__nav-item--active': focus === 'global' }"
            @click="selectGlobal"
          >
            <RsIcon name="layers" :size="14" class="nm-api-env-view__nav-icon" />
            <span class="nm-api-env-view__nav-text">
              <span class="nm-api-env-view__nav-name">{{ t('modules.api.globalVars') }}</span>
              <span class="nm-api-env-view__nav-meta">
                {{ t('modules.api.envVarCount', { n: globalVarCount }) }}
              </span>
            </span>
          </button>
        </nav>
      </aside>

      <ApiEnvironmentPanel />
    </div>
  </div>
</template>

<style scoped>
.nm-api-env-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--nm-editor-bg, var(--rs-surface-elevated));
}

.nm-api-env-view__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-md);
  flex-shrink: 0;
  min-height: 2.5rem;
  padding: var(--rs-space-sm) var(--rs-space-md);
  border-bottom: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3%, var(--rs-surface-elevated));
}

.nm-api-env-view__toolbar-main {
  min-width: 0;
}

.nm-api-env-view__title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.3;
}

.nm-api-env-view__hint {
  margin: 0.15rem 0 0;
  font-size: var(--nm-font-caption, 12px);
  color: var(--rs-muted);
  line-height: 1.45;
}

.nm-api-env-view__workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--rs-surface-elevated);
}

.nm-api-env-view__sidebar {
  display: flex;
  flex-direction: column;
  width: 16rem;
  flex-shrink: 0;
  border-right: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 2%, var(--rs-surface-elevated));
  overflow: auto;
}

.nm-api-env-view__sidebar-head {
  padding: var(--rs-space-sm) var(--rs-space-md);
  font-size: var(--nm-font-caption, 11px);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rs-muted);
}

.nm-api-env-view__filter {
  margin: 0 var(--rs-space-md) var(--rs-space-sm);
}

.nm-api-env-view__filter-icon {
  color: var(--rs-placeholder);
}

.nm-api-env-view__nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nm-api-env-view__nav-item {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  width: 100%;
  padding: var(--rs-space-sm) var(--rs-space-md);
  padding-left: calc(var(--rs-space-md) - 2px);
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  color: var(--rs-text);
  text-align: left;
  cursor: pointer;
}

.nm-api-env-view__nav-item:hover {
  background: var(--rs-item-hover);
}

.nm-api-env-view__nav-item--active {
  background: color-mix(in srgb, var(--rs-primary) 14%, transparent);
  border-left-color: var(--rs-primary);
}

.nm-api-env-view__nav-icon {
  flex-shrink: 0;
  color: var(--rs-muted);
}

.nm-api-env-view__nav-item--active .nm-api-env-view__nav-icon {
  color: var(--rs-primary);
}

.nm-api-env-view__nav-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.nm-api-env-view__nav-name {
  font-size: var(--nm-font-body, 13px);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-api-env-view__nav-meta {
  font-size: var(--nm-font-caption, 11px);
  color: var(--rs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-api-env-view__badge {
  flex-shrink: 0;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--rs-success);
  background: color-mix(in srgb, var(--rs-success) 16%, transparent);
}
</style>
