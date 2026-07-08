<script setup lang="ts">
/**
 * 全局 AI 助手面板。
 *
 * AI 是**跨模块通用能力**，不隶属任何单一领域模块，因此不进入 Activity Bar / 侧栏，
 * 而是由顶栏机器人按钮唤起、以右侧常驻面板形式与当前模块工作区并存——
 * 在任意模块（SSH / 数据库 / API…）下都可随时调用。
 *
 * 当前为占位视图；后续接入对话与 Tool 调用（MCP）后在此渲染会话内容。
 */
import { RsIcon } from '@niuma/ui'
import { useI18n } from 'vue-i18n'
import { useShellStore } from '@/stores/shell'

const { t } = useI18n()
const shellStore = useShellStore()
</script>

<template>
  <aside class="nm-ai-panel" :aria-label="t('ai.title')">
    <header class="nm-ai-panel__header">
      <span class="nm-ai-panel__brand">
        <RsIcon name="bot" :size="16" />
        <span class="nm-ai-panel__title">{{ t('ai.title') }}</span>
      </span>
      <button
        type="button"
        class="nm-ai-panel__close"
        :title="t('ai.close')"
        :aria-label="t('ai.close')"
        @click="shellStore.setAiPanelOpen(false)"
      >
        <RsIcon name="x" :size="15" />
      </button>
    </header>

    <div class="nm-ai-panel__body">
      <RsIcon name="bot" :size="40" class="nm-ai-panel__body-icon" />
      <p class="nm-section-title">{{ t('ai.title') }}</p>
      <p class="nm-section-desc">{{ t('ai.hint') }}</p>
      <p class="nm-section-desc nm-ai-panel__soon">{{ t('ai.bodyDesc') }}</p>
    </div>
  </aside>
</template>

<style scoped>
.nm-ai-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--nm-sidebar-bg);
}

.nm-ai-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--nm-tabbar-h);
  flex-shrink: 0;
  padding: 0 var(--rs-space-xs) 0 var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
}

.nm-ai-panel__brand {
  display: inline-flex;
  align-items: center;
  gap: var(--rs-space-xs);
  color: var(--rs-text);
  min-width: 0;
}

.nm-ai-panel__title {
  font-size: var(--nm-font-body);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nm-ai-panel__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--nm-topbar-control-h);
  height: var(--nm-topbar-control-h);
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: var(--rs-radius-sm);
  background: transparent;
  color: var(--rs-muted);
  line-height: 0;
  cursor: pointer;
  transition:
    background var(--rs-transition-fast),
    color var(--rs-transition-fast);
}

.nm-ai-panel__close:hover {
  background: color-mix(in srgb, var(--rs-text) 8%, transparent);
  color: var(--rs-text);
}

.nm-ai-panel__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rs-space-xs);
  min-height: 0;
  padding: var(--rs-space-lg);
  text-align: center;
  color: var(--rs-muted);
  overflow: auto;
}

.nm-ai-panel__body-icon {
  margin-bottom: var(--rs-space-sm);
  color: var(--rs-placeholder);
}

.nm-ai-panel__soon {
  color: var(--rs-placeholder);
}
</style>
