<script setup lang="ts">
/**
 * 对象脚本外壳：视图 / 过程 / 函数等新建与编辑共用布局。
 * 顶栏与 SqlQueryToolbar 同一套 IDE 密度；方言侧注入 labels、身份与右键菜单。
 */
import { computed } from 'vue'
import {
  RsButton,
  RsContextMenu,
  RsEmpty,
  type RsContextMenuItem,
} from '@niuma/ui'
import SqlQueryIdentity from './SqlQueryIdentity.vue'
import { sqlIdeToolbarIconButton } from '../types/sql-ide-toolbar'
import type {
  ObjectScriptMessageTone,
  ObjectScriptMode,
  ObjectScriptShellLabels,
} from '../types/object-script'

const props = withDefaults(
  defineProps<{
    labels: ObjectScriptShellLabels
    /** 连接/会话展示名（仅 tooltip；Tab 已含连接名） */
    sessionLabel?: string
    /** 作用域，如 database.object */
    scopeLabel?: string
    /** 类型：新建 / 视图 / 过程 … */
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

const busy = computed(() => props.saving || props.loading)

const applyLabel = computed(() =>
  props.mode === 'create' ? props.labels.create : props.labels.save,
)

const identityText = computed(() => {
  if (props.mode === 'create') {
    return props.typeLabel || props.labels.modeCreate
  }
  return props.scopeLabel || props.typeLabel
})

const identityTitle = computed(() =>
  [props.sessionLabel, props.scopeLabel, props.typeLabel].filter(Boolean).join(' · '),
)

const showReload = computed(() => props.showRefresh && props.mode !== 'create')
</script>

<template>
  <div class="nm-object-script">
    <header class="nm-sql-tb" role="toolbar" :aria-label="applyLabel">
      <div class="nm-sql-tb__lead">
        <div class="nm-sql-tb__scope">
          <SqlQueryIdentity :icon="icon" :title="identityTitle">
            {{ identityText }}
          </SqlQueryIdentity>
        </div>

        <span class="nm-sql-tb__sep" aria-hidden="true" />

        <RsButton
          v-bind="sqlIdeToolbarIconButton"
          icon="play"
          tone="success"
          :disabled="!canApply || busy"
          :tooltip="applyLabel"
          @click="emit('apply')"
        />

        <span class="nm-sql-tb__sep" aria-hidden="true" />

        <RsButton
          v-bind="sqlIdeToolbarIconButton"
          icon="align-left"
          :disabled="!canFormat || busy"
          :tooltip="labels.formatTooltip"
          @click="emit('format')"
        />
        <RsButton
          v-bind="sqlIdeToolbarIconButton"
          icon="copy"
          :disabled="!canCopy || busy"
          :tooltip="labels.copy"
          @click="emit('copy')"
        />

        <slot name="toolbar-start" />
      </div>

      <div class="nm-sql-tb__trail">
        <RsButton
          v-if="showReload"
          v-bind="sqlIdeToolbarIconButton"
          icon="refresh-cw"
          :disabled="busy"
          :tooltip="labels.refresh"
          @click="emit('refresh')"
        />
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

<style scoped src="./sql-ide-toolbar.css"></style>
<style scoped>
.nm-object-script {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-radius: 0;
  overflow: hidden;
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
