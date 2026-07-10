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
import RedisConnectionFields from '@/modules/redis/components/RedisConnectionFields.vue'
import RedisSession from '@/modules/redis/views/RedisSession.vue'
import { useTabStore } from '@/stores/tab'

const props = defineProps<{
  profileId?: string
  database?: number
  tabId?: string
}>()

const tabStore = useTabStore()
const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['redis'])
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

const profiles = computed(() => profileMap.value.redis)

/**
 * `useConnectionProfiles(['redis'])` 只拉取 Redis 站点，隧道 Tab 需要选择的是「SSH 跳板机」
 * 站点，因此单独拉一份只含 kind=ssh 的列表，仅用于隧道下拉，不复用上面的 CRUD composable。
 */
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
  return 'Redis'
}

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'redis' })
}

async function onSave(): Promise<void> {
  const wasEdit = dlgMode.value === 'edit'
  const ok = await cx.saveConnection()
  if (ok) {
    toast.success(wasEdit ? t('modules.redis.editSite') : t('modules.redis.newSite'))
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
  <RedisSession
    v-if="props.profileId"
    :profile-id="props.profileId"
    :database="props.database"
    :tab-id="props.tabId"
    class="nm-redis-tab"
  />
  <div v-else class="nm-module-root nm-redis-home">
    <header class="nm-redis-home__header">
      <h2 class="nm-section-title">{{ t('modules.redis.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.redis.homeDesc') }}</p>
    </header>

    <div class="nm-redis-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('redis')">
        {{ t('modules.redis.newSite') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">
        {{ t('settings.pluginsRefresh') }}
      </RsButton>
    </div>

    <p v-if="formError && !dlgOpen" class="nm-redis-home__error" role="alert">
      {{ formError }}
    </p>

    <RsLoading v-if="loading" class="nm-redis-home__loading" />

    <div v-else class="nm-redis-home__table">
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
      password-optional
      @save="onSave"
      @delete="onDelete"
      @test="cx.testConnection()"
    >
      <template #credential-hint>
        <p class="nm-redis-home__password-hint">{{ t('modules.redis.form.passwordHint') }}</p>
      </template>
      <template #options>
        <RedisConnectionFields :form="form" />
      </template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-redis-home {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}

.nm-redis-tab {
  height: 100%;
  min-height: 0;
}

.nm-redis-home__header {
  flex-shrink: 0;
}

.nm-redis-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-redis-home__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-redis-home__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-redis-home__table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-redis-home__table :deep(.rs-table) {
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
}

.nm-redis-home__password-hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
