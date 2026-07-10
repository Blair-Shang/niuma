<script setup lang="ts">
/**
 * FTP 模块主页：无活动会话时展示站点列表，双击或点「连接」在工作区打开传输会话。
 * 站点 CRUD 与侧栏运维面板共用 useConnectionProfiles，此处仅作工作区入口。
 */
import { RsButton, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionProfile } from '@/api/types/ftp'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import ConnectionProfileTable from '@/modules/ops/components/ConnectionProfileTable.vue'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import FtpConnectionFields from '@/modules/ftp/components/FtpConnectionFields.vue'
import FtpSession from '@/modules/ftp/views/FtpSession.vue'
import type { ConnItem } from '@/modules/ops/types'

const props = defineProps<{
  profileId?: string
}>()

const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()

const cx = useConnectionProfiles(['ftp'])
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

const profiles = computed(() => profileMap.value.ftp)

function protocolLabel(profile: ConnectionProfile): string {
  const protocol = profile.connectionOptions?.protocol ?? 'ftp'
  return protocol === 'ftps' ? t('modules.ftp.protocol.ftps') : t('modules.ftp.protocol.ftp')
}

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'ftp' })
}

async function onSave(): Promise<void> {
  const wasEdit = dlgMode.value === 'edit'
  const ok = await cx.saveConnection()
  if (ok) {
    toast.success(wasEdit ? t('modules.ftp.editSite') : t('modules.ftp.newSite'))
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
  <FtpSession v-if="props.profileId" :profile-id="props.profileId" class="nm-ftp-tab" />
  <div v-else class="nm-module-root nm-ftp-home">
    <header class="nm-ftp-home__header">
      <h2 class="nm-section-title">{{ t('modules.ftp.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.ftp.homeDesc') }}</p>
    </header>

    <div class="nm-ftp-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('ftp')">
        {{ t('modules.ftp.newSite') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">
        {{ t('settings.pluginsRefresh') }}
      </RsButton>
    </div>

    <p v-if="formError && !dlgOpen" class="nm-ftp-home__error" role="alert">
      {{ formError }}
    </p>

    <RsLoading v-if="loading" class="nm-ftp-home__loading" />

    <div v-else class="nm-ftp-home__table">
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
      <template #options>
        <FtpConnectionFields :form="form" />
      </template>
    </ConnectionFormDialog>
  </div>
</template>

<style scoped>
.nm-ftp-home,
.nm-ftp-tab {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}

.nm-ftp-home__header {
  flex-shrink: 0;
}

.nm-ftp-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-ftp-home__error {
  margin: 0;
  color: var(--rs-color-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-ftp-home__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-ftp-home__table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-ftp-home__table :deep(.rs-table) {
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
}
</style>
