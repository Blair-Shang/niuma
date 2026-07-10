<script setup lang="ts">
import { RsInput, RsLabel, RsSelect } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionFormMode } from '@/modules/connection'
import type { ConnectionDlgMode, ConnectionFormState } from '@/modules/ops/composables/useConnectionProfiles'

/**
 * SSH 凭据区完整替换组件（供 ConnectionFormDialog #credential-section 插槽使用）。
 *
 * 包含：用户名行 + 认证方式选择器 + 随认证类型动态切换的密码/私钥/路径/passphrase 字段。
 * 整体替换对话框默认的「用户名 + 密码」行，使 SSH 特有的多认证方案自包含在此组件中。
 */
const props = defineProps<{
  form: ConnectionFormState
  /**
   * 对话框模式。'delete' 时凭据区不会被渲染（外层 RsDialog 已 v-if="mode !== 'delete'"），
   * 但为与调用方的 dlgMode 类型兼容，此处接受完整的 ConnectionDlgMode。
   */
  mode: ConnectionDlgMode
}>()

const formMode = computed<ConnectionFormMode>(() =>
  props.mode === 'edit' ? 'edit' : 'create',
)

const { t } = useI18n()

const authOptions = computed<RsSelectOptions>(() => [
  { value: 'password', label: t('connection.form.sshAuthPassword') },
  { value: 'private_key', label: t('connection.form.sshAuthPrivateKey') },
  { value: 'private_key_file', label: t('connection.form.sshAuthPrivateKeyFile') },
])
</script>

<template>
  <section class="nm-conn-form__section">
    <!-- 用户名 + 认证方式 -->
    <div class="nm-conn-form__row">
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('opsNav.form.user') }}</RsLabel>
        <RsInput v-model="props.form.loginAccount" autocomplete="off" />
      </div>
      <div class="nm-conn-form__field nm-conn-form__field--grow">
        <RsLabel>{{ t('connection.form.sshAuthType') }}</RsLabel>
        <RsSelect v-model="props.form.sshAuthType" :options="authOptions" />
      </div>
    </div>

    <!-- 密码认证 -->
    <div v-if="props.form.sshAuthType === 'password'" class="nm-conn-form__field">
      <RsLabel :required="formMode === 'create'">{{ t('opsNav.form.password') }}</RsLabel>
      <RsInput v-model="props.form.password" type="password" autocomplete="new-password" />
    </div>

    <!-- 内联私钥 -->
    <div v-if="props.form.sshAuthType === 'private_key'" class="nm-conn-form__field">
      <label class="nm-conn-form__label" for="nm-conn-ssh-private-key">
        {{ t('connection.form.privateKey') }}<span v-if="formMode === 'create'"> *</span>
      </label>
      <textarea
        id="nm-conn-ssh-private-key"
        v-model="props.form.sshPrivateKey"
        class="nm-conn-form__textarea"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('connection.form.privateKeyPlaceholder')"
      />
    </div>

    <!-- 私钥文件路径 -->
    <div v-if="props.form.sshAuthType === 'private_key_file'" class="nm-conn-form__field">
      <RsLabel required>{{ t('connection.form.privateKeyPath') }}</RsLabel>
      <RsInput v-model="props.form.sshPrivateKeyPath" autocomplete="off" placeholder="~/.ssh/id_rsa" />
    </div>

    <!-- Passphrase（非密码认证时显示） -->
    <div v-if="props.form.sshAuthType !== 'password'" class="nm-conn-form__field">
      <RsLabel>{{ t('connection.form.passphrase') }}</RsLabel>
      <RsInput v-model="props.form.sshPassphrase" type="password" autocomplete="new-password" />
      <p class="nm-conn-form__hint">{{ t('connection.form.passphraseHint') }}</p>
    </div>

    <!-- 私钥文件路径模式编辑时的提示 -->
    <p
      v-if="formMode === 'edit' && props.form.sshAuthType === 'private_key_file'"
      class="nm-conn-form__hint"
    >
      {{ t('opsNav.form.passwordHint') }}
    </p>
  </section>
</template>

<style scoped>
.nm-conn-form__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
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

.nm-conn-form__label {
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  font-weight: 500;
}

.nm-conn-form__textarea {
  min-height: 8rem;
  width: 100%;
  resize: vertical;
  padding: var(--rs-space-sm);
  border: 1px solid var(--rs-border);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  color: var(--rs-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: var(--rs-font-size-xs);
  line-height: 1.5;
  outline: none;
}

.nm-conn-form__textarea:focus {
  border-color: var(--rs-primary);
}

.nm-conn-form__hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
