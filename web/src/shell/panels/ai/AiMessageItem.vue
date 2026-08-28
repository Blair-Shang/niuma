<script setup lang="ts">
/**
 * 单条对话消息：用户/助手布局；MD 渲染；底部工具条（复制/重试/编辑/分支）。
 */
import { copyTextToClipboard, RsIcon } from '@niuma/ui'
import { computed, defineAsyncComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiLiveToolInvocation } from '@/api/types/ai'
import { useAiStore } from '@/stores/ai'
import AiMarkdown from './AiMarkdown.vue'
import AiMediaLightbox from './AiMediaLightbox.vue'
import type { AiContextAttachment } from './context-pack'
import type { ExtractedTextFile } from './attachment-utils'
import type { ParsedAssistantContent } from './parse-assistant-content'

const AiToolCallCard = defineAsyncComponent(() => import('./AiToolCallCard.vue'))

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
    /** 本轮助手输出内的工具调用（嵌在对话气泡中，不单独占位）。 */
    tools?: AiLiveToolInvocation[]
  }>(),
  {
    messageId: '',
    createdAt: '',
    parsed: null,
    streaming: false,
    attachments: () => [],
    images: () => [],
    files: () => [],
    tools: () => [],
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

const canRegenerate = computed(
  () =>
    isAssistant.value &&
    Boolean(props.messageId) &&
    !props.streaming &&
    !aiStore.sending,
)

const canEdit = computed(() => isUser.value && Boolean(props.messageId) && !aiStore.sending)
const canBranch = computed(() => isUser.value && Boolean(props.messageId) && !aiStore.sending)

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
  <article class="nm-ai-msg" :class="`nm-ai-msg--${speaker}`">
    <div
      class="nm-ai-msg__avatar"
      :aria-label="isUser ? t('ai.roleUser') : t('ai.roleAssistant')"
    >
      <RsIcon :name="isUser ? 'user' : 'bot'" :size="13" />
    </div>
    <div class="nm-ai-msg__main">
      <div class="nm-ai-msg__role-row">
        <div class="nm-ai-msg__role">
          {{ isUser ? t('ai.roleUser') : t('ai.roleAssistant') }}
          <span v-if="streaming" class="nm-ai-msg__live">{{ t('ai.streaming') }}</span>
          <span v-else-if="timeLabel" class="nm-ai-msg__time">{{ timeLabel }}</span>
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
        <details
          v-if="parsed.thinking"
          class="nm-ai-msg__think"
          :open="parsed.thinkingOpen || undefined"
        >
          <summary>
            {{ parsed.thinkingOpen ? t('ai.thinkingLive') : t('ai.thinking') }}
          </summary>
          <div class="nm-ai-msg__think-body">
            <AiMarkdown :source="parsed.thinking" lite />
          </div>
        </details>
        <div v-if="tools.length" class="nm-ai-msg__tools">
          <AiToolCallCard
            v-for="tool in tools"
            :key="tool.invocationId"
            :name="tool.toolName"
            :status="tool.status"
            :args-summary="tool.argsSummary"
            :result-summary="tool.resultSummary"
            :error="tool.error"
            :risk="tool.risk"
            :confirmable="tool.status === 'pending'"
            @approve="aiStore.confirmTool(tool.invocationId, 'approve')"
            @reject="aiStore.confirmTool(tool.invocationId, 'reject')"
          />
        </div>
        <div v-if="parsed.body || streaming" class="nm-ai-msg__body nm-ai-msg__body--md">
          <AiMarkdown v-if="parsed.body" :source="parsed.body" :streaming="streaming" />
          <span v-if="streaming" class="nm-ai-msg__caret" aria-hidden="true" />
        </div>
      </template>

      <div
        v-else-if="isAssistant && tools.length"
        class="nm-ai-msg__tools"
      >
        <AiToolCallCard
          v-for="tool in tools"
          :key="tool.invocationId"
          :name="tool.toolName"
          :status="tool.status"
          :args-summary="tool.argsSummary"
          :result-summary="tool.resultSummary"
          :error="tool.error"
          :risk="tool.risk"
          :confirmable="tool.status === 'pending'"
          @approve="aiStore.confirmTool(tool.invocationId, 'approve')"
          @reject="aiStore.confirmTool(tool.invocationId, 'reject')"
        />
      </div>

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
  border-radius: 8px;
  flex-shrink: 0;
  color: var(--rs-muted);
  background: color-mix(in srgb, var(--rs-text) 6%, transparent);
  border: 1px solid var(--rs-border-subtle);
}

.nm-ai-msg--assistant .nm-ai-msg__avatar {
  color: color-mix(in srgb, var(--nm-aurora-a) 75%, var(--rs-text));
  background: color-mix(in srgb, var(--nm-aurora-a) 12%, transparent);
  border-color: color-mix(in srgb, var(--nm-aurora-a) 22%, var(--rs-border-subtle));
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

.nm-ai-msg__role {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--rs-text);
}

.nm-ai-msg__time {
  font-size: 11px;
  font-weight: 450;
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
  border-radius: 6px;
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
  font-size: 11px;
  font-weight: 450;
  color: var(--rs-muted);
}

.nm-ai-msg__live::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--nm-aurora-e);
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
  border-radius: 8px;
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
  border-radius: 8px;
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
  font-size: 11.5px;
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
  border-radius: 6px;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 4%, transparent);
  color: var(--rs-muted);
  font-size: 11px;
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

.nm-ai-msg__tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 100%;
}

.nm-ai-msg__tools :deep(.nm-ai-tool) {
  margin: 0;
}

.nm-ai-msg__think {
  max-width: 100%;
  border-radius: 8px;
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 3.5%, transparent);
  overflow: hidden;
}

.nm-ai-msg__think summary {
  cursor: pointer;
  list-style: none;
  padding: 6px 10px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--rs-muted);
  user-select: none;
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
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--rs-muted);
}

.nm-ai-msg__think-body :deep(.nm-ai-md) {
  font-size: 11.5px;
  color: var(--rs-muted);
}

.nm-ai-msg__body {
  max-width: 100%;
  font-size: 13px;
  line-height: 1.6;
  letter-spacing: -0.011em;
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
  border-radius: 12px 12px 4px 12px;
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
