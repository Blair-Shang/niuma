<script setup lang="ts">
/**
 * AI 消息列表：空态 / 加载 / 错误 / 消息流；贴底自动滚动。
 */
import { RsButton, RsIcon } from '@niuma/ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiLiveToolInvocation } from '@/api/types/ai'
import { useAccountStore } from '@/stores/account'
import { useAiStore } from '@/stores/ai'
import { useTabStore } from '@/stores/tab'
import { isSystemAiProvider } from './system-provider'
import AiMessageItem from './AiMessageItem.vue'
import AiToolConfirmActions from './AiToolConfirmActions.vue'
import { extractAttachmentMarkers } from './context-pack'
import { extractImageMarkers, extractTextMarkers } from './attachment-utils'
import { parseAssistantContent } from './parse-assistant-content'

const { t } = useI18n()
const aiStore = useAiStore()
const tabStore = useTabStore()
const accountStore = useAccountStore()

const usableProviders = computed(() =>
  aiStore.providers.filter((p) => p.recordStatus !== 'disabled'),
)
const onlySystemProvider = computed(() => {
  const list = usableProviders.value
  return list.length > 0 && list.every((p) => isSystemAiProvider(p))
})
const showLoginPrompt = computed(
  () =>
    !aiStore.loading &&
    !accountStore.isLoggedIn &&
    (usableProviders.value.length === 0 || onlySystemProvider.value) &&
    !aiStore.messages.length &&
    !aiStore.streamingText,
)

const listEl = ref<HTMLElement | null>(null)
const bottomEl = ref<HTMLElement | null>(null)
/** 用户是否贴近底部；上翻阅读时不强制抢走滚动。 */
const stickToBottom = ref(true)
/** 列表内待确认卡片是否还在视口里；滚走后改用底部固定条。 */
const pendingCardInView = ref(true)
const decidingId = ref('')
let pendingObserver: IntersectionObserver | null = null
let revealTimer = 0

const NEAR_BOTTOM_PX = 96

const showEmpty = computed(
  () =>
    !aiStore.loading &&
    usableProviders.value.length > 0 &&
    !showLoginPrompt.value &&
    !aiStore.messages.length &&
    !aiStore.streamingText,
)

const displayMessages = computed(() =>
  aiStore.messages.map((m) => {
    if (m.messageRole === 'user') {
      const withImages = extractImageMarkers(m.messageContent)
      const withFiles = extractTextMarkers(withImages.text)
      const extracted = extractAttachmentMarkers(withFiles.text)
      return {
        messageId: m.messageId,
        messageRole: m.messageRole,
        messageContent: extracted.text,
        attachments: extracted.attachments,
        images: withImages.images,
        files: withFiles.files,
        createdAt: m.createdAt,
        parsed: null,
      }
    }
    return {
      messageId: m.messageId,
      messageRole: m.messageRole,
      messageContent: m.messageContent,
      attachments: [] as ReturnType<typeof extractAttachmentMarkers>['attachments'],
      images: [] as string[],
      files: [] as ReturnType<typeof extractTextMarkers>['files'],
      createdAt: m.createdAt,
      parsed: m.messageRole === 'assistant' ? parseAssistantContent(m.messageContent) : null,
    }
  }),
)

const streamingParsed = computed(() => parseAssistantContent(aiStore.streamingText))
const showCancelled = computed(() => aiStore.runStatus === 'cancelled')
const showCompare = computed(() => Boolean(aiStore.previousAssistantContent && aiStore.isStreaming))

/**
 * 将工具调用挂到对应助手消息：落在「上一轮用户消息之后、该助手消息之前/之时」。
 * 尚未落库的本轮工具留给流式气泡。
 */
const toolsByMessageId = computed(() => {
  const map = new Map<string, AiLiveToolInvocation[]>()
  const msgs = displayMessages.value
  const tools = aiStore.displayTools
  if (!tools.length || !msgs.length) {
    return map
  }

  const assistantIdx: number[] = []
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].messageRole === 'assistant') {
      assistantIdx.push(i)
    }
  }
  if (!assistantIdx.length) {
    return map
  }

  const sorted = [...tools].sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
  )

  for (const tool of sorted) {
    const tAt = tool.createdAt || ''
    let targetId = ''
    for (const idx of assistantIdx) {
      const m = msgs[idx]
      const mAt = m.createdAt || ''
      if (tAt && mAt && tAt > mAt) {
        continue
      }
      let prevUserAt = ''
      for (let j = idx - 1; j >= 0; j--) {
        if (msgs[j].messageRole === 'user') {
          prevUserAt = msgs[j].createdAt || ''
          break
        }
      }
      if (tAt && prevUserAt && tAt < prevUserAt) {
        continue
      }
      targetId = m.messageId
      break
    }
    if (!targetId && !aiStore.isStreaming) {
      targetId = msgs[assistantIdx[assistantIdx.length - 1]].messageId
    }
    if (!targetId) {
      continue
    }
    const list = map.get(targetId)
    if (list) {
      list.push(tool)
    } else {
      map.set(targetId, [tool])
    }
  }
  return map
})

/** 尚未挂到历史助手消息的工具（流式本轮 / 尚无助手气泡）。 */
const streamingTools = computed(() => {
  const attached = new Set<string>()
  for (const list of toolsByMessageId.value.values()) {
    for (const t of list) {
      attached.add(t.invocationId)
    }
  }
  return aiStore.displayTools.filter((t) => !attached.has(t.invocationId))
})

const showStreamingBubble = computed(() => {
  if (aiStore.streamingText || streamingTools.value.length > 0) {
    return true
  }
  if (!aiStore.isStreaming) {
    return false
  }
  // 助手正文已落库（token 缓冲已清空）时不再叠一个空流式气泡
  const last = displayMessages.value[displayMessages.value.length - 1]
  return last?.messageRole !== 'assistant'
})

function toolsForMessage(messageId: string): AiLiveToolInvocation[] {
  return toolsByMessageId.value.get(messageId) ?? []
}

const pendingTools = computed(() => aiStore.displayTools.filter((x) => x.status === 'pending'))
const pendingKey = computed(() => pendingTools.value.map((x) => x.invocationId).join('|'))
const showPendingBar = computed(() => pendingTools.value.length > 0 && !pendingCardInView.value)

function disconnectPendingObserver(): void {
  pendingObserver?.disconnect()
  pendingObserver = null
}

function observePendingCards(): void {
  disconnectPendingObserver()
  const root = listEl.value
  if (!root || !pendingTools.value.length) {
    pendingCardInView.value = true
    return
  }
  const actions = root.querySelectorAll<HTMLElement>('[data-ai-pending-actions]')
  const targets = actions.length
    ? actions
    : root.querySelectorAll<HTMLElement>('.nm-ai-tool--pending')
  if (!targets.length) {
    pendingCardInView.value = false
    return
  }
  pendingObserver = new IntersectionObserver(
    (entries) => {
      pendingCardInView.value = entries.some((e) => e.isIntersecting)
    },
    { root, threshold: 0.35, rootMargin: '0px 0px -8px 0px' },
  )
  targets.forEach((node) => pendingObserver?.observe(node))
}

/** 只滚消息列表，避免 scrollIntoView 带动外层容器。 */
function scrollChildIntoList(child: HTMLElement, align: 'nearest' | 'end'): void {
  const el = listEl.value
  if (!el) {
    return
  }
  const listRect = el.getBoundingClientRect()
  const childRect = child.getBoundingClientRect()
  const visible =
    childRect.top >= listRect.top && childRect.bottom <= listRect.bottom
  if (align === 'nearest' && visible) {
    return
  }
  const nextTop =
    align === 'end'
      ? el.scrollTop + (childRect.bottom - listRect.bottom) + 12
      : el.scrollTop + (childRect.top - listRect.top) - 8
  el.scrollTop = Math.max(0, nextTop)
}

function scrollPendingIntoView(): void {
  const el = listEl.value
  if (!el) {
    return
  }
  const actions = el.querySelector<HTMLElement>('[data-ai-pending-actions]')
  const card = el.querySelector<HTMLElement>('.nm-ai-tool--pending')
  const target = actions || card
  if (!target) {
    return
  }
  scrollChildIntoList(target, 'end')
  requestAnimationFrame(() => observePendingCards())
}

function scheduleRevealPending(): void {
  if (revealTimer) {
    window.clearTimeout(revealTimer)
    revealTimer = 0
  }
  let attempt = 0
  const run = (): void => {
    if (!pendingTools.value.length) {
      return
    }
    const ready = Boolean(
      listEl.value?.querySelector('[data-ai-pending-actions], .nm-ai-tool--pending'),
    )
    if (ready) {
      scrollPendingIntoView()
      observePendingCards()
      return
    }
    // 卡片尚未挂上（异步组件）时先露出底部条，避免确认按钮消失
    pendingCardInView.value = false
    if (attempt < 10) {
      attempt += 1
      revealTimer = window.setTimeout(run, 50)
    }
  }
  void nextTick(run)
}

let scrollRaf = 0

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
}

function onListScroll(): void {
  const el = listEl.value
  if (!el) {
    return
  }
  stickToBottom.value = isNearBottom(el)
}

/** 滚到最新输出；force 用于用户刚发送时。待确认期间改为钉住确认区，避免被后续正文顶走。 */
function scrollToBottom(force = false): void {
  if (pendingTools.value.length && !force) {
    return
  }
  if (!force && !stickToBottom.value) {
    return
  }
  if (scrollRaf) {
    cancelAnimationFrame(scrollRaf)
  }
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    if (pendingTools.value.length && !force) {
      return
    }
    const el = listEl.value
    const anchor = bottomEl.value
    if (!el) {
      return
    }
    if (anchor) {
      anchor.scrollIntoView({ block: 'end', behavior: 'auto' })
    } else {
      el.scrollTop = el.scrollHeight
    }
    // Markdown / 图表异步增高后再补一次
    requestAnimationFrame(() => {
      if (pendingTools.value.length && !force) {
        return
      }
      if (!force && !stickToBottom.value) {
        return
      }
      if (anchor) {
        anchor.scrollIntoView({ block: 'end', behavior: 'auto' })
      } else if (listEl.value) {
        listEl.value.scrollTop = listEl.value.scrollHeight
      }
    })
  })
}

async function scrollToBottomAfterPaint(force = false): Promise<void> {
  await nextTick()
  scrollToBottom(force)
}

watch(
  () => aiStore.messages.length,
  () => {
    if (pendingTools.value.length) {
      void nextTick(() => scrollPendingIntoView())
      return
    }
    stickToBottom.value = true
    void scrollToBottomAfterPaint(true)
  },
)

watch(
  () => [aiStore.streamingText.length, aiStore.displayTools.length, aiStore.isStreaming] as const,
  () => {
    void scrollToBottomAfterPaint(false)
  },
)

watch(
  () => aiStore.runStatus,
  (status) => {
    if (status === 'done' || status === 'error' || status === 'cancelled') {
      if (pendingTools.value.length) {
        void nextTick(() => scrollPendingIntoView())
        return
      }
      void scrollToBottomAfterPaint(true)
    }
  },
)

watch(pendingKey, (key) => {
  decidingId.value = ''
  if (!key) {
    if (revealTimer) {
      window.clearTimeout(revealTimer)
      revealTimer = 0
    }
    disconnectPendingObserver()
    pendingCardInView.value = true
    return
  }
  scheduleRevealPending()
})

async function onPendingDecide(
  invocationId: string,
  decision: 'approve' | 'reject',
  scope: 'once' | 'run' | 'conversation' = 'once',
): Promise<void> {
  decidingId.value = invocationId
  try {
    await aiStore.confirmTool(invocationId, decision, scope)
  } finally {
    if (decidingId.value === invocationId) {
      decidingId.value = ''
    }
  }
}

onMounted(() => {
  listEl.value?.addEventListener('scroll', onListScroll, { passive: true })
  if (pendingKey.value) {
    observePendingCards()
  }
})

onBeforeUnmount(() => {
  listEl.value?.removeEventListener('scroll', onListScroll)
  disconnectPendingObserver()
  if (revealTimer) {
    window.clearTimeout(revealTimer)
    revealTimer = 0
  }
  if (scrollRaf) {
    cancelAnimationFrame(scrollRaf)
  }
})

function openProviderSettings(): void {
  tabStore.openSettings({ section: 'ai-providers' })
}

function openLogin(): void {
  accountStore.openAuth('login')
}

function focusAttachment(id: string): void {
  const tabId = id.startsWith('tab:') ? id.slice(4) : ''
  if (!tabId) {
    return
  }
  if (tabStore.allTabs.some((x) => x.tabId === tabId)) {
    tabStore.activateTab(tabId)
  }
}
</script>

<template>
  <div class="nm-ai-messages-wrap">
  <div ref="listEl" class="nm-ai-messages rs-native-scrollbar">
    <div v-if="aiStore.loading && !aiStore.messages.length" class="nm-ai-messages__welcome">
      <span class="nm-ai-messages__spinner" aria-hidden="true" />
      <p class="nm-ai-messages__welcome-desc">{{ t('ai.loading') }}</p>
    </div>

    <div v-else-if="showLoginPrompt" class="nm-ai-messages__welcome">
      <div class="nm-ai-messages__welcome-mark" aria-hidden="true">
        <RsIcon name="sparkles" :size="22" />
      </div>
      <h2 class="nm-ai-messages__welcome-title">{{ t('ai.loginToUse') }}</h2>
      <p class="nm-ai-messages__welcome-desc">{{ t('ai.loginToUseDesc') }}</p>
      <div class="nm-ai-messages__welcome-actions">
        <RsButton variant="primary" size="sm" @click="openLogin">
          {{ t('ai.openLogin') }}
        </RsButton>
        <RsButton variant="secondary" size="sm" @click="openProviderSettings">
          {{ t('ai.openSettings') }}
        </RsButton>
      </div>
    </div>

    <div v-else-if="!usableProviders.length" class="nm-ai-messages__welcome">
      <div class="nm-ai-messages__welcome-mark" aria-hidden="true">
        <RsIcon name="sparkles" :size="22" />
      </div>
      <h2 class="nm-ai-messages__welcome-title">{{ t('ai.noProvider') }}</h2>
      <p class="nm-ai-messages__welcome-desc">{{ t('ai.bodyDesc') }}</p>
      <RsButton variant="secondary" size="sm" @click="openProviderSettings">
        {{ t('ai.openSettings') }}
      </RsButton>
    </div>

    <div v-else-if="showEmpty" class="nm-ai-messages__welcome">
      <div class="nm-ai-messages__welcome-mark" aria-hidden="true">
        <RsIcon name="sparkles" :size="22" />
      </div>
      <h2 class="nm-ai-messages__welcome-title">{{ t('ai.emptyTitle') }}</h2>
      <p class="nm-ai-messages__welcome-desc">{{ t('ai.empty') }}</p>
    </div>

    <template v-else>
      <AiMessageItem
        v-for="m in displayMessages"
        :key="m.messageId"
        class="nm-ai-messages__item"
        :message-id="m.messageId"
        :speaker="m.messageRole"
        :content="m.messageContent"
        :attachments="m.attachments"
        :images="m.images"
        :files="m.files"
        :created-at="m.createdAt"
        :parsed="m.parsed"
        :tools="toolsForMessage(m.messageId)"
        @focus-attachment="focusAttachment"
      />

      <details v-if="showCompare" class="nm-ai-messages__compare">
        <summary>{{ t('ai.comparePrevious') }}</summary>
        <AiMessageItem
          speaker="assistant"
          :content="aiStore.previousAssistantContent || ''"
          :parsed="parseAssistantContent(aiStore.previousAssistantContent || '')"
        />
      </details>

      <AiMessageItem
        v-if="showStreamingBubble"
        class="nm-ai-messages__item"
        speaker="assistant"
        :content="aiStore.streamingText"
        :parsed="streamingParsed"
        :tools="streamingTools"
        streaming
      />

      <div ref="bottomEl" class="nm-ai-messages__anchor" aria-hidden="true" />
    </template>

    <div v-if="showCancelled" class="nm-ai-messages__status" role="status">
      <RsIcon name="ban" :size="14" />
      <span>{{ t('ai.cancelled') }}</span>
    </div>

    <div v-if="aiStore.runError || aiStore.error" class="nm-ai-messages__error" role="alert">
      <RsIcon name="circle-alert" :size="14" />
      <details class="nm-ai-messages__error-details">
        <summary>{{ t('ai.errorTitle') }}</summary>
        <pre>{{ aiStore.runError || aiStore.error }}</pre>
      </details>
    </div>
  </div>

  <aside v-if="showPendingBar" class="nm-ai-pending-bar" :aria-label="t('ai.toolPending')">
    <div
      v-for="tool in pendingTools"
      :key="tool.invocationId"
      class="nm-ai-pending-bar__row"
    >
      <div class="nm-ai-pending-bar__copy">
        <span class="nm-ai-pending-bar__name">{{ tool.toolName || t('ai.toolCall') }}</span>
        <span class="nm-ai-pending-bar__hint">{{ t('ai.toolConfirmHint') }}</span>
      </div>
      <AiToolConfirmActions
        class="nm-ai-pending-bar__btns"
        :deciding="decidingId === tool.invocationId"
        @approve="(scope) => onPendingDecide(tool.invocationId, 'approve', scope)"
        @reject="onPendingDecide(tool.invocationId, 'reject')"
      />
    </div>
  </aside>
  </div>
</template>

<style scoped>
.nm-ai-messages-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-ai-messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  scroll-behavior: auto;
}

.nm-ai-pending-bar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid color-mix(in srgb, var(--rs-warning, #d97706) 35%, var(--rs-border-subtle));
  background: color-mix(in srgb, var(--rs-warning, #d97706) 8%, var(--nm-editor-bg));
}

.nm-ai-pending-bar__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.nm-ai-pending-bar__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nm-ai-pending-bar__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--rs-text);
}

.nm-ai-pending-bar__hint {
  font-size: 11.5px;
  color: var(--rs-muted);
}

.nm-ai-pending-bar__btns {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 8px;
}

.nm-ai-messages__anchor {
  width: 100%;
  height: 1px;
  flex-shrink: 0;
  margin-top: -22px;
  pointer-events: none;
}

.nm-ai-messages__welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  min-height: 160px;
  padding: 24px 20px;
  text-align: center;
}

.nm-ai-messages__welcome-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-bottom: 4px;
  border-radius: 12px;
  color: var(--rs-muted);
  background: color-mix(in srgb, var(--rs-text) 5%, transparent);
  border: 1px solid var(--rs-border-subtle);
}

.nm-ai-messages__welcome-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--rs-text);
}

.nm-ai-messages__welcome-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}

.nm-ai-messages__welcome-desc {
  margin: 0;
  max-width: 16rem;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--rs-muted);
}

.nm-ai-messages__spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--rs-text) 12%, transparent);
  border-top-color: color-mix(in srgb, var(--rs-text) 55%, transparent);
  animation: nm-ai-spin 0.7s linear infinite;
}

@keyframes nm-ai-spin {
  to {
    transform: rotate(360deg);
  }
}

.nm-ai-messages__compare {
  border-radius: 10px;
  border: 1px dashed var(--rs-border-subtle);
  padding: 6px 10px;
  color: var(--rs-muted);
  font-size: 12px;
}

.nm-ai-messages__compare summary {
  cursor: pointer;
  list-style: none;
}

.nm-ai-messages__status,
.nm-ai-messages__error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 11px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.45;
}

.nm-ai-messages__status {
  border: 1px solid var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-text) 4%, transparent);
  color: var(--rs-muted);
}

.nm-ai-messages__error {
  border: 1px solid color-mix(in srgb, var(--rs-danger) 28%, transparent);
  background: color-mix(in srgb, var(--rs-danger) 8%, transparent);
  color: var(--rs-danger);
}

.nm-ai-messages__error-details {
  min-width: 0;
  flex: 1;
}

.nm-ai-messages__error-details summary {
  cursor: pointer;
  font-weight: 600;
}

.nm-ai-messages__error-details pre {
  margin: 6px 0 0;
  white-space: pre-wrap;
  font-size: 11px;
  opacity: 0.9;
}

@media print {
  .nm-ai-messages {
    overflow: visible;
    height: auto;
  }
}
</style>
