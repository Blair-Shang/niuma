<script setup lang="ts">
import { RsButton, RsConfirmDialog, RsMonacoEditor, useRsToast } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { MongoSchemaField, MongoSchemaValidator } from '@/api/types/mongodb'
import {
  buildMongoJsonSchema,
  formatValidatorJson,
} from '@/modules/mongodb/utils/schema-json-schema'

const props = defineProps<{
  sessionId: string | null
  database: string
  collection: string
  fields: MongoSchemaField[]
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const toast = useRsToast()

const validatorText = ref('{\n  \n}')
const validationLevel = ref('strict')
const validationAction = ref('error')
const loading = ref(false)
const applying = ref(false)
const confirmOpen = ref(false)
const currentValidator = ref<MongoSchemaValidator | null>(null)

const hasTarget = computed(
  () => !!props.sessionId && props.database.trim().length > 0 && props.collection.trim().length > 0,
)

const hasValidator = computed(() => {
  const raw = validatorText.value.trim()
  return raw.length > 0 && raw !== '{\n  \n}' && raw !== '{}'
})

async function loadValidator(): Promise<void> {
  if (!hasTarget.value) return
  loading.value = true
  try {
    const result = await mongodbApi.schemaValidatorGet({
      sessionId: props.sessionId!,
      database: props.database.trim(),
      collection: props.collection.trim(),
    })
    currentValidator.value = result
    if (result.validator) {
      validatorText.value = formatValidatorJson(result.validator)
    } else {
      validatorText.value = '{\n  \n}'
    }
    if (result.validationLevel) validationLevel.value = result.validationLevel
    if (result.validationAction) validationAction.value = result.validationAction
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.schema.validatorLoadError'))
  } finally {
    loading.value = false
  }
}

function generateFromSample(): void {
  if (props.fields.length === 0) {
    toast.error(t('modules.mongodb.schema.validatorNeedSample'))
    return
  }
  const draft = buildMongoJsonSchema(props.fields)
  validatorText.value = formatValidatorJson(draft)
  toast.success(t('modules.mongodb.schema.validatorGenerated'))
}

async function applyValidator(): Promise<void> {
  if (!hasTarget.value || !hasValidator.value) return
  applying.value = true
  try {
    const validator = JSON.parse(validatorText.value) as unknown
    await mongodbApi.schemaValidatorSet({
      sessionId: props.sessionId!,
      database: props.database.trim(),
      collection: props.collection.trim(),
      validator,
      validationLevel: validationLevel.value,
      validationAction: validationAction.value,
    })
    toast.success(t('modules.mongodb.schema.validatorApplied'))
    confirmOpen.value = false
    await loadValidator()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.schema.validatorApplyError'))
  } finally {
    applying.value = false
  }
}

watch(
  () => [props.open, props.sessionId, props.database, props.collection] as const,
  ([open]) => {
    if (open) void loadValidator()
  },
  { immediate: true },
)
</script>

<template>
  <section v-if="open" class="nm-schema-validator">
    <header class="nm-schema-validator__head">
      <div>
        <h3 class="nm-schema-validator__title">{{ t('modules.mongodb.schema.validation') }}</h3>
        <p class="nm-schema-validator__hint">{{ t('modules.mongodb.schema.validationHint') }}</p>
      </div>
      <div class="nm-schema-validator__actions">
        <RsButton size="sm" variant="ghost" :loading="loading" @click="loadValidator">
          {{ t('modules.mongodb.schema.validatorReload') }}
        </RsButton>
        <RsButton size="sm" variant="ghost" :disabled="fields.length === 0" @click="generateFromSample">
          {{ t('modules.mongodb.schema.validatorGenerate') }}
        </RsButton>
        <RsButton size="sm" variant="primary" :disabled="!hasValidator" @click="confirmOpen = true">
          {{ t('modules.mongodb.schema.validatorApply') }}
        </RsButton>
        <RsButton size="sm" variant="ghost" @click="emit('update:open', false)">
          {{ t('modules.mongodb.schema.validationClose') }}
        </RsButton>
      </div>
    </header>

    <div class="nm-schema-validator__options">
      <label class="nm-schema-validator__option">
        <span>{{ t('modules.mongodb.schema.validationLevel') }}</span>
        <select v-model="validationLevel" class="nm-schema-validator__select">
          <option value="off">{{ t('modules.mongodb.schema.validationLevelOff') }}</option>
          <option value="moderate">{{ t('modules.mongodb.schema.validationLevelModerate') }}</option>
          <option value="strict">{{ t('modules.mongodb.schema.validationLevelStrict') }}</option>
        </select>
      </label>
      <label class="nm-schema-validator__option">
        <span>{{ t('modules.mongodb.schema.validationAction') }}</span>
        <select v-model="validationAction" class="nm-schema-validator__select">
          <option value="warn">{{ t('modules.mongodb.schema.validationActionWarn') }}</option>
          <option value="error">{{ t('modules.mongodb.schema.validationActionError') }}</option>
        </select>
      </label>
      <span v-if="currentValidator?.validator" class="nm-schema-validator__status">
        {{ t('modules.mongodb.schema.validatorConfigured') }}
      </span>
    </div>

    <RsMonacoEditor
      v-model="validatorText"
      language="json"
      height="220px"
      class="nm-schema-validator__editor"
    />

    <RsConfirmDialog
      v-model:open="confirmOpen"
      :title="t('modules.mongodb.schema.validatorApplyConfirmTitle')"
      :description="t('modules.mongodb.schema.validatorApplyConfirm')"
      :confirm-text="t('modules.mongodb.schema.validatorApply')"
      tone="warning"
      confirm-variant="primary"
      @confirm="applyValidator"
    />
  </section>
</template>

<style scoped>
.nm-schema-validator {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-md);
  border-top: 1px solid var(--rs-border-subtle);
  background: var(--rs-surface-subtle);
  flex-shrink: 0;
}

.nm-schema-validator__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--rs-space-md);
  flex-wrap: wrap;
}

.nm-schema-validator__title {
  margin: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  color: var(--rs-foreground);
}

.nm-schema-validator__hint {
  margin: 4px 0 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-schema-validator__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.nm-schema-validator__options {
  display: flex;
  align-items: center;
  gap: var(--rs-space-md);
  flex-wrap: wrap;
}

.nm-schema-validator__option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}

.nm-schema-validator__select {
  padding: 2px 6px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-xs);
  background: var(--rs-surface);
  color: var(--rs-foreground);
  font-size: var(--rs-font-size-xs);
}

.nm-schema-validator__status {
  font-size: var(--rs-font-size-xs);
  color: var(--rs-success);
}

.nm-schema-validator__editor {
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  overflow: hidden;
}
</style>
