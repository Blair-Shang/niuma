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
import MongoConnectionFields from '@/modules/mongodb/components/MongoConnectionFields.vue'
import MongoSession from '@/modules/mongodb/views/MongoSession.vue'
import type { MongoSessionTab } from '@/modules/mongodb/pane-registry'

const props = defineProps<{
  profileId?: string
  database?: string
  collection?: string
  initialTab?: MongoSessionTab
  tabId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['mongodb'])
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

const profiles = computed(() => profileMap.value.mongodb)

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
  connect({ ...profile, kind: 'mongodb' })
}

async function onSave(): Promise<void> {
  const wasEdit = dlgMode.value === 'edit'
  const ok = await cx.saveConnection()
  if (ok) {
    toast.success(wasEdit ? t('modules.mongodb.editSite') : t('modules.mongodb.newSite'))
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
  <MongoSession
    v-if="props.profileId"
    :profile-id="props.profileId"
    :database="props.database"
    :collection="props.collection"
    :initial-tab="props.initialTab"
    :tab-id="props.tabId"
    class="nm-mongo-tab"
  />
  <div v-else class="nm-module-root nm-mongo-home">
    <header class="nm-mongo-home__header">
      <h2 class="nm-section-title">{{ t('modules.mongodb.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.mongodb.homeDesc') }}</p>
    </header>

    <div class="nm-mongo-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('mongodb')">
        {{ t('modules.mongodb.newSite') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">
        {{ t('settings.pluginsRefresh') }}
      </RsButton>
    </div>

    <p v-if="formError && !dlgOpen" class="nm-mongo-home__error" role="alert">
      {{ formError }}
    </p>

    <RsLoading v-if="loading" class="nm-mongo-home__loading" />

    <div v-else class="nm-mongo-home__table">
      <ConnectionProfileTable
        :profiles="profiles"
        :protocol-label="() => 'MongoDB'"
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
      password-optional
      @save="onSave"
      @delete="onDelete"
      @test="cx.testConnection()"
    >
      <template #options>
        <MongoConnectionFields :form="form" />
      </template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-mongo-home {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}

.nm-mongo-tab {
  height: 100%;
  min-height: 0;
}

.nm-mongo-home__header {
  flex-shrink: 0;
}

.nm-mongo-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-mongo-home__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-mongo-home__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-mongo-home__table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-mongo-home__table :deep(.rs-table) {
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
}
</style>
