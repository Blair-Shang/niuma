/**
 * SQL Server 对象脚本：视图 / 过程 / 函数 / 序列 / 同义词。
 * 视图/过程/函数保存走 CREATE OR ALTER；已有序列走 ALTER SEQUENCE；
 * 已有同义词走 DROP + CREATE。禁止 import 其它库业务模块。
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem } from '@niuma/ui'
import { sqlserverApi } from '@/api/sqlserver'
import { buildObjectScriptContextMenuItems } from '@/modules/database'
import type { ConnItem } from '@/modules/ops/types'
import {
  patchCategoryObjectCount,
  refreshResourceIfLoaded,
} from '@/modules/ops/composables/useConnTreeChildren'
import { basePath } from '@/modules/sqlserver/conn-tree-shared'
import { useSqlServerSqlEditor } from '@/modules/sqlserver/composables/useSqlServerSqlEditor'
import {
  defaultSqlServerProfile,
  resolveMonacoLanguageFromProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import { useSessionRegistry } from '@/stores/session-registry'
import { useTabStore } from '@/stores/tab'
import {
  objectKindIcon,
  objectKindToCategory,
  type SqlServerObjectKind,
  type SqlServerObjectScriptMode,
} from '@/modules/sqlserver/types/object-script'
import {
  normalizeObjectSaveSql,
  parseSqlServerObjectNameFromSql,
} from '@/modules/sqlserver/utils/normalize-object-ddl'
import { sqlserverObjectScriptTemplate } from '@/modules/sqlserver/sql-seed'

export type SqlServerObjectScriptProps = {
  sessionId: string | null
  profileId?: string
  database?: string
  schema?: string
  objectKind?: SqlServerObjectKind
  objectName?: string
  designMode?: SqlServerObjectScriptMode
  initialSql?: string
  draftSql?: string
  tabId?: string
  sessionLabel?: string
  active?: boolean
}

const DRAFT_PERSIST_MS = 400

export function useSqlServerObjectScript(props: SqlServerObjectScriptProps) {
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
  const localDesignMode = ref<SqlServerObjectScriptMode | null>(null)
  const localObjectName = ref<string | null>(null)
  let suppressDraftPersist = false
  let draftTimer: ReturnType<typeof setTimeout> | null = null

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

  const designMode = computed<SqlServerObjectScriptMode>(
    () => localDesignMode.value ?? props.designMode ?? 'alter',
  )
  const modeCreate = computed(() => designMode.value === 'create')
  const objectName = computed(() => localObjectName.value ?? props.objectName ?? '')
  const objectKind = computed(() => props.objectKind ?? 'view')
  const schemaName = computed(() => props.schema?.trim() || 'dbo')
  const kindIcon = computed(() => objectKindIcon(objectKind.value))

  const kindLabel = computed(() => {
    if (objectKind.value === 'procedure') return t('modules.sqlserver.session.tabProcedure')
    if (objectKind.value === 'function') return t('modules.sqlserver.session.tabFunction')
    if (objectKind.value === 'sequence') return t('modules.sqlserver.session.tabSequence')
    if (objectKind.value === 'synonym') return t('modules.sqlserver.session.tabSynonym')
    return t('modules.sqlserver.session.tabView')
  })

  const applyLabel = computed(() =>
    modeCreate.value
      ? t('modules.sqlserver.objectScript.create')
      : t('modules.sqlserver.objectScript.save'),
  )

  function dialectProfile() {
    if (!props.sessionId) return defaultSqlServerProfile()
    return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultSqlServerProfile()
  }

  const editor = useSqlServerSqlEditor({
    sqlText,
    active: () => props.active !== false,
    onRun: () => {
      void onApply()
    },
    getDialect: () => dialectProfile(),
    getSuggestScope: () => {
      if (!props.sessionId) return null
      return {
        sessionId: props.sessionId,
        database: props.database?.trim() || undefined,
        schema: schemaName.value,
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
      } else {
        applyLoadedSql(sqlserverObjectScriptTemplate(objectKind.value, schemaName.value))
      }
      if (force) clearDraftProp()
      return
    }

    if (!props.sessionId || !props.database || !objectName.value) {
      if (!sqlText.value.trim()) applyLoadedSql('')
      return
    }

    loading.value = true
    try {
      let loaded = ''
      if (objectKind.value === 'view' || objectKind.value === 'synonym') {
        const result = await sqlserverApi.metaDDL({
          sessionId: props.sessionId,
          database: props.database,
          schema: schemaName.value,
          table: objectName.value,
        })
        loaded = normalizeObjectSaveSql(result.ddl, objectKind.value, designMode.value)
      } else {
        const result = await sqlserverApi.metaRoutineSource({
          sessionId: props.sessionId,
          database: props.database,
          schema: schemaName.value,
          name: objectName.value,
          kind: objectKind.value,
        })
        loaded = normalizeObjectSaveSql(result.definition, objectKind.value, designMode.value)
      }
      try {
        loaded = formatSql(loaded, { dialect: 'sqlserver' })
      } catch {
        // 保持原文
      }
      applyLoadedSql(loaded)
      clearDraftProp()
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('modules.sqlserver.objectScript.loadError')
      lastError.value = msg
      toast.error(msg)
      if (!force && !sqlText.value.trim()) applyLoadedSql('')
    } finally {
      loading.value = false
    }
  }

  async function execOne(sql: string): Promise<void> {
    if (!props.sessionId) {
      throw new Error(t('modules.sqlserver.objectScript.needSession'))
    }
    const stmt = sql.trim()
    if (!stmt) {
      throw new Error(t('modules.sqlserver.objectScript.empty'))
    }
    const result = await sqlserverApi.queryExec({
      sessionId: props.sessionId,
      database: props.database,
      sql: stmt,
      limit: 1,
    })
    if (result.resultSetId) {
      await sqlserverApi
        .queryClose({ sessionId: props.sessionId, resultSetId: result.resultSetId })
        .catch(() => undefined)
    }
  }

  async function execStatements(sql: string): Promise<void> {
    const features = resolveSplitFeaturesFromProfile(dialectProfile())
    const statements = splitSqlStatementsWithFeatures(sql, features)
      .map((item) => item.sql.trim())
      .filter(Boolean)
    if (statements.length === 0) {
      throw new Error(t('modules.sqlserver.objectScript.empty'))
    }
    for (const stmt of statements) {
      await execOne(stmt)
    }
  }

  async function refreshTree(updateCounts: boolean): Promise<void> {
    if (!props.profileId || !props.database) return
    const conn = { profileId: props.profileId, kind: 'sqlserver' } as ConnItem
    const path = basePath(props.database, schemaName.value, objectKindToCategory(objectKind.value))
    try {
      await refreshResourceIfLoaded(conn, path, { deep: false })
      if (updateCounts) {
        patchCategoryObjectCount(conn, path, { delta: 1 })
      }
    } catch {
      // 刷树失败不影响保存提示
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
    }
    if (objectKind.value === 'view') nextProps.table = name
    if (objectKind.value === 'procedure') nextProps.routine = name
    if (objectKind.value === 'function') nextProps.routine = name
    if (objectKind.value === 'sequence') nextProps.sequence = name
    if (objectKind.value === 'synonym') nextProps.synonym = name
    tabs.updateTabProps(tabId, nextProps)
    const tab = tabs.allTabs.find((item) => item.tabId === tabId)
    if (tab && 'initialSql' in tab.props) {
      delete tab.props.initialSql
    }
    tabs.updateTitle(tabId, name)
    if (tab) {
      const resource = [props.database, schemaName.value, name].filter(Boolean).join('.')
      const resourcePrefix = `${t('workspace.tabTipResource')}:`
      const featurePrefix = `${t('workspace.tabTipFeature')}:`
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

  async function onApply(): Promise<void> {
    if (!props.sessionId || saving.value) return
    editor.syncSelectionFlag()
    const selectionOnly = editor.hasSelection.value
    const raw = editor.resolveSql().trim()
    if (!raw) {
      lastError.value = t('modules.sqlserver.objectScript.empty')
      return
    }

    saving.value = true
    lastError.value = null
    lastMessage.value = null
    const wasCreate = modeCreate.value
    const sqlObjectName = parseSqlServerObjectNameFromSql(raw, objectKind.value)
    const appliedName = sqlObjectName || objectName.value
    try {
      if (selectionOnly) {
        await execStatements(raw)
      } else {
        await execStatements(normalizeObjectSaveSql(raw, objectKind.value, designMode.value))
      }
      const okMsg = wasCreate
        ? t('modules.sqlserver.objectScript.createOk', { name: appliedName })
        : t('modules.sqlserver.objectScript.saveOk')
      lastMessage.value = okMsg
      toast.success(okMsg)
      await refreshTree(wasCreate)
      if (!selectionOnly) {
        suppressDraftPersist = true
        sqlText.value = normalizeObjectSaveSql(sqlText.value, objectKind.value, 'alter')
        void nextTick(() => {
          suppressDraftPersist = false
        })
        if (appliedName) switchToAlterAfterCreate(appliedName)
        baselineSql.value = sqlText.value
        persistDraftNow()
        const tabId = resolveTabId()
        if (tabId) tabs.setDirty(tabId, false)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('modules.sqlserver.objectScript.execError')
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
      toast.success(t('modules.sqlserver.objectScript.copied'))
    } catch {
      toast.error(t('modules.sqlserver.objectScript.copyFailed'))
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
        applySelection: t('modules.sqlserver.query.runSelection'),
        format: t('modules.sqlserver.query.format'),
        compress: t('modules.sqlserver.query.compress'),
        copy: t('modules.sqlserver.query.copy'),
        paste: t('modules.sqlserver.query.paste'),
        askAi: t('modules.sqlserver.query.askAi'),
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
        props.database,
        props.schema,
        props.objectKind,
        props.objectName,
        props.designMode,
        props.active,
      ] as const,
    (curr, prev) => {
      localDesignMode.value = null
      localObjectName.value = null
      if (props.active === false) return
      if (prev && prev[5] === 'create' && curr[5] === 'alter') {
        persistDraftNow()
        return
      }
      if (
        prev &&
        sqlText.value.trim() &&
        prev[1] === curr[1] &&
        prev[2] === curr[2] &&
        prev[3] === curr[3] &&
        prev[4] === curr[4] &&
        prev[5] === curr[5]
      ) {
        return
      }
      void loadScript()
    },
    { immediate: true },
  )

  onUnmounted(() => {
    if (draftTimer) clearTimeout(draftTimer)
    if (!suppressDraftPersist && sqlText.value.trim()) persistDraftNow()
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
    schemaName,
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
  }
}
