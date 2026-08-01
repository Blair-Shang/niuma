/**
 * 达梦对象脚本：视图 / 过程 / 函数 / 包 / 触发器 / 同义词 / 序列新建与编辑。
 * 正文经 tab.props.draftSql 持久化；禁止依赖其它库模块业务实现。
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRsToast, type RsContextMenuItem } from '@niuma/ui'
import { damengApi } from '@/api/dameng'
import { buildObjectScriptContextMenuItems } from '@/modules/database'
import { useDamengSqlEditor } from '@/modules/dameng/composables/useDamengSqlEditor'
import {
  isRoutineObjectKind,
  objectKindIcon,
  objectKindToCategory,
  usesMetaDdlLoad,
  type DamengObjectKind,
  type DamengObjectScriptMode,
} from '@/modules/dameng/types/object-script'
import {
  normalizeDamengObjectDdlForEdit,
  parseDamengObjectNameFromSql,
  toReplaceSql,
} from '@/modules/dameng/utils/normalize-object-ddl'
import {
  createObjectTemplate,
  dropFunctionSql,
  dropPackageSql,
  dropProcedureSql,
  dropSequenceSql,
  dropSynonymSql,
  dropTriggerSql,
} from '@/modules/dameng/utils/script-templates'
import type { ConnItem } from '@/modules/ops/types'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { refreshResourceIfLoaded, patchCategoryObjectCount } from '@/modules/ops/composables/useConnTreeChildren'
import {
  defaultDamengProfile,
  resolveMonacoLanguageFromProfile,
  resolveSplitFeaturesFromProfile,
} from '@/modules/sql-editor/capabilities'
import { formatSql } from '@/modules/sql-editor/format'
import { splitSqlStatementsWithFeatures } from '@/modules/sql-editor/split/sql-statement-splitter'
import { useSessionRegistry } from '@/stores/session-registry'
import { useTabStore } from '@/stores/tab'

export type DamengObjectScriptProps = {
  sessionId: string | null
  profileId?: string
  schema?: string
  objectKind: DamengObjectKind
  objectName?: string
  designMode?: DamengObjectScriptMode
  initialSql?: string
  draftSql?: string
  tabId?: string
  sessionLabel?: string
  active?: boolean
}

const DRAFT_PERSIST_MS = 400

const KIND_LABEL_KEY: Record<DamengObjectKind, string> = {
  view: 'tabView',
  procedure: 'tabProcedure',
  function: 'tabFunction',
  package: 'tabPackage',
  trigger: 'tabTrigger',
  synonym: 'tabSynonym',
  sequence: 'tabSequence',
}

function categoryPath(schema: string, category: string): ConnResourcePath {
  return {
    segments: [
      { kind: 'schema', name: schema },
      { kind: 'category', name: category },
    ],
  }
}

function dropSqlForKind(kind: DamengObjectKind, schema: string, name: string): string {
  switch (kind) {
    case 'function':
      return dropFunctionSql(schema, name)
    case 'package':
      return dropPackageSql(schema, name)
    case 'trigger':
      return dropTriggerSql(schema, name)
    case 'synonym':
      return dropSynonymSql(schema, name)
    case 'sequence':
      return dropSequenceSql(schema, name)
    case 'procedure':
    default:
      return dropProcedureSql(schema, name)
  }
}

export function useDamengObjectScript(props: DamengObjectScriptProps) {
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
  const localDesignMode = ref<DamengObjectScriptMode | null>(null)
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

  const designMode = computed<DamengObjectScriptMode>(
    () => localDesignMode.value ?? props.designMode ?? 'alter',
  )
  const modeCreate = computed(() => designMode.value === 'create')
  const objectName = computed(() => localObjectName.value ?? props.objectName ?? '')
  const objectKind = computed(() => props.objectKind)
  const kindIcon = computed(() => objectKindIcon(objectKind.value))
  const schemaName = computed(() => props.schema?.trim() ?? '')

  const kindLabel = computed(() =>
    t(`modules.dameng.session.${KIND_LABEL_KEY[objectKind.value]}`),
  )

  const applyLabel = computed(() =>
    modeCreate.value
      ? t('modules.dameng.objectScript.create')
      : t('modules.dameng.objectScript.save'),
  )

  function dialectProfile() {
    if (!props.sessionId) return defaultDamengProfile()
    return sessionRegistry.getDialectForSession(props.sessionId) ?? defaultDamengProfile()
  }

  const editor = useDamengSqlEditor({
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
      if (usesMetaDdlLoad(objectKind.value)) {
        const result = await damengApi.metaDDL({
          sessionId: props.sessionId,
          schema: schemaName.value,
          table: objectName.value,
          name: objectName.value,
        })
        const cleaned = normalizeDamengObjectDdlForEdit(result.ddl, objectKind.value)
        try {
          loaded = formatSql(cleaned, { dialect: 'dameng' })
        } catch {
          loaded = cleaned
        }
      } else {
        const kind = objectKind.value === 'function' ? 'function' : 'procedure'
        const result = await damengApi.metaRoutineSource({
          sessionId: props.sessionId,
          schema: schemaName.value,
          name: objectName.value,
          kind,
        })
        const cleaned = normalizeDamengObjectDdlForEdit(result.definition, objectKind.value)
        try {
          loaded = formatSql(cleaned, { dialect: 'dameng' })
        } catch {
          loaded = cleaned
        }
      }
      applyLoadedSql(loaded)
      clearDraftProp()
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : t('modules.dameng.objectScript.loadError')
      lastError.value = msg
      toast.error(msg)
      if (!force && !sqlText.value.trim()) applyLoadedSql('')
    } finally {
      loading.value = false
    }
  }

  async function execOne(sql: string): Promise<void> {
    if (!props.sessionId) {
      throw new Error(t('modules.dameng.objectScript.needSession'))
    }
    const stmt = sql.trim()
    if (!stmt) {
      throw new Error(t('modules.dameng.objectScript.empty'))
    }
    const result = await damengApi.queryExec({
      sessionId: props.sessionId,
      schema: schemaName.value || undefined,
      sql: stmt,
      limit: 1,
    })
    if (result.resultSetId) {
      await damengApi
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
      throw new Error(t('modules.dameng.objectScript.empty'))
    }
    for (const stmt of statements) {
      await execOne(stmt)
    }
  }

  async function applyObjectFullScript(
    raw: string,
    schema: string,
    namesToDrop: Iterable<string>,
  ): Promise<void> {
    const kind = objectKind.value
    const hasReplace = /^create\s+or\s+replace\b/i.test(raw.trim())
    // 序列通常无 OR REPLACE：保存前先 DROP
    const needDrop = kind === 'sequence' || !hasReplace
    if (needDrop) {
      for (const name of namesToDrop) {
        try {
          await execOne(dropSqlForKind(kind, schema, name))
        } catch {
          // 对象可能不存在；继续 CREATE
        }
      }
    }
    const createLike =
      /^\s*create\b/i.test(raw) &&
      /\b(procedure|function|package|trigger|synonym|sequence)\b/i.test(raw)
    if (createLike) {
      await execStatements(hasReplace || kind === 'sequence' ? raw : toReplaceSql(raw))
      return
    }
    await execStatements(raw)
  }

  /** @param updateCounts 新建时就地 patch 分类徽章，不重拉 schema */
  async function refreshTree(updateCounts: boolean): Promise<void> {
    if (!props.profileId || !schemaName.value) return
    const conn = { profileId: props.profileId, kind: 'dameng' } as ConnItem
    const cat = objectKindToCategory(objectKind.value)
    const path = categoryPath(schemaName.value, cat)
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
      nextProps.isView = true
    } else if (objectKind.value === 'sequence') {
      nextProps.sequence = name
    } else if (isRoutineObjectKind(objectKind.value)) {
      nextProps.routine = name
      nextProps.routineKind = objectKind.value
    }
    tabs.updateTabProps(tabId, nextProps)
    // Object.assign 无法用 undefined 删掉 initialSql，显式移除避免后续误灌模板
    const tab = tabs.allTabs.find((item) => item.tabId === tabId)
    if (tab && 'initialSql' in tab.props) {
      delete tab.props.initialSql
    }
    // Tab 只显示对象名；完整 schema.对象放 tip（对齐 MySQL）
    tabs.updateTitle(tabId, name)
    if (tab) {
      const resourcePrefix = `${t('workspace.tabTipResource')}:`
      const featurePrefix = `${t('workspace.tabTipFeature')}:`
      const head = (tab.tooltip ?? '')
        .split('\n')
        .filter(Boolean)
        .filter((line) => !line.startsWith(resourcePrefix) && !line.startsWith(featurePrefix))
      const next = [...head]
      const resource = schemaName.value ? `${schemaName.value}.${name}` : name
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
      lastError.value = t('modules.dameng.objectScript.empty')
      return
    }

    saving.value = true
    lastError.value = null
    lastMessage.value = null
    const wasCreate = modeCreate.value
    const sqlObjectName = parseDamengObjectNameFromSql(raw, objectKind.value)
    const appliedName = sqlObjectName || objectName.value
    try {
      if (!selectionOnly && schemaName.value && appliedName) {
        if (objectKind.value === 'view') {
          await execStatements(toReplaceSql(raw))
        } else {
          const namesToDrop = new Set<string>([appliedName])
          if (!wasCreate && objectName.value) namesToDrop.add(objectName.value)
          await applyObjectFullScript(raw, schemaName.value, namesToDrop)
        }
      } else {
        await execStatements(raw)
      }
      const okMsg = wasCreate
        ? t('modules.dameng.objectScript.createOk', { name: appliedName })
        : t('modules.dameng.objectScript.saveOk')
      lastMessage.value = okMsg
      toast.success(okMsg)
      // 新建需更新分类计数；纯编辑数量不变，只刷分类夹
      await refreshTree(wasCreate)

      if (!selectionOnly) {
        if (objectKind.value === 'view') {
          suppressDraftPersist = true
          sqlText.value = toReplaceSql(sqlText.value)
          void nextTick(() => {
            suppressDraftPersist = false
          })
        } else if (
          objectKind.value !== 'sequence' &&
          /^\s*create\b/i.test(sqlText.value) &&
          !/^create\s+or\s+replace\b/i.test(sqlText.value.trim())
        ) {
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
        error instanceof Error ? error.message : t('modules.dameng.objectScript.execError')
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
      toast.success(t('modules.dameng.objectScript.copied'))
    } catch {
      toast.error(t('modules.dameng.objectScript.copyFailed'))
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
        applySelection: t('modules.dameng.query.runSelection'),
        format: t('modules.dameng.query.format'),
        compress: t('modules.dameng.query.compress'),
        copy: t('modules.dameng.objectScript.copy'),
        paste: t('modules.dameng.query.paste'),
        askAi: t('modules.dameng.query.askAi'),
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
