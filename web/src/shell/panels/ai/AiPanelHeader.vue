<script setup lang="ts">
/**
 * AI 面板顶栏：标题（可重命名）、历史会话、新对话、关闭。
 */
import { RsIcon, RsPopover, useRsToast } from '@niuma/ui'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { dialogApi } from '@/api/dialog'
import { fsApi } from '@/api/fs'
import { useAiStore } from '@/stores/ai'
import { useShellStore } from '@/stores/shell'

const { t } = useI18n()
const toast = useRsToast()
const aiStore = useAiStore()
const shellStore = useShellStore()

const historyOpen = ref(false)
const renaming = ref(false)
const renameDraft = ref('')
const titleInput = ref<HTMLInputElement | null>(null)

const headerTitle = computed(() => {
  const title = aiStore.activeConversation?.conversationTitle?.trim()
  return title || t('ai.title')
})

function conversationLabel(title: string | null | undefined): string {
  const trimmed = title?.trim()
  return trimmed || t('ai.untitled')
}

async function onHistorySelect(id: string): Promise<void> {
  historyOpen.value = false
  if (!id || id === aiStore.activeConversationId) {
    return
  }
  await aiStore.openConversation(id)
}

async function onHistoryDelete(id: string, e: Event): Promise<void> {
  e.stopPropagation()
  await aiStore.removeConversation(id)
}

function onNewChat(): void {
  historyOpen.value = false
  aiStore.newConversation()
}

function sanitizeExportFilename(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'ai-chat'
}

async function onExport(): Promise<void> {
  const md = aiStore.exportConversationMarkdown()
  if (!md.trim()) {
    toast.info(t('ai.exportChatEmpty'))
    return
  }
  const title = aiStore.activeConversation?.conversationTitle?.trim() || t('ai.title')
  const defaultPath = `${sanitizeExportFilename(title)}.md`
  try {
    const picked = await dialogApi.saveFile({
      title: t('ai.exportChat'),
      defaultPath,
      accept: ['.md', '.markdown', '.txt'],
    })
    if (picked.canceled || !picked.filePaths[0]) {
      return
    }
    await fsApi.writeText({ path: picked.filePaths[0], content: md })
    toast.success(t('ai.exportChatDone'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('ai.exportChatFailed'))
  }
}

async function startRename(): Promise<void> {
  if (!aiStore.activeConversationId) {
    return
  }
  renaming.value = true
  renameDraft.value = aiStore.activeConversation?.conversationTitle?.trim() || ''
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select()
}

async function commitRename(): Promise<void> {
  if (!renaming.value || !aiStore.activeConversationId) {
    renaming.value = false
    return
  }
  const next = renameDraft.value.trim()
  renaming.value = false
  if (!next || next === aiStore.activeConversation?.conversationTitle?.trim()) {
    return
  }
  await aiStore.renameConversation(aiStore.activeConversationId, next)
}

function cancelRename(): void {
  renaming.value = false
}

function onTitleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    void commitRename()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelRename()
  }
}
</script>

<template>
  <header class="nm-ai-header">
    <div class="nm-ai-header__title-wrap">
      <input
        v-if="renaming"
        ref="titleInput"
        v-model="renameDraft"
        class="nm-ai-header__title-input"
        :aria-label="t('ai.renameChat')"
        @blur="commitRename"
        @keydown="onTitleKeydown"
      />
      <button
        v-else
        type="button"
        class="nm-ai-header__title"
        :title="t('ai.renameChat')"
        :disabled="!aiStore.activeConversationId"
        @dblclick="startRename"
      >
        {{ headerTitle }}
      </button>
      <button
        v-if="aiStore.activeConversationId && !renaming"
        type="button"
        class="nm-ai-header__icon-btn nm-ai-header__rename"
        :title="t('ai.renameChat')"
        :aria-label="t('ai.renameChat')"
        @click="startRename"
      >
        <RsIcon name="pencil" :size="13" />
      </button>
    </div>

    <div class="nm-ai-header__actions">
      <button
        type="button"
        class="nm-ai-header__icon-btn"
        :title="t('ai.exportChat')"
        :aria-label="t('ai.exportChat')"
        :disabled="!aiStore.messages.length"
        @click="onExport"
      >
        <RsIcon name="download" :size="15" />
      </button>
      <RsPopover v-model:open="historyOpen" side="bottom" align="end" :side-offset="6" width="lg">
        <button
          type="button"
          class="nm-ai-header__icon-btn"
          :class="{ 'nm-ai-header__icon-btn--active': historyOpen }"
          :title="t('ai.history')"
          :aria-label="t('ai.history')"
          :aria-expanded="historyOpen"
        >
          <RsIcon name="history" :size="15" />
        </button>
        <template #content>
          <div class="nm-ai-history">
            <div class="nm-ai-history__head">
              <span class="nm-ai-history__title">{{ t('ai.history') }}</span>
              <button type="button" class="nm-ai-history__new" @click="onNewChat">
                <RsIcon name="plus" :size="13" />
                {{ t('ai.newChat') }}
              </button>
            </div>

            <p v-if="!aiStore.conversations.length" class="nm-ai-history__empty">
              {{ t('ai.noHistory') }}
            </p>

            <div v-else class="nm-ai-history__list rs-native-scrollbar">
              <div
                v-for="c in aiStore.conversations"
                :key="c.conversationId"
                class="nm-ai-history__item"
                :class="{ 'nm-ai-history__item--active': c.conversationId === aiStore.activeConversationId }"
              >
                <button
                  type="button"
                  class="nm-ai-history__item-main"
                  @click="onHistorySelect(c.conversationId)"
                >
                  <span class="nm-ai-history__item-label">{{ conversationLabel(c.conversationTitle) }}</span>
                </button>
                <button
                  type="button"
                  class="nm-ai-history__item-del"
                  :title="t('ai.deleteChat')"
                  :aria-label="t('ai.deleteChat')"
                  @click="onHistoryDelete(c.conversationId, $event)"
                >
                  <RsIcon name="trash-2" :size="12" />
                </button>
              </div>
            </div>
          </div>
        </template>
      </RsPopover>

      <button
        type="button"
        class="nm-ai-header__icon-btn"
        :title="t('ai.newChat')"
        :aria-label="t('ai.newChat')"
        @click="aiStore.newConversation()"
      >
        <RsIcon name="square-pen" :size="15" />
      </button>

      <button
        type="button"
        class="nm-ai-header__icon-btn"
        :title="t('ai.close')"
        :aria-label="t('ai.close')"
        @click="shellStore.setAiPanelOpen(false)"
      >
        <RsIcon name="x" :size="15" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.nm-ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  box-sizing: border-box;
  height: var(--nm-tabbar-h);
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--rs-border-subtle);
  background: var(--nm-frame-bg);
}

.nm-ai-header__title-wrap {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.nm-ai-header__title {
  border: 0;
  padding: 0;
  margin: 0;
  background: transparent;
  font-size: var(--nm-font-body);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1;
  color: var(--rs-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  cursor: default;
  max-width: 100%;
}

.nm-ai-header__title:disabled {
  opacity: 0.7;
  cursor: default;
}

.nm-ai-header__title-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  margin: 0;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--rs-border-subtle);
  background: var(--nm-editor-bg);
  color: var(--rs-text);
  font-size: var(--nm-font-body);
  font-weight: 600;
}

.nm-ai-header__rename {
  opacity: 0.55;
}

.nm-ai-header__title-wrap:hover .nm-ai-header__rename {
  opacity: 1;
}

.nm-ai-header__actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}

.nm-ai-header__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--rs-text-secondary);
  cursor: pointer;
}

.nm-ai-header__icon-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
  color: var(--rs-text);
}

.nm-ai-header__icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.nm-ai-header__icon-btn--active {
  background: color-mix(in srgb, var(--rs-text) 10%, transparent);
  color: var(--rs-text);
}

.nm-ai-history {
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  /* 抵消 RsPopover 默认 0.75rem 内边距，列表与滚动条贴齐面板边缘 */
  width: calc(100% + 1.5rem);
  margin: -0.25rem -0.75rem;
  min-width: 0;
  max-width: none;
  padding: 0.25rem 0;
}

.nm-ai-history__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 0.75rem;
}

.nm-ai-history__title {
  font-size: var(--nm-font-caption);
  font-weight: 600;
  color: var(--rs-text-secondary);
}

.nm-ai-history__new {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  padding: 4px 8px;
  border-radius: 6px;
  background: transparent;
  color: var(--rs-text);
  font-size: var(--nm-font-caption);
  cursor: pointer;
}

.nm-ai-history__new:hover {
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
}

.nm-ai-history__empty {
  margin: 0;
  padding: 12px 0.75rem;
  font-size: var(--nm-font-caption);
  color: var(--rs-text-secondary);
}

.nm-ai-history__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 280px;
  overflow: auto;
  padding: 0 0 0 0.5rem;
}

.nm-ai-history__item {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 6px;
  margin-right: 0.25rem;
}

.nm-ai-history__item--active {
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
}

.nm-ai-history__item-main {
  flex: 1;
  min-width: 0;
  border: 0;
  padding: 7px 8px;
  background: transparent;
  color: var(--rs-text);
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
}

.nm-ai-history__item-main:hover {
  background: color-mix(in srgb, var(--rs-text) 6%, transparent);
}

.nm-ai-history__item-label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--nm-font-body);
}

.nm-ai-history__item-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--rs-text-secondary);
  cursor: pointer;
  opacity: 0;
}

.nm-ai-history__item:hover .nm-ai-history__item-del {
  opacity: 1;
}

.nm-ai-history__item-del:hover {
  color: var(--rs-danger, #ef4444);
  background: color-mix(in srgb, var(--rs-danger, #ef4444) 12%, transparent);
}
</style>
