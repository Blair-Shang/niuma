<script setup lang="ts">
/**
 * 调试辅助「说明」侧栏：会话开关 + 编号提示列表。
 */
import { RsCheckbox } from '@niuma/ui'

withDefaults(
  defineProps<{
    /** 调试会话开关文案 */
    enableLabel: string
    tips: string[]
    enableDisabled?: boolean
    /** 是否显示会话开关（默认 true） */
    showEnableOption?: boolean
  }>(),
  {
    enableDisabled: false,
    showEnableOption: true,
  },
)

const enableSession = defineModel<boolean>('enableSession', { default: true })
</script>

<template>
  <div class="nm-debug-side nm-debug-side--help">
    <div v-if="showEnableOption" class="nm-debug-side__help-option">
      <RsCheckbox v-model="enableSession" size="sm" :disabled="enableDisabled">
        {{ enableLabel }}
      </RsCheckbox>
    </div>
    <ol v-if="tips.length > 0" class="nm-debug-side__tips">
      <li v-for="(tip, i) in tips" :key="i" class="nm-debug-side__tip">
        <span class="nm-debug-side__tip-index" aria-hidden="true">{{ i + 1 }}</span>
        <span class="nm-debug-side__tip-text">{{ tip }}</span>
      </li>
    </ol>
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

.nm-debug-side--help {
  gap: var(--rs-space-md);
}

.nm-debug-side__help-option {
  flex-shrink: 0;
  padding: 10px 12px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm, 6px);
  background: color-mix(in srgb, var(--rs-surface) 92%, var(--rs-bg-muted, #f3f4f6));
}

.nm-debug-side__tips {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nm-debug-side__tip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--rs-space-sm);
  align-items: start;
  padding: 10px 12px;
  border: 1px solid var(--rs-border-subtle);
  border-radius: var(--rs-radius-sm, 6px);
  background: var(--rs-surface);
  line-height: 1.55;
}

.nm-debug-side__tip-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  height: 1.35rem;
  margin-top: 1px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--rs-text-muted);
  background: color-mix(in srgb, var(--rs-border-subtle) 85%, transparent);
}

.nm-debug-side__tip-text {
  min-width: 0;
  color: var(--rs-text-secondary, var(--rs-text-muted));
}
</style>
