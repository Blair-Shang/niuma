<script setup lang="ts">
import { RsButton, RsLoading, useRsToast } from '@niuma/ui'
import { computed, onMounted, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import ConnectionProfileTable from '@/modules/ops/components/ConnectionProfileTable.vue'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import type { ConnItem } from '@/modules/ops/types'
import SshSession from '@/modules/ssh/views/SshSession.vue'
import { useTabStore } from '@/stores/tab'

const props = defineProps<{
  profileId?: string
}>()

const tabStore = useTabStore()
const { t } = useI18n()
const toast = useRsToast()
const { connect } = useConnectionNavigation()
const cx = useConnectionProfiles(['ssh'])
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

/** 现有 SSH 会话数（Tab 即会话，用于新会话编号） */
const sshCount = computed(() => tabStore.allTabs.filter((tab) => tab.moduleId === 'ssh').length)
const profiles = computed(() => profileMap.value.ssh)

function protocolLabel(): string {
  return 'SSH'
}

/**
 * 新建 SSH 会话 —— 强制新开一个 Tab 实例（多会话并行）。会话的管理（切换/关闭/
 * 分屏）统一由 TabBar 承担，模块内不再重复维护会话列表。
 */
function newSession(): void {
  tabStore.openTab({
    moduleId: 'ssh',
    title: `${t('modules.ssh.newTab')} ${sshCount.value + 1}`,
    closable: true,
  })
}

function onConnect(profile: ConnItem): void {
  connect({ ...profile, kind: 'ssh' })
}

async function onSave(): Promise<void> {
  const wasEdit = dlgMode.value === 'edit'
  const ok = await cx.saveConnection()
  if (ok) {
    toast.success(wasEdit ? t('modules.ssh.editSite') : t('modules.ssh.newSite'))
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
  <SshSession v-if="props.profileId" :profile-id="props.profileId" class="nm-ssh-tab" />
  <div v-else class="nm-module-root nm-ssh-home">
    <header class="nm-ssh-home__header">
      <h2 class="nm-section-title">{{ t('modules.ssh.title') }}</h2>
      <p class="nm-section-desc">{{ t('modules.ssh.homeDesc') }}</p>
    </header>

    <div class="nm-ssh-home__toolbar">
      <RsButton variant="primary" @click="cx.openCreate('ssh')">
        {{ t('modules.ssh.newSite') }}
      </RsButton>
      <RsButton variant="ghost" @click="newSession">
        {{ t('modules.ssh.newTab') }}
      </RsButton>
      <RsButton variant="ghost" :disabled="loading" @click="cx.loadAll()">
        {{ t('settings.pluginsRefresh') }}
      </RsButton>
    </div>

    <p v-if="formError && !dlgOpen" class="nm-ssh-home__error" role="alert">
      {{ formError }}
    </p>

    <RsLoading v-if="loading" class="nm-ssh-home__loading" />

    <div v-else class="nm-ssh-home__table">
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
    />
  </div>
</template>

<style scoped>
.nm-ssh-home {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  height: 100%;
  min-height: 0;
}

.nm-ssh-tab {
  height: 100%;
  min-height: 0;
}

.nm-ssh-home__header {
  flex-shrink: 0;
}

.nm-ssh-home__toolbar {
  display: flex;
  gap: var(--rs-space-sm);
  flex-shrink: 0;
}

.nm-ssh-home__error {
  margin: 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-ssh-home__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-ssh-home__table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-ssh-home__table :deep(.rs-table) {
  border-radius: var(--rs-radius-md);
  border: 1px solid var(--rs-border-subtle);
}
</style>
