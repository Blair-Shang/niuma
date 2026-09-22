<script setup lang="ts">
/**
 * 环境详情：选中环境的名称 / Base URL / 变量表，或全局变量。
 */
import { RsButton, RsConfirmDialog, RsInput, RsLabel } from '@niuma/ui'
import ApiVariableTable from './ApiVariableTable.vue'
import { useApiEnvironmentPanel } from './useApiEnvironmentPanel'

const {
  api,
  t,
  focus,
  nameDraft,
  confirmRemoveOpen,
  globalRows,
  envVarRows,
  activeEnv,
  globalVarCount,
  useEnvironment,
  commitEnvName,
  onRemoveEnv,
  onBaseUrlInput,
} = useApiEnvironmentPanel()
</script>

<template>
  <section class="nm-api-env">
    <div v-if="focus === 'global'" class="nm-api-env__inner">
      <header class="nm-api-env__head">
        <div>
          <h2 class="nm-api-env__title">{{ t('modules.api.globalVars') }}</h2>
          <p class="nm-api-env__desc">{{ t('modules.api.envGlobalHint') }}</p>
        </div>
      </header>
      <div class="nm-api-env__card">
        <div class="nm-api-env__card-head">
          <span>{{ t('modules.api.globalVars') }}</span>
          <span class="nm-api-env__count">{{ t('modules.api.envVarCount', { n: globalVarCount }) }}</span>
        </div>
        <ApiVariableTable v-model="globalRows" />
      </div>
    </div>

    <div v-else-if="activeEnv" class="nm-api-env__inner">
      <header class="nm-api-env__head">
        <div>
          <h2 class="nm-api-env__title">{{ activeEnv.name }}</h2>
          <p class="nm-api-env__desc">{{ t('modules.api.envDetailHint') }}</p>
        </div>
        <div class="nm-api-env__actions">
          <span v-if="activeEnv.id === api.envId" class="nm-api-env__badge">
            {{ t('modules.api.envUsing') }}
          </span>
          <RsButton
            v-else
            size="sm"
            variant="secondary"
            @click="useEnvironment(activeEnv.id)"
          >
            {{ t('modules.api.envUseCurrent') }}
          </RsButton>
        </div>
      </header>

      <div class="nm-api-env__form">
        <div class="nm-api-env__field">
          <RsLabel>{{ t('modules.api.name') }}</RsLabel>
          <RsInput
            v-model="nameDraft"
            size="sm"
            autocomplete="off"
            @blur="commitEnvName"
            @keydown.enter.prevent="commitEnvName"
          />
        </div>
        <div class="nm-api-env__field">
          <RsLabel>{{ t('modules.api.baseUrl') }}</RsLabel>
          <RsInput
            :model-value="activeEnv.baseUrl"
            size="sm"
            radius="sm"
            spellcheck="false"
            :placeholder="t('modules.api.baseUrlPlaceholder')"
            @update:model-value="onBaseUrlInput(String($event))"
          />
        </div>
      </div>

      <div class="nm-api-env__card">
        <div class="nm-api-env__card-head">
          <span>{{ t('modules.api.environmentVars') }}</span>
          <span class="nm-api-env__count">
            {{ t('modules.api.envVarCount', { n: envVarRows.length }) }}
          </span>
        </div>
        <ApiVariableTable v-model="envVarRows" />
      </div>

      <footer class="nm-api-env__footer">
        <RsButton
          variant="ghost"
          size="sm"
          :disabled="api.environments.length <= 1"
          @click="confirmRemoveOpen = true"
        >
          {{ t('modules.api.deleteEnvironment') }}
        </RsButton>
      </footer>
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
}

.nm-api-env__inner {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding: var(--rs-space-md) var(--rs-space-lg) var(--rs-space-lg);
}

.nm-api-env__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
}

.nm-api-env__title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.nm-api-env__desc {
  margin: 0.25rem 0 0;
  font-size: var(--nm-font-caption, 12px);
  color: var(--rs-muted);
  line-height: 1.5;
}

.nm-api-env__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-api-env__badge {
  padding: 2px 8px;
  font-size: var(--nm-font-caption, 11px);
  font-weight: 600;
  color: var(--rs-success);
  background: color-mix(in srgb, var(--rs-success) 16%, transparent);
}

.nm-api-env__form {
  display: grid;
  grid-template-columns: minmax(10rem, 16rem) minmax(0, 1fr);
  gap: var(--rs-space-md);
}

.nm-api-env__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.nm-api-env__card {
  display: flex;
  flex-direction: column;
  min-height: 12rem;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 2%, var(--rs-surface-elevated));
}

.nm-api-env__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  font-size: 12px;
  font-weight: 600;
}

.nm-api-env__count {
  font-weight: 500;
  color: var(--rs-muted);
}

.nm-api-env__footer {
  display: flex;
  justify-content: flex-start;
  padding-top: 0.25rem;
}

@media (max-width: 720px) {
  .nm-api-env__form {
    grid-template-columns: 1fr;
  }
}
</style>
