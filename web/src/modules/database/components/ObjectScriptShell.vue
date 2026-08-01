<script setup lang="ts">
/**
 * 对象脚本外壳：视图 / 过程 / 函数等新建与编辑共用布局。
 * 方言侧注入 labels、身份信息与右键菜单；通过 #editor 挂 Monaco。
 */
import {
  RsButton,
  RsContextMenu,
  RsEmpty,
  RsIcon,
  type RsContextMenuItem,
} from '@niuma/ui'
import type {
  ObjectScriptMessageTone,
  ObjectScriptMode,
  ObjectScriptShellLabels,
} from '../types/object-script'

withDefaults(
  defineProps<{
    labels: ObjectScriptShellLabels
    /** 连接/会话展示名 */
    sessionLabel?: string
    /** 作用域，如 database.object（对象名建议放 Tab，避免与编辑器改名不一致） */
    scopeLabel?: string
    /** 类型徽章：新建 / 视图 / 过程 … */
    typeLabel?: string
    icon?: string
    mode?: ObjectScriptMode
    loading?: boolean
    saving?: boolean
    canApply?: boolean
    canCopy?: boolean
    canFormat?: boolean
    showRefresh?: boolean
    /** 是否已具备编辑对象（否则 Empty） */
    hasObject?: boolean
    message?: string | null
    messageTone?: ObjectScriptMessageTone | null
    /** 编辑区右键菜单（对齐查询面板；含 AI） */
    contextMenuItems?: RsContextMenuItem[]
  }>(),
  {
    sessionLabel: '',
    scopeLabel: '',
    typeLabel: '',
    icon: 'file-code',
    mode: 'alter',
    loading: false,
    saving: false,
    canApply: true,
    canCopy: true,
    canFormat: true,
    showRefresh: true,
    hasObject: true,
    message: null,
    messageTone: null,
    contextMenuItems: () => [],
  },
)

const emit = defineEmits<{
  format: []
  copy: []
  refresh: []
  apply: []
  contextSelect: [key: string]
}>()
</script>

<template>
  <div class="nm-object-script">
    <header class="nm-object-script__chrome">
      <div class="nm-object-script__identity" :title="sessionLabel">
        <RsIcon :name="icon" :size="16" />
        <span class="nm-object-script__session">{{ sessionLabel || 'SQL' }}</span>
        <span v-if="scopeLabel" class="nm-object-script__scope">{{ scopeLabel }}</span>
        <span v-if="typeLabel" class="nm-object-script__type">{{ typeLabel }}</span>
      </div>
      <div class="nm-object-script__actions">
        <slot name="toolbar-start" />
        <RsButton
          variant="ghost"
          size="sm"
          icon="braces"
          :disabled="!canFormat || saving || loading"
          :tooltip="labels.formatTooltip"
          @click="emit('format')"
        >
          {{ labels.format }}
        </RsButton>
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
          v-if="showRefresh && mode !== 'create'"
          variant="ghost"
          size="sm"
          icon="refresh-cw"
          :loading="loading"
          @click="emit('refresh')"
        >
          {{ labels.refresh }}
        </RsButton>
        <RsButton
          variant="primary"
          size="sm"
          icon="play"
          :loading="saving"
          :disabled="!canApply"
          @click="emit('apply')"
        >
          {{ mode === 'create' ? labels.create : labels.save }}
        </RsButton>
        <slot name="toolbar-end" />
      </div>
    </header>

    <RsEmpty
      v-if="!hasObject"
      icon="file-code"
      :description="labels.needObject"
      class="nm-object-script__empty"
    />
    <RsContextMenu
      v-else
      class="nm-object-script__menu"
      :items="contextMenuItems"
      @select="emit('contextSelect', $event)"
    >
      <div class="nm-object-script__body">
        <div class="nm-object-script__editor">
          <slot name="editor" />
        </div>
        <footer
          v-if="message"
          class="nm-object-script__msg"
          :class="{
            'nm-object-script__msg--error': messageTone === 'error',
            'nm-object-script__msg--ok': messageTone === 'ok',
          }"
        >
          {{ message }}
        </footer>
      </div>
    </RsContextMenu>
  </div>
</template>

<style scoped>
.nm-object-script {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-radius: 0;
  overflow: hidden;
}

.nm-object-script__chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rs-space-sm);
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--rs-border-subtle);
  flex-shrink: 0;
  border-radius: 0;
}

.nm-object-script__identity {
  display: flex;
  align-items: center;
  gap: var(--rs-space-sm);
  min-width: 0;
  font-size: var(--rs-font-size-sm);
  font-weight: 600;
}

.nm-object-script__session {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-object-script__scope,
.nm-object-script__type {
  color: var(--rs-fg-muted);
  font-weight: 400;
}

.nm-object-script__type {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: var(--rs-font-size-xs);
}

.nm-object-script__actions {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  flex-shrink: 0;
}

.nm-object-script__empty {
  flex: 1;
}

.nm-object-script__menu {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.nm-object-script__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.nm-object-script__editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 0;
}

.nm-object-script__editor :deep(.rs-monaco) {
  border-radius: 0;
  border: none;
}

.nm-object-script__msg {
  flex-shrink: 0;
  padding: 0.35rem 0.75rem;
  font-size: var(--rs-font-size-xs);
  border-top: 1px solid var(--rs-border-subtle);
  border-radius: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.nm-object-script__msg--error {
  color: var(--rs-danger);
  background: color-mix(in srgb, var(--rs-danger) 8%, var(--rs-surface));
}

.nm-object-script__msg--ok {
  color: var(--rs-success, var(--rs-fg-muted));
  background: color-mix(in srgb, var(--rs-success, #16a34a) 8%, var(--rs-surface));
}
</style>
