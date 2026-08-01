/**
 * 达梦对象脚本：视图 / 过程 / 函数新建与编辑。
 * 正文经 tab.props.draftSql 持久化；禁止依赖其它库模块业务实现。
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem } from '@niuma/ui'
import { oracleApi } from '@/api/oracle'
import { buildObjectScriptContextMenuItems } from '@/modules/database'
import { useOracleSqlEditor } from '@/modules/oracle/composables/useOracleSqlEditor'
import {
  objectKindIcon,
  objectKindToCategory,
  type OracleObjectKind,
  type OracleObjectScriptMode,
} from '@/modules/oracle/types/object-script'
import {
  normalizeOracleObjectDdlForEdit,
  parseOracleObjectNameFromSql,
  toReplaceSql,
} from '@/modules/oracle/utils/normalize-object-ddl'
import { createObjectTemplate } from '@/modules/oracle/utils/script-templates'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { refreshResourceIfLoaded } from '@/modules/ops/composables/useConnTreeChildren'
import {
  defaultOracleProfile,
  resolveMonacoLanguageFromProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import { useSessionRegistry } from '@/stores/session-registry'
import { useTabStore } from '@/stores/tab'

export type OracleObjectScriptProps = {
  sessionId: string | null
  profileId?: string
  schema?: string
  objectKind: OracleObjectKind
  objectName?: string
  designMode?: OracleObjectScriptMode
  initialSql?: string
  draftSql?: string
  tabId?: string
  sessionLabel?: string
  active?: boolean
}

const DRAFT_PERSIST_MS = 400

function categoryPath(schema: string, category: string): ConnResourcePath {
  return {
    segments: [
      { kind: 'schema', name: schema },
      { kind: 'category', name: category },
    ],
  }
}

function schemaOnlyPath(schema: string): ConnResourcePath {
  return { segments: [{ kind: 'schema', name: schema }] }
}

export function useOracleObjectScript(props: OracleObjectScriptProps) {
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
  const localDesignMode = ref<OracleObjectScriptMode | null>(null)
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

  const designMode = computed<OracleObjectScriptMode>(
    () => localDesignMode.value ?? props.designMode ?? 'alter',
  )
  const modeCreate = computed(() => designMode.value === 'create')
  const objectName = computed(() => localObjectName.value ?? props.objectName ?? '')
  const objectKind = computed(() => props.objectKind)
  const kindIcon = computed(() => objectKindIcon(objectKind.value))
  const schemaName = computed(() => props.schema?.trim() ?? '')

  const kindLabel = computed(() => {
    if (objectKind.value === 'procedure') return t('modules.oracle.session.tabProcedure')
    if (objectKind.value === 'function') return t('modules.oracle.session.tabFunction')
    if (objectKind.value === 'package') return t('modules.oracle.session.tabPackage')
    return t('modules.oracle.session.tabView')
  })

  const applyLabel = computed(() =>
    modeCreate.value
      ? t('modules.oracle.objectScript.create')
      : t('modules.oracle.objectScript.save'),
  )

  function dialectProfile() {
    if (!props.sessionId) return defaultOracleProfile()
    return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultOracleProfile()
  }

  const editor = useOracleSqlEditor({
    sqlText,
    active: () => props.active !== false,
    onRun: () => {
      void onApply()
    },
    getDialect: () => dialectProfile(),
    getSuggestScope: () => {
      if (!props.sessionId) return null
      const schema = schemaName.value || undefined
      return {
        sessionId: props.sessionId,
        database: schema,
        schema,
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
      } else if (schemaName.value && objectName.value) {
        applyLoadedSql(
          createObjectTemplate(schemaName.value, objectKindToCategory(objectKind.value)),
        )
      } else if (schemaName.value) {
        applyLoadedSql(
          createObjectTemplate(schemaName.value, objectKindToCategory(objectKind.value)),
        )
      } else {
        applyLoadedSql('')
      }
      if (force) clearDraftProp()
      return
    }

    if (!props.sessionId || !schemaName.value || !objectName.value) {
      if (!sqlText.value.trim()) applyLoadedSql('')
      return
    }

    loading.value = true
    try {
      let loaded = ''
      if (objectKind.value === 'view') {
        const result = await oracleApi.metaDDL({
          sessionId: props.sessionId,
          schema: schemaName.value,
          table: objectName.value,
        })
        const cleaned = normalizeOracleObjectDdlForEdit(result.ddl)
        try {
          loaded = formatSql(cleaned, { dialect: 'oracle' })
        } catch {
          loaded = cleaned
        }
      } else if (objectKind.value === 'package') {
        const result = await oracleApi.metaPackageSource({
          sessionId: props.sessionId,
          schema: schemaName.value,
          name: objectName.value,
          part: 'both',
        })
        loaded = normalizeOracleObjectDdlForEdit(
          [result.definition, result.bodyDefinition].filter(Boolean).join('\n/\n\n'),
        )
      } else {
        const result = await oracleApi.metaRoutineSource({
          sessionId: props.sessionId,
          schema: schemaName.value,
          name: objectName.value,
          kind: objectKind.value,
        })
        const cleaned = normalizeOracleObjectDdlForEdit(result.definition)
        try {
          loaded = formatSql(cleaned, { dialect: 'oracle' })
        } catch {
          loaded = cleaned
        }
      }
      applyLoadedSql(loaded)
      clearDraftProp()
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : t('modules.oracle.objectScript.loadError')
      lastError.value = msg
      toast.error(msg)
      if (!force && !sqlText.value.trim()) applyLoadedSql('')
    } finally {
      loading.value = false
    }
  }

  async function execOne(sql: string): Promise<void> {
    if (!props.sessionId) {
      throw new Error(t('modules.oracle.objectScript.needSession'))
    }
    const stmt = sql.trim()
    if (!stmt) {
      throw new Error(t('modules.oracle.objectScript.empty'))
    }
    const result = await oracleApi.queryExec({
      sessionId: props.sessionId,
      schema: schemaName.value || undefined,
      sql: stmt,
      limit: 1,
    })
    if (result.resultSetId) {
      await oracleApi
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
      throw new Error(t('modules.oracle.objectScript.empty'))
    }
    for (const stmt of statements) {
      await execOne(stmt)
    }
  }

  async function applyRoutineFullScript(
    raw: string,
    _schema: string,
    _namesToDrop: Iterable<string>,
  ): Promise<void> {
    if (/^\s*create\b/i.test(raw) && /\b(procedure|function)\b/i.test(raw)) {
      await execOne(toReplaceSql(raw))
      return
    }
    await execStatements(raw)
  }

  async function refreshTree(): Promise<void> {
    if (!props.profileId || !schemaName.value) return
    const conn = { profileId: props.profileId, kind: 'oracle' } as ConnItem
    const cat = objectKindToCategory(objectKind.value)
    try {
      await refreshResourceIfLoaded(conn, categoryPath(schemaName.value, cat), { deep: true })
      await refreshResourceIfLoaded(conn, schemaOnlyPath(schemaName.value), { deep: false })
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
    }
    if (objectKind.value === 'view') {
      nextProps.table = name
      nextProps.isView = true
    } else {
      nextProps.routine = name
      nextProps.routineKind = objectKind.value
    }
    tabs.updateTabProps(tabId, nextProps)
    const tab = tabs.allTabs.find((item) => item.tabId === tabId)
    if (tab && 'initialSql' in tab.props) {
      delete tab.props.initialSql
    }
    const base = schemaName.value ? `${schemaName.value}.${name}` : name
    tabs.updateTitle(tabId, `${base} · ${kindLabel.value}`)
  }

  async function onApply(): Promise<void> {
    if (!props.sessionId || saving.value) return
    editor.syncSelectionFlag()
    const selectionOnly = editor.hasSelection.value
    const raw = editor.resolveSql().trim()
    if (!raw) {
      lastError.value = t('modules.oracle.objectScript.empty')
      return
    }

    saving.value = true
    lastError.value = null
    lastMessage.value = null
    const wasCreate = modeCreate.value
    const sqlObjectName = parseOracleObjectNameFromSql(raw, objectKind.value)
    const appliedName = sqlObjectName || objectName.value
    try {
      if (!selectionOnly && schemaName.value && appliedName) {
        if (objectKind.value === 'view') {
          await execStatements(toReplaceSql(raw))
        } else if (objectKind.value === 'package') {
          await execStatements(raw)
        } else {
          const namesToDrop = new Set<string>([appliedName])
          if (!wasCreate && objectName.value) namesToDrop.add(objectName.value)
          await applyRoutineFullScript(raw, schemaName.value, namesToDrop)
        }
      } else {
        await execStatements(raw)
      }
      const okMsg = wasCreate
        ? t('modules.oracle.objectScript.createOk', { name: appliedName })
        : t('modules.oracle.objectScript.saveOk')
      lastMessage.value = okMsg
      toast.success(okMsg)
      await refreshTree()

      if (!selectionOnly) {
        if (objectKind.value === 'view') {
          suppressDraftPersist = true
          sqlText.value = toReplaceSql(sqlText.value)
          void nextTick(() => {
            suppressDraftPersist = false
          })
        } else if (/^\s*create\b/i.test(sqlText.value) && !/^create\s+or\s+replace\b/i.test(sqlText.value.trim())) {
          suppressDraftPersist = true
          sqlText.value = toReplaceSql(sqlText.value)
          void nextTick(() => {
            suppressDraftPersist = false
          })
        }
        if (appliedName) switchToAlterAfterCreate(appliedName)
        baselineSql.value = sqlText.value
        persistDraftNow()
        const tabId = resolveTabId()
        if (tabId) tabs.setDirty(tabId, false)
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : t('modules.oracle.objectScript.execError')
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
      toast.success(t('modules.oracle.objectScript.copied'))
    } catch {
      toast.error(t('modules.oracle.objectScript.copyFailed'))
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
        applySelection: t('modules.oracle.query.runSelection'),
        format: t('modules.oracle.query.format'),
        compress: t('modules.oracle.query.compress'),
        copy: t('modules.oracle.objectScript.copy'),
        paste: t('modules.oracle.query.paste'),
        askAi: t('modules.oracle.query.askAi'),
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
        schemaName.value,
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
  }
}
