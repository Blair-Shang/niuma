<script setup lang="ts">
import { RsButton, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import ConnectionProfileTable from '@/modules/ops/components/ConnectionProfileTable.vue'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import type { ConnItem } from '@/modules/ops/types'
import DamengConnectionFields from '@/modules/dameng/components/DamengConnectionFields.vue'
import DamengAdvancedFields from '@/modules/dameng/components/DamengAdvancedFields.vue'
import type { DamengSessionTab } from '@/modules/dameng/pane-registry'
import DamengSession from '@/modules/dameng/views/DamengSession.vue'

const props = defineProps<{
  profileId?: string
  schema?: string
  table?: string
  initialTab?: DamengSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  designMode?: 'create' | 'alter'
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['dameng'])
const {
  profileMap,
  loading,
  dlgOpen,
  dlgMode,
  dlgKind,
  dlgProfile,
  form,
  formError,
  saving,
  deleting,
  testing,
  testMessage,
} = toRefs(cx)

const profiles = computed(() => profileMap.value.dameng)

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'dameng' })
}

async function onSave(): Promise<void> {
  const wasEdit = dlgMode.value === 'edit'
  const ok = await cx.saveConnection()
  if (ok) {
    toast.success(wasEdit ? t('modules.dameng.editSite') : t('modules.dameng.newSite'))
  }
}

async function onDelete(): Promise<void> {
  const ok = await cx.deleteConnection()
  if (!ok && formError.value) {
    toast.error(formError.value)
  }
}

onMounted(() => {
  cx.loadAll().catch(() => undefined)
})
</script>

<template>
  <DamengSession
    v-if="props.profileId"
    :profile-id="props.profileId"
    :schema="props.schema"
    :table="props.table"
    :initial-tab="props.initialTab"
    :initial-sql="props.initialSql"
    :auto-run-initial-sql="props.autoRunInitialSql"
    :design-mode="props.designMode"
    :tab-id="props.tabId"
    class="nm-dameng-tab"
  />
  <div v-else class="nm-module-root nm-dameng-home">
    <header class="nm-dameng-home__header">
      <h2 class="nm-section-title">{{ t('modules.dameng.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.dameng.homeDesc') }}</p>
    </header>

    <div class="nm-dameng-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('dameng')">
        {{ t('modules.dameng.newSite') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">
        {{ t('settings.pluginsRefresh') }}
      </RsButton>
    </div>

    <p v-if="formError && !dlgOpen" class="nm-dameng-home__error" role="alert">
      {{ formError }}
    </p>

    <RsLoading v-if="loading" class="nm-dameng-home__loading" />

    <div v-else class="nm-dameng-home__table">
      <ConnectionProfileTable
        :profiles="profiles"
        :protocol-label="() => 'Dameng'"
        @connect="onConnect"
        @edit="cx.openEdit($event)"
        @delete="cx.openDelete($event)"
      />
    </div>

    <ConnectionFormDialog
      v-model:open="dlgOpen"
      :mode="dlgMode"
      :kind="dlgKind"
      :profile="dlgProfile"
      :form="form"
      :form-error="formError"
      :saving="saving"
      :deleting="deleting"
      :testing="testing"
      :test-message="testMessage"
      :tunnel-ssh-profiles="[]"
      @save="onSave"
      @delete="onDelete"
      @test="cx.testConnection()"
    >
      <template #options>
        <DamengConnectionFields :form="form" />
      </template>
      <template #advanced>
        <DamengAdvancedFields :form="form" />
      </template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-dameng-home {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}

.nm-dameng-tab {
  height: 100%;
  min-height: 0;
}

.nm-dameng-home__header {
  flex-shrink: 0;
}

.nm-dameng-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-dameng-home__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-dameng-home__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-dameng-home__table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-dameng-home__table :deep(.rs-table) {
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
}
</style>
