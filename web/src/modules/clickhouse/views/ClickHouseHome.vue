<script setup lang="ts">
import { RsButton, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import ConnectionProfileTable from '@/modules/ops/components/ConnectionProfileTable.vue'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import type { ConnItem } from '@/modules/ops/types'
import ClickHouseConnectionFields from '@/modules/clickhouse/components/ClickHouseConnectionFields.vue'
import ClickHouseSslFields from '@/modules/clickhouse/components/ClickHouseSslFields.vue'
import ClickHouseAdvancedFields from '@/modules/clickhouse/components/ClickHouseAdvancedFields.vue'
import type { ClickHouseSessionTab } from '@/modules/clickhouse/pane-registry'
import type {
  ClickHouseObjectKind,
  ClickHouseObjectScriptMode,
} from '@/modules/clickhouse/types/object-script'
import ClickHouseSession from '@/modules/clickhouse/views/ClickHouseSession.vue'

const props = defineProps<{
  profileId?: string
  database?: string
  table?: string
  isView?: boolean
  designMode?: ClickHouseObjectScriptMode
  objectKind?: ClickHouseObjectKind
  objectName?: string
  draftSql?: string
  initialTab?: ClickHouseSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  tabId?: string
}>()
const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['clickhouse'])
const { profileMap, loading, dlgOpen, dlgMode, dlgKind, dlgProfile, form, formError, saving, deleting, testing, testMessage } = toRefs(cx)
const profiles = computed(() => profileMap.value.clickhouse)

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'clickhouse' })
}
async function onSave(): Promise<void> {
  const ok = await cx.saveConnection()
  if (ok) toast.success(t('modules.clickhouse.editSite'))
}
async function onDelete(): Promise<void> {
  const ok = await cx.deleteConnection()
  if (!ok && formError.value) toast.error(formError.value)
}
onMounted(() => { void cx.loadAll() })
</script>

<template>
  <ClickHouseSession
    v-if="props.profileId"
    :profile-id="props.profileId"
    :database="props.database"
    :table="props.table"
    :is-view="props.isView"
    :design-mode="props.designMode"
    :object-kind="props.objectKind"
    :object-name="props.objectName"
    :draft-sql="props.draftSql"
    :initial-tab="props.initialTab"
    :initial-sql="props.initialSql"
    :auto-run-initial-sql="props.autoRunInitialSql"
    :tab-id="props.tabId"
    class="nm-clickhouse-tab"
  />
  <div v-else class="nm-module-root nm-clickhouse-home">
    <header>
      <h2 class="nm-section-title">{{ t('modules.clickhouse.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.clickhouse.homeDesc') }}</p>
    </header>
    <div class="nm-clickhouse-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('clickhouse')">{{ t('modules.clickhouse.newSite') }}</RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">{{ t('settings.pluginsRefresh') }}</RsButton>
    </div>
    <p v-if="formError && !dlgOpen" class="nm-clickhouse-home__error" role="alert">{{ formError }}</p>
    <RsLoading v-if="loading" class="nm-clickhouse-home__loading" />
    <ConnectionProfileTable
      v-else
      :profiles="profiles"
      :protocol-label="() => 'ClickHouse'"
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
      <template #options><ClickHouseConnectionFields :form="form" /></template>
      <template #ssl><ClickHouseSslFields :form="form" /></template>
      <template #advanced><ClickHouseAdvancedFields :form="form" /></template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-clickhouse-home { display: flex; flex-direction: column; gap: var(--rs-space-md); height: 100%; min-height: 0; }
.nm-clickhouse-tab, .nm-clickhouse-home__loading { flex: 1; min-height: 0; }
.nm-clickhouse-home__toolbar { display: flex; gap: var(--rs-space-sm); }
.nm-clickhouse-home__error { margin: 0; color: var(--rs-danger); }
</style>
