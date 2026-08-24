<script setup lang="ts">
import { RsButton, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import ConnectionProfileTable from '@/modules/ops/components/ConnectionProfileTable.vue'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import type { ConnItem } from '@/modules/ops/types'
import PostgresConnectionFields from '@/modules/postgres/components/PostgresConnectionFields.vue'
import PostgresSslFields from '@/modules/postgres/components/PostgresSslFields.vue'
import PostgresAdvancedFields from '@/modules/postgres/components/PostgresAdvancedFields.vue'
import type { PostgresSessionTab } from '@/modules/postgres/pane-registry'
import PostgresSession from '@/modules/postgres/views/PostgresSession.vue'

const props = defineProps<{
  profileId?: string
  database?: string
  initialTab?: PostgresSessionTab
  initialSql?: string
  /** 查询正文草稿（随 workspace.tabs 重启恢复） */
  draftSql?: string
  autoRunInitialSql?: boolean
  queryExecMode?: 'paged' | 'batch'
  tabId?: string
}>()
const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['postgres'])
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
const profiles = computed(() => profileMap.value.postgres)

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'postgres' })
}
async function onSave(): Promise<void> {
  const ok = await cx.saveConnection()
  if (ok) toast.success(t('modules.postgres.editSite'))
}
async function onDelete(): Promise<void> {
  const ok = await cx.deleteConnection()
  if (!ok && formError.value) toast.error(formError.value)
}
onMounted(() => {
  void cx.loadAll()
})
</script>

<template>
  <PostgresSession
    v-if="props.profileId"
    :profile-id="props.profileId"
    :database="props.database"
    :initial-tab="props.initialTab"
    :initial-sql="props.initialSql"
    :draft-sql="props.draftSql"
    :auto-run-initial-sql="props.autoRunInitialSql"
    :query-exec-mode="props.queryExecMode"
    :tab-id="props.tabId"
    class="nm-postgres-tab"
  />
  <div v-else class="nm-module-root nm-postgres-home">
    <header>
      <h2 class="nm-section-title">{{ t('modules.postgres.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.postgres.homeDesc') }}</p>
    </header>
    <div class="nm-postgres-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('postgres')">
        {{ t('modules.postgres.newSite') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">
        {{ t('settings.pluginsRefresh') }}
      </RsButton>
    </div>
    <p v-if="formError && !dlgOpen" class="nm-postgres-home__error" role="alert">{{ formError }}</p>
    <RsLoading v-if="loading" class="nm-postgres-home__loading" />
    <ConnectionProfileTable
      v-else
      :profiles="profiles"
      :protocol-label="() => t('nav.postgres')"
      @connect="onConnect"
      @edit="cx.openEdit($event)"
      @delete="cx.openDelete($event)"
    />
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
      <template #options><PostgresConnectionFields :form="form" /></template>
      <template #ssl><PostgresSslFields :form="form" /></template>
      <template #advanced><PostgresAdvancedFields :form="form" /></template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-postgres-home {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}
.nm-postgres-tab,
.nm-postgres-home__loading {
  flex: 1;
  min-height: 0;
}
.nm-postgres-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
}
.nm-postgres-home__error {
  margin: 0;
  color: var(--rs-danger);
}
</style>
