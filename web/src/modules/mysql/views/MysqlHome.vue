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
import MysqlConnectionFields from '@/modules/mysql/components/MysqlConnectionFields.vue'
import MysqlSslFields from '@/modules/mysql/components/MysqlSslFields.vue'
import MysqlAdvancedFields from '@/modules/mysql/components/MysqlAdvancedFields.vue'
import type { MysqlSessionTab } from '@/modules/mysql/pane-registry'
import MysqlSession from '@/modules/mysql/views/MysqlSession.vue'

const props = defineProps<{
  profileId?: string
  database?: string
  initialTab?: MysqlSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['mysql'])
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

const profiles = computed(() => profileMap.value.mysql)

const sshProfilesForTunnel = ref<ConnItem[]>([])

async function loadSshProfilesForTunnel(): Promise<void> {
  try {
    const result = await connectionApi.list({ kind: 'ssh' })
    sshProfilesForTunnel.value = (result.profiles ?? []).map((p) => ({ ...p, kind: 'ssh' as const }))
  } catch {
    sshProfilesForTunnel.value = []
  }
}

function protocolLabel(): string {
  return 'MySQL'
}

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'mysql' })
}

async function onSave(): Promise<void> {
  const wasEdit = dlgMode.value === 'edit'
  const ok = await cx.saveConnection()
  if (ok) {
    toast.success(wasEdit ? t('modules.mysql.editSite') : t('modules.mysql.newSite'))
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
  void loadSshProfilesForTunnel()
})
</script>

<template>
  <MysqlSession
    v-if="props.profileId"
    :profile-id="props.profileId"
    :database="props.database"
    :initial-tab="props.initialTab"
    :initial-sql="props.initialSql"
    :auto-run-initial-sql="props.autoRunInitialSql"
    :tab-id="props.tabId"
    class="nm-mysql-tab"
  />
  <div v-else class="nm-module-root nm-mysql-home">
    <header class="nm-mysql-home__header">
      <h2 class="nm-section-title">{{ t('modules.mysql.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.mysql.homeDesc') }}</p>
    </header>

    <div class="nm-mysql-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('mysql')">
        {{ t('modules.mysql.newSite') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">
        {{ t('settings.pluginsRefresh') }}
      </RsButton>
    </div>

    <p v-if="formError && !dlgOpen" class="nm-mysql-home__error" role="alert">
      {{ formError }}
    </p>

    <RsLoading v-if="loading" class="nm-mysql-home__loading" />

    <div v-else class="nm-mysql-home__table">
      <ConnectionProfileTable
        :profiles="profiles"
        :protocol-label="protocolLabel"
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
      :tunnel-ssh-profiles="sshProfilesForTunnel"
      @save="onSave"
      @delete="onDelete"
      @test="cx.testConnection()"
    >
      <template #options>
        <MysqlConnectionFields :form="form" />
      </template>
      <template #ssl>
        <MysqlSslFields :form="form" />
      </template>
      <template #advanced>
        <MysqlAdvancedFields :form="form" />
      </template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-mysql-home {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}

.nm-mysql-tab {
  height: 100%;
  min-height: 0;
}

.nm-mysql-home__header {
  flex-shrink: 0;
}

.nm-mysql-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-mysql-home__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-mysql-home__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-mysql-home__table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-mysql-home__table :deep(.rs-table) {
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
}
</style>
