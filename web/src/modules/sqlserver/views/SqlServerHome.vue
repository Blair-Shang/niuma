<script setup lang="ts">
import { RsButton, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, ref, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi } from '@/api'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import ConnectionProfileTable from '@/modules/ops/components/ConnectionProfileTable.vue'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import type { ConnItem } from '@/modules/ops/types'
import SqlServerConnectionFields from '@/modules/sqlserver/components/SqlServerConnectionFields.vue'
import SqlServerSslFields from '@/modules/sqlserver/components/SqlServerSslFields.vue'
import SqlServerAdvancedFields from '@/modules/sqlserver/components/SqlServerAdvancedFields.vue'
import type { SqlServerSessionTab } from '@/modules/sqlserver/pane-registry'
import type { SqlServerObjectKind, SqlServerObjectScriptMode } from '@/modules/sqlserver/types/object-script'
import SqlServerSession from '@/modules/sqlserver/views/SqlServerSession.vue'

const props = defineProps<{
  profileId?: string
  database?: string
  schema?: string
  table?: string
  isView?: boolean
  objectKind?: SqlServerObjectKind
  objectName?: string
  routine?: string
  routineKind?: 'procedure' | 'function'
  sequence?: string
  synonym?: string
  designMode?: SqlServerObjectScriptMode
  draftSql?: string
  initialTab?: SqlServerSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['sqlserver'])
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
const profiles = computed(() => profileMap.value.sqlserver)

const sshProfilesForTunnel = ref<ConnItem[]>([])

async function loadSshProfilesForTunnel(): Promise<void> {
  try {
    const result = await connectionApi.list({ kind: 'ssh' })
    sshProfilesForTunnel.value = (result.profiles ?? []).map((p) => ({ ...p, kind: 'ssh' as const }))
  } catch {
    sshProfilesForTunnel.value = []
  }
}

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'sqlserver' })
}

async function onSave(): Promise<void> {
  const wasEdit = dlgMode.value === 'edit'
  const ok = await cx.saveConnection()
  if (ok) {
    toast.success(wasEdit ? t('modules.sqlserver.editSite') : t('modules.sqlserver.newSite'))
  }
}

async function onDelete(): Promise<void> {
  const ok = await cx.deleteConnection()
  if (!ok && formError.value) toast.error(formError.value)
}

onMounted(() => {
  void cx.loadAll()
  void loadSshProfilesForTunnel()
})
</script>

<template>
  <SqlServerSession
    v-if="props.profileId"
    :profile-id="props.profileId"
    :database="props.database"
    :schema="props.schema"
    :table="props.table"
    :is-view="props.isView"
    :object-kind="props.objectKind"
    :object-name="props.objectName"
    :routine="props.routine"
    :routine-kind="props.routineKind"
    :sequence="props.sequence"
    :synonym="props.synonym"
    :design-mode="props.designMode"
    :draft-sql="props.draftSql"
    :initial-tab="props.initialTab"
    :initial-sql="props.initialSql"
    :auto-run-initial-sql="props.autoRunInitialSql"
    :tab-id="props.tabId"
    class="nm-sqlserver-tab"
  />
  <div v-else class="nm-module-root nm-sqlserver-home">
    <header>
      <h2 class="nm-section-title">{{ t('modules.sqlserver.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.sqlserver.homeDesc') }}</p>
    </header>
    <div class="nm-sqlserver-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('sqlserver')">{{ t('modules.sqlserver.newSite') }}</RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">{{ t('settings.pluginsRefresh') }}</RsButton>
    </div>
    <p v-if="formError && !dlgOpen" class="nm-sqlserver-home__error" role="alert">{{ formError }}</p>
    <RsLoading v-if="loading" class="nm-sqlserver-home__loading" />
    <ConnectionProfileTable
      v-else
      :profiles="profiles"
      :protocol-label="() => 'SQL Server'"
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
      :tunnel-ssh-profiles="sshProfilesForTunnel"
      @save="onSave"
      @delete="onDelete"
      @test="cx.testConnection()"
    >
      <template #options>
        <SqlServerConnectionFields :form="form" />
      </template>
      <template #ssl>
        <SqlServerSslFields :form="form" />
      </template>
      <template #advanced>
        <SqlServerAdvancedFields :form="form" />
      </template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-sqlserver-home {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}
.nm-sqlserver-tab,
.nm-sqlserver-home__loading {
  flex: 1;
  min-height: 0;
}
.nm-sqlserver-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
}
.nm-sqlserver-home__error {
  margin: 0;
  color: var(--rs-danger);
}
</style>
