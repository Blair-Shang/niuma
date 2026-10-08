<script setup lang="ts">
/**
 * 环境配置工作台。列表选中编辑；请求栏的当前环境由详情「设为当前」切换。
 */
import { RsButton, RsIcon, RsInput, useRsToast } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { pickJsonFile } from '../utils/collection-io'
import { importPostmanEnvironment } from '../http/import/postman-env'
import { useApiTesterStore } from '../stores/api-tester'
import { useEnvironmentPanel } from './composables/useEnvironmentPanel'
import EnvironmentDetail from './components/EnvironmentDetail.vue'

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
} = useEnvironmentPanel()
const api = useApiTesterStore()
const toast = useRsToast()

async function importEnvironment(): Promise<void> {
  const text = await pickJsonFile()
  if (!text) return
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    toast.error(t('modules.api.importEnvironmentError'))
    return
  }
  if (!parsed || typeof parsed !== 'object') {
    toast.error(t('modules.api.importEnvironmentError'))
    return
  }
  const env = importPostmanEnvironment(parsed as Record<string, unknown>)
  if (!env) {
    toast.error(t('modules.api.importEnvironmentError'))
    return
  }
  const created = api.importEnvironment(env.name, env.vars)
  selectEnvironment(created.id)
  toast.success(t('modules.api.importEnvironmentOk'))
}
</script>

<template>
  <div class="nm-api-env-view">
    <aside class="nm-api-env-view__sidebar">
      <div class="nm-api-env-view__sidebar-head">
        <span class="nm-api-env-view__sidebar-label">{{ t('modules.api.envListTitle') }}</span>
        <RsInput
          v-model="listFilter"
          size="sm"
          class="nm-api-env-view__filter"
          :placeholder="t('modules.api.envSearch')"
          :aria-label="t('modules.api.envSearch')"
          clearable
        >
          <template #prefix>
            <RsIcon name="search" :size="12" class="nm-api-env-view__filter-icon" />
          </template>
        </RsInput>
        <RsButton
          size="sm"
          variant="ghost"
          icon-only
          icon="upload"
          :aria-label="t('modules.api.importEnvironment')"
          :title="t('modules.api.importEnvironment')"
          @click="importEnvironment"
        />
        <RsButton
          size="sm"
          variant="ghost"
          icon-only
          icon="plus"
          :aria-label="t('modules.api.newEnvironment')"
          :title="t('modules.api.newEnvironment')"
          @click="createEnvironment"
        />
      </div>
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

      <div class="nm-api-env-view__shared">
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
      </div>
    </aside>

    <EnvironmentDetail />
  </div>
</template>

<style scoped>
.nm-api-env-view {
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--rs-bg);
}

.nm-api-env-view__sidebar {
  display: flex;
  flex-direction: column;
  width: 260px;
  flex-shrink: 0;
  min-height: 0;
  border-right: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 2%, var(--rs-surface-elevated));
}

.nm-api-env-view__sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: 16px 12px 4px 16px;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  color: var(--rs-muted);
}

.nm-api-env-view__sidebar-label {
  flex-shrink: 0;
}

.nm-api-env-view__filter {
  flex: 1;
  min-width: 0;
}

.nm-api-env-view__filter-icon {
  color: var(--rs-placeholder);
}

.nm-api-env-view__nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px;
}

.nm-api-env-view__shared {
  flex-shrink: 0;
  border-top: 1px solid var(--rs-border-subtle);
  padding: 8px 8px;
}

.nm-api-env-view__nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 48px;
  padding: 6px 12px;
  border: none;
  border-radius: var(--rs-radius);
  background: transparent;
  color: var(--rs-text);
  text-align: left;
  cursor: pointer;
}

.nm-api-env-view__nav-item:hover {
  background: var(--rs-item-hover);
}

.nm-api-env-view__nav-item--active {
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
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
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: var(--rs-success);
  background: color-mix(in srgb, var(--rs-success) 14%, transparent);
}
</style>
