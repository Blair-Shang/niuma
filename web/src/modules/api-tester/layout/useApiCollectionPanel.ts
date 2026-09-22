import {
  useRsToast,
  type RsContextMenuItem,
} from '@niuma/ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabStore } from '@/stores/tab'
import {
  downloadJson,
  fileSlug,
  parseCollection,
  pickJsonFile,
  serializeCollection,
} from '../utils/collection-io'
import { findPaneCreate, listApiPaneCreates, paneCreateKey } from '../pane-registry'
import type { ApiPaneCreateAction } from '../pane-types'
import { useApiTesterStore } from '../stores/api-tester'
import type { ApiFolder, ApiMethod, ApiSideView } from '../types'
import type { ApiTreeCtx } from '../components/ApiCollectionTree.vue'

export type ApiPanelCtx = ApiTreeCtx | { kind: 'history'; historyId: string }

/** 新建请求弹窗确认前暂存的协议与落点，取消则不写集合。 */
type RequestCreateDraft = {
  folderId?: string
  method?: ApiMethod
  listen?: boolean
}

/** 集合侧栏：树/历史切换、右键菜单、重命名删除、导入导出。 */
export function useApiCollectionPanel() {
  const { t } = useI18n()
  const toast = useRsToast()
  const api = useApiTesterStore()
  const tabStore = useTabStore()

  const selectedId = computed(() => {
    const id = tabStore.activeTab?.props.requestId
    return typeof id === 'string' ? id : ''
  })

  const ctxTarget = ref<ApiPanelCtx | null>(null)
  const ctxMenuOpen = ref(false)

  watch(
    () => api.folders.map((folder) => folder.id).join('\0'),
    () => {
      if (!ctxMenuOpen.value) return
      ctxMenuOpen.value = false
      ctxTarget.value = null
    },
  )

  const nameDlgOpen = ref(false)
  const nameDlgKind = ref<'folder' | 'request'>('folder')
  const nameDlgMode = ref<'create' | 'edit'>('create')
  const nameDlgId = ref('')
  const nameDlgValue = ref('')
  const nameDlgError = ref('')
  const nameForm = ref<HTMLFormElement | null>(null)
  const requestDraft = ref<RequestCreateDraft>({})

  const confirmOpen = ref(false)
  const confirmKind = ref<'folder' | 'request' | 'history' | 'history-all'>('folder')
  const confirmId = ref('')
  const confirmName = ref('')

  const nameDlgTitle = computed(() => {
    if (nameDlgKind.value === 'folder') {
      return nameDlgMode.value === 'create' ? t('modules.api.newFolder') : t('modules.api.renameFolder')
    }
    return nameDlgMode.value === 'create' ? t('modules.api.newRequest') : t('modules.api.renameRequest')
  })

  const confirmTitle = computed(() => {
    if (confirmKind.value === 'folder') return t('modules.api.deleteFolder')
    if (confirmKind.value === 'request') return t('modules.api.deleteRequest')
    if (confirmKind.value === 'history-all') return t('modules.api.clearHistory')
    return t('modules.api.deleteHistory')
  })

  const confirmDesc = computed(() => {
    if (confirmKind.value === 'folder') return t('modules.api.deleteFolderConfirm', { name: confirmName.value })
    if (confirmKind.value === 'request') return t('modules.api.deleteRequestConfirm', { name: confirmName.value })
    if (confirmKind.value === 'history-all') return t('modules.api.clearHistoryConfirm')
    return t('modules.api.deleteHistoryConfirm', { name: confirmName.value })
  })

  function setSideView(view: ApiSideView): void {
    api.sideView = view
  }

  function moveFolderItems(requestId: string): RsContextMenuItem[] {
    const current = api.folders.find((folder) => folder.requests.some((req) => req.id === requestId))
    return api.folders
      .filter((folder) => folder.id !== current?.id)
      .map((folder) => ({
        key: `move-folder:${folder.id}`,
        label: folder.name,
        icon: 'folder',
      }))
  }

  const historyRootCtxItems = computed<RsContextMenuItem[]>(() => [
    { key: 'clear-history', label: t('modules.api.clearHistory'), icon: 'trash-2', danger: true },
  ])

  const historyRowCtxItems = computed<RsContextMenuItem[]>(() => [
    { key: 'open-history', label: t('modules.api.openHistory'), icon: 'send' },
    { key: 'sep-hist', label: '', separator: true },
    { key: 'delete-history', label: t('modules.api.deleteHistory'), icon: 'trash-2', danger: true },
  ])

  function createCtxItems(): RsContextMenuItem[] {
    return listApiPaneCreates().map(toCreateMenuItem)
  }

  function toCreateMenuItem(item: ApiPaneCreateAction): RsContextMenuItem {
    const children = item.children?.map(toCreateMenuItem)
    return {
      key: children?.length ? `new-pane-group:${item.method}` : paneCreateKey(item),
      label: t(item.labelKey),
      icon: item.icon,
      children,
    }
  }

  const rootCtxItems = computed<RsContextMenuItem[]>(() => [
    ...createCtxItems(),
    { key: 'new-folder', label: t('modules.api.newFolder'), icon: 'folder-plus' },
    { key: 'sep-io', label: '', separator: true },
    { key: 'import', label: t('modules.api.importCollection'), icon: 'upload' },
    { key: 'export', label: t('modules.api.exportCollection'), icon: 'download' },
  ])

  const folderCtxItems = computed<RsContextMenuItem[]>(() => [
    ...createCtxItems(),
    { key: 'sep-io', label: '', separator: true },
    { key: 'import', label: t('modules.api.importCollection'), icon: 'upload' },
    { key: 'export', label: t('modules.api.exportFolder'), icon: 'download' },
    { key: 'sep-manage', label: '', separator: true },
    { key: 'rename', label: t('modules.api.renameFolder'), icon: 'pencil' },
    { key: 'delete', label: t('modules.api.deleteFolder'), icon: 'trash-2', danger: true },
  ])

  const requestCtxItems = computed<RsContextMenuItem[]>(() => {
    const requestId = ctxTarget.value?.kind === 'request' ? ctxTarget.value.requestId : ''
    const items: RsContextMenuItem[] = [
      { key: 'duplicate', label: t('modules.api.duplicate'), icon: 'copy' },
      { key: 'export', label: t('modules.api.exportRequest'), icon: 'download' },
      { key: 'sep-manage', label: '', separator: true },
      { key: 'rename', label: t('modules.api.renameRequest'), icon: 'pencil' },
    ]
    const moveChildren = requestId ? moveFolderItems(requestId) : []
    if (moveChildren.length > 0) {
      items.push({
        key: 'move-folder',
        label: t('modules.api.moveToFolder'),
        icon: 'folder-open',
        children: moveChildren,
      })
    }
    items.push(
      { key: 'sep-delete', label: '', separator: true },
      { key: 'delete', label: t('modules.api.deleteRequest'), icon: 'trash-2', danger: true },
    )
    return items
  })

  const activeCtxItems = computed<RsContextMenuItem[]>(() => {
    if (api.sideView === 'history') {
      if (ctxTarget.value?.kind === 'history') return historyRowCtxItems.value
      return historyRootCtxItems.value
    }
    const target = ctxTarget.value
    if (!target || target.kind === 'history') return rootCtxItems.value
    if (target.kind === 'folder') return folderCtxItems.value
    return requestCtxItems.value
  })

  function onSelect(id: string): void {
    api.openRequestTab(id)
  }

  function onNewRequest(folderId?: string, method?: ApiMethod, opts?: { listen?: boolean; name?: string }): void {
    openNameDialog(
      'request',
      'create',
      '',
      opts?.name?.trim() || t('modules.api.newRequest'),
      { folderId, method, listen: opts?.listen },
    )
  }

  function tryCreatePane(key: string, folderId?: string): boolean {
    const action = findPaneCreate(key)
    if (!action) return false
    onNewRequest(folderId, action.method, {
      listen: action.listen,
      name: action.nameKey ? t(action.nameKey) : undefined,
    })
    return true
  }

  function openNameDialog(
    kind: 'folder' | 'request',
    mode: 'create' | 'edit',
    id = '',
    value = '',
    draft?: RequestCreateDraft,
  ): void {
    nameDlgKind.value = kind
    nameDlgMode.value = mode
    nameDlgId.value = id
    nameDlgValue.value = value
    nameDlgError.value = ''
    requestDraft.value = draft ?? {}
    nameDlgOpen.value = true
    void nextTick(() => {
      const input = nameForm.value?.querySelector('input')
      input?.focus()
      input?.select()
    })
  }

  function onNameSave(): void {
    const name = nameDlgValue.value.trim()
    if (!name) {
      nameDlgError.value = t('modules.api.nameRequired')
      return
    }
    if (nameDlgKind.value === 'folder') {
      if (nameDlgMode.value === 'create') {
        api.addFolder(name)
        toast.success(t('modules.api.folderAdded'))
      } else if (api.renameFolder(nameDlgId.value, name)) {
        toast.success(t('modules.api.folderRenamed'))
      }
    } else if (nameDlgMode.value === 'create') {
      api.addRequest({
        folderId: requestDraft.value.folderId,
        draftsName: t('modules.api.drafts'),
        method: requestDraft.value.method,
        listen: requestDraft.value.listen,
        name,
      })
      toast.success(t('modules.api.requestAdded'))
    } else if (api.renameRequest(nameDlgId.value, name)) {
      toast.success(t('modules.api.requestRenamed'))
    }
    nameDlgOpen.value = false
  }

  function openConfirm(kind: 'folder' | 'request' | 'history' | 'history-all', id: string, name: string): void {
    confirmKind.value = kind
    confirmId.value = id
    confirmName.value = name
    confirmOpen.value = true
  }

  function onConfirmDelete(): void {
    if (confirmKind.value === 'folder') {
      if (api.deleteFolder(confirmId.value)) toast.success(t('modules.api.folderDeleted'))
    } else if (confirmKind.value === 'request') {
      if (api.deleteRequest(confirmId.value)) toast.success(t('modules.api.requestDeleted'))
    } else if (confirmKind.value === 'history') {
      void api.deleteHistory(confirmId.value)
      toast.success(t('modules.api.historyDeleted'))
    } else if (confirmKind.value === 'history-all') {
      void api.clearHistory()
      toast.success(t('modules.api.historyCleared'))
    }
    confirmOpen.value = false
  }

  function exportFolders(slice: ApiFolder[], filename: string): void {
    downloadJson(filename, serializeCollection(slice))
    toast.success(t('modules.api.exportSuccess'))
  }

  async function importInto(folderId?: string): Promise<void> {
    const text = await pickJsonFile()
    if (text == null) return
    const parsed = parseCollection(text)
    if ('error' in parsed) {
      toast.error(t(parsed.error === 'kind' ? 'modules.api.importKindError' : 'modules.api.importError'))
      return
    }
    const result = api.mergeImported(parsed.folders, folderId)
    toast.success(t('modules.api.importSuccess', { folders: result.folders, requests: result.requests }))
  }

  function onRootCtx(key: string): void {
    if (tryCreatePane(key)) return
    if (key === 'new-folder') {
      openNameDialog('folder', 'create', '', t('modules.api.newFolder'))
      return
    }
    if (key === 'import') {
      void importInto()
      return
    }
    if (key === 'export') {
      exportFolders(api.folders, `niuma-api-${fileSlug('collection')}.json`)
    }
  }

  function onFolderCtx(key: string, folderId: string): void {
    const folder = api.folderById(folderId)
    if (!folder) return
    if (tryCreatePane(key, folderId)) return
    if (key === 'import') {
      void importInto(folderId)
      return
    }
    if (key === 'export') {
      exportFolders([folder], `niuma-api-${fileSlug(folder.name)}.json`)
      return
    }
    if (key === 'rename') {
      openNameDialog('folder', 'edit', folderId, folder.name)
      return
    }
    if (key === 'delete') {
      openConfirm('folder', folderId, folder.name)
    }
  }

  function onRequestCtx(key: string, requestId: string): void {
    const req = api.requestById(requestId)
    if (!req) return
    if (key === 'duplicate') {
      api.duplicateRequest(requestId)
      toast.success(t('modules.api.requestDuplicated'))
      return
    }
    if (key === 'export') {
      const folder = api.folders.find((item) => item.requests.some((row) => row.id === requestId))
      exportFolders(
        [{ id: folder?.id ?? requestId, name: req.name, requests: [{ ...req }] }],
        `niuma-api-${fileSlug(req.name)}.json`,
      )
      return
    }
    if (key === 'rename') {
      openNameDialog('request', 'edit', requestId, req.name)
      return
    }
    if (key.startsWith('move-folder:')) {
      const folderId = key.slice('move-folder:'.length)
      if (api.moveRequest(requestId, folderId)) toast.success(t('modules.api.requestMoved'))
      return
    }
    if (key === 'delete') {
      openConfirm('request', requestId, req.name)
    }
  }

  function onHistoryCtx(key: string, historyId?: string): void {
    if (key === 'clear-history') {
      openConfirm('history-all', '', '')
      return
    }
    if (!historyId) return
    if (key === 'open-history') {
      api.openHistory(historyId)
      return
    }
    if (key === 'delete-history') {
      const item = api.history.find((row) => row.historyId === historyId)
      openConfirm('history', historyId, item?.requestName ?? '')
    }
  }

  function onCtxSelect(key: string): void {
    const target = ctxTarget.value
    if (api.sideView === 'history') {
      onHistoryCtx(key, target?.kind === 'history' ? target.historyId : undefined)
      return
    }
    if (!target || target.kind === 'history') {
      onRootCtx(key)
      return
    }
    if (target.kind === 'folder') {
      onFolderCtx(key, target.folderId)
      return
    }
    onRequestCtx(key, target.requestId)
  }

  return {
    api,
    selectedId,
    ctxTarget,
    ctxMenuOpen,
    nameDlgOpen,
    nameDlgValue,
    nameDlgError,
    nameForm,
    nameDlgTitle,
    confirmOpen,
    confirmTitle,
    confirmDesc,
    activeCtxItems,
    setSideView,
    onSelect,
    onNewRequest,
    openNameDialog,
    onNameSave,
    onConfirmDelete,
    onCtxSelect,
  }
}
