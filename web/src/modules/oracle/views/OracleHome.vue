<script setup lang="ts">
import { RsButton, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import ConnectionProfileTable from '@/modules/ops/components/ConnectionProfileTable.vue'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import type { ConnItem } from '@/modules/ops/types'
import OracleConnectionFields from '@/modules/oracle/components/OracleConnectionFields.vue'
import OracleAdvancedFields from '@/modules/oracle/components/OracleAdvancedFields.vue'
import type { OracleSessionTab } from '@/modules/oracle/pane-registry'
import OracleSession from '@/modules/oracle/views/OracleSession.vue'

const props = defineProps<{
  profileId?: string
  schema?: string
  table?: string
  isView?: boolean
  objectKind?: import('@/modules/oracle/types/object-script').OracleObjectKind
  objectName?: string
  designMode?: import('@/modules/oracle/types/object-script').OracleObjectScriptMode
  draftSql?: string
  initialTab?: OracleSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  tabId?: string
}>()
const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['oracle'])
const { profileMap, loading, dlgOpen, dlgMode, dlgKind, dlgProfile, form, formError, saving, deleting, testing, testMessage } = toRefs(cx)
const profiles = computed(() => profileMap.value.oracle)
function onConnect(profile: ConnItem): void { connect({ ...profile, kind: 'oracle' }) }
async function onSave(): Promise<void> {
  const ok = await cx.saveConnection()
  if (ok) toast.success(t('modules.oracle.editSite'))
}
async function onDelete(): Promise<void> {
  const ok = await cx.deleteConnection()
  if (!ok && formError.value) toast.error(formError.value)
}
onMounted(() => { void cx.loadAll() })
</script>

<template>
  <OracleSession
    v-if="props.profileId"
    :profile-id="props.profileId"
    :schema="props.schema"
    :table="props.table"
    :is-view="props.isView"
    :object-kind="props.objectKind"
    :object-name="props.objectName"
    :design-mode="props.designMode"
    :draft-sql="props.draftSql"
    :initial-tab="props.initialTab"
    :initial-sql="props.initialSql"
    :auto-run-initial-sql="props.autoRunInitialSql"
    :tab-id="props.tabId"
    class="nm-oracle-tab"
  />
  <div v-else class="nm-module-root nm-oracle-home">
    <header><h2 class="nm-section-title">{{ t('modules.oracle.title') }}</h2><p class="nm-section-desc">{{ t('modules.oracle.homeDesc') }}</p></header>
    <div class="nm-oracle-home__toolbar"><RsButton variant="primary" @click="cx.openCreate('oracle')">{{ t('modules.oracle.newSite') }}</RsButton><RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">{{ t('settings.pluginsRefresh') }}</RsButton></div>
    <p v-if="formError && !dlgOpen" class="nm-oracle-home__error" role="alert">{{ formError }}</p>
    <RsLoading v-if="loading" class="nm-oracle-home__loading" />
    <ConnectionProfileTable v-else :profiles="profiles" :protocol-label="() => 'Oracle'" @connect="onConnect" @edit="cx.openEdit($event)" @delete="cx.openDelete($event)" />
    <ConnectionFormDialog v-model:open="dlgOpen" :mode="dlgMode" :kind="dlgKind" :profile="dlgProfile" :form="form" :form-error="formError" :saving="saving" :deleting="deleting" :testing="testing" :test-message="testMessage" :tunnel-ssh-profiles="[]" @save="onSave" @delete="onDelete" @test="cx.testConnection()">
      <template #options><OracleConnectionFields :form="form" /></template>
      <template #advanced><OracleAdvancedFields :form="form" /></template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-oracle-home { display: flex; flex-direction: column; gap: var(--rs-space-md); height: 100%; min-height: 0; }
.nm-oracle-tab, .nm-oracle-home__loading { flex: 1; min-height: 0; }
.nm-oracle-home__toolbar { display: flex; gap: var(--rs-space-sm); }
.nm-oracle-home__error { margin: 0; color: var(--rs-danger); }
</style>
