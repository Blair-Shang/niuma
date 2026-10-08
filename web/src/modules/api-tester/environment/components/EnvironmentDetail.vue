<script setup lang="ts">
/**
 * 环境详情：变量表，或全局变量。名称在标题和左侧列表，Base URL 写在变量 baseUrl。
 */
import { RsButton, RsConfirmDialog } from '@niuma/ui'
import { useEnvironmentPanel } from '../composables/useEnvironmentPanel'
import VariableTable from './VariableTable.vue'

const {
  api,
  t,
  focus,
  confirmRemoveOpen,
  globalRows,
  envVarRows,
  activeEnv,
  useEnvironment,
  onRemoveEnv,
} = useEnvironmentPanel()
</script>

<template>
  <section class="nm-api-env">
    <div v-if="focus === 'global'" class="nm-api-env__board">
      <section class="nm-api-env__panel">
        <header class="nm-api-env__panel-head">
          <span>{{ t('modules.api.globalVars') }}</span>
          <span class="nm-api-env__panel-hint">{{ t('modules.api.envGlobalHint') }}</span>
        </header>
        <VariableTable v-model="globalRows" />
      </section>
    </div>

    <div v-else-if="activeEnv" class="nm-api-env__board">
      <section class="nm-api-env__panel">
        <header class="nm-api-env__panel-head">
          <span>{{ t('modules.api.environmentVars') }}</span>
          <span class="nm-api-env__panel-hint">{{ t('modules.api.envDetailHint') }}</span>
          <span class="nm-api-env__panel-actions">
            <RsButton
              v-if="activeEnv.id !== api.envId"
              size="sm"
              variant="secondary"
              @click="useEnvironment(activeEnv.id)"
            >
              {{ t('modules.api.envUseCurrent') }}
            </RsButton>
            <RsButton
              variant="ghost"
              size="sm"
              icon-only
              icon="trash-2"
              tone="danger"
              :disabled="api.environments.length <= 1"
              :aria-label="t('modules.api.deleteEnvironment')"
              :title="t('modules.api.deleteEnvironment')"
              @click="confirmRemoveOpen = true"
            />
          </span>
        </header>
        <VariableTable v-model="envVarRows" />
      </section>
    </div>

    <RsConfirmDialog
      v-model:open="confirmRemoveOpen"
      :title="t('modules.api.deleteEnvironment')"
      :description="t('modules.api.deleteEnvironmentConfirm', { name: activeEnv?.name ?? '' })"
      :confirm-text="t('modules.api.deleteEnvironment')"
      :cancel-text="t('common.cancel')"
      confirm-variant="danger"
      @confirm="onRemoveEnv"
    />
  </section>
</template>

<style scoped>
.nm-api-env {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--rs-bg);
}

.nm-api-env__board {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm);
}

.nm-api-env__panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius);
  background: var(--rs-surface-elevated);
  overflow: hidden;
}

.nm-api-env__panel-head {
  display: flex;
  align-items: center;
  gap: var(--rs-space-md);
  flex-shrink: 0;
  min-height: var(--rs-control-height-lg);
  padding: 0 var(--rs-space-lg);
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: var(--rs-font-size-sm);
  font-weight: var(--rs-font-weight-semibold, 600);
}

.nm-api-env__panel-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--rs-font-size-xs);
  font-weight: var(--rs-font-weight-normal, 400);
  color: var(--rs-muted);
}

.nm-api-env__panel-actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
  margin-left: auto;
}

</style>
