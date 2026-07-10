<script setup lang="ts">
import {
  RsButton,
  RsConfirmDialog,
  RsDialog,
  RsInput,
  RsLabel,
} from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ConnectionProxyFields,
  ConnectionTunnelFields,
  ConnectionTestFeedback,
  getConnectionKindDef,
  type ConnectionFormMode,
} from '@/modules/connection'
import type { ConnectionDlgMode, ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'
import ConnectionColorPicker from '@/modules/ops/components/ConnectionColorPicker.vue'
import type { ConnItem, ConnKind } from '@/modules/ops/types'

/**
 * 连接表单对话框 —— 通用壳层，不感知具体连接协议。
 *
 * 协议专属字段通过具名插槽注入，新增协议只需创建对应的 XxxConnectionFields 组件
 * 并在调用方（XxxHome.vue / OpsConnectionPanel.vue）通过插槽传入，本文件无需修改。
 *
 * 插槽说明：
 * - `#credential-section`：完整替换默认「用户名 + 密码」区。SSH 用此注入含认证方式
 *   选择器的 SshConnectionFields。未提供时显示默认用户名 + 密码行。
 * - `#credential-hint`：凭据区下方的提示文本，默认为空。Redis 用此注入可选密码提示。
 * - `#options`：协议专属选项区（追加在凭据区之后）。FTP 注入 FtpConnectionFields，
 *   Redis 注入 RedisConnectionFields，MongoDB 等未来协议同理。
 */

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
  tunnelSshProfiles?: ConnItem[]
  /**
   * 为 true 时默认凭据区的密码字段不标 required（适用于密码可选的协议，如 Redis）。
   * 使用 #credential-section 插槽时此属性无效。
   */
  passwordOptional?: boolean
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

const formTabs = computed(() => {
  const tabs: Array<{ value: string; label: string }> = [
    { value: 'basic', label: t('connection.form.tabBasic') },
    { value: 'proxy', label: t('connection.form.tabProxy') },
  ]
  if (getConnectionKindDef(props.kind)?.supportsTunnel) {
    tabs.push({ value: 'tunnel', label: t('connection.form.tabTunnel') })
  }
  return tabs
})

const passwordRequired = computed(
  () => props.mode === 'create' && !props.passwordOptional,
)

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
        <!-- 名称 + 颜色 -->
        <section class="nm-conn-form__section">
          <div class="nm-conn-form__identity">
            <ConnectionColorPicker v-model="form.accentColor" />
            <div class="nm-conn-form__field nm-conn-form__field--grow">
              <RsLabel required>{{ t('opsNav.form.name') }}</RsLabel>
              <RsInput v-model="form.profileName" autocomplete="off" :placeholder="t('opsNav.form.namePlaceholder')" />
            </div>
          </div>
        </section>

        <!-- 主机 + 端口 -->
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

        <!--
          凭据区：SSH 通过 #credential-section 完整替换此区域，其他协议使用默认内容。
          #credential-hint 插槽供 Redis 等需要追加提示的协议使用。
        -->
        <slot name="credential-section">
          <section class="nm-conn-form__section">
            <div class="nm-conn-form__row">
              <div class="nm-conn-form__field nm-conn-form__field--grow">
                <RsLabel>{{ t('opsNav.form.user') }}</RsLabel>
                <RsInput v-model="form.loginAccount" autocomplete="off" />
              </div>
              <div class="nm-conn-form__field nm-conn-form__field--grow">
                <RsLabel :required="passwordRequired">{{ t('opsNav.form.password') }}</RsLabel>
                <RsInput v-model="form.password" type="password" autocomplete="new-password" />
              </div>
            </div>
            <slot name="credential-hint" />
          </section>
        </slot>

        <!-- 协议专属选项区：FTP / Redis / MongoDB 等各自在此插槽注入 -->
        <slot name="options" />
      </div>

      <div v-show="formTab === 'proxy'" class="nm-conn-form__tab-panel">
        <ConnectionProxyFields :form="form" :mode="formMode" />
      </div>

      <div v-show="formTab === 'tunnel'" class="nm-conn-form__tab-panel">
        <ConnectionTunnelFields :form="form" :ssh-profiles="tunnelSshProfiles ?? []" />
      </div>

      <ConnectionTestFeedback v-if="!testing" :message="testMessage" />
      <p v-if="formError" class="nm-conn-form__error" role="alert">{{ formError }}</p>

      <div class="nm-conn-form__actions">
        <RsButton
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
