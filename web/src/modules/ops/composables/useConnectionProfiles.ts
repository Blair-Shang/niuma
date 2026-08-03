import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  connectionApi,
  credentialApi,
  isBridgeAvailable,
  isPlatformUnavailable,
  withPlatformRetry,
} from '@/api'
import type {
  ConnectionProfileInput,
  CredentialInput,
} from '@/api/types/connection'
import {
  applyProxyToForm,
  applyTunnelToForm,
  buildProxyOptions,
  buildTunnelOptions,
  emptyProxyFormState,
  emptyTunnelFormState,
  getConnectionKindDef,
  validateProxyForm,
  validateTunnelForm,
  type ConnectionTestMessage,
} from '@/modules/connection'
import {
  CONN_KIND_DEFS,
  DEFAULT_CONN_ACCENT,
  profileAccentColor,
  type ConnItem,
  type ConnKind,
  defaultPortForKind,
} from '@/modules/ops/types'
import {
  getConnectionFormAdapter,
  type ConnectionDlgMode,
  type ConnectionFormState,
  type ConnectionTestParams,
} from '@/modules/ops/connection-form/index'
import { ensureConnKindForm } from '@/modules/ops/conn-kind-loaders'

export type { ConnectionDlgMode, ConnectionFormState } from '@/modules/ops/connection-form/index'

function baseEmptyForm(kind: ConnKind): ConnectionFormState {
  return {
    profileName: '',
    hostAddress: '',
    portNumber: String(defaultPortForKind(kind)),
    loginAccount: '',
    password: '',
    sshAuthType: 'password',
    sshPrivateKey: '',
    sshPrivateKeyPath: '',
    sshPassphrase: '',
    connectTimeoutSeconds: '',
    accentColor: DEFAULT_CONN_ACCENT,
    ...emptyProxyFormState(),
    ...emptyTunnelFormState(),
  }
}

function emptyForm(kind: ConnKind): ConnectionFormState {
  const base = baseEmptyForm(kind)
  try {
    return { ...base, ...getConnectionFormAdapter(kind).defaults() }
  } catch {
    return base
  }
}

function emptyProfileMap(): Record<ConnKind, ConnItem[]> {
  return Object.fromEntries(CONN_KIND_DEFS.map((def) => [def.kind, []])) as unknown as Record<ConnKind, ConnItem[]>
}

/**
 * 连接站点 CRUD 与列表状态（Platform connection API）。
 * 供 SideNav、SiteManager 等复用，Shell 层不应重复实现。
 */
export function useConnectionProfiles(kinds: ConnKind[] = CONN_KIND_DEFS.map((k) => k.kind)) {
  const { t } = useI18n()
  const kindSet = new Set<string>(kinds)

  const profileMap = ref<Record<ConnKind, ConnItem[]>>(emptyProfileMap())
  const loading = ref(false)
  const searchQuery = ref('')

  const dlgOpen = ref(false)
  const dlgMode = ref<ConnectionDlgMode>('create')
  const dlgKind = ref<ConnKind>('ftp')
  const dlgProfile = ref<ConnItem | null>(null)
  const saving = ref(false)
  const deleting = ref(false)
  const testing = ref(false)
  const testMessage = ref<ConnectionTestMessage | null>(null)
  const formError = ref<string | null>(null)

  const form = reactive<ConnectionFormState>(emptyForm('ftp'))

  const allProfiles = computed<ConnItem[]>(() => {
    const flat: ConnItem[] = []
    for (const kind of kinds) {
      flat.push(...profileMap.value[kind].map((p) => ({ ...p, kind })))
    }
    return flat
  })

  /**
   * 拉取站点列表并按 kind 分组。
   * - 多协议（侧栏）：一次 `list({})`，避免 N 次并行请求
   * - 单协议（模块 Home）：仍带 kind 过滤，少传无关数据
   * 协议 chunk / 表单不在此处预热，展开树或打开对话框时再 ensure。
   */
  async function fetchProfilesByKind(): Promise<Record<ConnKind, ConnItem[]>> {
    const res =
      kinds.length === 1
        ? await connectionApi.list({ kind: kinds[0] })
        : await connectionApi.list({})

    const grouped = emptyProfileMap()
    for (const kind of kinds) {
      grouped[kind] = []
    }
    for (const profile of res.profiles ?? []) {
      const kind = (kinds.length === 1 ? kinds[0] : profile.connectionKind) as ConnKind
      if (!kindSet.has(kind)) continue
      grouped[kind].push({ ...profile, kind })
    }
    return grouped
  }

  async function loadAll(): Promise<void> {
    if (!isBridgeAvailable()) {
      return
    }
    loading.value = true
    try {
      // Platform 刚 spawn / dev:hot 偶发未就绪：有界重试真实 list，不单独探测就绪
      const grouped = await withPlatformRetry(fetchProfilesByKind)
      const next = { ...profileMap.value }
      for (const kind of kinds) {
        next[kind] = grouped[kind]
      }
      profileMap.value = next
    } catch (err) {
      if (isPlatformUnavailable(err)) {
        console.warn('[connection] list unavailable after retries', err)
      } else {
        console.warn('[connection] list failed', err)
      }
    } finally {
      loading.value = false
    }
  }

  function resetForm(kind: ConnKind): void {
    Object.assign(form, emptyForm(kind))
  }

  async function openCreate(kind: ConnKind): Promise<void> {
    await ensureConnKindForm(kind)
    dlgMode.value = 'create'
    dlgKind.value = kind
    dlgProfile.value = null
    resetForm(kind)
    formError.value = null
    testMessage.value = null
    dlgOpen.value = true
  }

  /** 将已有连接配置灌入表单（不含 dlgMode / dlgProfile）。 */
  function applyItemToForm(item: ConnItem, profileName: string): void {
    dlgKind.value = item.kind
    resetForm(item.kind)
    form.profileName = profileName
    form.hostAddress = item.hostAddress
    form.portNumber = String(item.portNumber || defaultPortForKind(item.kind))
    form.loginAccount = item.loginAccount
    form.password = ''
    form.accentColor = profileAccentColor(item.connectionOptions)
    getConnectionFormAdapter(item.kind).applyProfile?.(form, item)
    applyProxyToForm(form, item.connectionOptions)
    applyTunnelToForm(form, item.connectionOptions)
  }

  /** 从 OS Keychain 回填凭据；失败时静默，由用户手动补密。 */
  async function loadSecretIntoForm(item: ConnItem): Promise<void> {
    if (!item.credentialIds?.length) return
    try {
      const result = await credentialApi.get({ profileId: item.profileId })
      if (result.found) {
        const adapter = getConnectionFormAdapter(item.kind)
        if (adapter.applyLoadedSecret) {
          adapter.applyLoadedSecret(form, result.secret)
        } else {
          form.password = result.secret
        }
      }
    } catch {
      // Keychain 不可用时用户可手动输入密码
    }
  }

  async function openEdit(item: ConnItem): Promise<void> {
    await ensureConnKindForm(item.kind)
    dlgMode.value = 'edit'
    dlgProfile.value = item
    applyItemToForm(item, item.profileName)
    formError.value = null
    testMessage.value = null
    dlgOpen.value = true
    // 对话框已先行打开；凭据回填通常在毫秒内完成
    await loadSecretIntoForm(item)
  }

  /**
   * 克隆连接：以 create 模式打开表单并预填原配置（含 Keychain 凭据与代理密码）。
   * 保存后生成新 profileId，不修改原连接。
   */
  async function openClone(item: ConnItem): Promise<void> {
    await ensureConnKindForm(item.kind)
    dlgMode.value = 'create'
    dlgProfile.value = null
    applyItemToForm(item, `${item.profileName}${t('opsNav.cloneNameSuffix')}`)
    // create 无 dlgProfile，代理密码须写入表单，否则保存会丢失
    const proxyPassword = item.connectionOptions?.proxy?.password
    if (typeof proxyPassword === 'string' && proxyPassword) {
      form.proxyPassword = proxyPassword
    }
    formError.value = null
    testMessage.value = null
    dlgOpen.value = true
    await loadSecretIntoForm(item)
  }

  function openDelete(item: ConnItem): void {
    dlgMode.value = 'delete'
    dlgKind.value = item.kind
    dlgProfile.value = item
    dlgOpen.value = true
  }

  function savedProxyPassword(): string | undefined {
    const raw = dlgProfile.value?.connectionOptions?.proxy?.password
    return typeof raw === 'string' ? raw : undefined
  }

  function buildInput(): ConnectionProfileInput {
    const accent = { accentColor: form.accentColor }
    const proxy = buildProxyOptions(form, savedProxyPassword())
    const tunnel = buildTunnelOptions(form)
    const connectionOptions = getConnectionFormAdapter(dlgKind.value).buildOptions({ form, accent, proxy, tunnel })
    return {
      profileName: form.profileName.trim(),
      connectionKind: dlgKind.value,
      hostAddress: form.hostAddress.trim(),
      portNumber: Number.parseInt(form.portNumber, 10) || defaultPortForKind(dlgKind.value),
      loginAccount: form.loginAccount.trim(),
      connectionOptions,
    }
  }

  function formSecret(): string {
    return getConnectionFormAdapter(dlgKind.value).secret?.({ form }) ?? form.password.trim()
  }

  function formSecretRequired(): boolean {
    return getConnectionFormAdapter(dlgKind.value).secretRequired?.({ form }) ?? true
  }

  function secretRequired(): boolean {
    return formSecretRequired()
  }

  function formCredentialKind(): CredentialInput['kind'] {
    return getConnectionFormAdapter(dlgKind.value).credentialKind?.({ form }) ?? 'password'
  }

  function authRequiredMessage(): string {
    return getConnectionFormAdapter(dlgKind.value).authRequiredMessage?.(form, t) ?? t('opsNav.passwordRequired')
  }

  function tunnelValidationRequired(): boolean {
    return getConnectionKindDef(dlgKind.value)?.supportsTunnel === true
  }

  function validateSaveInput(secret: string): boolean {
    if (!form.profileName.trim()) {
      formError.value = t('opsNav.form.nameRequired')
      return false
    }
    const hideHost = getConnectionKindDef(dlgKind.value)?.hideHostPort === true
    if (!hideHost && !form.hostAddress.trim()) {
      formError.value = t('opsNav.form.hostRequired')
      return false
    }
    if (!validateProxyForm(form)) {
      formError.value = t('connection.form.proxyHostRequired')
      return false
    }
    if (tunnelValidationRequired() && !validateTunnelForm(form)) {
      formError.value = t('connection.form.tunnelSshProfileRequired')
      return false
    }
    const adapterError = getConnectionFormAdapter(dlgKind.value).validate?.({
      form,
      mode: dlgMode.value,
      t,
      secret,
    })
    if (adapterError) {
      formError.value = adapterError
      return false
    }
    if (dlgMode.value === 'create' && !secret && secretRequired()) {
      formError.value = authRequiredMessage()
      return false
    }
    return true
  }

  /** 测试连接拨号超时上限（秒），短于日常会话默认值以尽快反馈失败 */
  const TEST_CONNECTION_TIMEOUT_CAP_SECONDS = 12

  function buildTestParams(): ConnectionTestParams {
    const input = buildInput()
    const params = getConnectionFormAdapter(dlgKind.value).buildTestParams({
      input,
      timeoutSeconds: TEST_CONNECTION_TIMEOUT_CAP_SECONDS,
    }) as ConnectionTestParams & { secret?: string; profileId?: string }
    const credSecret = formSecret()
    if (credSecret) {
      params.secret = credSecret
    } else if (dlgMode.value === 'edit' && dlgProfile.value) {
      // 编辑时密码留空：主机/代理走表单，密码从 Keychain 经 profileId 注入
      params.profileId = dlgProfile.value.profileId
    }
    return params
  }

  async function testConnection(): Promise<void> {
    testMessage.value = null
    const hideHost = getConnectionKindDef(dlgKind.value)?.hideHostPort === true
    if (!hideHost && !form.hostAddress.trim()) {
      testMessage.value = { ok: false, text: t('opsNav.form.hostRequired') }
      return
    }
    if (dlgMode.value === 'create' && secretRequired() && !formSecret()) {
      testMessage.value = { ok: false, text: authRequiredMessage() }
      return
    }
    if (!validateProxyForm(form)) {
      testMessage.value = { ok: false, text: t('connection.form.proxyHostRequired') }
      return
    }
    if (tunnelValidationRequired() && !validateTunnelForm(form)) {
      testMessage.value = { ok: false, text: t('connection.form.tunnelSshProfileRequired') }
      return
    }
    const adapterError = getConnectionFormAdapter(dlgKind.value).validate?.({
      form,
      mode: dlgMode.value,
      t,
      secret: formSecret(),
    })
    if (adapterError) {
      testMessage.value = { ok: false, text: adapterError }
      return
    }
    testing.value = true
    try {
      const params = buildTestParams()
      const result = await getConnectionFormAdapter(dlgKind.value).callSessionTest(params)
      testMessage.value = {
        ok: result.ok,
        text: result.message || (result.ok ? t('connection.form.testOk') : t('connection.form.testFail')),
      }
    } catch (e) {
      testMessage.value = {
        ok: false,
        text: e instanceof Error ? e.message : t('connection.form.testFail'),
      }
    } finally {
      testing.value = false
    }
  }

  async function saveConnection(): Promise<boolean> {
    formError.value = null
    const secret = formSecret()
    if (!validateSaveInput(secret)) return false
    saving.value = true
    try {
      const profile = buildInput()
      const credential: CredentialInput | undefined = secret
        ? { label: profile.profileName, kind: formCredentialKind(), secret }
        : undefined

      if (dlgMode.value === 'edit' && dlgProfile.value) {
        await connectionApi.update({
          profileId: dlgProfile.value.profileId,
          profile,
          rowVersion: dlgProfile.value.rowVersion,
          credential,
        })
      } else {
        await connectionApi.create({ profile, credential })
      }
      dlgOpen.value = false
      await loadAll()
      return true
    } catch (e) {
      formError.value = e instanceof Error ? e.message : t('opsNav.saveError')
      return false
    } finally {
      saving.value = false
    }
  }

  async function deleteConnection(): Promise<boolean> {
    if (!dlgProfile.value) {
      return false
    }
    deleting.value = true
    try {
      await connectionApi.delete({ profileId: dlgProfile.value.profileId })
      dlgOpen.value = false
      await loadAll()
      return true
    } catch (e) {
      formError.value = e instanceof Error ? e.message : t('opsNav.deleteError')
      return false
    } finally {
      deleting.value = false
    }
  }

  return reactive({
    profileMap,
    loading,
    searchQuery,
    allProfiles,
    dlgOpen,
    dlgMode,
    dlgKind,
    dlgProfile,
    saving,
    deleting,
    testing,
    testMessage,
    formError,
    form,
    loadAll,
    openCreate,
    openEdit,
    openClone,
    openDelete,
    saveConnection,
    testConnection,
    deleteConnection,
  })
}
