import { useRsToast, type RsSelectOptions } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  columnValues,
  firstCell,
  withSqlServerSession,
} from '@/modules/sqlserver/composables/useSqlServerSessionSql'
import { sqlserverApi } from '@/api/sqlserver'
import { useSqlServerDdlActionStore } from '@/modules/sqlserver/stores/ddl-actions'
import {
  COLLATION_SERVER_DEFAULT,
  SQLSERVER_COMPAT_LEVELS,
  SQLSERVER_RECOVERY_MODELS,
  buildCreateDatabaseSql,
  resolveAzureSqlPaas,
  suggestDataFileName,
  suggestLogFileName,
  validateCollationName,
  validateDatabaseName,
  type SqlServerCreateDatabaseSpec,
  type SqlServerRecoveryModel,
} from '@/modules/sqlserver/utils/create-database'

const OPTIONS_SQL = `
SELECT
  CONVERT(nvarchar(128), SERVERPROPERTY('Collation')) AS server_collation,
  CONVERT(nvarchar(260), SERVERPROPERTY('InstanceDefaultDataPath')) AS data_path,
  CONVERT(nvarchar(260), SERVERPROPERTY('InstanceDefaultLogPath')) AS log_path,
  CONVERT(int, SERVERPROPERTY('ProductMajorVersion')) AS product_major,
  CONVERT(int, SERVERPROPERTY('EngineEdition')) AS engine_edition,
  (SELECT compatibility_level FROM sys.databases WHERE name = N'master') AS master_compat,
  (SELECT recovery_model_desc FROM sys.databases WHERE name = N'model') AS model_recovery;
`.trim()

const COLLATIONS_SQL = `SELECT name FROM sys.fn_helpcollations() ORDER BY name;`
const EXISTING_SQL = `SELECT name FROM sys.databases ORDER BY name;`
const COMPAT_INHERIT = '__inherit__'
/** 与 RsDialog form 入场动画对齐，避免候选项回填打断居中位移。 */
const DIALOG_POP_IN_MS = 240

async function closeResultSet(
  sessionId: string,
  resultSetId: string | undefined,
): Promise<void> {
  if (!resultSetId) return
  await sqlserverApi.queryClose({ sessionId, resultSetId }).catch(() => undefined)
}

function parseRecovery(raw: string): SqlServerRecoveryModel | '' {
  const upper = raw.trim().toUpperCase().replaceAll(' ', '_')
  if ((SQLSERVER_RECOVERY_MODELS as readonly string[]).includes(upper)) {
    return upper as SqlServerRecoveryModel
  }
  return ''
}

/** 新建数据库表单状态、服务器候选项与 SQL 预览。 */
export function useSqlServerDatabaseCreateForm() {
  const { t } = useI18n()
  const toast = useRsToast()
  const { pending, busy } = storeToRefs(useSqlServerDdlActionStore())

  const dbName = ref('')
  const collation = ref(COLLATION_SERVER_DEFAULT)
  const recovery = ref<SqlServerRecoveryModel | ''>('SIMPLE')
  const compatibilityLevel = ref<number | ''>('')
  const customizeFiles = ref(false)
  const dataLogical = ref('')
  const dataPath = ref('')
  const dataSizeMb = ref(8)
  const dataGrowthMb = ref(64)
  const logLogical = ref('')
  const logPath = ref('')
  const logSizeMb = ref(8)
  const logGrowthMb = ref(64)
  const filesTouched = ref(false)

  const optionsLoading = ref(false)
  const optionsReady = ref(false)
  const serverCollation = ref('')
  const defaultDataDir = ref('')
  const defaultLogDir = ref('')
  const collationChoices = ref<string[]>([])
  const collationsLoading = ref(false)
  const collationsLoaded = ref(false)
  const existingNames = ref<string[]>([])
  const maxCompat = ref(160)
  const azureSqlDb = ref(false)
  const activeProfileId = ref('')

  let loadTimer = 0
  let loadToken = 0

  const azure = computed(() => azureSqlDb.value)
  const formDisabled = computed(() => busy.value)

  const nameError = computed(() => validateDatabaseName(dbName.value, existingNames.value))

  const canConfirm = computed(() => {
    if (pending.value?.kind !== 'create_database' || !optionsReady.value || optionsLoading.value) {
      return false
    }
    if (nameError.value) return false
    if (!validateCollationName(collation.value)) return false
    if (customizeFiles.value && !azure.value) {
      if (!dataLogical.value.trim() || !dataPath.value.trim()) return false
      if (!logLogical.value.trim() || !logPath.value.trim()) return false
      if (dataSizeMb.value < 1 || logSizeMb.value < 1) return false
    }
    return true
  })

  const collationOptions = computed((): RsSelectOptions => [
    {
      value: COLLATION_SERVER_DEFAULT,
      label: serverCollation.value
        ? t('modules.sqlserver.createDb.collationServer', { name: serverCollation.value })
        : t('modules.sqlserver.createDb.collationDefault'),
    },
    ...collationChoices.value.map((name) => ({ value: name, label: name })),
  ])

  const recoveryOptions = computed((): RsSelectOptions => [
    { value: 'SIMPLE', label: t('modules.sqlserver.createDb.recoverySimple') },
    { value: 'FULL', label: t('modules.sqlserver.createDb.recoveryFull') },
    { value: 'BULK_LOGGED', label: t('modules.sqlserver.createDb.recoveryBulk') },
  ])

  const compatOptions = computed((): RsSelectOptions => [
    { value: COMPAT_INHERIT, label: t('modules.sqlserver.createDb.compatDefault') },
    ...SQLSERVER_COMPAT_LEVELS.filter((n) => n <= maxCompat.value).map((n) => ({
      value: String(n),
      label: String(n),
    })),
  ])

  const compatSelect = computed({
    get: () => (compatibilityLevel.value === '' ? COMPAT_INHERIT : String(compatibilityLevel.value)),
    set: (v: string) => {
      compatibilityLevel.value = !v || v === COMPAT_INHERIT ? '' : Number(v)
    },
  })

  function applyFileDefaults(name: string): void {
    const n = name.trim() || 'NewDatabase'
    dataLogical.value = n
    logLogical.value = `${n}_log`
    dataPath.value = suggestDataFileName(defaultDataDir.value, n)
    logPath.value = suggestLogFileName(defaultLogDir.value, n)
  }

  function buildSpec(): SqlServerCreateDatabaseSpec {
    const name = dbName.value.trim()
    const spec: SqlServerCreateDatabaseSpec = {
      name,
      collation: collation.value,
      azure: azure.value,
    }
    if (!azure.value) {
      spec.recovery = recovery.value
      if (customizeFiles.value) {
        spec.files = {
          data: {
            logicalName: dataLogical.value.trim(),
            fileName: dataPath.value.trim(),
            sizeMb: dataSizeMb.value,
            filegrowthMb: dataGrowthMb.value,
          },
          log: {
            logicalName: logLogical.value.trim(),
            fileName: logPath.value.trim(),
            sizeMb: logSizeMb.value,
            filegrowthMb: logGrowthMb.value,
          },
        }
      }
    }
    spec.compatibilityLevel = compatibilityLevel.value
    return spec
  }

  const previewSql = computed(() => {
    if (nameError.value) return ''
    return buildCreateDatabaseSql(buildSpec())
  })

  async function loadOptions(profileId: string, isAzure: boolean, token: number): Promise<void> {
    optionsLoading.value = true
    try {
      await withSqlServerSession(profileId, async (sessionId) => {
        const opts = await sqlserverApi.queryExec({
          sessionId,
          database: 'master',
          sql: OPTIONS_SQL,
          limit: 8,
        })
        if (token !== loadToken) return
        serverCollation.value = firstCell(opts, 'server_collation')
        defaultDataDir.value = firstCell(opts, 'data_path')
        defaultLogDir.value = firstCell(opts, 'log_path') || defaultDataDir.value
        const major = Number(firstCell(opts, 'product_major'))
        const masterCompat = Number(firstCell(opts, 'master_compat'))
        if (Number.isFinite(masterCompat) && masterCompat > 0) {
          maxCompat.value = masterCompat
        } else if (Number.isFinite(major) && major > 0) {
          maxCompat.value = major * 10
        } else {
          maxCompat.value = 160
        }
        const edition = Number(firstCell(opts, 'engine_edition'))
        azureSqlDb.value = resolveAzureSqlPaas(edition, isAzure)
        if (azureSqlDb.value) {
          recovery.value = ''
        } else {
          recovery.value = parseRecovery(firstCell(opts, 'model_recovery')) || 'SIMPLE'
        }
        await closeResultSet(sessionId, opts.resultSetId)

        const existing = await sqlserverApi.queryExec({
          sessionId,
          database: 'master',
          sql: EXISTING_SQL,
          limit: 10000,
        })
        if (token !== loadToken) return
        existingNames.value = columnValues(existing, 'name')
        await closeResultSet(sessionId, existing.resultSetId)
      }, 'master')
      if (token !== loadToken) return
      if (!filesTouched.value) applyFileDefaults(dbName.value)
    } catch (e) {
      if (token !== loadToken) return
      toast.error(e instanceof Error ? e.message : t('modules.sqlserver.createDb.optionsLoadError'))
    } finally {
      if (token === loadToken) {
        optionsLoading.value = false
        optionsReady.value = true
      }
    }
  }

  async function loadCollations(profileId: string): Promise<void> {
    if (collationsLoaded.value || collationsLoading.value) return
    collationsLoading.value = true
    const token = loadToken
    try {
      await withSqlServerSession(profileId, async (sessionId) => {
        const collations = await sqlserverApi.queryExec({
          sessionId,
          database: 'master',
          sql: COLLATIONS_SQL,
          limit: 10000,
        })
        if (token !== loadToken) return
        collationChoices.value = columnValues(collations, 'name')
        collationsLoaded.value = true
        await closeResultSet(sessionId, collations.resultSetId)
      }, 'master')
    } catch (e) {
      if (token !== loadToken) return
      toast.error(e instanceof Error ? e.message : t('modules.sqlserver.createDb.optionsLoadError'))
    } finally {
      if (token === loadToken) collationsLoading.value = false
    }
  }

  function cancelScheduledLoad(): void {
    if (loadTimer) {
      window.clearTimeout(loadTimer)
      loadTimer = 0
    }
  }

  function scheduleLoadOptions(profileId: string, isAzure: boolean, delayMs: number): void {
    cancelScheduledLoad()
    const token = ++loadToken
    const run = () => {
      loadTimer = 0
      void loadOptions(profileId, isAzure, token)
    }
    if (delayMs <= 0) {
      run()
      return
    }
    loadTimer = window.setTimeout(run, delayMs)
  }

  function onCollationDropdownOpen(isOpen: boolean): void {
    if (!isOpen || collationsLoaded.value || !activeProfileId.value) return
    void loadCollations(activeProfileId.value)
  }

  watch(
    () => pending.value,
    (req) => {
      if (req?.kind !== 'create_database') return
      optionsReady.value = false
      dbName.value = req.name || ''
      collation.value = COLLATION_SERVER_DEFAULT
      recovery.value = req.azure ? '' : 'SIMPLE'
      compatibilityLevel.value = ''
      customizeFiles.value = false
      filesTouched.value = false
      azureSqlDb.value = Boolean(req.azure)
      existingNames.value = []
      collationChoices.value = []
      collationsLoaded.value = false
      collationsLoading.value = false
      activeProfileId.value = req.profileId
      dataSizeMb.value = 8
      dataGrowthMb.value = 64
      logSizeMb.value = 8
      logGrowthMb.value = 64
      scheduleLoadOptions(req.profileId, Boolean(req.azure), DIALOG_POP_IN_MS)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    cancelScheduledLoad()
    loadToken += 1
  })

  watch(dbName, (name) => {
    if (!filesTouched.value) applyFileDefaults(name)
  })

  watch(customizeFiles, (on) => {
    if (on && !filesTouched.value) applyFileDefaults(dbName.value)
  })

  return {
    dbName,
    collation,
    recovery,
    compatibilityLevel,
    compatSelect,
    customizeFiles,
    dataLogical,
    dataPath,
    dataSizeMb,
    dataGrowthMb,
    logLogical,
    logPath,
    logSizeMb,
    logGrowthMb,
    filesTouched,
    azure,
    formDisabled,
    optionsLoading,
    collationsLoading,
    onCollationDropdownOpen,
    nameError,
    canConfirm,
    collationOptions,
    recoveryOptions,
    compatOptions,
    previewSql,
    defaultDataDir,
    buildSpec,
  }
}
