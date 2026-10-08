/**
 * 环境配置：左列表选中编辑，与请求栏「当前环境」分开。
 * 写回走 store.replace*Vars，只 queue 变化的 scope，不深 watch 全部 environments。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiTesterStore } from '../../stores/api-tester'
import type { ApiEnvironment, ApiVarRow } from '../../types'
import { debounceFn, rowsToTypedRecord, typedRecordToRows } from '../../utils/vars-rows'

export type ApiEnvFocus = 'environment' | 'global'

export interface ApiEnvListItem {
  id: string
  name: string
  baseUrl: string
  current: boolean
}

const focus = ref<ApiEnvFocus>('environment')
const selectedEnvId = ref('')
const listFilter = ref('')
const confirmRemoveOpen = ref(false)
const globalRows = ref<ApiVarRow[]>([])
const envVarRows = ref<ApiVarRow[]>([])
let wired = false

/** 环境页单例。工作台与详情共用，避免把 ref 当 props 传。 */
export function useEnvironmentPanel() {
  const { t } = useI18n()
  const api = useApiTesterStore()

  if (!wired) {
    wired = true
    globalRows.value = typedRecordToRows(api.globals.vars, api.globals.kinds, 'global')

    watch(
      () => api.envId,
      (id) => {
        if (!selectedEnvId.value && id) selectedEnvId.value = id
      },
      { immediate: true },
    )

    const commitGlobalRows = debounceFn(() => {
      const typed = rowsToTypedRecord(globalRows.value)
      api.replaceGlobalVars(typed.vars, typed.kinds)
    }, 400)

    const commitEnvVarRows = debounceFn(() => {
      const env = api.environments.find((item) => item.id === selectedEnvId.value)
      if (!env || focus.value !== 'environment') return
      const typed = rowsToTypedRecord(envVarRows.value)
      env.baseUrl = (typed.vars.baseUrl ?? '').trim()
      api.replaceEnvironmentVars(env.id, typed.vars, typed.kinds)
    }, 400)

    watch(globalRows, () => commitGlobalRows(), { deep: true })

    watch(
      [() => selectedEnvId.value, focus],
      () => {
        if (focus.value !== 'environment') {
          envVarRows.value = []
          return
        }
        const env = api.environments.find((item) => item.id === selectedEnvId.value)
        if (!env) {
          envVarRows.value = []
          return
        }
        envVarRows.value = typedRecordToRows(env.vars, env.kinds, `env:${env.id}`)
      },
      { immediate: true },
    )

    watch(envVarRows, () => commitEnvVarRows(), { deep: true })
  }

  const activeEnv = computed<ApiEnvironment | undefined>(() => {
    if (focus.value !== 'environment') return undefined
    const id = selectedEnvId.value || api.envId
    return api.environments.find((item) => item.id === id)
  })

  const envList = computed<ApiEnvListItem[]>(() => {
    const q = listFilter.value.trim().toLowerCase()
    return api.environments
      .filter((item) => !q || item.name.toLowerCase().includes(q))
      .map((item) => ({
        id: item.id,
        name: item.name,
        baseUrl: item.baseUrl,
        current: item.id === api.envId,
      }))
  })

  const globalVarCount = computed(() => Object.keys(api.globals.vars).length)

  function selectEnvironment(id: string): void {
    focus.value = 'environment'
    selectedEnvId.value = id
  }

  function selectGlobal(): void {
    focus.value = 'global'
  }

  function useEnvironment(id: string): void {
    if (!api.environments.some((item) => item.id === id)) return
    api.envId = id
    selectedEnvId.value = id
    focus.value = 'environment'
  }

  function createEnvironment(): void {
    const env = api.addEnvironment(t('modules.api.newEnvironment'))
    selectEnvironment(env.id)
  }

  function onRemoveEnv(): void {
    const env = activeEnv.value
    if (!env) return
    if (api.removeEnvironment(env.id)) {
      selectedEnvId.value = api.envId
      focus.value = 'environment'
    }
    confirmRemoveOpen.value = false
  }

  return {
    api,
    t,
    focus,
    selectedEnvId,
    listFilter,
    confirmRemoveOpen,
    globalRows,
    envVarRows,
    activeEnv,
    envList,
    globalVarCount,
    selectEnvironment,
    selectGlobal,
    useEnvironment,
    createEnvironment,
    onRemoveEnv,
  }
}
