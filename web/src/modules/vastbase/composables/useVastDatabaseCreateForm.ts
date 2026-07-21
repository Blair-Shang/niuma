import { useRsToast } from '@niuma/ui'
import type { RsSelectOptions } from '@niuma/ui'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { vastbaseApi } from '@/api'
import type { VastDatabaseCreateOptionsResult, VastDdlParams } from '@/api/types/vastbase'
import {
  useVastDdlActionStore,
  type VastDatabaseCreateOptions,
  type VastPendingDdlAction,
} from '@/modules/vastbase/stores/ddl-actions'

/** RsSelect / Combobox 不允许空字符串 value，用哨兵表示「继承模板默认」。 */
export const COLLATION_DEFAULT = '__default__'

function ensureSelectValue(value: string, choices: string[], fallback: string): string {
  if (value && choices.includes(value)) return value
  if (fallback && choices.includes(fallback)) return fallback
  return choices[0] ?? fallback
}

function ensureCollationValue(value: string, choices: string[], fallback: string): string {
  if (!value || value === COLLATION_DEFAULT) {
    if (fallback && choices.includes(fallback)) return fallback
    return COLLATION_DEFAULT
  }
  if (choices.includes(value)) return value
  if (fallback && choices.includes(fallback)) return fallback
  return COLLATION_DEFAULT
}

function collationParam(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed || trimmed === COLLATION_DEFAULT) return undefined
  return trimmed
}

/** 新建数据库表单状态与候选项加载。 */
export function useVastDatabaseCreateForm() {
  const { t } = useI18n()
  const toast = useRsToast()
  const { pending, busy } = storeToRefs(useVastDdlActionStore())

  const dbName = ref('')
  const dbOwner = ref('CURRENT_USER')
  const dbEncoding = ref('UTF8')
  const dbTemplate = ref('template0')
  const dbLcCollate = ref(COLLATION_DEFAULT)
  const dbLcCtype = ref(COLLATION_DEFAULT)

  const optionsLoading = ref(false)
  const ownerChoices = ref<string[]>([])
  const encodingChoices = ref<string[]>([])
  const templateChoices = ref<string[]>([])
  const collationChoices = ref<string[]>([])

  const defaultOptionLabel = computed(() => t('modules.vastbase.ddl.dbDefaultOption'))

  const ownerOptions = computed((): RsSelectOptions => [
    { value: 'CURRENT_USER', label: 'CURRENT_USER' },
    ...ownerChoices.value.map((name) => ({ value: name, label: name })),
  ])

  const encodingOptions = computed((): RsSelectOptions =>
    encodingChoices.value.map((enc) => ({ value: enc, label: enc })),
  )

  const templateOptions = computed((): RsSelectOptions =>
    templateChoices.value.map((tpl) => ({ value: tpl, label: tpl })),
  )

  const collationOptions = computed((): RsSelectOptions => [
    { value: COLLATION_DEFAULT, label: defaultOptionLabel.value },
    ...collationChoices.value.map((coll) => ({ value: coll, label: coll })),
  ])

  const formDisabled = computed(() => busy.value || optionsLoading.value)

  const canConfirm = computed(() => {
    if (pending.value?.kind !== 'create_database' || optionsLoading.value) {
      return false
    }
    return dbName.value.trim().length > 0
  })

  function applyCreateOptions(result: VastDatabaseCreateOptionsResult): void {
    ownerChoices.value = result.owners
    encodingChoices.value = result.encodings
    templateChoices.value = result.templates
    collationChoices.value = result.collations

    dbEncoding.value = ensureSelectValue(
      dbEncoding.value,
      encodingChoices.value,
      result.defaultEncoding ?? 'UTF8',
    )
    dbTemplate.value = ensureSelectValue(
      dbTemplate.value,
      templateChoices.value,
      result.defaultTemplate ?? 'template0',
    )
    dbOwner.value = ensureSelectValue(
      dbOwner.value,
      ['CURRENT_USER', ...ownerChoices.value],
      'CURRENT_USER',
    )
    dbLcCollate.value = ensureCollationValue(
      dbLcCollate.value,
      collationChoices.value,
      result.defaultLcCollate ?? '',
    )
    dbLcCtype.value = ensureCollationValue(
      dbLcCtype.value,
      collationChoices.value,
      result.defaultLcCtype ?? '',
    )
  }

  async function loadCreateOptions(profileId: string, encoding?: string): Promise<void> {
    optionsLoading.value = true
    try {
      const result = await vastbaseApi.metaDatabaseCreateOptions({
        profileId,
        encoding,
      })
      applyCreateOptions(result)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.vastbase.ddl.optionsLoadError'))
    } finally {
      optionsLoading.value = false
    }
  }

  function applyCreateDefaults(
    name: string | undefined,
    opts: VastDatabaseCreateOptions | undefined,
  ): void {
    dbName.value = name ?? 'new_database'
    dbOwner.value = opts?.owner ?? 'CURRENT_USER'
    dbEncoding.value = opts?.encoding ?? 'UTF8'
    dbTemplate.value = opts?.template ?? 'template0'
    dbLcCollate.value = opts?.lcCollate ? opts.lcCollate : COLLATION_DEFAULT
    dbLcCtype.value = opts?.lcCtype ? opts.lcCtype : COLLATION_DEFAULT
  }

  function buildPayload(req: VastPendingDdlAction): VastDdlParams {
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
      template: dbTemplate.value,
      lcCollate: collationParam(dbLcCollate.value),
      lcCtype: collationParam(dbLcCtype.value),
    }
  }

  watch(
    () => pending.value,
    (req) => {
      if (req?.kind === 'create_database') {
        applyCreateDefaults(req.name, req.createOptions)
        void loadCreateOptions(req.profileId, dbEncoding.value)
      }
    },
    { immediate: true },
  )

  watch(dbEncoding, (encoding, prev) => {
    const req = pending.value
    if (req?.kind !== 'create_database' || encoding === prev || optionsLoading.value) return
    void loadCreateOptions(req.profileId, encoding)
  })

  return {
    dbName,
    dbOwner,
    dbEncoding,
    dbTemplate,
    dbLcCollate,
    dbLcCtype,
    ownerOptions,
    encodingOptions,
    templateOptions,
    collationOptions,
    formDisabled,
    canConfirm,
    buildPayload,
  }
}
