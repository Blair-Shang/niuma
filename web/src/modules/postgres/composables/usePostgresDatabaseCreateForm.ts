import { useRsToast } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { postgresApi } from '@/api'
import type { PostgresDatabaseCreateOptionsResult, PostgresDdlParams } from '@/api/types/postgres'
import { isProtectedDatabase } from '@/modules/postgres/conn-tree-shared'
import {
  usePostgresDdlActionStore,
  type PostgresDatabaseCreateOptions,
  type PostgresPendingDdlAction,
} from '@/modules/postgres/stores/ddl-actions'

/** RsSelect 不允许空字符串 value；对齐 DBeaver Default（省略该子句）。 */
export const OPTION_DEFAULT = '__default__'

function ensureSelectValue(value: string, choices: string[], fallback: string): string {
  if (value && choices.includes(value)) return value
  if (fallback && choices.includes(fallback)) return fallback
  return choices[0] ?? fallback
}

function ensureOptionalValue(value: string, choices: string[], fallback: string): string {
  if (value === OPTION_DEFAULT) return OPTION_DEFAULT
  if (value && choices.includes(value)) return value
  if (fallback && choices.includes(fallback)) return fallback
  return OPTION_DEFAULT
}

function optionalParam(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed || trimmed === OPTION_DEFAULT) return undefined
  return trimmed
}

function parseConnectionLimit(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return undefined
  const limit = Math.trunc(n)
  return limit < 0 ? undefined : limit
}

/** 与 RsDialog form 入场动画对齐，避免候选项回填打断居中位移。 */
const DIALOG_POP_IN_MS = 240

function prependCurrent(choices: string[], current: string): string[] {
  if (!current || current === OPTION_DEFAULT || choices.includes(current)) return choices
  return [current, ...choices]
}

/** 新建数据库表单：名称 / 所有者 / 模板 / 编码 / 表空间 / 排序规则 / 连接数。 */
export function usePostgresDatabaseCreateForm() {
  const { t } = useI18n()
  const toast = useRsToast()
  const { pending, busy } = storeToRefs(usePostgresDdlActionStore())

  const dbName = ref('')
  const dbOwner = ref('CURRENT_USER')
  const dbEncoding = ref('UTF8')
  const dbTemplate = ref('template0')
  const dbTablespace = ref(OPTION_DEFAULT)
  const dbLcCollate = ref(OPTION_DEFAULT)
  const dbLcCtype = ref(OPTION_DEFAULT)
  const dbConnLimit = ref('-1')

  const optionsLoading = ref(false)
  const optionsReady = ref(false)
  const ownerChoices = ref<string[]>([])
  const encodingChoices = ref<string[]>([])
  const templateChoices = ref<string[]>([])
  const tablespaceChoices = ref<string[]>([])
  const collationChoices = ref<string[]>([])
  const existingDatabases = ref<string[]>([])

  let loadTimer = 0
  let loadToken = 0

  const defaultOptionLabel = computed(() => t('modules.postgres.ddl.dbDefaultOption'))

  const ownerOptions = computed((): RsSelectOptions => [
    { value: 'CURRENT_USER', label: 'CURRENT_USER' },
    ...ownerChoices.value.map((name) => ({ value: name, label: name })),
  ])

  const encodingOptions = computed((): RsSelectOptions =>
    prependCurrent(encodingChoices.value, dbEncoding.value).map((enc) => ({
      value: enc,
      label: enc,
    })),
  )

  const templateOptions = computed((): RsSelectOptions => [
    { value: OPTION_DEFAULT, label: defaultOptionLabel.value },
    ...prependCurrent(templateChoices.value, dbTemplate.value).map((tpl) => ({
      value: tpl,
      label: tpl,
    })),
  ])

  const tablespaceOptions = computed((): RsSelectOptions => [
    { value: OPTION_DEFAULT, label: defaultOptionLabel.value },
    ...tablespaceChoices.value.map((ts) => ({ value: ts, label: ts })),
  ])

  const collationOptions = computed((): RsSelectOptions => [
    { value: OPTION_DEFAULT, label: defaultOptionLabel.value },
    ...collationChoices.value.map((coll) => ({ value: coll, label: coll })),
  ])

  const formDisabled = computed(() => busy.value)

  const nameError = computed(() => {
    const name = dbName.value.trim()
    if (!name) return t('modules.postgres.ddl.dbNameRequired')
    if (isProtectedDatabase(name)) return t('modules.postgres.ddl.dbNameReserved', { name })
    if (existingDatabases.value.includes(name)) {
      return t('modules.postgres.ddl.dbNameExists', { name })
    }
    return ''
  })

  const templateOverrideHint = computed(() => {
    const template = optionalParam(dbTemplate.value)
    if (!template || template === 'template0') return ''
    const encodingSet = Boolean(dbEncoding.value.trim())
    const localeSet = Boolean(optionalParam(dbLcCollate.value) || optionalParam(dbLcCtype.value))
    if (!encodingSet && !localeSet) return ''
    return t('modules.postgres.ddl.dbTemplateOverrideHint', { template })
  })

  const canConfirm = computed(() => {
    if (pending.value?.kind !== 'create_database' || !optionsReady.value || optionsLoading.value) {
      return false
    }
    return nameError.value === ''
  })

  function applyCreateOptions(result: PostgresDatabaseCreateOptionsResult): void {
    ownerChoices.value = result.owners
    encodingChoices.value = result.encodings
    templateChoices.value = result.templates
    tablespaceChoices.value = result.tablespaces ?? []
    collationChoices.value = result.collations
    existingDatabases.value = result.existingDatabases ?? []

    dbEncoding.value = ensureSelectValue(
      dbEncoding.value,
      encodingChoices.value,
      result.defaultEncoding ?? 'UTF8',
    )
    dbTemplate.value = ensureOptionalValue(
      dbTemplate.value,
      templateChoices.value,
      result.defaultTemplate ?? 'template0',
    )
    dbOwner.value = ensureSelectValue(
      dbOwner.value,
      ['CURRENT_USER', ...ownerChoices.value],
      'CURRENT_USER',
    )
    dbTablespace.value = ensureOptionalValue(dbTablespace.value, tablespaceChoices.value, '')
    dbLcCollate.value = ensureOptionalValue(
      dbLcCollate.value,
      collationChoices.value,
      result.defaultLcCollate ?? '',
    )
    dbLcCtype.value = ensureOptionalValue(
      dbLcCtype.value,
      collationChoices.value,
      result.defaultLcCtype ?? '',
    )
  }

  async function loadCreateOptions(
    profileId: string,
    encoding: string | undefined,
    token: number,
  ): Promise<void> {
    optionsLoading.value = true
    try {
      const result = await postgresApi.metaDatabaseCreateOptions({
        profileId,
        encoding,
      })
      if (token !== loadToken) return
      applyCreateOptions(result)
    } catch (e) {
      if (token !== loadToken) return
      toast.error(e instanceof Error ? e.message : t('modules.postgres.ddl.optionsLoadError'))
    } finally {
      if (token === loadToken) {
        optionsLoading.value = false
        optionsReady.value = true
      }
    }
  }

  function cancelScheduledLoad(): void {
    if (loadTimer) {
      window.clearTimeout(loadTimer)
      loadTimer = 0
    }
  }

  function scheduleLoadCreateOptions(
    profileId: string,
    encoding: string | undefined,
    delayMs: number,
  ): void {
    cancelScheduledLoad()
    const token = ++loadToken
    const run = () => {
      loadTimer = 0
      void loadCreateOptions(profileId, encoding, token)
    }
    if (delayMs <= 0) {
      run()
      return
    }
    loadTimer = window.setTimeout(run, delayMs)
  }

  function applyCreateDefaults(
    name: string | undefined,
    opts: PostgresDatabaseCreateOptions | undefined,
  ): void {
    dbName.value = name ?? 'new_database'
    dbOwner.value = opts?.owner ?? 'CURRENT_USER'
    dbEncoding.value = opts?.encoding ?? 'UTF8'
    dbTemplate.value = opts?.template ?? 'template0'
    dbTablespace.value = opts?.tablespace ? opts.tablespace : OPTION_DEFAULT
    dbLcCollate.value = opts?.lcCollate ? opts.lcCollate : OPTION_DEFAULT
    dbLcCtype.value = opts?.lcCtype ? opts.lcCtype : OPTION_DEFAULT
    const limit = opts?.connectionLimit
    dbConnLimit.value = limit === undefined || limit < 0 ? '-1' : String(limit)
  }

  function buildPayload(req: PostgresPendingDdlAction): PostgresDdlParams {
    return {
      action: req.action,
      profileId: req.profileId,
      database: req.database,
      schema: req.schema,
      name: dbName.value.trim(),
      args: req.args,
      oid: req.oid,
      owner: dbOwner.value.trim(),
      encoding: dbEncoding.value,
      template: optionalParam(dbTemplate.value) ?? '',
      tablespace: optionalParam(dbTablespace.value),
      lcCollate: optionalParam(dbLcCollate.value),
      lcCtype: optionalParam(dbLcCtype.value),
      connectionLimit: parseConnectionLimit(dbConnLimit.value),
    }
  }

  watch(
    () => pending.value,
    (req) => {
      if (req?.kind === 'create_database') {
        optionsReady.value = false
        applyCreateDefaults(req.name, req.createOptions)
        scheduleLoadCreateOptions(req.profileId, dbEncoding.value, DIALOG_POP_IN_MS)
      }
    },
    { immediate: true },
  )

  watch(dbEncoding, (encoding, prev) => {
    const req = pending.value
    if (req?.kind !== 'create_database' || encoding === prev || optionsLoading.value) return
    scheduleLoadCreateOptions(req.profileId, encoding, 0)
  })

  onScopeDispose(() => {
    cancelScheduledLoad()
    loadToken += 1
  })

  return {
    dbName,
    dbOwner,
    dbEncoding,
    dbTemplate,
    dbTablespace,
    dbLcCollate,
    dbLcCtype,
    dbConnLimit,
    ownerOptions,
    encodingOptions,
    templateOptions,
    tablespaceOptions,
    collationOptions,
    formDisabled,
    nameError,
    templateOverrideHint,
    canConfirm,
    buildPayload,
  }
}
