<script setup lang="ts">
/**
 * 集合树薄壳。对齐运维 RsTree：virtual / show-line / 拖拽 / 受控展开。
 * 节点与拖放规则在 collection-tree.ts，这里只渲染行。
 */
import { RsIcon, RsTree, type RsTreeDropPosition, type RsTreeNode } from '@niuma/ui'
import { computed } from 'vue'
import {
  allowApiTreeDrop,
  apiCollectionSearchMatch,
  apiTreeCtxOf,
  buildCollectionTreeNodes,
  isApiFolderNode,
  isApiRequestNode,
  type ApiTreeCtx,
  type ApiTreeNode,
} from '../utils/collection-tree'
import type { ApiFolder } from '../types'
import ApiMethodBadge from './ApiMethodBadge.vue'

const props = defineProps<{
  folders: ApiFolder[]
  filter: string
}>()

const selected = defineModel<string>({ default: '' })
const expandedKeys = defineModel<string[]>('expandedKeys', { default: () => [] })

const emit = defineEmits<{
  select: [id: string]
  'row-context': [target: ApiTreeCtx]
  drop: [dragKey: string, dropKey: string, position: RsTreeDropPosition]
}>()

const nodes = computed(() => buildCollectionTreeNodes(props.folders))
const selectedKey = computed(() => (selected.value ? `req:${selected.value}` : ''))

function onSelect(key: string | string[]): void {
  const raw = Array.isArray(key) ? key[0] : key
  if (!raw || raw.startsWith('folder:')) return
  const id = raw.startsWith('req:') ? raw.slice(4) : raw
  selected.value = id
  emit('select', id)
}

function onNodeClick(_node: RsTreeNode, key: string): void {
  if (key.startsWith('req:')) onSelect(key)
}

function onRowContext(node: RsTreeNode): void {
  const target = apiTreeCtxOf(node)
  if (target) emit('row-context', target)
}

function allowDrop(dragKey: string, dropKey: string, position: RsTreeDropPosition): boolean {
  return allowApiTreeDrop(props.folders, dragKey, dropKey, position)
}

function treeSearchMatch(node: RsTreeNode, keyword: string): boolean {
  return apiCollectionSearchMatch(node as ApiTreeNode, keyword)
}

function isFolderOpen(node: RsTreeNode): boolean {
  return Boolean(node.key && expandedKeys.value.includes(node.key))
}

function asFolder(node: RsTreeNode) {
  return isApiFolderNode(node) ? node : null
}

function asRequest(node: RsTreeNode) {
  return isApiRequestNode(node) ? node : null
}
</script>

<template>
  <div class="nm-api-tree">
    <RsTree
      :model-value="selectedKey"
      :nodes="nodes"
      :filter="filter"
      :filter-node="treeSearchMatch"
      v-model:expanded-keys="expandedKeys"
      virtual
      show-line
      block-node
      highlight
      draggable
      drag-trigger="row"
      :allow-drop="allowDrop"
      height="100%"
      size="sm"
      class="nm-api-tree__tree"
      @update:model-value="onSelect"
      @node-click="onNodeClick"
      @node-dblclick="onNodeClick"
      @node-drop="(dragKey, dropKey, position) => emit('drop', dragKey, dropKey, position)"
    >
      <template #title="{ node }">
        <div
          v-if="asFolder(node)"
          class="nm-api-tree__row"
          @contextmenu="onRowContext(node)"
        >
          <RsIcon
            :name="isFolderOpen(node) ? 'folder-open' : 'folder'"
            :size="14"
            class="nm-api-tree__icon nm-api-tree__icon--folder"
          />
          <span class="nm-api-tree__label nm-api-tree__label--folder">{{ node.label }}</span>
          <span v-if="asFolder(node)!._count" class="nm-api-tree__badge">{{ asFolder(node)!._count }}</span>
        </div>
        <div
          v-else-if="asRequest(node)"
          class="nm-api-tree__row"
          :title="asRequest(node)!._url"
          @contextmenu="onRowContext(node)"
        >
          <ApiMethodBadge :method="asRequest(node)!._method" compact />
          <span class="nm-api-tree__label">{{ node.label }}</span>
        </div>
      </template>
    </RsTree>
  </div>
</template>

<style scoped>
.nm-api-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.nm-api-tree__tree {
  flex: 1;
  min-height: 0;
  padding: var(--rs-space-xs) 0;
}

.nm-api-tree__tree :deep(.rs-tree__empty) {
  padding: var(--rs-space-md) var(--rs-space-sm);
}

.nm-api-tree__row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  width: 100%;
  min-width: 0;
}

.nm-api-tree__icon {
  flex-shrink: 0;
}

.nm-api-tree__icon--folder {
  color: var(--rs-warning);
}

.nm-api-tree__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-api-tree__label--folder {
  font-weight: 500;
}

.nm-api-tree__badge {
  flex-shrink: 0;
  font-size: var(--rs-font-size-xs);
  font-variant-numeric: tabular-nums;
  color: var(--rs-muted);
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--rs-surface-subtle);
}
</style>
