import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { connectionApi, ftpApi, sshApi } from '@/api'
import { isBridgeAvailable } from '@/api/client'
import type { ConnectionProfileInput, CredentialInput, FtpConnectionOptions, FtpSessionTestParams } from '@/api/types/ftp'
import { DEFAULT_FTP_OPTIONS } from '@/api/types/ftp'
import type { SshConnectionOptions, SshSessionTestParams } from '@/api/types/ssh'
import { DEFAULT_SSH_OPTIONS } from '@/api/types/ssh'
import {
  applyProxyToForm,
  buildProxyOptions,
  emptyProxyFormState,
  validateProxyForm,
  type ConnectionTestMessage,
  type ProxyFormState,
} from '@/modules/connection'
import {
  CONN_KIND_DEFS,
  DEFAULT_CONN_ACCENT,
  profileAccentColor,
  type ConnAccentColor,
  type ConnItem,
  type ConnKind,
  defaultPortForKind,
} from '@/modules/ops/types'

export type ConnectionDlgMode = 'create' | 'edit' | 'delete'

export interface ConnectionFormState extends ProxyFormState {
  profileName: string
  hostAddress: string
  portNumber: string
  loginAccount: string
  password: string
  accentColor: ConnAccentColor
  protocol: 'ftp' | 'ftps'
  passive: string
  encoding: 'utf-8' | 'gbk'
}

type ConnectionTestParams = FtpSessionTestParams | SshSessionTestParams

function emptyForm(kind: ConnKind): ConnectionFormState {
  return {
    profileName: '',
    hostAddress: '',
    portNumber: String(defaultPortForKind(kind)),
    loginAccount: '',
    password: '',
    accentColor: DEFAULT_CONN_ACCENT,
    protocol: 'ftp',
    passive: 'true',
    encoding: 'utf-8',
    ...emptyProxyFormState(),
  }
}

/**
 * 连接站点 CRUD 与列表状态（Platform connection API）。
 * 供 SideNav、SiteManager 等复用，Shell 层不应重复实现。
 */
export function useConnectionProfiles(kinds: ConnKind[] = CONN_KIND_DEFS.map((k) => k.kind)) {
  const { t } = useI18n()

  const profileMap = ref<Record<ConnKind, ConnItem[]>>({ ssh: [], ftp: [] })
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

  async function loadAll(): Promise<void> {
    if (!isBridgeAvailable()) {
      return
    }
    loading.value = true
    try {
      const results = await Promise.all(
        kinds.map(async (kind) => {
          const res = await connectionApi.list({ kind })
          return { kind, profiles: res.profiles ?? [] }
        }),
      )
      const next = { ...profileMap.value }
      for (const { kind, profiles } of results) {
        next[kind] = profiles.map((p) => ({ ...p, kind }))
      }
      profileMap.value = next
    } catch {
      /* Platform 未就绪时静默 */
    } finally {
      loading.value = false
    }
  }

  function resetForm(kind: ConnKind): void {
    Object.assign(form, emptyForm(kind))
  }

  function openCreate(kind: ConnKind): void {
    dlgMode.value = 'create'
    dlgKind.value = kind
    dlgProfile.value = null
    resetForm(kind)
    formError.value = null
    testMessage.value = null
    dlgOpen.value = true
  }

  function openEdit(item: ConnItem): void {
    dlgMode.value = 'edit'
    dlgKind.value = item.kind
    dlgProfile.value = item
    form.profileName = item.profileName
    form.hostAddress = item.hostAddress
    form.portNumber = String(item.portNumber || defaultPortForKind(item.kind))
    form.loginAccount = item.loginAccount
    form.password = ''
    form.accentColor = profileAccentColor(item.connectionOptions)
    if (item.kind === 'ftp' && item.connectionOptions) {
      const opts = item.connectionOptions as unknown as FtpConnectionOptions
      form.protocol = opts.protocol ?? 'ftp'
      form.passive = String(opts.passive ?? true)
      form.encoding = opts.encoding ?? 'utf-8'
    }
    applyProxyToForm(form, item.connectionOptions)
    formError.value = null
    testMessage.value = null
    dlgOpen.value = true
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
    const isFtp = dlgKind.value === 'ftp'
    const accent = { accentColor: form.accentColor }
    const proxy = buildProxyOptions(form, savedProxyPassword())
    return {
      profileName: form.profileName.trim(),
      connectionKind: dlgKind.value,
      hostAddress: form.hostAddress.trim(),
      portNumber: Number.parseInt(form.portNumber, 10) || defaultPortForKind(dlgKind.value),
      loginAccount: form.loginAccount.trim(),
      connectionOptions: isFtp
        ? {
            ...DEFAULT_FTP_OPTIONS,
            ...accent,
            protocol: form.protocol,
            tls_mode: form.protocol === 'ftps' ? 'explicit' : 'none',
            passive: form.passive === 'true',
            encoding: form.encoding,
            proxy,
          }
        : {
            ...DEFAULT_SSH_OPTIONS,
            ...accent,
            proxy,
          },
    }
  }

  /** 测试连接拨号超时（秒），短于日常会话默认值以尽快反馈失败 */
  const TEST_CONNECTION_TIMEOUT_SECONDS = 12

  function buildTestParams(): ConnectionTestParams {
    const input = buildInput()
    const params: ConnectionTestParams =
      dlgKind.value === 'ftp'
        ? {
            hostAddress: input.hostAddress,
            portNumber: input.portNumber,
            loginAccount: input.loginAccount,
            options: {
              ...(input.connectionOptions as unknown as FtpConnectionOptions),
              timeout_seconds: TEST_CONNECTION_TIMEOUT_SECONDS,
            },
          }
        : {
            hostAddress: input.hostAddress,
            portNumber: input.portNumber,
            loginAccount: input.loginAccount,
            options: {
              ...(input.connectionOptions as unknown as SshConnectionOptions),
              timeout_seconds: TEST_CONNECTION_TIMEOUT_SECONDS,
            },
          }
    if (form.password.trim()) {
      params.password = form.password
    } else if (dlgMode.value === 'edit' && dlgProfile.value) {
      // 编辑时密码留空：主机/代理走表单，密码从 Keychain 经 profileId 注入
      params.profileId = dlgProfile.value.profileId
    }
    return params
  }

  async function testConnection(): Promise<void> {
    testMessage.value = null
    if (!form.hostAddress.trim()) {
      testMessage.value = { ok: false, text: t('opsNav.form.hostRequired') }
      return
    }
    if (dlgMode.value === 'create' && !form.password.trim()) {
      testMessage.value = { ok: false, text: t('opsNav.passwordRequired') }
      return
    }
    if (!validateProxyForm(form)) {
      testMessage.value = { ok: false, text: t('connection.form.proxyHostRequired') }
      return
    }
    testing.value = true
    try {
      const params = buildTestParams()
      const result =
        dlgKind.value === 'ftp'
          ? await ftpApi.sessionTest(params as FtpSessionTestParams)
          : await sshApi.sessionTest(params as SshSessionTestParams)
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
    if (!form.profileName.trim()) {
      formError.value = t('opsNav.form.nameRequired')
      return false
    }
    if (!form.hostAddress.trim()) {
      formError.value = t('opsNav.form.hostRequired')
      return false
    }
    if (!validateProxyForm(form)) {
      formError.value = t('connection.form.proxyHostRequired')
      return false
    }
    saving.value = true
    try {
      const profile = buildInput()
      const secret = form.password.trim()
      const credential: CredentialInput | undefined = secret
        ? { label: profile.profileName, kind: 'password', secret }
        : undefined

      if (dlgMode.value === 'edit' && dlgProfile.value) {
        await connectionApi.update({
          profileId: dlgProfile.value.profileId,
          profile,
          rowVersion: dlgProfile.value.rowVersion,
          credential,
        })
      } else {
        if (!secret) {
          formError.value = t('opsNav.passwordRequired')
          return false
        }
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
    openDelete,
    saveConnection,
    testConnection,
    deleteConnection,
  })
}
