<script setup lang="ts">
/**
 * 运维连接面板 — 薄壳，仅负责组合：搜索 + 连接树 + 表单对话框。
 *
 * 扩展指南（新增连接类型）：
 *   1. 在 types.ts 的 CONN_KIND_DEFS 追加 kind
 *   2. 在 modules/<kind>/register-conn-full.ts 自注册，并在 register-builtin-conn-kinds.ts 挂 loader
 *   本文件无需修改。
 */
import { RsContextMenu, RsIcon, RsInput, RsLoading, RsTree, useRsToast } from '@niuma/ui'
import type { RsContextMenuItem, RsTreeDropPosition, RsTreeNode } from '@niuma/ui'
import { computed, nextTick, onMounted, onUnmounted, ref, toRef, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getModuleById } from '@/extensions/registry/extension-registry'
import type { ModuleCategory } from '@/extensions/types/module'
import { useRoute, useRouter } from 'vue-router'
import ConnectionFormDialog from '@/modules/ops/components/ConnectionFormDialog.vue'
import FolderFormDialog from '@/modules/ops/components/FolderFormDialog.vue'
import { getConnectionKindDef } from '@/modules/connection'
import { connKindHasTree, ensureConnKind, isConnKindLoaded } from '@/modules/ops/conn-kind-loaders'
import {
  getConnTreeProvider,
  useConnTreeActionHosts,
  useConnTreeRegistryEpoch,
} from '@/modules/ops/conn-tree/registry'
import { getConnTreeTabSync } from '@/modules/ops/conn-tree/tab-sync'
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
import { useConnTreeSyncStore } from '@/stores/conn-tree-sync'
import { useSessionRegistry } from '@/stores/session-registry'
import { useTabStore } from '@/stores/tab'
import { CONN_KIND_DEFS, DEFAULT_FOLDER_ACCENT, folderAccentColor, kindIcon, profileAccentColor, type ConnAccentColor, type ConnItem, type ConnKind } from '@/modules/ops/types'

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

/** 协议注册的树操作宿主（确认框等）；响应式列表，懒注册后自动挂载。 */
const connTreeActionHosts = useConnTreeActionHosts()
/** Provider 懒注册世代：右键菜单构建时读取，避免 items 仍是 ensure 前的精简版。 */
const connTreeRegistryEpoch = useConnTreeRegistryEpoch()

/**
 * 右键打开前若树协议尚未 ensure：拦住菜单，加载并等下一帧刷新 items 后再重放 contextmenu。
 * 无树协议（ssh/ftp 等）或已加载时直接放行，无额外延迟。
 */
const ctxMenuReplay = ref(false)

function warmConnKind(kind: ConnKind): void {
  if (!connKindHasTree(kind)) return
  void ensureConnKind(kind).catch(() => undefined)
}

function onConnKindContextMenu(e: MouseEvent, kind: ConnKind): void {
  if (ctxMenuReplay.value || !connKindHasTree(kind) || isConnKindLoaded(kind)) return
  e.preventDefault()
  e.stopPropagation()
  const target = e.currentTarget as HTMLElement
  const { clientX, clientY } = e
  void (async () => {
    await ensureConnKind(kind).catch(() => undefined)
    await nextTick()
    ctxMenuReplay.value = true
    try {
      target.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 2,
          buttons: 2,
          view: window,
        }),
      )
      await nextTick()
    } finally {
      ctxMenuReplay.value = false
    }
  })()
}

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
  _searchTimer = setTimeout(() => {
    treeFilter.value = v
  }, 250)
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

/** 活跃 Tab → 侧栏树聚焦；协议差异由 ConnTreeTabSyncStrategy 提供。 */
async function syncTreeToActiveTab(): Promise<void> {
  const tab = tabStore.activeTab
  if (!tab?.moduleId) {
    return
  }
  const kind = tab.moduleId as ConnKind
  if (!CONN_KIND_DEFS.some((d) => d.kind === kind)) {
    return
  }
  try {
    await ensureConnKind(kind)
  } catch {
    return
  }
  const strategy = getConnTreeTabSync(kind)
  if (!strategy) {
    return
  }
  const key = strategy.resolveFocusKey(tab, { profiles: allProfiles.value })
  if (key) {
    void applyTreeFocus(key)
  }
}

watch(
  () => tabStore.activeTabId,
  () => {
    void syncTreeToActiveTab()
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
  if (hit) { void cx.openCreate(hit.kind); return }
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
  void connTreeRegistryEpoch.value
  const connected = sessionRegistry.isProfileConnected(item.profileId, item.kind)
  const provider = getConnTreeProvider(item.kind)
  const providerItems = provider?.connMenuItems?.(item) ?? []
  const expandable = provider?.canExpand(item) ?? connKindHasTree(item.kind)
  const items: RsContextMenuItem[] = [
    { key: 'connect', label: t('opsNav.connect'), icon: 'plug' },
    ...(connected
      ? [{ key: 'disconnect', label: t('opsNav.disconnect'), icon: 'unplug' } as RsContextMenuItem]
      : []),
    ...(providerItems.length
      ? ([
          { key: 'sep-provider', label: '', separator: true },
          ...providerItems,
        ] as RsContextMenuItem[])
      : []),
    ...(expandable
      ? ([
          { key: 'sep-refresh', label: '', separator: true },
          { key: 'conn-refresh', label: t('opsNav.refresh'), icon: 'refresh-cw' },
        ] as RsContextMenuItem[])
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

function onConnCtx(key: string, node: ConnLeafNode): void {
  const item = node._conn
  void (async () => {
    await ensureConnKind(item.kind)
    if (key === 'conn-refresh') {
      const nodeKey = node.key
      if (nodeKey) {
        treeChildren.refreshNode(nodeKey, node).catch(() => undefined)
      }
      return
    }
    const provider = getConnTreeProvider(item.kind)
    if (provider?.onConnMenuSelect?.(item, key)) {
      return
    }
    if (key === 'connect') connect(item)
    else if (key === 'disconnect') void sessionRegistry.disconnect(item.profileId, item.kind)
    else if (key === 'edit') void cx.openEdit(item)
    else if (key === 'delete') void cx.openDelete(item)
    else if (key.startsWith('move-folder:')) {
      const folderId = key.slice('move-folder:'.length)
      cf.moveToFolder(item.profileId, folderId === '__none__' ? null : folderId)
    }
  })()
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
    void cx.openCreate(hitKind.kind)
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
async function onNodeDblclick(node: RsTreeNode): Promise<void> {
  const n = node as ConnTreeNode
  if (n._type === 'conn') {
    connect(n._conn)
    return
  }
  if (n._type === 'resource') {
    if (!n.isLeaf) {
      const nodeKey = node.key
      if (!nodeKey) return
      if (treeExpandedKeys.value.includes(nodeKey)) {
        treeRef.value?.collapseNode(nodeKey)
        return
      }
      try {
        await treeChildren.loadData(node, nodeKey)
        treeRef.value?.expandNode(nodeKey)
      } catch {
        // ignore
      }
      return
    }
    await ensureConnKind(n._conn.kind)
    const provider = getConnTreeProvider(n._conn.kind)
    if (provider?.activate) {
      provider.activate(n._conn, n._path)
      return
    }
    const ctx: ConnOpenContext = { resourcePath: n._path }
    connect(n._conn, ctx)
  }
}

/* ── 资源节点右键菜单 ── */

function resourceMenuItemsFor(node: ConnResourceNode): RsContextMenuItem[] {
  void connTreeRegistryEpoch.value
  const provider = getConnTreeProvider(node._conn.kind)
  const providerItems = provider?.resourceMenuItems?.(node._conn, node._path) ?? []
  return [
    ...providerItems,
    ...(providerItems.length ? [{ key: 'sep-refresh', label: '', separator: true } as RsContextMenuItem] : []),
    { key: 'resource-refresh', label: t('opsNav.refresh'), icon: 'refresh-cw' },
  ]
}

function onResourceCtx(key: string, node: ConnResourceNode): void {
  void (async () => {
    if (key === 'resource-refresh') {
      const nodeKey = node.key
      if (nodeKey) {
        treeChildren.refreshNode(nodeKey, node).catch(() => undefined)
      }
      return
    }
    await ensureConnKind(node._conn.kind)
    const provider = getConnTreeProvider(node._conn.kind)
    provider?.onResourceMenuSelect?.(node._conn, node._path, key)
  })()
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

onMounted(() => {
  void cx.loadAll()
})

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
          show-line
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
              @select="onConnCtx($event, asLeafNode(node as ConnTreeNode))"
            >
              <div
                class="nm-conn-row"
                :title="`${asLeafNode(node as ConnTreeNode)._conn.hostAddress}:${asLeafNode(node as ConnTreeNode)._conn.portNumber}`"
                @pointerenter="warmConnKind(asLeafNode(node as ConnTreeNode)._conn.kind)"
                @contextmenu.capture="onConnKindContextMenu($event, asLeafNode(node as ConnTreeNode)._conn.kind)"
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

            <!-- 资源子节点（逻辑库 / 集合 / 未来 schema 等） -->
            <RsContextMenu
              v-else-if="(node as ConnTreeNode)._type === 'resource'"
              :items="resourceMenuItemsFor(asResourceNode(node as ConnTreeNode))"
              @select="onResourceCtx($event, asResourceNode(node as ConnTreeNode))"
            >
              <div
                class="nm-conn-row nm-conn-row--resource"
                :title="asResourceNode(node as ConnTreeNode).label"
                @pointerenter="warmConnKind(asResourceNode(node as ConnTreeNode)._conn.kind)"
                @contextmenu.capture="onConnKindContextMenu($event, asResourceNode(node as ConnTreeNode)._conn.kind)"
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
            </RsContextMenu>
          </template>
        </RsTree>
      </div>

      <!--
        连接表单对话框。
        协议专属字段通过注册表（connection/registry.ts）动态注入，本组件无需感知具体协议。
        新增协议：modules/<kind>/register-conn-form.ts + register-builtin-conn-kinds.ts 挂 loader。
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
        <template v-if="kindDef?.ssl" #ssl>
          <component :is="kindDef.ssl" :form="form" />
        </template>
        <template v-if="kindDef?.advanced" #advanced>
          <component :is="kindDef.advanced" :form="form" />
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

      <!-- 协议树操作宿主：由 conn-tree 注册表贡献，面板不感知具体协议。 -->
      <component
        :is="Host"
        v-for="(Host, index) in connTreeActionHosts"
        :key="index"
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
