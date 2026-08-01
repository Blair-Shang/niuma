/**
 * ClickHouse 对象脚本：视图 / 物化视图 / 字典新建与编辑。
 *
 * 分层：
 * - 加载：meta.ddl + 前端展示规范化
 * - 预览 / 保存策略：后端 ddl.objectScriptPreview|Apply（按会话 Cap 裁决）
 * - 正文草稿：tab.props.draftSql
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem } from '@niuma/ui'
import { clickhouseApi } from '@/api/clickhouse'
import type { ClickHouseObjectScriptParams } from '@/api/types/clickhouse'
import { buildObjectScriptContextMenuItems } from '@/modules/database'
import { useClickHouseSqlEditor } from '@/modules/clickhouse/composables/useClickHouseSqlEditor'
import {
  objectKindIcon,
  objectKindToCategory,
  type ClickHouseObjectKind,
  type ClickHouseObjectScriptMode,
} from '@/modules/clickhouse/types/object-script'
import {
  normalizeClickHouseObjectDdlForEdit,
  parseClickHouseObjectNameFromSql,
  toReplaceSql,
} from '@/modules/clickhouse/utils/normalize-object-ddl'
import { fetchConnectionDefaultCluster } from '@/modules/clickhouse/utils/cluster'
import { createObjectTemplate } from '@/modules/clickhouse/utils/script-templates'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import {
  patchCategoryObjectCount,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import {
  defaultClickHouseProfile,
  resolveMonacoLanguageFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import { useSessionRegistry } from '@/stores/session-registry'
import { useTabStore } from '@/stores/tab'

export type ClickHouseObjectScriptProps = {
  sessionId: string | null
  profileId?: string
  database?: string
  objectKind: ClickHouseObjectKind
  objectName?: string
  designMode?: ClickHouseObjectScriptMode
  initialSql?: string
  draftSql?: string
  tabId?: string
  sessionLabel?: string
  active?: boolean
}

const DRAFT_PERSIST_MS = 400

function categoryPath(database: string, category: string): ConnResourcePath {
  return {
    segments: [
      { kind: 'database', name: database },
      { kind: 'category', name: category },
    ],
  }
}

export function useClickHouseObjectScript(props: ClickHouseObjectScriptProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const sessionRegistry = useSessionRegistry()
  const tabs = useTabStore()

  const loading = ref(false)
  const saving = ref(false)
  const sqlText = ref('')
  const baselineSql = ref('')
  const lastMessage = ref<string | null>(null)
  const lastError = ref<string | null>(null)
  const localDesignMode = ref<ClickHouseObjectScriptMode | null>(null)
  const localObjectName = ref<string | null>(null)
  /** 连接配置默认 ON CLUSTER（保存 / 新建模板注入） */
  const defaultOnCluster = ref('')
  const showPreview = ref(false)
  const previewLoading = ref(false)
  const previewSqls = ref<string[]>([])
  const previewStrategy = ref('')
  let suppressDraftPersist = false
  let draftTimer: ReturnType<typeof setTimeout> | null = null

  async function refreshDefaultCluster(): Promise<void> {
    if (!props.profileId) {
      defaultOnCluster.value = ''
      return
    }
    defaultOnCluster.value = await fetchConnectionDefaultCluster(props.profileId)
  }

  function clusterOpts(): { onCluster?: string } | undefined {
    const oc = defaultOnCluster.value.trim()
    return oc ? { onCluster: oc } : undefined
  }

  function buildObjectScriptParams(raw: string, selectionOnly: boolean): ClickHouseObjectScriptParams {
    const oc = defaultOnCluster.value.trim()
    return {
      sessionId: props.sessionId || undefined,
      kind: objectKind.value,
      sql: raw,
      database: databaseName.value || undefined,
      existingName: modeCreate.value ? undefined : objectName.value || undefined,
      mode: designMode.value,
      cluster: oc || undefined,
      selectionOnly,
    }
  }

  function resolveTabId(): string | null {
    return props.tabId || tabs.activeTabId || null
  }

  function applyLoadedSql(sql: string): void {
    suppressDraftPersist = true
    sqlText.value = sql
    baselineSql.value = sql
    void nextTick(() => {
      suppressDraftPersist = false
    })
  }

  function clearDraftProp(): void {
    const tabId = resolveTabId()
    if (!tabId) return
    const tab = tabs.allTabs.find((item) => item.tabId === tabId)
    if (tab && 'draftSql' in tab.props) {
      delete tab.props.draftSql
    }
    tabs.setDirty(tabId, false)
  }

  function persistDraftNow(): void {
    const tabId = resolveTabId()
    if (!tabId || suppressDraftPersist) return
    const text = sqlText.value
    tabs.updateTabProps(tabId, { draftSql: text })
    tabs.setDirty(tabId, text !== baselineSql.value)
  }

  function schedulePersistDraft(): void {
    if (suppressDraftPersist) return
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      draftTimer = null
      persistDraftNow()
    }, DRAFT_PERSIST_MS)
  }

  const designMode = computed<ClickHouseObjectScriptMode>(
    () => localDesignMode.value ?? props.designMode ?? 'alter',
  )
  const modeCreate = computed(() => designMode.value === 'create')
  const objectName = computed(() => localObjectName.value ?? props.objectName ?? '')
  const objectKind = computed(() => props.objectKind)
  const kindIcon = computed(() => objectKindIcon(objectKind.value))
  const databaseName = computed(() => props.database?.trim() ?? '')

  const kindLabel = computed(() => {
    if (objectKind.value === 'materializedView') {
      return t('modules.clickhouse.session.tabMaterializedView')
    }
    if (objectKind.value === 'dictionary') {
      return t('modules.clickhouse.session.tabDictionary')
    }
    return t('modules.clickhouse.session.tabView')
  })

  const applyLabel = computed(() =>
    modeCreate.value
      ? t('modules.clickhouse.objectScript.create')
      : t('modules.clickhouse.objectScript.save'),
  )

  function dialectProfile() {
    if (!props.sessionId) return defaultClickHouseProfile()
    return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultClickHouseProfile()
  }

  const editor = useClickHouseSqlEditor({
    sqlText,
    active: () => props.active !== false,
    onRun: () => {
      void onApply()
    },
    getDialect: () => dialectProfile(),
    getSuggestScope: () => {
      if (!props.sessionId) return null
      const database = databaseName.value || undefined
      return {
        sessionId: props.sessionId,
        database,
        schema: database,
      }
    },
  })

  async function loadScript(opts?: { force?: boolean }): Promise<void> {
    lastError.value = null
    lastMessage.value = null
    const force = opts?.force === true
    const draft = typeof props.draftSql === 'string' ? props.draftSql : ''

    if (!force && draft.trim()) {
      applyLoadedSql(draft)
      return
    }

    if (modeCreate.value) {
      if (props.initialSql?.trim()) {
        applyLoadedSql(props.initialSql)
      } else if (databaseName.value) {
        await refreshDefaultCluster()
        applyLoadedSql(
          createObjectTemplate(
            databaseName.value,
            objectKindToCategory(objectKind.value),
            clusterOpts(),
          ),
        )
      } else {
        applyLoadedSql('')
      }
      if (force) clearDraftProp()
      return
    }

    if (!props.sessionId || !databaseName.value || !objectName.value) {
      if (!sqlText.value.trim()) applyLoadedSql('')
      return
    }

    loading.value = true
    try {
      const result = await clickhouseApi.metaDDL({
        sessionId: props.sessionId,
        database: databaseName.value,
        table: objectName.value,
      })
      const cleaned = normalizeClickHouseObjectDdlForEdit(result.ddl)
      let loaded = cleaned
      try {
        loaded = formatSql(cleaned, { dialect: 'clickhouse' })
      } catch {
        loaded = cleaned
      }
      applyLoadedSql(loaded)
      clearDraftProp()
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : t('modules.clickhouse.objectScript.loadError')
      lastError.value = msg
      toast.error(msg)
      if (!force && !sqlText.value.trim()) applyLoadedSql('')
    } finally {
      loading.value = false
    }
  }

  /** @param updateCounts 新建时就地 patch 分类徽章，不重拉 database（对齐 Kingbase） */
  async function refreshTree(updateCounts: boolean): Promise<void> {
    if (!props.profileId || !databaseName.value) return
    const conn = { profileId: props.profileId, kind: 'clickhouse' } as ConnItem
    const cat = objectKindToCategory(objectKind.value)
    const path = categoryPath(databaseName.value, cat)
    try {
      await refreshResourceIfLoaded(conn, path, { deep: false })
      if (updateCounts) {
        patchCategoryObjectCount(conn, path, { delta: 1 })
      }
    } catch {
      // 刷树失败不影响保存成功提示
    }
  }

  function switchToAlterAfterCreate(name: string): void {
    localDesignMode.value = 'alter'
    localObjectName.value = name
    const tabId = resolveTabId()
    if (!tabId) return
    const nextProps: Record<string, unknown> = {
      designMode: 'alter',
      objectName: name,
      objectKind: objectKind.value,
      table: name,
      isView: true,
    }
    tabs.updateTabProps(tabId, nextProps)
    const tab = tabs.allTabs.find((item) => item.tabId === tabId)
    if (tab && 'initialSql' in tab.props) {
      delete tab.props.initialSql
    }
    // Tab 只显示对象名；库.对象与功能放 tip（对齐 Kingbase）
    tabs.updateTitle(tabId, name)
    if (tab) {
      const resourcePrefix = `${t('workspace.tabTipResource')}:`
      const featurePrefix = `${t('workspace.tabTipFeature')}:`
      const resource = databaseName.value ? `${databaseName.value}.${name}` : name
      const head = (tab.tooltip ?? '')
        .split('\n')
        .filter(Boolean)
        .filter((line) => !line.startsWith(resourcePrefix) && !line.startsWith(featurePrefix))
      const next = [...head]
      if (resource) next.push(`${resourcePrefix} ${resource}`)
      next.push(`${featurePrefix} ${kindLabel.value}`)
      tab.tooltip = next.join('\n')
    }
  }

  async function runPreview(): Promise<void> {
    if (!props.sessionId) {
      toast.error(t('modules.clickhouse.objectScript.needSession'))
      return
    }
    editor.syncSelectionFlag()
    const selectionOnly = editor.hasSelection.value
    const raw = editor.resolveSql().trim()
    if (!raw) {
      lastError.value = t('modules.clickhouse.objectScript.empty')
      toast.error(lastError.value)
      return
    }
    previewLoading.value = true
    lastError.value = null
    try {
      await refreshDefaultCluster()
      const result = await clickhouseApi.ddlObjectScriptPreview(
        buildObjectScriptParams(raw, selectionOnly),
      )
      previewSqls.value = result.sql ?? []
      previewStrategy.value = result.strategy ?? ''
      showPreview.value = true
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : t('modules.clickhouse.objectScript.execError')
      lastError.value = msg
      toast.error(msg)
    } finally {
      previewLoading.value = false
    }
  }

  function onPreviewOpenChange(open: boolean): void {
    showPreview.value = open
    if (open && !previewLoading.value) {
      void runPreview()
    }
  }

  async function copyPreview(): Promise<void> {
    const body = previewSqls.value.join(';\n\n').trim()
    if (!body) return
    const text = body.endsWith(';') ? body : `${body};`
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('modules.clickhouse.objectScript.copyPreviewOk'))
    } catch {
      toast.error(t('modules.clickhouse.objectScript.copyPreviewFailed'))
    }
  }

  async function onApply(): Promise<void> {
    if (!props.sessionId || saving.value) return
    editor.syncSelectionFlag()
    const selectionOnly = editor.hasSelection.value
    const raw = editor.resolveSql().trim()
    if (!raw) {
      lastError.value = t('modules.clickhouse.objectScript.empty')
      return
    }

    saving.value = true
    lastError.value = null
    lastMessage.value = null
    const wasCreate = modeCreate.value
    const sqlObjectName = parseClickHouseObjectNameFromSql(raw, objectKind.value)
    const appliedName = sqlObjectName || objectName.value
    try {
      await refreshDefaultCluster()
      await clickhouseApi.ddlObjectScriptApply(buildObjectScriptParams(raw, selectionOnly))
      const okMsg = wasCreate
        ? t('modules.clickhouse.objectScript.createOk', { name: appliedName })
        : t('modules.clickhouse.objectScript.saveOk')
      lastMessage.value = okMsg
      toast.success(okMsg)
      await refreshTree(wasCreate)

      if (!selectionOnly) {
        if (objectKind.value === 'view') {
          suppressDraftPersist = true
          sqlText.value = toReplaceSql(sqlText.value)
          void nextTick(() => {
            suppressDraftPersist = false
          })
        }
        if (wasCreate && appliedName) {
          switchToAlterAfterCreate(appliedName)
        }
        baselineSql.value = sqlText.value
        persistDraftNow()
        const tabId = resolveTabId()
        if (tabId) tabs.setDirty(tabId, false)
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : t('modules.clickhouse.objectScript.execError')
      lastError.value = msg
      toast.error(msg)
    } finally {
      saving.value = false
    }
  }

  async function copyScript(): Promise<void> {
    if (!sqlText.value) return
    try {
      await navigator.clipboard.writeText(sqlText.value)
      toast.success(t('modules.clickhouse.objectScript.copied'))
    } catch {
      toast.error(t('modules.clickhouse.objectScript.copyFailed'))
    }
  }

  function formatEditor(): void {
    void editor.formatSql()
  }

  async function askAiAboutSelection(): Promise<void> {
    const { executeCommand } = await import('@/extensions/contributions/command-registry')
    editor.syncSelectionFlag()
    const sql = editor.resolveSql()
    if (sql) {
      const { publishEditorSelection } = await import('@/shell/panels/ai/workspace-context')
      publishEditorSelection({
        tabId: tabs.activeTabId || undefined,
        text: sql,
        language: 'sql',
        source: 'monaco',
      })
    }
    await executeCommand('workbench.ai.askSelection')
  }

  const contextMenuItems = computed((): RsContextMenuItem[] =>
    buildObjectScriptContextMenuItems({
      labels: {
        apply: applyLabel.value,
        applySelection: t('modules.clickhouse.query.runSelection'),
        format: t('modules.clickhouse.query.format'),
        compress: t('modules.clickhouse.query.compress'),
        copy: t('modules.clickhouse.objectScript.copy'),
        paste: t('modules.clickhouse.query.paste'),
        askAi: t('modules.clickhouse.query.askAi'),
      },
      saving: saving.value,
      hasSelection: editor.hasSelection.value,
      sqlEmpty: !sqlText.value.trim(),
      canApply: Boolean(props.sessionId),
      showAskAi: true,
    }),
  )

  function onContextMenuSelect(key: string): void {
    editor.syncSelectionFlag()
    if (key === 'apply') void onApply()
    else if (key === 'format') void editor.formatSql()
    else if (key === 'compress') void editor.compressSql()
    else if (key === 'copy') editor.copyEditor()
    else if (key === 'paste') void editor.pasteEditor()
    else if (key === 'askAi') void askAiAboutSelection()
  }

  watch(sqlText, () => {
    schedulePersistDraft()
  })

  watch(
    () =>
      [
        props.sessionId,
        databaseName.value,
        props.objectKind,
        props.objectName,
        props.designMode,
        props.active,
      ] as const,
    (curr, prev) => {
      localDesignMode.value = null
      localObjectName.value = null
      if (props.active === false) return
      if (prev && prev[4] === 'create' && curr[4] === 'alter') {
        persistDraftNow()
        return
      }
      if (
        prev &&
        sqlText.value.trim() &&
        prev[1] === curr[1] &&
        prev[2] === curr[2] &&
        prev[3] === curr[3] &&
        prev[4] === curr[4]
      ) {
        return
      }
      void loadScript()
    },
    { immediate: true },
  )

  onUnmounted(() => {
    if (draftTimer) clearTimeout(draftTimer)
    if (!suppressDraftPersist && sqlText.value.trim()) {
      persistDraftNow()
    }
  })

  const monacoLanguage = computed(() =>
    resolveMonacoLanguageFromProfile(dialectProfile()).monacoLanguageId,
  )

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
    objectKind,
    kindIcon,
    kindLabel,
    applyLabel,
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
    previewStrategy,
    runPreview,
    onPreviewOpenChange,
    copyPreview,
  }
}
