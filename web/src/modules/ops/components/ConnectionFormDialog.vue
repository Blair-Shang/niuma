<script setup lang="ts">
import {
  RsButton,
  RsConfirmDialog,
  RsDialog,
  RsInput,
  RsLabel,
  RsSelect,
} from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ConnectionProxyFields,
  ConnectionTestFeedback,
  type ConnectionFormMode,
} from '@/modules/connection'
import type { ConnectionDlgMode, ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'
import ConnectionColorPicker from '@/modules/ops/components/ConnectionColorPicker.vue'
import type { ConnItem, ConnKind } from '@/modules/ops/types'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  mode: ConnectionDlgMode
  kind: ConnKind
  profile: ConnItem | null
  form: ConnectionFormState
  formError: string | null
  saving: boolean
  deleting: boolean
  testing: boolean
  testMessage: { ok: boolean; text: string } | null
}>()

const emit = defineEmits<{
  save: []
  delete: []
  test: []
}>()

const { t } = useI18n()
const formTab = ref('basic')

const formMode = computed<ConnectionFormMode>(() =>
  props.mode === 'edit' ? 'edit' : 'create',
)

const dlgTitle = computed(() => {
  const type = props.kind.toUpperCase()
  if (props.mode === 'create') {
    return `${t('opsNav.add')} ${type}`
  }
  if (props.mode === 'edit') {
    return `${t('opsNav.edit')} ${type}`
  }
  return t('opsNav.deleteConn')
})

const formTabs = computed(() => [
  { value: 'basic', label: t('connection.form.tabBasic') },
  { value: 'proxy', label: t('connection.form.tabProxy') },
] as const)

const ftpProtocolOptions = computed<RsSelectOptions>(() => [
  { value: 'ftp', label: 'FTP' },
  { value: 'ftps', label: 'FTPS' },
])
const ftpPassiveOptions = computed<RsSelectOptions>(() => [
  { value: 'true', label: t('opsNav.passive.on') },
  { value: 'false', label: t('opsNav.passive.off') },
])
const ftpEncodingOptions = computed<RsSelectOptions>(() => [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK' },
])

watch(open, (isOpen) => {
  if (isOpen) {
    formTab.value = 'basic'
  }
})

function close(): void {
  open.value = false
}
</script>

<template>
  <RsDialog
    v-if="mode !== 'delete'"
    v-model:open="open"
    :title="dlgTitle"
    width="lg"
    layout="confirm"
    :show-overlay="false"
    :close-on-overlay-click="false"
  >
    <form class="nm-conn-form" autocomplete="off" @submit.prevent="emit('save')">
      <div class="nm-conn-form__tabs" role="tablist">
        <button
          v-for="tab in formTabs"
          :key="tab.value"
          type="button"
          role="tab"
          class="nm-conn-form__tab"
          :class="{ 'nm-conn-form__tab--active': formTab === tab.value }"
          :aria-selected="formTab === tab.value"
          @click="formTab = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>

      <div v-show="formTab === 'basic'" class="nm-conn-form__tab-panel">
        <section class="nm-conn-form__section">
          <div class="nm-conn-form__identity">
            <ConnectionColorPicker v-model="form.accentColor" />
            <div class="nm-conn-form__field nm-conn-form__field--grow">
              <RsLabel required>{{ t('opsNav.form.name') }}</RsLabel>
              <RsInput v-model="form.profileName" autocomplete="off" :placeholder="t('opsNav.form.namePlaceholder')" />
            </div>
          </div>
        </section>

        <section class="nm-conn-form__section">
          <div class="nm-conn-form__row">
            <div class="nm-conn-form__field nm-conn-form__field--grow">
              <RsLabel required>{{ t('opsNav.form.host') }}</RsLabel>
              <RsInput v-model="form.hostAddress" autocomplete="off" placeholder="192.168.1.1" />
            </div>
            <div class="nm-conn-form__field nm-conn-form__field--port">
              <RsLabel>{{ t('opsNav.form.port') }}</RsLabel>
              <RsInput v-model="form.portNumber" autocomplete="off" />
            </div>
          </div>
        </section>

        <section class="nm-conn-form__section">
          <div class="nm-conn-form__row">
            <div class="nm-conn-form__field nm-conn-form__field--grow">
              <RsLabel>{{ t('opsNav.form.user') }}</RsLabel>
              <RsInput v-model="form.loginAccount" autocomplete="off" />
            </div>
            <div class="nm-conn-form__field nm-conn-form__field--grow">
              <RsLabel :required="mode === 'create'">{{ t('opsNav.form.password') }}</RsLabel>
              <RsInput v-model="form.password" type="password" autocomplete="new-password" />
            </div>
          </div>
          <p v-if="mode === 'edit'" class="nm-conn-form__hint">
            {{ t('opsNav.form.passwordHint') }}
          </p>
        </section>

        <section v-if="kind === 'ftp'" class="nm-conn-form__section">
          <div class="nm-conn-form__row">
            <div class="nm-conn-form__field nm-conn-form__field--grow">
              <RsLabel>{{ t('modules.ftp.form.protocol') }}</RsLabel>
              <RsSelect v-model="form.protocol" :options="ftpProtocolOptions" />
            </div>
            <div class="nm-conn-form__field nm-conn-form__field--grow">
              <RsLabel>{{ t('modules.ftp.form.encoding') }}</RsLabel>
              <RsSelect v-model="form.encoding" :options="ftpEncodingOptions" />
            </div>
            <div class="nm-conn-form__field nm-conn-form__field--grow">
              <RsLabel>{{ t('modules.ftp.form.passive') }}</RsLabel>
              <RsSelect v-model="form.passive" :options="ftpPassiveOptions" />
            </div>
          </div>
        </section>
      </div>

      <div v-show="formTab === 'proxy'" class="nm-conn-form__tab-panel">
        <ConnectionProxyFields :form="form" :mode="formMode" />
      </div>

      <ConnectionTestFeedback v-if="!testing" :message="testMessage" />
      <p v-if="formError" class="nm-conn-form__error" role="alert">{{ formError }}</p>

      <div class="nm-conn-form__actions">
        <RsButton
          v-if="kind === 'ftp' || kind === 'ssh'"
          type="button"
          variant="secondary"
          class="nm-conn-form__test-btn"
          :disabled="saving"
          :loading="testing"
          @click="emit('test')"
        >
          {{ testing ? t('connection.form.testing') : t('connection.form.test') }}
        </RsButton>
        <span class="nm-conn-form__actions-spacer" />
        <RsButton type="button" variant="ghost" :disabled="testing" @click="close">
          {{ t('modules.ftp.form.cancel') }}
        </RsButton>
        <RsButton type="submit" variant="primary" :disabled="saving || testing" :loading="saving">
          {{ t('modules.ftp.form.save') }}
        </RsButton>
      </div>
    </form>
  </RsDialog>

  <RsConfirmDialog
    v-else
    v-model:open="open"
    :title="t('opsNav.deleteConn')"
    :description="profile ? t('opsNav.deleteConfirm', { name: profile.profileName }) : ''"
    :confirm-text="t('opsNav.deleteConn')"
    :cancel-text="t('modules.ftp.form.cancel')"
    :loading="deleting"
    @confirm="emit('delete')"
  />
</template>

<style scoped>
.nm-conn-form {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding-top: var(--rs-space-xs);
}

.nm-conn-form__tab-panel {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  min-height: 12rem;
}

.nm-conn-form__tabs {
  display: flex;
  gap: 0;
  margin: 0;
  padding: 0;
  border-bottom: 1px solid var(--rs-border);
}

.nm-conn-form__tab {
  appearance: none;
  margin: 0;
  padding: 0.375rem 0.75rem;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: transparent;
  font: inherit;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-conn-form__tab:hover {
  color: var(--rs-text);
}

.nm-conn-form__tab--active {
  color: var(--rs-text);
  font-weight: 500;
  border-bottom-color: var(--rs-primary);
}

.nm-conn-form__tab:focus-visible {
  outline: 2px solid var(--rs-focus-ring);
  outline-offset: -2px;
}

.nm-conn-form__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-conn-form__identity {
  display: flex;
  align-items: flex-start;
  gap: var(--rs-space-md);
}

.nm-conn-form__row {
  display: flex;
  gap: var(--rs-space-md);
}

.nm-conn-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-conn-form__field--grow {
  flex: 1;
  min-width: 0;
}

.nm-conn-form__field--port {
  width: 5.5rem;
  flex-shrink: 0;
}

.nm-conn-form__hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-conn-form__error {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-danger);
}

.nm-conn-form__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding-top: var(--rs-space-xs);
}

.nm-conn-form__test-btn {
  min-width: 7.5rem;
}

.nm-conn-form__actions-spacer {
  flex: 1;
  min-width: 0;
}
</style>
