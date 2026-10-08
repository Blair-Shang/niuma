<script setup lang="ts">
/**
 * 单条对话消息：用户/助手布局；MD 渲染；底部工具条（复制/重试/编辑/分支）。
 */
import { copyTextToClipboard, RsIcon } from '@niuma/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiLiveToolInvocation } from '@/api/types/ai'
import { useAiStore } from '@/stores/ai'
import AiMarkdown from './AiMarkdown.vue'
import AiMediaLightbox from './AiMediaLightbox.vue'
import AiToolCallList from './AiToolCallList.vue'
import type { AiContextAttachment } from './context-pack'
import type { ExtractedTextFile } from './attachment-utils'
import type { ParsedAssistantContent } from './parse-assistant-content'

const props = withDefaults(
  defineProps<{
    messageId?: string
    speaker: 'user' | 'assistant' | string
    content: string
    createdAt?: string
    parsed?: ParsedAssistantContent | null
    streaming?: boolean
    attachments?: AiContextAttachment[]
    images?: string[]
    files?: ExtractedTextFile[]
    /** 同一轮里紧接上一段助手文字，不再重复头像。 */
    continued?: boolean
    /** 先于这段文字发生的工具。 */
    toolsBefore?: AiLiveToolInvocation[]
    /** 这段文字之后、下一段文字之前的工具。 */
    toolsAfter?: AiLiveToolInvocation[]
  }>(),
  {
    messageId: '',
    createdAt: '',
    parsed: null,
    streaming: false,
    attachments: () => [],
    images: () => [],
    files: () => [],
    continued: false,
    toolsBefore: () => [],
    toolsAfter: () => [],
  },
)

const emit = defineEmits<{
  focusAttachment: [id: string]
}>()

const { t, locale } = useI18n()
const aiStore = useAiStore()

const isUser = computed(() => props.speaker === 'user')
const isAssistant = computed(() => props.speaker === 'assistant')
const copied = ref(false)
const previewOpen = ref(false)
const previewSrc = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

function openImagePreview(src: string): void {
  previewSrc.value = src
  previewOpen.value = true
}

const timeLabel = computed(() => {
  if (!props.createdAt) {
    return ''
  }
  try {
    const d = new Date(props.createdAt)
    if (Number.isNaN(d.getTime())) {
      return ''
    }
    return d.toLocaleTimeString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
})

const copyPayload = computed(() => {
  if (isAssistant.value && props.parsed) {
    return props.parsed.body || props.content
  }
  return props.content
})

const segments = computed(() => props.parsed?.segments ?? [])

/** 末尾未闭合的思考就是当前步骤，不再在它下面画光标。 */
const openThinkAtEnd = computed(() => {
  const last = segments.value[segments.value.length - 1]
  return last?.kind === 'think' && last.open === true
})

const caretIndex = computed(() => {
  if (!props.streaming || openThinkAtEnd.value) {
    return -1
  }
  for (let i = segments.value.length - 1; i >= 0; i--) {
    if (segments.value[i]?.kind === 'text') {
      return i
    }
  }
  return -1
})

const showIdleCaret = computed(
  () =>
    props.streaming &&
    caretIndex.value < 0 &&
    !openThinkAtEnd.value &&
    props.toolsBefore.length === 0 &&
    props.toolsAfter.length === 0,
)

const canRegenerate = computed(
  () =>
    isAssistant.value &&
    Boolean(props.messageId) &&
    !props.streaming &&
    !aiStore.sending,
)

const canEdit = computed(() => isUser.value && Boolean(props.messageId) && !aiStore.sending)
const canBranch = computed(() => isUser.value && Boolean(props.messageId) && !aiStore.sending)

function thinkPreview(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= 48) {
    return line
  }
  return `${line.slice(0, 48)}…`
}

function chipIcon(kind: AiContextAttachment['kind']): string {
  if (kind === 'tab') return 'file-text'
  if (kind === 'connection') return 'plug-zap'
  if (kind === 'selection') return 'type'
  if (kind === 'schema') return 'database'
  return 'circle-alert'
}

async function onCopy(): Promise<void> {
  const ok = await copyTextToClipboard(copyPayload.value)
  if (!ok) {
    return
  }
  copied.value = true
  if (copiedTimer) {
    clearTimeout(copiedTimer)
  }
  copiedTimer = setTimeout(() => {
    copied.value = false
  }, 1400)
}

async function onRegenerate(): Promise<void> {
  if (!canRegenerate.value || !props.messageId) {
    return
  }
  await aiStore.regenerate(props.messageId)
}

function onEdit(): void {
  if (!canEdit.value || !props.messageId) {
    return
  }
  aiStore.editUserMessage(props.messageId, props.content)
}

async function onBranch(): Promise<void> {
  if (!canBranch.value || !props.messageId) {
    return
  }
  await aiStore.branchFrom(props.messageId)
}
</script>

<template>
  <article class="nm-ai-msg" :class="[`nm-ai-msg--${speaker}`, { 'nm-ai-msg--continued': continued }]">
    <div
      class="nm-ai-msg__avatar"
      :aria-label="isUser ? t('ai.roleUser') : t('ai.roleAssistant')"
    >
      <RsIcon :name="isUser ? 'user' : 'bot'" :size="13" />
    </div>
    <div class="nm-ai-msg__main">
      <div v-if="streaming || (timeLabel && !continued)" class="nm-ai-msg__role-row">
        <div class="nm-ai-msg__meta">
          <span v-if="streaming" class="nm-ai-msg__live">{{ t('ai.streaming') }}</span>
          <span v-else class="nm-ai-msg__time">{{ timeLabel }}</span>
        </div>
      </div>

      <div v-if="attachments.length" class="nm-ai-msg__chips rs-native-scrollbar" role="list">
        <button
          v-for="a in attachments"
          :key="a.id"
          type="button"
          class="nm-ai-msg__chip"
          role="listitem"
          :title="a.detail || a.label"
          @click="emit('focusAttachment', a.id)"
        >
          <RsIcon :name="chipIcon(a.kind)" :size="11" />
          <span class="nm-ai-msg__chip-label">{{ a.label }}</span>
        </button>
      </div>

      <template v-if="isAssistant && parsed">
        <AiToolCallList v-if="toolsBefore.length" :tools="toolsBefore" />
        <template v-for="(segment, index) in segments" :key="index">
          <details
            v-if="segment.kind === 'think'"
            class="nm-ai-msg__think"
            :class="{ 'nm-ai-msg__think--live': segment.open }"
            :open="segment.open || undefined"
          >
            <summary>
              <span>{{ segment.open ? t('ai.thinkingLive') : t('ai.thinking') }}</span>
              <span v-if="!segment.open && segment.text" class="nm-ai-msg__think-preview">
                {{ thinkPreview(segment.text) }}
              </span>
            </summary>
            <div v-if="segment.text" class="nm-ai-msg__think-body">
              <AiMarkdown :source="segment.text" lite />
            </div>
          </details>
          <div v-else class="nm-ai-msg__body nm-ai-msg__body--md">
            <AiMarkdown :source="segment.text" :streaming="streaming && index === caretIndex" />
            <span v-if="index === caretIndex" class="nm-ai-msg__caret" aria-hidden="true" />
          </div>
        </template>
        <div v-if="showIdleCaret" class="nm-ai-msg__body nm-ai-msg__body--md">
          <span class="nm-ai-msg__caret" aria-hidden="true" />
        </div>
        <AiToolCallList v-if="toolsAfter.length" :tools="toolsAfter" />
      </template>

      <template v-else-if="isAssistant && (toolsBefore.length || toolsAfter.length)">
        <AiToolCallList v-if="toolsBefore.length" :tools="toolsBefore" />
        <AiToolCallList v-if="toolsAfter.length" :tools="toolsAfter" />
      </template>

      <div v-if="images.length" class="nm-ai-msg__images">
        <button
          v-for="(src, i) in images"
          :key="i"
          type="button"
          class="nm-ai-msg__image-link"
          :title="t('ai.mediaPreview')"
          @click="openImagePreview(src)"
        >
          <img :src="src" alt="" class="nm-ai-msg__image" />
        </button>
      </div>

      <AiMediaLightbox v-model:open="previewOpen" :image-src="previewSrc" />

      <div v-if="files.length" class="nm-ai-msg__files">
        <details v-for="(f, i) in files" :key="i" class="nm-ai-msg__file">
          <summary class="nm-ai-msg__file-summary">
            <RsIcon name="file-text" :size="12" />
            <span class="nm-ai-msg__file-name">{{ f.name }}</span>
          </summary>
          <pre class="nm-ai-msg__file-body rs-native-scrollbar">{{ f.text }}</pre>
        </details>
      </div>

      <div v-if="isUser" class="nm-ai-msg__body nm-ai-msg__body--md nm-ai-msg__body--user">
        <AiMarkdown v-if="content" :source="content" lite />
      </div>
      <div v-else-if="!isAssistant" class="nm-ai-msg__body">{{ content }}</div>
      <AiToolCallList v-if="isUser && toolsAfter.length" :tools="toolsAfter" />

      <div v-if="!streaming" class="nm-ai-msg__actions">
        <button
          type="button"
          class="nm-ai-msg__action"
          :title="copied ? t('ai.copiedMessage') : t('ai.copyMessage')"
          @click="onCopy"
        >
          <RsIcon :name="copied ? 'check' : 'copy'" :size="12" />
        </button>
        <button
          v-if="canRegenerate"
          type="button"
          class="nm-ai-msg__action"
          :title="t('ai.regenerate')"
          @click="onRegenerate"
        >
          <RsIcon name="refresh-cw" :size="12" />
        </button>
        <button
          v-if="canEdit"
          type="button"
          class="nm-ai-msg__action"
          :title="t('ai.editMessage')"
          @click="onEdit"
        >
          <RsIcon name="pencil" :size="12" />
        </button>
        <button
          v-if="canBranch"
          type="button"
          class="nm-ai-msg__action"
          :title="t('ai.branchChat')"
          @click="onBranch"
        >
          <RsIcon name="git-branch" :size="12" />
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.nm-ai-msg {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 8px;
  max-width: 100%;
  animation: nm-ai-msg-in 0.18s ease-out;
}

@keyframes nm-ai-msg-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.nm-ai-msg--user {
  grid-template-columns: minmax(0, 1fr) 28px;
}

.nm-ai-msg--user .nm-ai-msg__main {
  order: 1;
  align-items: flex-end;
}

.nm-ai-msg__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-top: 2px;
  border-radius: var(--rs-radius-sm);
  flex-shrink: 0;
  color: var(--rs-muted);
  background: color-mix(in srgb, var(--rs-text) 6%, transparent);
  border: 1px solid var(--rs-border-subtle);
}

.nm-ai-msg--continued .nm-ai-msg__avatar {
  visibility: hidden;
}

.nm-ai-msg--assistant .nm-ai-msg__avatar {
  color: var(--rs-primary);
  background: color-mix(in srgb, var(--rs-primary) 12%, transparent);
  border-color: color-mix(in srgb, var(--rs-primary) 28%, var(--rs-border-subtle));
}

.nm-ai-msg--user .nm-ai-msg__avatar {
  order: 2;
  color: var(--rs-text);
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
}

.nm-ai-msg__main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.nm-ai-msg__role-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 18px;
}

.nm-ai-msg--user .nm-ai-msg__role-row {
  justify-content: flex-end;
}

.nm-ai-msg__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nm-ai-msg__time {
  font-size: var(--nm-font-caption);
  font-weight: var(--rs-font-weight-regular);
  color: var(--rs-muted);
}

.nm-ai-msg__actions {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  margin-top: 2px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.nm-ai-msg:hover .nm-ai-msg__actions,
.nm-ai-msg:focus-within .nm-ai-msg__actions {
  opacity: 1;
}

.nm-ai-msg--user .nm-ai-msg__actions {
  justify-content: flex-end;
  align-self: flex-end;
}

.nm-ai-msg__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--rs-radius-xs);
  background: transparent;
  color: var(--rs-muted);
  cursor: pointer;
}

.nm-ai-msg__action:hover {
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
  color: var(--rs-text);
}

.nm-ai-msg__live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--nm-font-caption);
  font-weight: var(--rs-font-weight-regular);
  color: var(--rs-muted);
}

.nm-ai-msg__live::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: var(--rs-radius-full);
  background: var(--rs-success);
  animation: nm-ai-pulse 1.2s ease-in-out infinite;
}

@keyframes nm-ai-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.nm-ai-msg__chips {
  display: flex;
  flex-wrap: nowrap;
  gap: 5px;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: thin;
}

.nm-ai-msg__images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}

.nm-ai-msg--user .nm-ai-msg__images {
  justify-content: flex-end;
}

.nm-ai-msg__image-link {
  display: block;
  padding: 0;
  margin: 0;
  border-radius: var(--rs-radius-sm);
  overflow: hidden;
  border: 1px solid var(--rs-border-subtle);
  max-width: 220px;
  background: transparent;
  cursor: zoom-in;
}

.nm-ai-msg__image {
  display: block;
  max-width: 220px;
  max-height: 160px;
  object-fit: contain;
  background: var(--nm-editor-bg);
}

.nm-ai-msg__files {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 6px;
  max-width: 100%;
}

.nm-ai-msg--user .nm-ai-msg__files {
  align-items: flex-end;
}

.nm-ai-msg__file {
  max-width: min(100%, 28rem);
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 4%, transparent);
  overflow: hidden;
}

.nm-ai-msg__file-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  list-style: none;
  font-size: var(--nm-font-caption);
  color: var(--rs-text-secondary);
}

.nm-ai-msg__file-summary::-webkit-details-marker {
  display: none;
}

.nm-ai-msg__file-name {
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-ai-msg__file-body {
  margin: 0;
  padding: 8px 10px 10px;
  max-height: 12rem;
  overflow: auto;
  border-top: 1px solid var(--rs-border-subtle);
  font-size: var(--nm-font-caption);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--nm-editor-bg);
}

.nm-ai-msg--user .nm-ai-msg__chips {
  justify-content: flex-end;
}

.nm-ai-msg__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 10rem;
  min-height: 22px;
  padding: 2px 8px;
  border-radius: var(--rs-radius-xs);
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 4%, transparent);
  color: var(--rs-muted);
  font-size: var(--nm-font-caption);
  cursor: pointer;
}

.nm-ai-msg__chip:hover {
  color: var(--rs-text);
  background: color-mix(in srgb, var(--rs-text) 7%, transparent);
}

.nm-ai-msg__chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-ai-msg__think {
  max-width: 100%;
  border-radius: var(--rs-radius-sm);
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3.5%, transparent);
  overflow: hidden;
}

.nm-ai-msg__think--live {
  border-color: color-mix(in srgb, var(--rs-primary) 28%, var(--rs-border-subtle));
}

.nm-ai-msg__think--live .nm-ai-msg__think-body {
  max-height: 8rem;
}

.nm-ai-msg__think summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  cursor: pointer;
  list-style: none;
  padding: 6px 10px;
  font-size: var(--nm-font-caption);
  font-weight: var(--rs-font-weight-medium);
  color: var(--rs-muted);
  user-select: none;
}

.nm-ai-msg__think-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--rs-font-weight-regular);
}

.nm-ai-msg__think summary::-webkit-details-marker {
  display: none;
}

.nm-ai-msg__think summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 6px;
  transition: transform 0.12s ease;
}

.nm-ai-msg__think[open] summary::before {
  transform: rotate(90deg);
}

.nm-ai-msg__think-body {
  padding: 0 10px 8px;
  max-height: 12rem;
  overflow: auto;
  font-size: var(--nm-font-caption);
  line-height: 1.5;
  color: var(--rs-muted);
}

.nm-ai-msg__think-body :deep(.nm-ai-md) {
  font-size: var(--nm-font-caption);
  color: var(--rs-muted);
}

.nm-ai-msg__body {
  max-width: 100%;
  font-size: var(--nm-font-body);
  line-height: 1.6;
  letter-spacing: var(--nm-letter-spacing);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--rs-text);
}

.nm-ai-msg__body--md {
  white-space: normal;
}

.nm-ai-msg__body--md .nm-ai-msg__caret {
  margin-left: 2px;
}

.nm-ai-msg--user .nm-ai-msg__body--user {
  max-width: min(100%, 22rem);
  padding: 9px 12px;
  border-radius: var(--rs-radius) var(--rs-radius) var(--rs-radius-xs) var(--rs-radius);
  background: color-mix(in srgb, var(--rs-text) 7%, transparent);
}

.nm-ai-msg--assistant .nm-ai-msg__body {
  padding: 0;
  background: transparent;
}

.nm-ai-msg__caret {
  display: inline-block;
  width: 2px;
  height: 0.95em;
  margin-left: 1px;
  vertical-align: -0.12em;
  background: var(--rs-text);
  border-radius: 1px;
  animation: nm-ai-caret 0.9s steps(1) infinite;
}

@keyframes nm-ai-caret {
  0%,
  45% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}
</style>
