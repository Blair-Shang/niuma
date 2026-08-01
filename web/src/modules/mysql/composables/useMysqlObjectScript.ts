/**
 * MySQL 对象脚本：视图 / 过程 / 函数 新建与编辑共用逻辑。
 * 编辑器正文经 tab.props.draftSql 随 workspace.tabs 持久化，应用重启可恢复未保存内容。
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem } from '@niuma/ui'
import { mysqlApi } from '@/api'
import {
  buildObjectScriptContextMenuItems,
} from '@/modules/database'
import type { ConnItem } from '@/modules/ops/types'
import {
  refreshResourceIfLoaded,
  patchCategoryObjectCount,
} from '@/modules/ops/composables/useConnTreeChildren'
import { categoryPath } from '@/modules/mysql/conn-tree-shared'
import { useMysqlSqlEditor } from '@/modules/mysql/composables/useMysqlSqlEditor'
import {
  defaultMySQLProfile,
  resolveMonacoLanguageFromProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import { useSessionRegistry } from '@/stores/session-registry'
import { useTabStore } from '@/stores/tab'
import type { MysqlObjectKind, MysqlObjectScriptMode } from '@/modules/mysql/types/object-script'
import {
  objectKindIcon,
  objectKindToCategory,
} from '@/modules/mysql/types/object-script'
import {
  normalizeMysqlRoutineDdlForEdit,
  normalizeMysqlViewDdlForEdit,
  parseMysqlObjectNameFromSql,
} from '@/modules/mysql/utils/normalize-object-ddl'
import {
  createObjectTemplate,
  dropFunctionSql,
  dropProcedureSql,
} from '@/modules/mysql/utils/script-templates'

export type MysqlObjectScriptProps = {
  sessionId: string | null
  profileId?: string
  database?: string
  objectKind: MysqlObjectKind
  objectName?: string
  designMode?: MysqlObjectScriptMode
  initialSql?: string
  /** 未保存草稿（Tab 持久化） */
  draftSql?: string
  tabId?: string
  sessionLabel?: string
  active?: boolean
}

const DRAFT_PERSIST_MS = 400

function toReplaceViewSql(sql: string): string {
  const trimmed = sql.trim()
  if (/^create\s+or\s+replace\s+/i.test(trimmed)) return trimmed
  return trimmed.replace(/^create\s+/i, 'CREATE OR REPLACE ')
}

export function useMysqlObjectScript(props: MysqlObjectScriptProps) {
  const { t } = useI18n()
  const toast = useRsToast()
  const sessionRegistry = useSessionRegistry()
  const tabs = useTabStore()

  const loading = ref(false)
  const saving = ref(false)
  const sqlText = ref('')
  /** 上次加载/保存成功的正文，用于 dirty 判断 */
  const baselineSql = ref('')
  const lastMessage = ref<string | null>(null)
  const lastError = ref<string | null>(null)
  const localDesignMode = ref<MysqlObjectScriptMode | null>(null)
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
    const tab = tabs.allTabs.find((t) => t.tabId === tabId)
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

  const designMode = computed<MysqlObjectScriptMode>(
    () => localDesignMode.value ?? props.designMode ?? 'alter',
  )
  const modeCreate = computed(() => designMode.value === 'create')
  const objectName = computed(
    () => localObjectName.value ?? props.objectName ?? '',
  )
  const objectKind = computed(() => props.objectKind)
  const kindIcon = computed(() => objectKindIcon(objectKind.value))

  const kindLabel = computed(() => {
    if (objectKind.value === 'procedure') {
      return t('modules.mysql.session.tabProcedure')
    }
    if (objectKind.value === 'function') {
      return t('modules.mysql.session.tabFunction')
    }
    return t('modules.mysql.session.tabView')
  })

  const applyLabel = computed(() =>
    modeCreate.value
      ? t('modules.mysql.objectScript.create')
      : t('modules.mysql.objectScript.save'),
  )

  function dialectProfile() {
    if (!props.sessionId) return defaultMySQLProfile()
    return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultMySQLProfile()
  }

  const editor = useMysqlSqlEditor({
    sqlText,
    active: () => props.active !== false,
    onRun: () => {
      void onApply()
    },
    getDialect: () => dialectProfile(),
    getSuggestScope: () => {
      if (!props.sessionId) return null
      const db = props.database?.trim() || undefined
      return {
        sessionId: props.sessionId,
        database: db,
        schema: db,
      }
    },
  })

  async function loadScript(opts?: { force?: boolean }): Promise<void> {
    lastError.value = null
    lastMessage.value = null
    const force = opts?.force === true
    const draft = typeof props.draftSql === 'string' ? props.draftSql : ''

    // 应用重启 / 切回：优先恢复未保存草稿（刷新 force 除外）
    if (!force && draft.trim()) {
      applyLoadedSql(draft)
      return
    }

    if (modeCreate.value) {
      if (props.initialSql?.trim()) {
        applyLoadedSql(props.initialSql)
      } else if (props.database && objectName.value) {
        applyLoadedSql(
          createObjectTemplate(props.database, objectKindToCategory(objectKind.value)),
        )
      } else {
        applyLoadedSql('')
      }
      if (force) clearDraftProp()
      return
    }

    if (!props.sessionId || !props.database || !objectName.value) {
      // 会话未就绪时勿清空已有正文；无草稿则保持空，等 sessionId 再拉库
      if (!sqlText.value.trim()) applyLoadedSql('')
      return
    }

    loading.value = true
    try {
      let loaded = ''
      if (objectKind.value === 'view') {
        const result = await mysqlApi.metaDDL({
          sessionId: props.sessionId,
          database: props.database,
          table: objectName.value,
        })
        const cleaned = normalizeMysqlViewDdlForEdit(result.ddl)
        try {
          loaded = formatSql(cleaned, { dialect: 'mysql' })
        } catch {
          loaded = cleaned
        }
      } else {
        const result = await mysqlApi.metaRoutineSource({
          sessionId: props.sessionId,
          database: props.database,
          name: objectName.value,
          kind: objectKind.value,
        })
        const cleaned = normalizeMysqlRoutineDdlForEdit(result.definition)
        try {
          loaded = formatSql(cleaned, { dialect: 'mysql' })
        } catch {
          loaded = cleaned
        }
      }
      applyLoadedSql(loaded)
      // 刷新/拉库成功后再清草稿，避免失败时丢掉未保存内容
      clearDraftProp()
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : t('modules.mysql.objectScript.loadError')
      lastError.value = msg
      toast.error(msg)
      if (!force && !sqlText.value.trim()) applyLoadedSql('')
    } finally {
      loading.value = false
    }
  }

  async function execOne(sql: string): Promise<void> {
    if (!props.sessionId) {
      throw new Error(t('modules.mysql.objectScript.needSession'))
    }
    const stmt = sql.trim()
    if (!stmt) {
      throw new Error(t('modules.mysql.objectScript.empty'))
    }
    const result = await mysqlApi.queryExec({
      sessionId: props.sessionId,
      database: props.database,
      sql: stmt,
      limit: 1,
    })
    if (result.resultSetId) {
      await mysqlApi
        .queryClose({ sessionId: props.sessionId, resultSetId: result.resultSetId })
        .catch(() => undefined)
    }
  }

  async function execStatements(sql: string): Promise<void> {
    if (!props.sessionId) {
      throw new Error(t('modules.mysql.objectScript.needSession'))
    }
    const features = resolveSplitFeaturesFromProfile(dialectProfile())
    const statements = splitSqlStatementsWithFeatures(sql, features)
      .map((s) => s.sql.trim())
      .filter(Boolean)
    if (statements.length === 0) {
      throw new Error(t('modules.mysql.objectScript.empty'))
    }
    for (const stmt of statements) {
      await execOne(stmt)
    }
  }

  /** 例程全文保存：先 DROP IF EXISTS（含改名旧名），再 CREATE。 */
  async function applyRoutineFullScript(
    raw: string,
    database: string,
    namesToDrop: Iterable<string>,
  ): Promise<void> {
    for (const name of namesToDrop) {
      const drop =
        objectKind.value === 'function'
          ? dropFunctionSql(database, name)
          : dropProcedureSql(database, name)
      await execOne(drop)
    }
    if (/^\s*DELIMITER\b/im.test(raw)) {
      await execStatements(raw)
      return
    }
    if (/^\s*create\b/i.test(raw) && /\b(procedure|function)\b/i.test(raw)) {
      await execOne(raw)
      return
    }
    await execStatements(raw)
  }

  /** @param updateCounts 新建时就地 patch 分类徽章，不重拉 database */
  async function refreshTree(updateCounts: boolean): Promise<void> {
    if (!props.profileId || !props.database) return
    const conn = { profileId: props.profileId, kind: 'mysql' } as ConnItem
    const cat = objectKindToCategory(objectKind.value)
    const path = categoryPath(props.database, cat)
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
    }
    if (objectKind.value === 'view') {
      nextProps.table = name
    } else {
      nextProps.routine = name
      nextProps.routineKind = objectKind.value
    }
    tabs.updateTabProps(tabId, nextProps)
    // Object.assign 无法用 undefined 删掉 initialSql，显式移除避免后续误灌模板
    const tab = tabs.allTabs.find((t) => t.tabId === tabId)
    if (tab && 'initialSql' in tab.props) {
      delete tab.props.initialSql
    }
    const base = props.database ? `${props.database}.${name}` : name
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
    if (!props.sessionId || saving.value) return
    editor.syncSelectionFlag()
    const selectionOnly = editor.hasSelection.value
    const raw = editor.resolveSql().trim()
    if (!raw) {
      lastError.value = t('modules.mysql.objectScript.empty')
      return
    }

    saving.value = true
    lastError.value = null
    lastMessage.value = null
    const wasCreate = modeCreate.value
    // 以 SQL 内真实对象名为准（用户常改掉 new_proc / new_func）；占位名仅作回退
    const sqlObjectName = parseMysqlObjectNameFromSql(raw, objectKind.value)
    const appliedName = sqlObjectName || objectName.value
    try {
      // 全文保存：视图 OR REPLACE；例程 DROP IF EXISTS + CREATE（新建/再次保存均走此路径，避免 already exists）
      // 选区执行按原样跑（对齐 Query）
      if (!selectionOnly && props.database && appliedName) {
        if (objectKind.value === 'view') {
          await execStatements(toReplaceViewSql(raw))
        } else {
          const namesToDrop = new Set<string>([appliedName])
          // 编辑态改名：同时清掉 Tab 上的旧名，避免残留
          if (!wasCreate && objectName.value) {
            namesToDrop.add(objectName.value)
          }
          await applyRoutineFullScript(raw, props.database, namesToDrop)
        }
      } else {
        await execStatements(raw)
      }
      const okMsg = wasCreate
        ? t('modules.mysql.objectScript.createOk', { name: appliedName })
        : t('modules.mysql.objectScript.saveOk')
      lastMessage.value = okMsg
      toast.success(okMsg)
      await refreshTree(wasCreate)

      if (!selectionOnly) {
        // 创建/保存后一律保留当前编辑器正文，禁止 loadScript 灌回模板或 SHOW CREATE
        if (objectKind.value === 'view') {
          suppressDraftPersist = true
          sqlText.value = toReplaceViewSql(sqlText.value)
          void nextTick(() => {
            suppressDraftPersist = false
          })
        }
        if (appliedName) {
          switchToAlterAfterCreate(appliedName)
        }
        baselineSql.value = sqlText.value
        persistDraftNow()
        const tabId = resolveTabId()
        if (tabId) tabs.setDirty(tabId, false)
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : t('modules.mysql.objectScript.execError')
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
      toast.success(t('modules.mysql.objectScript.copied'))
    } catch {
      toast.error(t('modules.mysql.objectScript.copyFailed'))
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
        applySelection: t('modules.mysql.query.runSelection'),
        format: t('modules.mysql.query.format'),
        compress: t('modules.mysql.query.compress'),
        copy: t('modules.mysql.query.copy'),
        paste: t('modules.mysql.query.paste'),
        askAi: t('modules.mysql.query.askAi'),
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
        props.objectKind,
        props.objectName,
        props.designMode,
        props.active,
      ] as const,
    (curr, prev) => {
      localDesignMode.value = null
      localObjectName.value = null
      if (props.active === false) return

      // 创建成功后 props：create→alter，保留刚执行的正文
      if (prev && prev[4] === 'create' && curr[4] === 'alter') {
        persistDraftNow()
        return
      }

      // 同一对象已有正文时不重灌（避免：保存后再 load、sessionId 晚到冲模板、切 Tab 回来被 SHOW CREATE 覆盖）
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
