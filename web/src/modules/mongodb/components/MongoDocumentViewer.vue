<script setup lang="ts">
import { RsButton, RsConfirmDialog, RsDialog, useRsToast } from '@niuma/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mongodbApi } from '@/api'
import type { MongoDocument } from '@/api/types/mongodb'
import { formatMongoJson, parseMongoJson } from '@/modules/mongodb/utils/format'

const props = defineProps<{
  sessionId: string
  database: string
  collection: string
  document: MongoDocument | null
  insertMode?: boolean
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  saved: []
  deleted: []
}>()

const { t } = useI18n()
const toast = useRsToast()

const jsonText = ref('{}')
const saving = ref(false)
const deleting = ref(false)
const deleteConfirm = ref(false)
const parseError = ref<string | null>(null)

const title = computed(() =>
  props.insertMode
    ? t('modules.mongodb.document.insertTitle')
    : t('modules.mongodb.document.editTitle'),
)

watch(
  () => [open.value, props.document, props.insertMode] as const,
  ([isOpen, doc, insert]) => {
    if (!isOpen) {
      return
    }
    parseError.value = null
    jsonText.value = formatMongoJson(insert ? {} : (doc ?? {}))
  },
  { immediate: true },
)

async function onSave(): Promise<void> {
  parseError.value = null
  let parsed: MongoDocument
  try {
    parsed = parseMongoJson(jsonText.value)
  } catch (e) {
    parseError.value = e instanceof Error ? e.message : t('modules.mongodb.document.invalidJson')
    return
  }

  saving.value = true
  try {
    if (props.insertMode) {
      await mongodbApi.documentInsert({
        sessionId: props.sessionId,
        database: props.database,
        collection: props.collection,
        document: parsed,
      })
      toast.success(t('modules.mongodb.document.inserted'))
    } else if (props.document?._id !== undefined) {
      await mongodbApi.documentUpdate({
        sessionId: props.sessionId,
        database: props.database,
        collection: props.collection,
        id: props.document._id,
        document: parsed,
      })
      toast.success(t('modules.mongodb.document.updated'))
    }
    open.value = false
    emit('saved')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.document.saveError'))
  } finally {
    saving.value = false
  }
}

async function onDelete(): Promise<void> {
  if (props.document?._id === undefined) {
    return
  }
  deleting.value = true
  try {
    await mongodbApi.documentDelete({
      sessionId: props.sessionId,
      database: props.database,
      collection: props.collection,
      id: props.document._id,
    })
    toast.success(t('modules.mongodb.document.deleted'))
    deleteConfirm.value = false
    open.value = false
    emit('deleted')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mongodb.document.deleteError'))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <RsDialog v-model:open="open" :title="title" size="lg">
    <textarea
      v-model="jsonText"
      class="nm-mongo-doc-viewer__editor"
      spellcheck="false"
      :aria-label="t('modules.mongodb.document.jsonLabel')"
    />
    <p v-if="parseError" class="nm-mongo-doc-viewer__error" role="alert">{{ parseError }}</p>

    <template #footer>
      <RsButton v-if="!insertMode" variant="danger" :loading="deleting" @click="deleteConfirm = true">
        {{ t('modules.mongodb.document.delete') }}
      </RsButton>
      <div class="nm-mongo-doc-viewer__footer-spacer" />
      <RsButton variant="ghost" @click="open = false">{{ t('common.cancel') }}</RsButton>
      <RsButton variant="primary" :loading="saving" @click="onSave">
        {{ insertMode ? t('modules.mongodb.document.insert') : t('modules.mongodb.document.save') }}
      </RsButton>
    </template>
  </RsDialog>

  <RsConfirmDialog
    v-model:open="deleteConfirm"
    :title="t('modules.mongodb.document.deleteTitle')"
    :description="t('modules.mongodb.document.deleteDesc')"
    variant="danger"
    :loading="deleting"
    @confirm="onDelete"
  />
</template>

<style scoped>
.nm-mongo-doc-viewer__editor {
  width: 100%;
  min-height: 320px;
  font-family: var(--rs-font-mono);
  font-size: var(--rs-font-size-sm);
  line-height: 1.5;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-md);
  padding: var(--rs-space-sm);
  resize: vertical;
  background: var(--rs-surface);
  color: var(--rs-fg);
}

.nm-mongo-doc-viewer__error {
  margin: var(--rs-space-xs) 0 0;
  color: var(--rs-danger);
  font-size: var(--rs-font-size-sm);
}

.nm-mongo-doc-viewer__footer-spacer {
  flex: 1;
}
</style>
