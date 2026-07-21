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
import VastConnectionFields from '@/modules/vastbase/components/VastConnectionFields.vue'
import VastSslFields from '@/modules/vastbase/components/VastSslFields.vue'
import VastAdvancedFields from '@/modules/vastbase/components/VastAdvancedFields.vue'
import type { VastSessionTab } from '@/modules/vastbase/pane-registry'
import VastSession from '@/modules/vastbase/views/VastSession.vue'

const props = defineProps<{
  profileId?: string
  database?: string
  schema?: string
  table?: string
  routine?: string
  routineKind?: 'function' | 'procedure'
  args?: string
  oid?: number
  initialTab?: VastSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  designMode?: 'create' | 'alter'
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['vastbase'])
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

const profiles = computed(() => profileMap.value.vastbase)

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
  return 'Vastbase'
}

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'vastbase' })
}

async function onSave(): Promise<void> {
  const wasEdit = dlgMode.value === 'edit'
  const ok = await cx.saveConnection()
  if (ok) {
    toast.success(wasEdit ? t('modules.vastbase.editSite') : t('modules.vastbase.newSite'))
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
  <VastSession
    v-if="props.profileId"
    :profile-id="props.profileId"
    :database="props.database"
    :schema="props.schema"
    :table="props.table"
    :routine="props.routine"
    :routine-kind="props.routineKind"
    :args="props.args"
    :oid="props.oid"
    :initial-tab="props.initialTab"
    :initial-sql="props.initialSql"
    :auto-run-initial-sql="props.autoRunInitialSql"
    :design-mode="props.designMode"
    :tab-id="props.tabId"
    class="nm-vast-tab"
  />
  <div v-else class="nm-module-root nm-vast-home">
    <header class="nm-vast-home__header">
      <h2 class="nm-section-title">{{ t('modules.vastbase.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.vastbase.homeDesc') }}</p>
    </header>

    <div class="nm-vast-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('vastbase')">
        {{ t('modules.vastbase.newSite') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">
        {{ t('settings.pluginsRefresh') }}
      </RsButton>
    </div>

    <p v-if="formError && !dlgOpen" class="nm-vast-home__error" role="alert">
      {{ formError }}
    </p>

    <RsLoading v-if="loading" class="nm-vast-home__loading" />

    <div v-else class="nm-vast-home__table">
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
        <VastConnectionFields :form="form" />
      </template>
      <template #ssl>
        <VastSslFields :form="form" />
      </template>
      <template #advanced>
        <VastAdvancedFields :form="form" />
      </template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-vast-home {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}

.nm-vast-tab {
  height: 100%;
  min-height: 0;
}

.nm-vast-home__header {
  flex-shrink: 0;
}

.nm-vast-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-vast-home__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-vast-home__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-vast-home__table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-vast-home__table :deep(.rs-table) {
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
}
</style>
