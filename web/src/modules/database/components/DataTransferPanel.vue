<script setup lang="ts">
/**
 * 数据传输面板主体：整块内容可滚动（对象表等局部固定高度），底部为进度日志。
 * 表单内容由方言通过默认 slot / #form 注入。
 */
import { nextTick, ref, watch } from 'vue'
import type { DataTransferLogLine, DataTransferPanelLabels } from '../types/data-transfer'

const props = defineProps<{
  labels: DataTransferPanelLabels
  lines: DataTransferLogLine[]
  busy?: boolean
}>()

const logEl = ref<HTMLElement | null>(null)

async function scrollLogToBottom(): Promise<void> {
  await nextTick()
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
}

watch(
  () => props.lines,
  () => {
    void scrollLogToBottom()
  },
  { deep: true },
)

defineExpose({ scrollLogToBottom })
</script>

<template>
  <div class="nm-dt">
    <slot />
    <p v-if="$slots.note" class="nm-dt__note">
      <slot name="note" />
    </p>

    <section class="nm-dt__log-panel">
      <div class="nm-dt__log-head">
        <span>{{ labels.progressLog }}</span>
        <span v-if="busy" class="nm-dt__log-running">{{ labels.running }}</span>
      </div>
      <div ref="logEl" class="nm-dt__log" role="log" aria-live="polite">
        <p v-if="lines.length === 0" class="nm-dt__log-empty">{{ labels.progressEmpty }}</p>
        <div
          v-for="(line, idx) in lines"
          :key="`${line.at}-${idx}`"
          class="nm-dt__log-line"
          :class="{
            'is-done': line.ok === true,
            'is-failed':
              line.ok === false ||
              line.message.startsWith('error ') ||
              line.message.startsWith('completed with'),
            'is-canceled': line.phase === 'canceled',
          }"
        >
          <span
            v-if="line.ok !== undefined || line.phase === 'canceled'"
            class="nm-dt__log-phase"
          >{{ line.phase }}</span>
          <span class="nm-dt__log-msg">{{ line.message }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nm-dt {
  display: flex;
  flex-direction: column;
  gap: var(--rs-space-md, 12px);
  padding: 14px 16px;
  color: var(--rs-text);
  box-sizing: border-box;
}

.nm-dt__note {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--rs-radius-sm, 6px);
  border: 1px dashed var(--rs-border-subtle);
  background: color-mix(in srgb, var(--rs-surface) 88%, var(--rs-muted) 12%);
  font-size: var(--rs-font-size-xs, 12px);
  line-height: 1.45;
  color: var(--rs-muted);
  flex: 0 0 auto;
}

.nm-dt__log-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 0 auto;
  min-height: 0;
}

.nm-dt__log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--rs-font-size-xs, 12px);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--rs-muted);
}

.nm-dt__log-running {
  color: var(--rs-accent, var(--rs-primary));
  font-weight: 500;
}

.nm-dt__log {
  max-height: 160px;
  min-height: 72px;
  overflow-y: auto;
  padding: 8px 10px;
  border-radius: var(--rs-radius-sm, 6px);
  border: 1px solid var(--rs-border-subtle);
  background: var(--rs-bg-code, var(--rs-surface-elevated, #f8f9fa));
  font-family: var(--rs-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
}

.nm-dt__log-empty {
  margin: 0;
  color: var(--rs-muted);
}

.nm-dt__log-line {
  display: flex;
  gap: 8px;
  line-height: 1.5;
}

.nm-dt__log-phase {
  flex: 0 0 auto;
  min-width: 56px;
  font-weight: 600;
}

.nm-dt__log-msg {
  word-break: break-all;
}

.nm-dt__log-line.is-done {
  color: var(--rs-fg-success, #16a34a);
}

.nm-dt__log-line.is-failed {
  color: var(--rs-fg-danger, #dc2626);
}

.nm-dt__log-line.is-canceled {
  color: var(--rs-muted);
}
</style>
