/**
 * 环境配置：左列表选中编辑，与请求栏「当前环境」分开。
 * 写回走 store.replace*Vars，只 queue 变化的 scope，不深 watch 全部 environments。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useApiTesterStore } from '../stores/api-tester'
import type { ApiEnvironment, ApiVarRow } from '../types'
import { debounceFn, rowsToTypedRecord, typedRecordToRows } from '../utils/vars-rows'

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
const nameDraft = ref('')
const confirmRemoveOpen = ref(false)
const globalRows = ref<ApiVarRow[]>([])
const envVarRows = ref<ApiVarRow[]>([])
let wired = false

/** 环境页单例。View 与 Panel 共用，避免把 ref 当 props 传。 */
export function useApiEnvironmentPanel() {
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
      const keepBase = env.vars.baseUrl ?? env.baseUrl
      const typed = rowsToTypedRecord(envVarRows.value)
      if (keepBase) typed.vars.baseUrl = keepBase
      api.replaceEnvironmentVars(env.id, typed.vars, typed.kinds)
    }, 400)

    watch(globalRows, () => commitGlobalRows(), { deep: true })

    watch(
      [() => selectedEnvId.value, focus],
      () => {
        if (focus.value !== 'environment') {
          envVarRows.value = []
          nameDraft.value = ''
          return
        }
        const env = api.environments.find((item) => item.id === selectedEnvId.value)
        if (!env) {
          envVarRows.value = []
          nameDraft.value = ''
          return
        }
        nameDraft.value = env.name
        envVarRows.value = typedRecordToRows(env.vars, env.kinds, `env:${env.id}`, (key) => key === 'baseUrl')
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

  function commitEnvName(): void {
    const env = activeEnv.value
    if (!env) return
    const name = nameDraft.value.trim()
    if (!name) {
      nameDraft.value = env.name
      return
    }
    const saved = api.renameEnvironment(env.id, name)
    nameDraft.value = saved?.name ?? env.name
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

  function onBaseUrlInput(value: string): void {
    const env = activeEnv.value
    if (!env) return
    api.updateEnvironmentBaseUrl(env.id, value)
  }

  return {
    api,
    t,
    focus,
    selectedEnvId,
    listFilter,
    nameDraft,
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
    commitEnvName,
    onRemoveEnv,
    onBaseUrlInput,
  }
}
