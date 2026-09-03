<script setup lang="ts">
/**
 * SFTP 模块主页：无活动会话时展示站点列表，双击或点「连接」打开传输会话。
 * 只走 sftp-service，不申请 SSH shell。
 */
import { RsButton, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import ConnectionProfileTable from '@/modules/ops/components/ConnectionProfileTable.vue'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import SshConnectionFields from '@/modules/ssh/components/SshConnectionFields.vue'
import SshConnectionOptionsFields from '@/modules/ssh/components/SshConnectionOptionsFields.vue'
import SftpSession from '@/modules/sftp/views/SftpSession.vue'
import type { ConnItem } from '@/modules/ops/types'

const props = defineProps<{
  profileId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()

const cx = useConnectionProfiles(['sftp'])
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

const profiles = computed(() => profileMap.value.sftp)

function protocolLabel(): string {
  return 'SFTP'
}

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'sftp' })
}

async function onSave(): Promise<void> {
  const wasEdit = dlgMode.value === 'edit'
  const ok = await cx.saveConnection()
  if (ok) {
    toast.success(wasEdit ? t('modules.sftp.editSite') : t('modules.sftp.newSite'))
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
  <SftpSession v-if="props.profileId" :profile-id="props.profileId" class="nm-sftp-tab" />
  <div v-else class="nm-module-root nm-sftp-home">
    <header class="nm-sftp-home__header">
      <h2 class="nm-section-title">{{ t('modules.sftp.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.sftp.homeDesc') }}</p>
    </header>

    <div class="nm-sftp-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('sftp')">
        {{ t('modules.sftp.newSite') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">
        {{ t('settings.pluginsRefresh') }}
      </RsButton>
    </div>

    <p v-if="formError && !dlgOpen" class="nm-sftp-home__error" role="alert">
      {{ formError }}
    </p>

    <RsLoading v-if="loading" class="nm-sftp-home__loading" />

    <div v-else class="nm-sftp-home__table">
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
      @save="onSave"
      @delete="onDelete"
      @test="cx.testConnection()"
    >
      <template #credential-section>
        <SshConnectionFields :form="form" :mode="dlgMode" />
      </template>
      <template #options>
        <SshConnectionOptionsFields :form="form" />
      </template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-sftp-home,
.nm-sftp-tab {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}

.nm-sftp-home__header {
  flex-shrink: 0;
}

.nm-sftp-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-sftp-home__error {
  margin: 0;
  color: var(--rs-color-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-sftp-home__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-sftp-home__table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-sftp-home__table :deep(.rs-table) {
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
}
</style>
