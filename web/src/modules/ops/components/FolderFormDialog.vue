<script setup lang="ts">
import { RsButton, RsDialog, RsInput, RsLabel } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ConnectionColorPicker from '@/modules/ops/components/ConnectionColorPicker.vue'
import type { ConnAccentColor } from '@/modules/ops/types'

const open = defineModel<boolean>('open', { required: true })
const name = defineModel<string>('name', { required: true })
const accentColor = defineModel<ConnAccentColor>('accentColor', { required: true })

const props = defineProps<{
  mode: 'create' | 'edit'
  formError?: string | null
}>()

const emit = defineEmits<{
  save: []
}>()

const { t } = useI18n()

const dlgTitle = computed(() =>
  props.mode === 'create' ? t('opsNav.addFolder') : t('opsNav.editFolder'),
)

function close(): void {
  open.value = false
}
</script>

<template>
  <RsDialog
    v-model:open="open"
    :title="dlgTitle"
    width="md"
    layout="confirm"
    :resizable="false"
    :fullscreenable="false"
    :show-overlay="false"
    :close-on-overlay-click="false"
  >
    <template #body>
    <form class="nm-folder-form" autocomplete="off" @submit.prevent="emit('save')">
      <section class="nm-folder-form__section">
        <div class="nm-folder-form__identity">
          <ConnectionColorPicker v-model="accentColor" />
          <div class="nm-folder-form__field nm-folder-form__field--grow">
            <RsLabel required>{{ t('opsNav.form.folderName') }}</RsLabel>
            <RsInput
              v-model="name"
              autocomplete="off"
              :placeholder="t('opsNav.form.folderNamePlaceholder')"
            />
          </div>
        </div>
      </section>

      <p v-if="formError" class="nm-folder-form__error" role="alert">{{ formError }}</p>

      <div class="nm-folder-form__actions">
        <span class="nm-folder-form__actions-spacer" />
        <RsButton type="button" variant="ghost" @click="close">
          {{ t('modules.ftp.form.cancel') }}
        </RsButton>
        <RsButton type="submit" variant="primary">
          {{ t('modules.ftp.form.save') }}
        </RsButton>
      </div>
    </form>
    </template>
  </RsDialog>
</template>

<style scoped>
.nm-folder-form {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md);
  padding-top: var(--rs-space-xs);
}

.nm-folder-form__section {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
}

.nm-folder-form__identity {
  display: flex;
  align-items: flex-start;
  gap: var(--rs-space-md);
}

.nm-folder-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-xs);
}

.nm-folder-form__field--grow {
  flex: 1;
  min-width: 0;
}

.nm-folder-form__error {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  color: var(--rs-danger);
}

.nm-folder-form__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding-top: var(--rs-space-xs);
}

.nm-folder-form__actions-spacer {
  flex: 1;
  min-width: 0;
}
</style>
