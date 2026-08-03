<script setup lang="ts">
/**
 * 表设计 SQL 预览：锚定工具栏按钮的 RsPopover + RsCodeBlock（CodeMirror）。
 * 仅展示与复制，不在此执行创建/应用或跳转查询。
 */
import { RsButton, RsCodeBlock, RsLoading, RsPopover } from '@niuma/ui'
import { computed } from 'vue'

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(
  defineProps<{
    /** 为空则不渲染外层标题栏（RsCodeBlock 自带 lang/复制） */
    title?: string
    sql: string[]
    loading?: boolean
    copyLabel?: string
    emptyLabel?: string
  }>(),
  {
    title: '',
    loading: false,
    copyLabel: '',
    emptyLabel: '',
  },
)

const emit = defineEmits<{
  copy: []
}>()

const code = computed(() => {
  const body = (props.sql ?? []).join(';\n\n').trim()
  if (!body) return ''
  return body.endsWith(';') ? body : `${body};`
})

const showHead = computed(() => Boolean(props.title || props.copyLabel))
</script>

<template>
  <RsPopover v-model:open="open" side="bottom" align="end" width="auto" :side-offset="6">
    <slot />
    <template #content>
      <div class="nm-table-design-preview">
        <div v-if="showHead" class="nm-table-design-preview__head">
          <span v-if="title" class="nm-table-design-preview__title">{{ title }}</span>
          <div class="nm-table-design-preview__actions">
            <RsButton
              v-if="copyLabel"
              size="sm"
              variant="ghost"
              icon="copy"
              :disabled="loading || !code"
              @click="emit('copy')"
            >
              {{ copyLabel }}
            </RsButton>
          </div>
        </div>
        <div class="nm-table-design-preview__body">
          <RsLoading v-if="loading" class="nm-table-design-preview__loading" />
          <RsCodeBlock
            v-else-if="code"
            :code="code"
            lang="sql"
            class="nm-table-design-preview__code"
          />
          <p v-else-if="emptyLabel" class="nm-table-design-preview__empty">{{ emptyLabel }}</p>
        </div>
      </div>
    </template>
  </RsPopover>
</template>

<style scoped>
.nm-table-design-preview {
  width: min(640px, 80vw);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nm-table-design-preview__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}
.nm-table-design-preview__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--rs-fg-muted);
}
.nm-table-design-preview__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.nm-table-design-preview__body {
  min-height: 200px;
  max-height: min(50vh, 420px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.nm-table-design-preview__loading {
  flex: 1;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nm-table-design-preview__code {
  flex: 1;
  min-height: 200px;
  border-radius: var(--rs-radius-sm, 4px);
  overflow: auto;
}
.nm-table-design-preview__empty {
  flex: 1;
  min-height: 200px;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--rs-fg-muted);
}
</style>
