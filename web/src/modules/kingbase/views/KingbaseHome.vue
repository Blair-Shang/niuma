<script setup lang="ts">
import { RsButton, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import ConnectionProfileTable from '@/modules/ops/components/ConnectionProfileTable.vue'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import type { ConnItem } from '@/modules/ops/types'
import KingbaseConnectionFields from '@/modules/kingbase/components/KingbaseConnectionFields.vue'
import KingbaseSslFields from '@/modules/kingbase/components/KingbaseSslFields.vue'
import KingbaseAdvancedFields from '@/modules/kingbase/components/KingbaseAdvancedFields.vue'
import type { KingbaseSessionTab } from '@/modules/kingbase/pane-registry'
import KingbaseSession from '@/modules/kingbase/views/KingbaseSession.vue'

const props = defineProps<{
  profileId?: string
  database?: string
  initialTab?: KingbaseSessionTab
  initialSql?: string
  autoRunInitialSql?: boolean
  queryExecMode?: 'paged' | 'batch'
  tabId?: string
}>()
const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['kingbase'])
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
const profiles = computed(() => profileMap.value.kingbase)

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'kingbase' })
}
async function onSave(): Promise<void> {
  const ok = await cx.saveConnection()
  if (ok) toast.success(t('modules.kingbase.editSite'))
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
  <KingbaseSession
    v-if="props.profileId"
    :profile-id="props.profileId"
    :database="props.database"
    :initial-tab="props.initialTab"
    :initial-sql="props.initialSql"
    :auto-run-initial-sql="props.autoRunInitialSql"
    :query-exec-mode="props.queryExecMode"
    :tab-id="props.tabId"
    class="nm-kingbase-tab"
  />
  <div v-else class="nm-module-root nm-kingbase-home">
    <header>
      <h2 class="nm-section-title">{{ t('modules.kingbase.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.kingbase.homeDesc') }}</p>
    </header>
    <div class="nm-kingbase-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('kingbase')">
        {{ t('modules.kingbase.newSite') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">
        {{ t('settings.pluginsRefresh') }}
      </RsButton>
    </div>
    <p v-if="formError && !dlgOpen" class="nm-kingbase-home__error" role="alert">{{ formError }}</p>
    <RsLoading v-if="loading" class="nm-kingbase-home__loading" />
    <ConnectionProfileTable
      v-else
      :profiles="profiles"
      :protocol-label="() => t('nav.kingbase')"
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
      <template #options><KingbaseConnectionFields :form="form" /></template>
      <template #ssl><KingbaseSslFields :form="form" /></template>
      <template #advanced><KingbaseAdvancedFields :form="form" /></template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-kingbase-home {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}
.nm-kingbase-tab,
.nm-kingbase-home__loading {
  flex: 1;
  min-height: 0;
}
.nm-kingbase-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
}
.nm-kingbase-home__error {
  margin: 0;
  color: var(--rs-danger);
}
</style>
