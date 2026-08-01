<script setup lang="ts">
import { RsButton, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import ConnectionProfileTable from '@/modules/ops/components/ConnectionProfileTable.vue'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import type { ConnItem } from '@/modules/ops/types'
import SqliteConnectionFields from '@/modules/sqlite/components/SqliteConnectionFields.vue'
import SqliteAdvancedFields from '@/modules/sqlite/components/SqliteAdvancedFields.vue'
import type { SqliteSessionTab } from '@/modules/sqlite/pane-registry'
import SqliteSession from '@/modules/sqlite/views/SqliteSession.vue'

const props = defineProps<{
  profileId?: string
  schema?: string
  table?: string
  initialTab?: SqliteSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  designMode?: 'create' | 'alter'
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['sqlite'])
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

const profiles = computed(() => profileMap.value.sqlite)

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'sqlite' })
}

async function onSave(): Promise<void> {
  const wasEdit = dlgMode.value === 'edit'
  const ok = await cx.saveConnection()
  if (ok) {
    toast.success(wasEdit ? t('modules.sqlite.editSite') : t('modules.sqlite.newSite'))
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
  <SqliteSession
    v-if="props.profileId"
    :profile-id="props.profileId"
    :schema="props.schema"
    :table="props.table"
    :initial-tab="props.initialTab"
    :initial-sql="props.initialSql"
    :auto-run-initial-sql="props.autoRunInitialSql"
    :design-mode="props.designMode"
    :tab-id="props.tabId"
    class="nm-sqlite-tab"
  />
  <div v-else class="nm-module-root nm-sqlite-home">
    <header class="nm-sqlite-home__header">
      <h2 class="nm-section-title">{{ t('modules.sqlite.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.sqlite.homeDesc') }}</p>
    </header>

    <div class="nm-sqlite-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('sqlite')">
        {{ t('modules.sqlite.newSite') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">
        {{ t('settings.pluginsRefresh') }}
      </RsButton>
    </div>

    <p v-if="formError && !dlgOpen" class="nm-sqlite-home__error" role="alert">
      {{ formError }}
    </p>

    <RsLoading v-if="loading" class="nm-sqlite-home__loading" />

    <div v-else class="nm-sqlite-home__table">
      <ConnectionProfileTable
        :profiles="profiles"
        :protocol-label="() => 'SQLite'"
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
        <SqliteConnectionFields :form="form" />
      </template>
      <template #advanced>
        <SqliteAdvancedFields :form="form" />
      </template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-sqlite-home {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}

.nm-sqlite-tab {
  height: 100%;
  min-height: 0;
}

.nm-sqlite-home__header {
  flex-shrink: 0;
}

.nm-sqlite-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-sqlite-home__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-sqlite-home__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-sqlite-home__table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-sqlite-home__table :deep(.rs-table) {
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
}
</style>
