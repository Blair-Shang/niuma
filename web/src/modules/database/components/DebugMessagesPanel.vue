<script setup lang="ts">
/**
 * 调试辅助「消息」侧栏：OK/ERR 着色日志列表。
 */
import { RsEmpty } from '@niuma/ui'
import { computed } from 'vue'
import {
  debugMessageBadge,
  parseDebugMessageLines,
} from '../types/debug-assist'

const props = defineProps<{
  messages: string[]
  empty: string
}>()

const items = computed(() => parseDebugMessageLines(props.messages))
</script>

<template>
  <div class="nm-debug-side">
    <RsEmpty
      v-if="items.length === 0"
      fill
      icon="message-square"
      :description="empty"
    />
    <ul v-else class="nm-debug-side__msg-list" role="log" aria-live="polite">
      <li
        v-for="item in items"
        :key="item.id"
        class="nm-debug-side__msg-item"
        :class="`nm-debug-side__msg-item--${item.tone}`"
      >
        <span class="nm-debug-side__msg-badge" aria-hidden="true">
          {{ debugMessageBadge(item.tone) }}
        </span>
        <pre class="nm-debug-side__msg-text">{{ item.text }}</pre>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.nm-debug-side {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-sm);
  padding: var(--rs-space-sm) var(--rs-space-md);
  overflow: auto;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--rs-surface-muted, var(--rs-bg-muted)) 55%, transparent) 0%,
      transparent 48px
    ),
    var(--rs-surface);
  font-size: var(--rs-font-size-sm);
  color: var(--rs-text);
}

.nm-debug-side__msg-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nm-debug-side__msg-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--rs-space-sm);
  align-items: start;
  padding: 8px 10px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm, 6px);
  background: color-mix(in srgb, var(--rs-surface) 88%, var(--rs-bg-muted, #f3f4f6));
  border-left-width: 3px;
  border-left-color: var(--rs-border);
}

.nm-debug-side__msg-item--ok {
  border-left-color: var(--rs-success, #16a34a);
}

.nm-debug-side__msg-item--err {
  border-left-color: var(--rs-danger, #dc2626);
  background: color-mix(in srgb, var(--rs-danger, #dc2626) 6%, var(--rs-surface));
}

.nm-debug-side__msg-item--info {
  border-left-color: var(--rs-info, #2563eb);
}

.nm-debug-side__msg-badge {
  flex-shrink: 0;
  min-width: 2rem;
  margin-top: 1px;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1.4;
  text-align: center;
  color: var(--rs-text-muted);
  background: color-mix(in srgb, var(--rs-border-subtle) 70%, transparent);
}

.nm-debug-side__msg-item--ok .nm-debug-side__msg-badge {
  color: var(--rs-success, #16a34a);
  background: color-mix(in srgb, var(--rs-success, #16a34a) 12%, transparent);
}

.nm-debug-side__msg-item--err .nm-debug-side__msg-badge {
  color: var(--rs-danger, #dc2626);
  background: color-mix(in srgb, var(--rs-danger, #dc2626) 12%, transparent);
}

.nm-debug-side__msg-text {
  margin: 0;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--rs-font-mono, ui-monospace, monospace);
  font-size: var(--rs-font-size-xs);
  line-height: 1.55;
  color: var(--rs-text);
}
</style>
