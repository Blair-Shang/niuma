<script setup lang="ts">
/**
 * DDL 只读预览外壳：身份条 · 复制/刷新 · 加载/空态 · 编辑器区。
 * 方言侧注入 labels 与作用域信息，通过默认插槽挂 Monaco。
 */
import { RsButton, RsEmpty, RsIcon, RsLoading } from '@niuma/ui'
import type { DdlShellLabels } from '../types/ddl-shell'

withDefaults(
  defineProps<{
    labels: DdlShellLabels
    sessionLabel?: string
    scopeLabel?: string
    /** 对象类型徽章（TABLE / VIEW …） */
    typeLabel?: string
    icon?: string
    loading?: boolean
    /** 作用域是否就绪（库.schema.表等） */
    hasScope?: boolean
    /** 是否已有 DDL 文本 */
    hasDdl?: boolean
    canCopy?: boolean
  }>(),
  {
    sessionLabel: '',
    scopeLabel: '',
    typeLabel: '',
    icon: 'file-code',
    loading: false,
    hasScope: false,
    hasDdl: false,
    canCopy: false,
  },
)

const emit = defineEmits<{
  copy: []
  refresh: []
}>()
</script>

<template>
  <div class="nm-ddl-shell">
    <header class="nm-ddl-shell__chrome">
      <div class="nm-ddl-shell__identity" :title="sessionLabel">
        <RsIcon :name="icon" :size="16" />
        <span class="nm-ddl-shell__session">{{ sessionLabel || 'SQL' }}</span>
        <span v-if="scopeLabel" class="nm-ddl-shell__scope">{{ scopeLabel }}</span>
        <span v-if="typeLabel" class="nm-ddl-shell__type">{{ typeLabel }}</span>
      </div>
      <div class="nm-ddl-shell__actions">
        <slot name="toolbar-start" />
        <RsButton
          variant="ghost"
          size="sm"
          icon="copy"
          :disabled="!canCopy"
          @click="emit('copy')"
        >
          {{ labels.copy }}
        </RsButton>
        <RsButton
          variant="ghost"
          size="sm"
          icon="refresh-cw"
          :loading="loading"
          @click="emit('refresh')"
        >
          {{ labels.refresh }}
        </RsButton>
        <slot name="toolbar-end" />
      </div>
    </header>

    <RsLoading v-if="loading && !hasDdl" block class="nm-ddl-shell__loading" />
    <RsEmpty
      v-else-if="!hasScope"
      fill
      icon="file-code"
      :description="labels.needScope"
      class="nm-ddl-shell__empty"
    />
    <RsEmpty
      v-else-if="!hasDdl"
      fill
      icon="file-code"
      :description="labels.empty"
      class="nm-ddl-shell__empty"
    />
    <div v-else class="nm-ddl-shell__editor">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.nm-ddl-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.nm-ddl-shell__chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
}

.nm-ddl-shell__identity {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-ddl-shell__session {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-ddl-shell__scope,
.nm-ddl-shell__type {
  color: var(--rs-fg-muted);
  font-weight: 400;
}

.nm-ddl-shell__type {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: var(--rs-font-size-xs);
}

.nm-ddl-shell__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-ddl-shell__loading,
.nm-ddl-shell__empty {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nm-ddl-shell__editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-ddl-shell__editor :deep(.rs-monaco) {
  border-radius: 0;
  border: none;
}
</style>
