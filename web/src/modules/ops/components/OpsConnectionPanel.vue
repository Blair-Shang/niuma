<script setup lang="ts">
/**
 * 运维连接面板 — 薄壳，仅负责组合：搜索 + 连接树 + 表单对话框。
 *
 * 扩展指南（新增 Redis / MongoDB / 数据库等连接类型）：
 *   1. 在 types.ts 的 CONN_KIND_DEFS 追加一条 kind 定义
 *   2. 在 connectionApi 中添加对应接口
 *   3. 在 ConnectionFormDialog.vue 增加该 kind 的表单字段
 *   本文件无需任何修改。
 */
import { RsContextMenu, RsIcon, RsInput, RsLoading, RsTree, useRsToast } from '@niuma/ui'
import type { RsContextMenuItem, RsTreeDropPosition, RsTreeNode } from '@niuma/ui'
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, toRefs, watch, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { getModuleById } from '@/extensions/registry/extension-registry'
import type { ModuleCategory } from '@/extensions/types/module'
import { useRoute, useRouter } from 'vue-router'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import { useConnFolders, type ConnFolder } from '@/modules/ops/composables/useConnFolders'
import {
  allowDrop,
  collectExpandableConnKeys,
  connTreeSearchMatch,
  filterConnTreeByCategory,
  handleConnTreeDrop,
  useConnTree,
  type ConnFolderNode,
  type ConnLeafNode,
  type ConnTreeNode,
} from '@/modules/ops/composables/useConnTree'
import { CONN_KIND_DEFS, kindIcon, profileAccentColor, type ConnItem } from '@/modules/ops/types'

const props = withDefaults(
  defineProps<{
    category?: ModuleCategory
  }>(),
  {
    category: 'explorer',
  },
)

const { t } = useI18n()
const toast = useRsToast()
const route = useRoute()
const router = useRouter()
const { connect } = useConnectionNavigation()

/* ── 连接 CRUD ── */
const cx = useConnectionProfiles()
const {
  searchQuery,
  loading,
  allProfiles,
  dlgOpen,
  dlgMode,
  dlgKind,
  dlgProfile,
  form,
  formError,
  saving,
  deleting,
  testing,
  testMessage,
} = toRefs(cx)

/* ── 文件夹管理 ── */
const cf = useConnFolders()

const categoryRef = toRef(props, 'category')

/* ── 搜索防抖：输入框立即响应，树过滤延迟 250ms 触发，降低万级数据下的重算频率 ── */
const treeFilter = ref('')
let _searchTimer: ReturnType<typeof setTimeout> | null = null

watch(searchQuery, (v) => {
  if (_searchTimer !== null) clearTimeout(_searchTimer)
  _searchTimer = setTimeout(() => { treeFilter.value = v }, 250)
})

onUnmounted(() => {
  if (_searchTimer !== null) clearTimeout(_searchTimer)
})

/* ── 全量连接树 → 分类级联过滤 → 搜索级联过滤（RsTree） ── */
const { nodes: fullTreeNodes } = useConnTree(allProfiles, cf.folders, cf.rootOrder, cf.syncRootOrder)

const categoryTreeNodes = computed(() =>
  filterConnTreeByCategory(fullTreeNodes.value, categoryRef.value),
)

const treeExpandedKeys = ref<string[]>([])

// 仅在分类切换或文件夹结构变化时重算展开键，避免每次连接数据变更都 deep-walk 整棵树
watch(
  [categoryRef, cf.folders],
  () => {
    const expandable = collectExpandableConnKeys(categoryTreeNodes.value)
    const valid = new Set(expandable)
    const kept = treeExpandedKeys.value.filter((k) => valid.has(k))
    treeExpandedKeys.value = kept.length > 0 ? kept : expandable
  },
  { immediate: true },
)

function treeSearchMatch(node: RsTreeNode, keyword: string): boolean {
  return connTreeSearchMatch(node as ConnTreeNode, keyword)
}

function allowTreeDrop(dragKey: string, dropKey: string, position: RsTreeDropPosition): boolean {
  return allowDrop(dragKey, dropKey, position, cf.folders.value)
}

/* ── 根区域右键菜单（暂不按 Activity 分类过滤，显示全部新建项） ── */
const rootCtxItems = computed<RsContextMenuItem[]>(() => [
  ...CONN_KIND_DEFS.map((k) => ({
    key: `new-${k.kind}`,
    label: t(k.kind === 'ssh' ? 'opsNav.addSsh' : 'opsNav.addFtp'),
    icon: k.icon,
  })),
  { key: 'open-module:database', label: t('opsNav.addDatabase'), icon: 'database' },
  { key: 'open-module:api', label: t('opsNav.addApi'), icon: 'send' },
  { key: 'sep-folder', label: '', separator: true },
  { key: 'new-folder', label: t('opsNav.addFolder'), icon: 'folder-plus' },
])

function onRootCtx(key: string): void {
  const hit = CONN_KIND_DEFS.find((k) => key === `new-${k.kind}`)
  if (hit) { cx.openCreate(hit.kind); return }
  if (key.startsWith('open-module:')) {
    const moduleId = key.slice('open-module:'.length)
    const mod = getModuleById(moduleId)
    if (mod && route.path !== mod.routePath) {
      router.push(mod.routePath).catch(() => undefined)
    }
    return
  }
  if (key === 'new-folder') doCreateFolder()
}

function doCreateFolder(): void {
  const folder = cf.createFolder(t('opsNav.newFolder'))
  nextTick(() => startRename(folder.id, folder.name)).catch(() => undefined)
}

/* ── 连接项右键菜单 ── */
function connCtxItemsFor(item: ConnItem): RsContextMenuItem[] {
  const items: RsContextMenuItem[] = [
    { key: 'connect', label: t('opsNav.connect'), icon: 'plug' },
    { key: 'sep1', label: '', separator: true },
    { key: 'edit', label: t('opsNav.editConn'), icon: 'pencil' },
    { key: 'delete', label: t('opsNav.deleteConn'), icon: 'trash-2', danger: true },
  ]
  if (cf.folders.value.length > 0) {
    const currentFolder = cf.folders.value.find((f) => f.profileIds.includes(item.profileId))
    const moveChildren: RsContextMenuItem[] = [
      ...(currentFolder
        ? [{ key: 'move-folder:__none__', label: t('opsNav.removeFromFolder'), icon: 'folder-x' }]
        : []),
      ...cf.folders.value
        .filter((f) => f.id !== currentFolder?.id)
        .map((f) => ({ key: `move-folder:${f.id}`, label: f.name, icon: 'folder' })),
    ]
    if (moveChildren.length > 0) {
      items.push(
        { key: 'sep2', label: '', separator: true },
        { key: 'move-folder', label: t('opsNav.moveToFolder'), icon: 'folder-open', children: moveChildren },
      )
    }
  }
  return items
}

function onConnCtx(key: string, item: ConnItem): void {
  if (key === 'connect') connect(item)
  else if (key === 'edit') cx.openEdit(item)
  else if (key === 'delete') cx.openDelete(item)
  else if (key.startsWith('move-folder:')) {
    const folderId = key.slice('move-folder:'.length)
    cf.moveToFolder(item.profileId, folderId === '__none__' ? null : folderId)
  }
}

/* ── 文件夹右键菜单 ── */
const folderCtxItems: RsContextMenuItem[] = [
  { key: 'rename', label: t('opsNav.renameFolder'), icon: 'pencil' },
  { key: 'delete', label: t('opsNav.deleteFolder'), icon: 'trash-2', danger: true },
]

function onFolderCtx(key: string, folder: ConnFolder): void {
  if (key === 'rename') startRename(folder.id, folder.name)
  else if (key === 'delete') cf.deleteFolder(folder.id)
}

/* ── 文件夹内联重命名 ── */
const editingFolderId = ref<string | null>(null)
const editingFolderName = ref('')
const renameInputRef = ref<ComponentPublicInstance | null>(null)

watch(editingFolderId, async (id) => {
  if (!id) return
  await nextTick()
  const root = renameInputRef.value?.$el as HTMLElement | undefined
  const input = root?.querySelector<HTMLInputElement>('.rs-input-group__control')
  input?.focus()
  input?.select()
})

function startRename(id: string, name: string): void {
  editingFolderId.value = id
  editingFolderName.value = name
}

function commitRename(): void {
  if (editingFolderId.value && editingFolderName.value.trim()) {
    cf.renameFolder(editingFolderId.value, editingFolderName.value.trim())
  }
  editingFolderId.value = null
  editingFolderName.value = ''
}

function cancelRename(): void {
  editingFolderId.value = null
  editingFolderName.value = ''
}

/* ── 树拖放 → 同步到 useConnFolders ── */
function onNodeDrop(dragKey: string, dropKey: string, position: RsTreeDropPosition): void {
  handleConnTreeDrop(cf.folders, cf, dragKey, dropKey, position)
}

/* ── 保存 / 删除 ── */
async function onSave(): Promise<void> {
  const wasEdit = dlgMode.value === 'edit'
  const ok = await cx.saveConnection()
  if (ok) toast.success(wasEdit ? t('opsNav.edited') : t('opsNav.added'))
}

async function onDelete(): Promise<void> {
  const ok = await cx.deleteConnection()
  if (ok) toast.success(t('opsNav.deleted'))
  else if (formError.value) toast.error(formError.value)
}

onMounted(async () => { await cx.loadAll() })

/* ── 类型守卫（模板用） ── */
function asFolderNode(n: ConnTreeNode): ConnFolderNode { return n as ConnFolderNode }
function asLeafNode(n: ConnTreeNode): ConnLeafNode { return n as ConnLeafNode }
</script>

<template>
  <RsContextMenu :items="rootCtxItems" @select="onRootCtx">
    <div class="nm-ops-conn">
      <!-- 搜索栏 -->
      <div class="nm-ops-conn__searchbar">
        <RsInput
          v-model="searchQuery"
          size="sm"
          class="nm-ops-conn__search-input"
          :placeholder="t('common.search')"
          clearable
        >
          <template #prefix>
            <RsIcon name="search" :size="12" class="nm-ops-conn__search-icon" />
          </template>
        </RsInput>
      </div>

      <!-- 连接树 -->
      <div class="nm-ops-conn__body">
        <RsLoading v-if="loading" class="nm-ops-conn__loader" />
        <RsTree
          v-else
          virtual
          :nodes="categoryTreeNodes"
          :filter="treeFilter"
          :filter-node="treeSearchMatch"
          v-model:expanded-keys="treeExpandedKeys"
          :allow-drop="allowTreeDrop"
          block-node
          draggable
          drag-trigger="row"
          :selectable="false"
          size="sm"
          class="nm-ops-conn__tree"
          @node-drop="onNodeDrop"
        >
          <template #title="{ node }">
            <!-- 文件夹节点 -->
            <RsContextMenu
              v-if="(node as ConnTreeNode)._type === 'folder'"
              :items="folderCtxItems"
              @select="onFolderCtx($event, asFolderNode(node as ConnTreeNode)._folder)"
            >
              <div class="nm-conn-row">
                <RsIcon
                  :name="asFolderNode(node as ConnTreeNode)._folder.expanded ? 'folder-open' : 'folder'"
                  :size="14"
                  class="nm-conn-row__icon nm-conn-row__icon--folder"
                />
                <RsInput
                  v-if="editingFolderId === asFolderNode(node as ConnTreeNode)._folder.id"
                  ref="renameInputRef"
                  v-model="editingFolderName"
                  size="sm"
                  class="nm-conn-row__rename nm-no-drag"
                  :aria-label="t('opsNav.renameFolder')"
                  @click.stop
                  @blur="commitRename"
                  @press-enter="commitRename"
                  @keydown.escape.prevent="cancelRename"
                />
                <span v-else class="nm-conn-row__label nm-conn-row__label--folder">{{ node.label }}</span>
              </div>
            </RsContextMenu>

            <!-- 连接叶节点 -->
            <RsContextMenu
              v-else
              :items="connCtxItemsFor(asLeafNode(node as ConnTreeNode)._conn)"
              @select="onConnCtx($event, asLeafNode(node as ConnTreeNode)._conn)"
            >
              <div
                class="nm-conn-row"
                :title="`${asLeafNode(node as ConnTreeNode)._conn.hostAddress}:${asLeafNode(node as ConnTreeNode)._conn.portNumber}`"
                @dblclick="connect(asLeafNode(node as ConnTreeNode)._conn)"
              >
                <RsIcon
                  :name="kindIcon(asLeafNode(node as ConnTreeNode)._conn.kind)"
                  :size="14"
                  class="nm-conn-row__icon"
                  :color="profileAccentColor(asLeafNode(node as ConnTreeNode)._conn.connectionOptions)"
                />
                <span class="nm-conn-row__label">{{ node.label }}</span>
              </div>
            </RsContextMenu>
          </template>
        </RsTree>
      </div>

      <!-- 连接表单对话框 -->
      <ConnectionFormDialog
        v-model:open="dlgOpen"
        :mode="dlgMode"
        :kind="dlgKind"
        :profile="dlgProfile"
        :form="form"
        :form-error="formError"
        :saving="saving"
        :deleting="deleting"
        :testing="testing"
        :test-message="testMessage"
        @save="onSave"
        @delete="onDelete"
        @test="cx.testConnection()"
      />
    </div>
  </RsContextMenu>
</template>

<style scoped>
.nm-ops-conn {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.nm-ops-conn__searchbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: var(--nm-tabbar-h);
  padding: 0 var(--rs-space-sm);
  border-bottom: 1px solid var(--rs-border-subtle);
  box-sizing: border-box;
}

.nm-ops-conn__search-input {
  flex: 1;
  min-width: 0;
}

.nm-ops-conn__search-icon {
  color: var(--rs-placeholder);
}

.nm-ops-conn__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.nm-ops-conn__loader {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.nm-ops-conn__tree {
  flex: 1;
  min-height: 0;
  padding: var(--rs-space-xs) 0;
}

.nm-ops-conn__tree :deep(.rs-tree__empty) {
  padding: var(--rs-space-md) var(--rs-space-sm);
}

/* ── 行内布局（继承 RsTree 标签样式）── */
.nm-conn-row {
  display: flex;
  align-items: center;
  gap: var(--rs-space-xs);
  width: 100%;
  min-width: 0;
}

.nm-conn-row__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nm-conn-row__label--folder {
  font-weight: 500;
}

.nm-conn-row__icon {
  flex-shrink: 0;
}

.nm-conn-row__icon--folder {
  color: var(--rs-warning, #f59e0b);
}

.nm-conn-row__rename {
  flex: 1;
  min-width: 0;
}
</style>
