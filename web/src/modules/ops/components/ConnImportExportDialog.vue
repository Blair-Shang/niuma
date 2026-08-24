<script setup lang="ts">
/**
 * 连接导入 / 导出选项对话框。
 * 导出可选择含凭据（口令加密）；导入可输入口令还原凭据。
 * 对话框内明确提示妥善保管文件与口令。
 */
import { RsButton, RsCheckbox, RsDialog, RsInput, RsLabel } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

export type ConnIoDialogMode = 'export' | 'import'

const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(
  defineProps<{
    mode: ConnIoDialogMode
  }>(),
  {},
)

const emit = defineEmits<{
  confirm: [payload: { includeSecrets: boolean; passphrase: string }]
}>()

const { t } = useI18n()

const includeSecrets = ref(true)
const passphrase = ref('')
const passphraseConfirm = ref('')
const formError = ref<string | null>(null)

const title = computed(() =>
  props.mode === 'export' ? t('opsNav.exportConnections') : t('opsNav.importConnections'),
)

watch(open, (isOpen) => {
  if (!isOpen) return
  includeSecrets.value = props.mode === 'export'
  passphrase.value = ''
  passphraseConfirm.value = ''
  formError.value = null
})

watch(includeSecrets, () => {
  formError.value = null
})

function close(): void {
  open.value = false
}

function onSubmit(): void {
  formError.value = null
  if (props.mode === 'export' && includeSecrets.value) {
    if (!passphrase.value.trim()) {
      formError.value = t('opsNav.io.passphraseRequired')
      return
    }
    if (passphrase.value !== passphraseConfirm.value) {
      formError.value = t('opsNav.io.passphraseMismatch')
      return
    }
    if (passphrase.value.trim().length < 8) {
      formError.value = t('opsNav.io.passphraseTooShort')
      return
    }
  }
  emit('confirm', {
    includeSecrets: props.mode === 'export' ? includeSecrets.value : true,
    passphrase: passphrase.value,
  })
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="title"
    width="md"
    layout="form"
    :resizable="false"
    :fullscreenable="false"
    :show-overlay="false"
    :close-on-overlay-click="false"
  >
    <template #body>
      <form class="nm-conn-io" autocomplete="off" @submit.prevent="onSubmit">
        <p class="nm-conn-io__warn" role="note">
          {{ t('opsNav.io.safekeepHint') }}
        </p>

        <template v-if="mode === 'export'">
          <RsCheckbox v-model="includeSecrets">
            {{ t('opsNav.io.includeSecrets') }}
          </RsCheckbox>
          <p class="nm-conn-io__hint">{{ t('opsNav.io.includeSecretsHint') }}</p>
        </template>
        <template v-else>
          <p class="nm-conn-io__hint">{{ t('opsNav.io.importPassphraseHint') }}</p>
        </template>

        <div
          v-if="mode === 'import' || includeSecrets"
          class="nm-conn-io__fields"
        >
          <div class="nm-conn-io__field">
            <RsLabel :required="mode === 'export'">{{ t('opsNav.io.passphrase') }}</RsLabel>
            <RsInput
              v-model="passphrase"
              type="password"
              autocomplete="new-password"
              :placeholder="t('opsNav.io.passphrasePlaceholder')"
            />
          </div>
          <div v-if="mode === 'export'" class="nm-conn-io__field">
            <RsLabel required>{{ t('opsNav.io.passphraseConfirm') }}</RsLabel>
            <RsInput
              v-model="passphraseConfirm"
              type="password"
              autocomplete="new-password"
              :placeholder="t('opsNav.io.passphraseConfirmPlaceholder')"
            />
          </div>
        </div>

        <p v-if="formError" class="nm-conn-io__error" role="alert">{{ formError }}</p>

        <div class="nm-conn-io__actions">
          <span class="nm-conn-io__spacer" />
          <RsButton type="button" variant="ghost" @click="close">
            {{ t('modules.ftp.form.cancel') }}
          </RsButton>
          <RsButton type="submit" variant="primary">
            {{ mode === 'export' ? t('opsNav.io.continueExport') : t('opsNav.io.continueImport') }}
          </RsButton>
        </div>
      </form>
    </template>
  </RsDialog>
</template>

<style scoped>
.nm-conn-io {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding-top: var(--rs-space-xs);
}

.nm-conn-io__warn {
  margin: 0;
  padding: var(--rs-space-sm) var(--rs-space-md);
  font-size: var(--rs-font-size-sm);
  line-height: 1.5;
  color: var(--rs-fg);
  background: color-mix(in srgb, var(--rs-warning, #ff9500) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--rs-warning, #ff9500) 35%, transparent);
  border-radius: var(--rs-radius-sm, 6px);
}

.nm-conn-io__hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
  line-height: 1.45;
}

.nm-conn-io__fields {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-conn-io__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-conn-io__error {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-danger);
}

.nm-conn-io__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding-top: var(--rs-space-xs);
}

.nm-conn-io__spacer {
  flex: 1;
  min-width: 0;
}
</style>
