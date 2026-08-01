<script setup lang="ts">
/**
 * AI 对话媒体全屏预览：图片 / 图表放大，避免 CEF target=_blank 弹出黑屏窗。
 */
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RsIcon } from '@niuma/ui'

const props = defineProps<{
  open: boolean
  /** 图片预览 src；与 chart 插槽二选一 */
  imageSrc?: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()

function close(): void {
  emit('update:open', false)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) {
    e.preventDefault()
    close()
  }
}

watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="nm-ai-lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="t('ai.mediaPreview')"
      @click.self="close"
    >
      <button
        type="button"
        class="nm-ai-lightbox__close"
        :title="t('ai.previewClose')"
        :aria-label="t('ai.previewClose')"
        @click="close"
      >
        <RsIcon name="x" :size="18" />
      </button>
      <div class="nm-ai-lightbox__body" @click.stop>
        <img
          v-if="imageSrc"
          :src="imageSrc"
          alt=""
          class="nm-ai-lightbox__img"
        />
        <slot v-else name="chart" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nm-ai-lightbox {
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 24px 24px;
  background: color-mix(in srgb, #0a0a0a 78%, transparent);
  backdrop-filter: blur(6px);
}

.nm-ai-lightbox__close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid color-mix(in srgb, #fff 18%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, #1a1a1a 88%, transparent);
  color: #f3f3f3;
  cursor: pointer;
}

.nm-ai-lightbox__close:hover {
  background: color-mix(in srgb, #2a2a2a 92%, transparent);
}

.nm-ai-lightbox__body {
  width: min(1100px, 100%);
  height: min(720px, calc(100vh - 72px));
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
}

.nm-ai-lightbox__img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.45);
  background: var(--nm-editor-bg, #1f1f1f);
}
</style>
