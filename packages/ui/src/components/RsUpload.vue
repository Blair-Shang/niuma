<script setup lang="ts">
import { computed } from 'vue'
import RsIcon from './RsIcon.vue'
import { formatFileSize, mergeUploadFiles, removeUploadFileAt, validateUploadFiles } from './upload-utils'
import { useRsI18n } from '../composables/useRsI18n'

const model = defineModel<File[]>({ default: () => [] })

const props = withDefaults(
  defineProps<{
    accept?: string
    multiple?: boolean
    maxSize?: number
    maxCount?: number
    disabled?: boolean
    label?: string
    hint?: string
  }>(),
  {
    multiple: false,
    disabled: false,
  },
)

const emit = defineEmits<{
  reject: [errors: ReturnType<typeof validateUploadFiles>['rejected']]
}>()

const { t } = useRsI18n()
const canAdd = computed(() => !props.maxCount || model.value.length < props.maxCount)
const isDropzoneDisabled = computed(() => props.disabled || !canAdd.value)
const resolvedHint = computed(() => props.hint ?? t('upload.browse'))

function onFilesChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  const result = validateUploadFiles(files, {
    accept: props.accept,
    maxSize: props.maxSize,
    maxCount: props.maxCount ? props.maxCount - model.value.length : undefined,
  })
  model.value = mergeUploadFiles(model.value, result.accepted, props.maxCount)
  if (result.rejected.length) emit('reject', result.rejected)
  input.value = ''
}

function removeFile(index: number): void {
  model.value = removeUploadFileAt(model.value, index)
}
</script>

<template>
  <div class="rs-upload">
    <label
      class="rs-upload__dropzone"
      :class="{ 'rs-upload__dropzone--disabled': isDropzoneDisabled }"
    >
      <input
        class="rs-upload__input"
        type="file"
        :accept="accept"
        :multiple="multiple"
        :disabled="isDropzoneDisabled"
        @change="onFilesChange"
      >
      <span class="rs-upload__icon" aria-hidden="true">
        <RsIcon name="cloud-upload" :size="22" />
      </span>
      <span class="rs-upload__text">
        <span class="rs-upload__label">{{ label ?? t('upload.label') }}</span>
        <span class="rs-upload__hint">{{ resolvedHint }}</span>
      </span>
    </label>
    <ul v-if="model.length" class="rs-upload__list">
      <li
        v-for="(file, index) in model"
        :key="`${file.name}-${file.size}-${index}`"
        class="rs-upload__file"
      >
        <span class="rs-upload__file-icon" aria-hidden="true">
          <RsIcon name="file" :size="16" />
        </span>
        <span class="rs-upload__file-meta">
          <span class="rs-upload__file-name">{{ file.name }}</span>
          <span class="rs-upload__file-size">{{ formatFileSize(file.size) }}</span>
        </span>
        <button
          type="button"
          class="rs-upload__file-remove"
          :aria-label="t('common.remove')"
          @click.stop="removeFile(index)"
        >
          <RsIcon name="x" :size="14" />
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.rs-upload {
  display: grid;
  gap: var(--rs-space-md);
}

.rs-upload__dropzone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-md);
  min-height: 8.5rem;
  padding: var(--rs-space-xl) var(--rs-space-lg);
  border: 1px dashed var(--rs-border);
  border-radius: var(--rs-radius);
  background: color-mix(in srgb, var(--rs-surface) 82%, var(--rs-bg));
  cursor: pointer;
  text-align: center;
  transition:
    border-color var(--rs-transition-fast),
    background var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast);
}

.rs-upload__dropzone:hover:not(.rs-upload__dropzone--disabled) {
  border-color: color-mix(in srgb, var(--rs-primary) 55%, var(--rs-border));
  background: color-mix(in srgb, var(--rs-primary) 6%, var(--rs-surface));
}

.rs-upload__dropzone:focus-within:not(.rs-upload__dropzone--disabled) {
  border-color: var(--rs-focus-border, var(--rs-primary));
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}

.rs-upload__dropzone--disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.rs-upload__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: inherit;
}

.rs-upload__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  border-radius: var(--rs-radius-full);
  border: 1px solid color-mix(in srgb, var(--rs-primary) 24%, var(--rs-border));
  background: var(--rs-primary-container);
  color: var(--rs-on-primary-container);
  box-shadow: var(--rs-shadow-sm);
  transition:
    transform var(--rs-transition-fast),
    box-shadow var(--rs-transition-fast);
}

.rs-upload__dropzone:hover:not(.rs-upload__dropzone--disabled) .rs-upload__icon {
  transform: translateY(-1px);
  box-shadow: var(--rs-shadow);
}

.rs-upload__text {
  display: grid;
  gap: 0.25rem;
  max-width: 20rem;
}

.rs-upload__label {
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
  line-height: var(--rs-line-height-tight);
}

.rs-upload__hint {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  line-height: var(--rs-line-height-normal);
}

.rs-upload__list {
  display: grid;
  gap: var(--rs-space-xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

.rs-upload__file {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm) var(--rs-space-md);
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm);
  background: var(--rs-surface);
  transition:
    border-color var(--rs-transition-fast),
    background var(--rs-transition-fast);
}

.rs-upload__file:hover {
  border-color: var(--rs-border);
  background: color-mix(in srgb, var(--rs-surface-hover) 35%, var(--rs-surface));
}

.rs-upload__file-icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-bg) 55%, var(--rs-surface));
  color: var(--rs-muted);
}

.rs-upload__file-meta {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
  flex: 1;
}

.rs-upload__file-name {
  overflow: hidden;
  color: var(--rs-text);
  font-size: var(--rs-font-size-sm);
  font-weight: 500;
  line-height: var(--rs-line-height-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-upload__file-size {
  color: var(--rs-muted);
  font-size: var(--rs-font-size-xs);
  line-height: var(--rs-line-height-tight);
}

.rs-upload__file-remove {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.rs-upload__file-remove:hover {
  background: var(--rs-item-hover);
  color: var(--rs-text);
}

.rs-upload__file-remove:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--rs-focus-ring-width, 2px) var(--rs-focus-ring);
}
</style>
