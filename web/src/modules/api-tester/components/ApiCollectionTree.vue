<script setup lang="ts">
import { RsInput, RsTree, type RsTreeNode } from '@niuma/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ApiFolder } from '../types'
import ApiMethodBadge from './ApiMethodBadge.vue'

export type ApiTreeCtx =
  | { kind: 'folder'; folderId: string }
  | { kind: 'request'; folderId: string; requestId: string }

const props = withDefaults(
  defineProps<{
    folders: ApiFolder[]
    hideFilter?: boolean
  }>(),
  { hideFilter: false },
)

const filter = defineModel<string>('filter', { default: '' })
const selected = defineModel<string>({ default: '' })

const emit = defineEmits<{
  select: [id: string]
  'row-context': [target: ApiTreeCtx]
}>()

const { t } = useI18n()

const nodes = computed<RsTreeNode[]>(() =>
  props.folders.map((folder) => ({
    key: `folder:${folder.id}`,
    label: folder.name,
    icon: 'folder',
    nodeKind: 'folder',
    folderId: folder.id,
    children: folder.requests.map((req) => ({
      key: req.id,
      label: req.name,
      method: req.method,
      isLeaf: true,
      nodeKind: 'request',
      folderId: folder.id,
      requestId: req.id,
    })),
  })),
)

function asCtx(node: RsTreeNode): ApiTreeCtx | null {
  const folderId = typeof node.folderId === 'string' ? node.folderId : ''
  if (!folderId) return null
  if (node.nodeKind === 'request' && typeof node.requestId === 'string') {
    return { kind: 'request', folderId, requestId: node.requestId }
  }
  if (node.nodeKind === 'folder') {
    return { kind: 'folder', folderId }
  }
  return null
}

function onSelect(key: string | string[]): void {
  const id = Array.isArray(key) ? key[0] : key
  if (!id || id.startsWith('folder:')) return
  selected.value = id
  emit('select', id)
}

function onRowContext(node: RsTreeNode): void {
  const target = asCtx(node)
  if (target) emit('row-context', target)
}
</script>

<template>
  <div class="nm-api-tree">
    <RsInput
      v-if="!hideFilter"
      v-model="filter"
      size="sm"
      :placeholder="t('modules.api.search')"
      radius="sm"
    />
    <RsTree
      :model-value="selected"
      :nodes="nodes"
      :filter="filter"
      size="sm"
      block-node
      default-expand-all
      highlight
      height="100%"
      @update:model-value="onSelect"
    >
      <template #title="{ node, label }">
        <span class="nm-api-tree__title" @contextmenu="onRowContext(node)">
          <ApiMethodBadge v-if="typeof node.method === 'string'" :method="String(node.method)" compact />
          <span class="nm-api-tree__label">{{ label }}</span>
        </span>
      </template>
    </RsTree>
  </div>
</template>

<style scoped>
.nm-api-tree {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  height: 100%;
  min-height: 0;
}

.nm-api-tree :deep(.rs-tree) {
  flex: 1;
  min-height: 0;
}

.nm-api-tree__title {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  width: 100%;
}

.nm-api-tree__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
