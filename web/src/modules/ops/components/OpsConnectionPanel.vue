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
import { computed, onMounted, onUnmounted, ref, toRef, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getModuleById } from '@/extensions/registry/extension-registry'
import type { ModuleCategory } from '@/extensions/types/module'
import { useRoute, useRouter } from 'vue-router'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import FolderFormDialog from '@/modules/ops/components/FolderFormDialog.vue'
import { getConnectionKindDef } from '@/modules/connection'
import { connTreeKey, resourceTreeKey } from '@/modules/ops/conn-tree/keys'
import { getConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnOpenContext } from '@/modules/ops/conn-tree/types'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { useConnectionProfiles } from '@/modules/ops/composables/useConnectionProfiles'
import { useConnTreeFocus, type RsTreeExpose } from '@/modules/ops/composables/useConnTreeFocus'
import { useConnTreeChildren } from '@/modules/ops/composables/useConnTreeChildren'
import {
  allowDrop,
  collectExpandableConnKeys,
  connTreeSearchMatch,
  filterConnTreeByCategory,
  handleConnTreeDrop,
  useConnTree,
  type ConnFolderNode,
  type ConnLeafNode,
  type ConnResourceNode,
  type ConnTreeNode,
} from '@/modules/ops/composables/useConnTree'
import { useConnFolders, type ConnFolder } from '@/modules/ops/composables/useConnFolders'
import { readRedisDatabaseFromOptions } from '@/modules/redis/composables/useRedisDatabase'
import { useConnTreeSyncStore } from '@/stores/conn-tree-sync'
import { useSessionRegistry } from '@/stores/session-registry'
import { useTabStore } from '@/stores/tab'
import { CONN_KIND_DEFS, DEFAULT_FOLDER_ACCENT, folderAccentColor, kindIcon, profileAccentColor, type ConnAccentColor, type ConnItem } from '@/modules/ops/types'

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
const tabStore = useTabStore()
const sessionRegistry = useSessionRegistry()
const connTreeSync = useConnTreeSyncStore()

const treeRef = ref<RsTreeExpose | null>(null)

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

/* ── 当前对话框协议的 UI 插槽定义（从注册表查表） ── */
const kindDef = computed(() => getConnectionKindDef(dlgKind.value))

const tunnelSshProfiles = computed(() =>
  allProfiles.value.filter((p) => p.kind === 'ssh' && p.profileId !== dlgProfile.value?.profileId),
)

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
const treeChildren = useConnTreeChildren()

const treeExpandedKeys = ref<string[]>([])

const categoryTreeNodes = computed(() =>
  treeChildren.displayNodes(filterConnTreeByCategory(fullTreeNodes.value, categoryRef.value)),
)

const { applyTreeFocus } = useConnTreeFocus({
  treeRef,
  nodes: categoryTreeNodes,
  expandedKeys: treeExpandedKeys,
  treeChildren,
})

function redisDbResourceKey(profileId: string, db: number): string {
  return resourceTreeKey(profileId, { segments: [{ kind: 'db', name: String(db) }] })
}

function resolveRedisTabDb(profileId: string, tabDatabase: unknown): number | null {
  const conn = allProfiles.value.find((p) => p.profileId === profileId && p.kind === 'redis')
  if (!conn) {
    return null
  }
  const provider = getConnTreeProvider('redis')
  if (!provider?.canExpand(conn)) {
    return null
  }
  if (typeof tabDatabase === 'number') {
    return tabDatabase
  }
  return readRedisDatabaseFromOptions(conn.connectionOptions).database
}

function syncTreeToActiveTab(): void {
  const tab = tabStore.activeTab
  if (!tab || tab.moduleId !== 'redis') {
    return
  }
  const profileId = tab.props.profileId
  if (typeof profileId !== 'string' || !profileId) {
    return
  }
  const db = resolveRedisTabDb(profileId, tab.props.database)
  if (db === null) {
    void applyTreeFocus(connTreeKey(profileId))
    return
  }
  void applyTreeFocus(redisDbResourceKey(profileId, db))
}

watch(
  () => tabStore.activeTabId,
  () => {
    syncTreeToActiveTab()
  },
  { immediate: true },
)

watch(
  () => connTreeSync.tick,
  () => {
    const key = connTreeSync.focusKey
    if (key) {
      void applyTreeFocus(key)
    }
  },
)

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

/** 二级「新建连接」子菜单（仅显示协议名，不重复「新建」前缀）。 */
function newConnSubItems(): RsContextMenuItem[] {
  return CONN_KIND_DEFS.map((k) => ({
    key: `new-${k.kind}`,
    label: k.label,
    icon: k.icon,
  }))
}

/* ── 根区域右键菜单（暂不按 Activity 分类过滤，显示全部新建项） ── */
const rootCtxItems = computed<RsContextMenuItem[]>(() => [
  {
    key: 'new-connection',
    label: t('opsNav.newConnection'),
    icon: 'plus',
    children: newConnSubItems(),
  },
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

function doCreateFolder(parentId: string | null = null): void {
  openFolderDialog('create', parentId)
}

/* ── 连接项右键菜单 ── */
function connCtxItemsFor(item: ConnItem): RsContextMenuItem[] {
  const connected = sessionRegistry.isProfileConnected(item.profileId, item.kind)
  const items: RsContextMenuItem[] = [
    { key: 'connect', label: t('opsNav.connect'), icon: 'plug' },
    ...(connected
      ? [{ key: 'disconnect', label: t('opsNav.disconnect'), icon: 'unplug' } as RsContextMenuItem]
      : []),
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
  else if (key === 'disconnect') void sessionRegistry.disconnect(item.profileId, item.kind)
  else if (key === 'edit') cx.openEdit(item)
  else if (key === 'delete') cx.openDelete(item)
  else if (key.startsWith('move-folder:')) {
    const folderId = key.slice('move-folder:'.length)
    cf.moveToFolder(item.profileId, folderId === '__none__' ? null : folderId)
  }
}

/* ── 文件夹右键菜单 ── */

/**
 * 文件夹右键菜单 = 新建连接（在此文件夹内）+ 新建子文件夹 + 分隔线 + 重命名 / 删除。
 * 结构与根区域右键对齐，让「在文件夹内新建」和「在根区域新建」保持一致的操作心智。
 */
const folderCtxItems = computed<RsContextMenuItem[]>(() => [
  {
    key: 'new-connection',
    label: t('opsNav.newConnection'),
    icon: 'plus',
    children: newConnSubItems(),
  },
  { key: 'sep-new', label: '', separator: true },
  { key: 'new-subfolder', label: t('opsNav.addFolder'), icon: 'folder-plus' },
  { key: 'sep-manage', label: '', separator: true },
  { key: 'edit', label: t('opsNav.edit'), icon: 'pencil' },
  { key: 'delete', label: t('opsNav.deleteFolder'), icon: 'trash-2', danger: true },
])

/**
 * 用于追踪「从文件夹右键菜单新建连接」时的目标文件夹 ID。
 * 连接保存成功后自动归入此文件夹，对话框关闭时自动清零。
 */
const pendingFolderId = ref<string | null>(null)
watch(dlgOpen, (isOpen) => { if (!isOpen) pendingFolderId.value = null })

function onFolderCtx(key: string, folder: ConnFolder): void {
  const hitKind = CONN_KIND_DEFS.find((k) => key === `new-${k.kind}`)
  if (hitKind) {
    pendingFolderId.value = folder.id
    cx.openCreate(hitKind.kind)
    return
  }
  if (key === 'new-subfolder') {
    doCreateFolder(folder.id)
    return
  }
  if (key === 'edit') openFolderDialog('edit', null, folder)
  else if (key === 'delete') cf.deleteFolder(folder.id)
}

/* ── 文件夹对话框（新建 / 编辑，与连接表单统一风格） ── */
const folderDlgOpen = ref(false)
const folderDlgMode = ref<'create' | 'edit'>('create')
const folderDlgId = ref<string | null>(null)
const folderDlgParentId = ref<string | null>(null)
const folderDlgName = ref('')
const folderDlgColor = ref<ConnAccentColor>(DEFAULT_FOLDER_ACCENT)
const folderDlgError = ref<string | null>(null)

function openFolderDialog(
  mode: 'create' | 'edit',
  parentId: string | null = null,
  folder?: ConnFolder,
): void {
  folderDlgMode.value = mode
  folderDlgId.value = folder?.id ?? null
  folderDlgParentId.value = parentId
  folderDlgName.value = mode === 'create' ? t('opsNav.newFolder') : (folder?.name ?? '')
  folderDlgColor.value = folder ? folderAccentColor(folder) : DEFAULT_FOLDER_ACCENT
  folderDlgError.value = null
  folderDlgOpen.value = true
}

function onFolderSave(): void {
  const name = folderDlgName.value.trim()
  if (!name) {
    folderDlgError.value = t('opsNav.form.folderNameRequired')
    return
  }
  if (folderDlgMode.value === 'create') {
    cf.createFolder(name, folderDlgParentId.value, folderDlgColor.value)
    toast.success(t('opsNav.folderAdded'))
  } else if (folderDlgId.value) {
    cf.updateFolder(folderDlgId.value, { name, accentColor: folderDlgColor.value })
    toast.success(t('opsNav.folderEdited'))
  }
  folderDlgOpen.value = false
}

/* ── 树拖放 → 同步到 useConnFolders ── */
function onNodeDrop(dragKey: string, dropKey: string, position: RsTreeDropPosition): void {
  handleConnTreeDrop(cf.folders, cf, dragKey, dropKey, position)
}

/** 双击叶节点打开连接（须在 RsTree 行级监听，避免首次单击切换 focused 时 slot 重渲染打断 dblclick） */
function onNodeDblclick(node: RsTreeNode): void {
  const n = node as ConnTreeNode
  if (n._type === 'conn') {
    connect(n._conn)
    return
  }
  if (n._type === 'resource') {
    const provider = getConnTreeProvider(n._conn.kind)
    if (provider?.activate) {
      provider.activate(n._conn, n._path)
      return
    }
    const ctx: ConnOpenContext = { resourcePath: n._path }
    connect(n._conn, ctx)
  }
}

/* ── 保存 / 删除 ── */
async function onSave(): Promise<void> {
  const wasCreate = dlgMode.value === 'create'
  const targetFolderId = pendingFolderId.value

  // 快照保存前已有的 profile ID 集合，用于在 loadAll() 更新后识别新建的连接。
  // 必须在 await 之前获取，否则 saveConnection 内部的 loadAll() 会先修改 allProfiles。
  const beforeIds = wasCreate && targetFolderId
    ? new Set(allProfiles.value.map((p) => p.profileId))
    : null

  const ok = await cx.saveConnection()
  if (ok) {
    // 从文件夹右键新建的连接：保存成功后自动归入目标文件夹
    if (wasCreate && targetFolderId && beforeIds) {
      const newProfile = allProfiles.value.find((p) => !beforeIds.has(p.profileId))
      if (newProfile) cf.moveToFolder(newProfile.profileId, targetFolderId)
    }
    toast.success(wasCreate ? t('opsNav.added') : t('opsNav.edited'))
  }
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
function asResourceNode(n: ConnTreeNode): ConnResourceNode { return n as ConnResourceNode }
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
          ref="treeRef"
          v-else
          virtual
          lazy
          :load-data="treeChildren.loadData"
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
          @node-dblclick="onNodeDblclick"
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
                  class="nm-conn-row__icon"
                  :color="folderAccentColor(asFolderNode(node as ConnTreeNode)._folder)"
                />
                <span class="nm-conn-row__label nm-conn-row__label--folder">{{ node.label }}</span>
              </div>
            </RsContextMenu>

            <!-- 连接节点 -->
            <RsContextMenu
              v-else-if="(node as ConnTreeNode)._type === 'conn'"
              :items="connCtxItemsFor(asLeafNode(node as ConnTreeNode)._conn)"
              @select="onConnCtx($event, asLeafNode(node as ConnTreeNode)._conn)"
            >
              <div
                class="nm-conn-row"
                :title="`${asLeafNode(node as ConnTreeNode)._conn.hostAddress}:${asLeafNode(node as ConnTreeNode)._conn.portNumber}`"
              >
                <RsIcon
                  :name="kindIcon(asLeafNode(node as ConnTreeNode)._conn.kind)"
                  :size="14"
                  class="nm-conn-row__icon"
                  :color="profileAccentColor(asLeafNode(node as ConnTreeNode)._conn.connectionOptions)"
                />
                <span class="nm-conn-row__label">{{ node.label }}</span>
                <span
                  v-if="sessionRegistry.isProfileConnected(asLeafNode(node as ConnTreeNode)._conn.profileId, asLeafNode(node as ConnTreeNode)._conn.kind)"
                  class="nm-conn-row__status"
                  :title="t('opsNav.connected')"
                />
              </div>
            </RsContextMenu>

            <!-- 资源子节点（逻辑库 / 未来 schema 等） -->
            <div
              v-else-if="(node as ConnTreeNode)._type === 'resource'"
              class="nm-conn-row nm-conn-row--resource"
              :title="asResourceNode(node as ConnTreeNode).label"
            >
              <RsIcon
                :name="asResourceNode(node as ConnTreeNode)._icon ?? 'database'"
                :size="14"
                class="nm-conn-row__icon"
                :color="profileAccentColor(asResourceNode(node as ConnTreeNode)._conn.connectionOptions)"
              />
              <span class="nm-conn-row__label">{{ node.label }}</span>
              <span
                v-if="asResourceNode(node as ConnTreeNode)._badge"
                class="nm-conn-row__badge"
              >
                {{ asResourceNode(node as ConnTreeNode)._badge }}
              </span>
            </div>
          </template>
        </RsTree>
      </div>

      <!--
        连接表单对话框。
        协议专属字段通过注册表（connection/registry.ts）动态注入，本组件无需感知具体协议。
        新增协议只需在 modules/ops/connection-kinds.ts 追加一行 registerConnectionKind()。
      -->
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
        :password-optional="kindDef?.passwordOptional"
        :tunnel-ssh-profiles="tunnelSshProfiles"
        @save="onSave"
        @delete="onDelete"
        @test="cx.testConnection()"
      >
        <!-- 凭据区：仅当协议注册了自定义凭据组件时替换（如 SSH） -->
        <template v-if="kindDef?.credentialSection" #credential-section>
          <component :is="kindDef.credentialSection" :form="form" :mode="dlgMode" />
        </template>

        <!-- 凭据区提示文字：仅当协议注册了 credentialHint 时显示（如 Redis 密码可选提示） -->
        <template v-if="kindDef?.credentialHint" #credential-hint>
          <p class="nm-ops-conn__password-hint">{{ t(kindDef.credentialHint) }}</p>
        </template>

        <!-- 协议专属选项区：仅当协议注册了 options 组件时显示（如 FTP / Redis） -->
        <template v-if="kindDef?.options" #options>
          <component :is="kindDef.options" :form="form" />
        </template>
      </ConnectionFormDialog>

      <FolderFormDialog
        v-model:open="folderDlgOpen"
        v-model:name="folderDlgName"
        v-model:accent-color="folderDlgColor"
        :mode="folderDlgMode"
        :form-error="folderDlgError"
        @save="onFolderSave"
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

.nm-conn-row__badge {
  flex-shrink: 0;
  font-size: var(--rs-font-size-xs);
  font-variant-numeric: tabular-nums;
  color: var(--rs-muted);
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--rs-surface-subtle);
}

.nm-conn-row__status {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--rs-success, #34c759);
}

.nm-ops-conn__password-hint {
  margin: 0;
  font-size: var(--rs-font-size-xs);
  color: var(--rs-muted);
}
</style>
