/**
 * SQLite 对象脚本：视图 / 触发器 / 索引新建与编辑。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem } from '@niuma/ui'
import { sqliteApi } from '@/api/sqlite'
import { buildObjectScriptContextMenuItems } from '@/modules/database'
import { useSqliteSqlEditor } from '@/modules/sqlite/composables/useSqliteSqlEditor'
import {
  createObjectTemplate,
  objectKindIcon,
  objectKindToCategory,
  parseObjectNameFromSql,
  type SqliteObjectKind,
  type SqliteObjectScriptMode,
} from '@/modules/sqlite/types/object-script'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import {
  patchCategoryObjectCount,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import {
  defaultSqliteProfile,
  resolveMonacoLanguageFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import { useSessionRegistry } from '@/stores/session-registry'
import { useTabStore } from '@/stores/tab'

export type SqliteObjectScriptProps = {
  sessionId: string | null
  profileId?: string
  schema?: string
  objectKind: SqliteObjectKind
  objectName?: string
  designMode?: SqliteObjectScriptMode
  initialSql?: string
  draftSql?: string
  tabId?: string
  sessionLabel?: string
  active?: boolean
}

const DRAFT_PERSIST_MS = 400

export function useSqliteObjectScript(props: SqliteObjectScriptProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const sessionRegistry = useSessionRegistry()
  const tabs = useTabStore()

  const loading = ref(false)
  const saving = ref(false)
  const sqlText = ref('')
  const lastMessage = ref<string | null>(null)
  const lastError = ref<string | null>(null)
  const localDesignMode = ref<SqliteObjectScriptMode | null>(null)
  const localObjectName = ref<string | null>(null)
  const showPreview = ref(false)
  const previewLoading = ref(false)
  const previewSqls = ref<string[]>([])
  let suppressDraftPersist = false
  let draftTimer: ReturnType<typeof setTimeout> | null = null

  const objectKind = computed(() => props.objectKind)
  const schemaName = computed(() => props.schema?.trim() || 'main')
  const designMode = computed<SqliteObjectScriptMode>(
    () => localDesignMode.value ?? props.designMode ?? (props.objectName ? 'alter' : 'create'),
  )
  const modeCreate = computed(() => designMode.value === 'create')
  const objectName = computed(
    () => localObjectName.value ?? props.objectName?.trim() ?? '',
  )
  const kindIcon = computed(() => objectKindIcon(objectKind.value))
  const kindLabel = computed(() => {
    switch (objectKind.value) {
      case 'trigger':
        return t('modules.sqlite.objectScript.kindTrigger')
      case 'index':
        return t('modules.sqlite.objectScript.kindIndex')
      default:
        return t('modules.sqlite.objectScript.kindView')
    }
  })
  const applyLabel = computed(() =>
    modeCreate.value
      ? t('modules.sqlite.objectScript.create')
      : t('modules.sqlite.objectScript.save'),
  )

  const dialect = computed(
    () => sessionRegistry.getDialectForSession(props.sessionId) ?? defaultSqliteProfile(),
  )

  const editor = useSqliteSqlEditor({
    sqlText,
    active: () => props.active !== false,
    onRun: () => {
      void onApply()
    },
    getSuggestScope: () =>
      props.sessionId
        ? {
            sessionId: props.sessionId,
            schema: schemaName.value,
            database: schemaName.value,
          }
        : null,
    getDialect: () => dialect.value,
  })

  const monacoLanguage = computed(
    () => resolveMonacoLanguageFromProfile(dialect.value).monacoLanguageId,
  )

  /** 必须用本面板 tabId；禁止回退 activeTabId，避免多 Tab / keep-alive 串台 */
  function resolveTabId(): string | null {
    const id = props.tabId?.trim()
    return id || null
  }

  function persistDraft(): void {
    if (suppressDraftPersist) return
    const tabId = resolveTabId()
    if (!tabId) return
    tabs.updateTabProps(tabId, { draftSql: sqlText.value })
  }

  watch(sqlText, () => {
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      draftTimer = null
      persistDraft()
    }, DRAFT_PERSIST_MS)
  })

  async function loadScript(): Promise<void> {
    lastError.value = null
    lastMessage.value = null
    if (modeCreate.value) {
      const name = objectName.value || 'new_object'
      suppressDraftPersist = true
      sqlText.value =
        props.draftSql?.trim() ||
        props.initialSql?.trim() ||
        createObjectTemplate(objectKind.value, schemaName.value, name)
      suppressDraftPersist = false
      return
    }
    if (!props.sessionId || !objectName.value) {
      lastError.value = t('modules.sqlite.objectScript.needObject')
      return
    }
    loading.value = true
    try {
      const res = await sqliteApi.metaDDL({
        sessionId: props.sessionId,
        schema: schemaName.value,
        name: objectName.value,
        type: objectKind.value,
      })
      suppressDraftPersist = true
      sqlText.value = props.draftSql?.trim() || res.ddl || ''
      suppressDraftPersist = false
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : t('modules.sqlite.objectScript.loadError')
    } finally {
      loading.value = false
    }
  }

  async function runPreview(): Promise<void> {
    if (!props.sessionId) {
      lastError.value = t('modules.sqlite.objectScript.needSession')
      return
    }
    const raw = sqlText.value.trim()
    if (!raw) {
      lastError.value = t('modules.sqlite.objectScript.empty')
      return
    }
    previewLoading.value = true
    lastError.value = null
    try {
      const res = await sqliteApi.ddlObjectScriptPreview({
        sessionId: props.sessionId,
        kind: objectKind.value,
        sql: raw,
        schema: schemaName.value,
        existingName: modeCreate.value ? undefined : objectName.value || undefined,
        mode: designMode.value,
      })
      previewSqls.value = res.sql ?? []
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      previewSqls.value = []
    } finally {
      previewLoading.value = false
    }
  }

  async function onPreviewOpenChange(open: boolean): Promise<void> {
    showPreview.value = open
    if (open) await runPreview()
  }

  async function refreshTreeAfterCreate(appliedName: string): Promise<void> {
    if (!props.profileId) return
    const conn = { profileId: props.profileId, kind: 'sqlite' } as ConnItem
    const cat = objectKindToCategory(objectKind.value)
    const path: ConnResourcePath = {
      segments: [
        { kind: 'schema', name: schemaName.value },
        { kind: 'category', name: cat },
      ],
    }
    patchCategoryObjectCount(conn, path, { delta: 1 })
    await refreshResourceIfLoaded(conn, path)
    void appliedName
  }

  /** 创建成功后切 alter：Tab 只显示对象名，完整路径放 tip（对齐 MySQL）。 */
  function switchToAlterAfterCreate(name: string): void {
    localDesignMode.value = 'alter'
    localObjectName.value = name
    const tabId = resolveTabId()
    if (!tabId) return
    tabs.updateTabProps(tabId, {
      designMode: 'alter',
      objectName: name,
      objectKind: objectKind.value,
      objectType: objectKind.value,
      table: name,
    })
    const tab = tabs.allTabs.find((x) => x.tabId === tabId)
    if (tab && 'initialSql' in tab.props) {
      delete tab.props.initialSql
    }
    const base = `${schemaName.value}.${name}`
    tabs.updateTitle(tabId, name)
    if (tab) {
      const resourcePrefix = `${t('workspace.tabTipResource')}:`
      const featurePrefix = `${t('workspace.tabTipFeature')}:`
      const head = (tab.tooltip ?? '')
        .split('\n')
        .filter(Boolean)
        .filter((line) => !line.startsWith(resourcePrefix) && !line.startsWith(featurePrefix))
      const next = [...head]
      if (base) next.push(`${resourcePrefix} ${base}`)
      next.push(`${featurePrefix} ${kindLabel.value}`)
      tab.tooltip = next.join('\n')
    }
  }

  async function onApply(): Promise<void> {
    if (!props.sessionId) {
      lastError.value = t('modules.sqlite.objectScript.needSession')
      return
    }
    const raw = sqlText.value.trim()
    if (!raw) {
      lastError.value = t('modules.sqlite.objectScript.empty')
      return
    }
    saving.value = true
    lastError.value = null
    lastMessage.value = null
    try {
      await sqliteApi.ddlObjectScriptApply({
        sessionId: props.sessionId,
        kind: objectKind.value,
        sql: raw,
        schema: schemaName.value,
        existingName: modeCreate.value ? undefined : objectName.value || undefined,
        mode: designMode.value,
      })
      const appliedName = parseObjectNameFromSql(raw, objectKind.value) || objectName.value
      if (modeCreate.value && appliedName) {
        switchToAlterAfterCreate(appliedName)
        await refreshTreeAfterCreate(appliedName)
        lastMessage.value = t('modules.sqlite.objectScript.createOk', { name: appliedName })
      } else {
        lastMessage.value = t('modules.sqlite.objectScript.saveOk')
      }
      toast.success(lastMessage.value)
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : t('modules.sqlite.objectScript.execError')
    } finally {
      saving.value = false
    }
  }

  async function formatEditor(): Promise<void> {
    try {
      sqlText.value = formatSql(sqlText.value, { dialect: 'sqlite' })
    } catch {
      /* ignore */
    }
  }

  async function copyScript(): Promise<void> {
    try {
      await navigator.clipboard.writeText(sqlText.value)
      toast.success(t('modules.sqlite.objectScript.copied'))
    } catch {
      toast.error(t('modules.sqlite.objectScript.copyFailed'))
    }
  }

  async function copyPreview(): Promise<void> {
    try {
      await navigator.clipboard.writeText(previewSqls.value.join('\n\n'))
      toast.success(t('modules.sqlite.objectScript.copied'))
    } catch {
      toast.error(t('modules.sqlite.objectScript.copyFailed'))
    }
  }

  const contextMenuItems = computed((): RsContextMenuItem[] =>
    buildObjectScriptContextMenuItems({
      labels: {
        apply: applyLabel.value,
        applySelection: t('modules.sqlite.query.runSelection'),
        format: t('modules.sqlite.query.format'),
        compress: t('modules.sqlite.query.compress'),
        copy: t('modules.sqlite.objectScript.copy'),
        paste: t('modules.sqlite.query.paste'),
      },
      saving: saving.value,
      hasSelection: editor.hasSelection.value,
      sqlEmpty: !sqlText.value.trim(),
      canApply: Boolean(props.sessionId),
      showAskAi: false,
    }),
  )

  function onContextMenuSelect(key: string): void {
    editor.syncSelectionFlag?.()
    if (key === 'apply') void onApply()
    else if (key === 'format') void formatEditor()
    else if (key === 'compress') void editor.compressSql?.()
    else if (key === 'copy') void copyScript()
    else if (key === 'paste') void editor.pasteEditor?.()
  }

  watch(
    () =>
      [props.sessionId, props.schema, props.objectKind, props.objectName, props.designMode] as const,
    () => {
      localDesignMode.value = null
      localObjectName.value = null
      void loadScript()
    },
    { immediate: true },
  )

  onUnmounted(() => {
    if (draftTimer) {
      clearTimeout(draftTimer)
      draftTimer = null
    }
    persistDraft()
  })

  return {
    t,
    sqlText,
    loading,
    saving,
    lastMessage,
    lastError,
    modeCreate,
    designMode,
    objectName,
    kindIcon,
    kindLabel,
    languageReady: editor.languageReady,
    monacoLanguage,
    editorRef: editor.editorRef,
    formatEditor,
    onApply,
    copyScript,
    loadScript,
    contextMenuItems,
    onContextMenuSelect,
    showPreview,
    previewLoading,
    previewSqls,
    onPreviewOpenChange,
    copyPreview,
  }
}
