import { damengApi } from '@/api/dameng'
import { DEFAULT_DAMENG_OPTIONS, type DamengConnectionOptions, type DamengSSLMode, type DamengSessionTestParams } from '@/api/types/dameng'
import { cappedTestTimeout, formatTimeoutFormValue, readStoredTimeoutSeconds } from '@/modules/connection/connection-options'
import { basePasswordSecret, buildTimeoutSeconds, passwordCredentialKind, passwordRequiredMessage } from '@/modules/ops/connection-form/adapter-helpers'
import { formStr, type ConnectionFormAdapter, type ConnectionTestParams } from '@/modules/ops/connection-form/types'

function sslMode(value: string): DamengSSLMode {
  return ['disable', 'require', 'verify-ca', 'verify-full'].includes(value)
    ? value as DamengSSLMode
    : DEFAULT_DAMENG_OPTIONS.ssl_mode!
}

export const damengConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    damengSchema: '',
    damengSslMode: DEFAULT_DAMENG_OPTIONS.ssl_mode,
    damengSslCa: '',
    damengSslCert: '',
    damengSslKey: '',
    damengAppName: DEFAULT_DAMENG_OPTIONS.application_name,
    damengExcludeSystemSchemas: String(DEFAULT_DAMENG_OPTIONS.exclude_system_schemas),
  }),
  applyProfile(form, item) {
    const options = item.connectionOptions as DamengConnectionOptions | undefined
    form.damengSchema = options?.schema ?? ''
    form.damengSslMode = sslMode(options?.ssl_mode ?? '')
    form.damengSslCa = options?.ssl_ca ?? ''
    form.damengSslCert = options?.ssl_cert ?? ''
    form.damengSslKey = options?.ssl_key ?? ''
    form.damengAppName = options?.application_name ?? options?.appName ?? 'NiuMa'
    form.damengExcludeSystemSchemas = String(options?.exclude_system_schemas ?? true)
    form.connectTimeoutSeconds = formatTimeoutFormValue(
      readStoredTimeoutSeconds(options as Record<string, unknown> | undefined, 30),
      30,
    )
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    const timeout = buildTimeoutSeconds(form, 30)
    return {
      ...DEFAULT_DAMENG_OPTIONS,
      ...accent,
      schema: formStr(form, 'damengSchema').trim(),
      ssl_mode: sslMode(formStr(form, 'damengSslMode')),
      ssl_ca: formStr(form, 'damengSslCa').trim(),
      ssl_cert: formStr(form, 'damengSslCert').trim(),
      ssl_key: formStr(form, 'damengSslKey').trim(),
      application_name: formStr(form, 'damengAppName').trim() || 'NiuMa',
      appName: formStr(form, 'damengAppName').trim() || 'NiuMa',
      exclude_system_schemas: formStr(form, 'damengExcludeSystemSchemas') !== 'false',
      connect_timeout_seconds: timeout,
      timeout_seconds: timeout,
      // dm 驱动当前不支持 proxy 直连，仅支持 SSH 隧道转发。
      proxy: { type: 'none' as const },
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const options = input.connectionOptions as DamengConnectionOptions
    return {
      hostAddress: input.hostAddress,
      portNumber: input.portNumber,
      loginAccount: input.loginAccount,
      options: {
        ...options,
        // 历史站点可能已保存 proxy；测试连接时强制忽略，避免 dm DSN 报错。
        proxy: { type: 'none' as const },
        connect_timeout_seconds: cappedTestTimeout(
          readStoredTimeoutSeconds(options as Record<string, unknown>, 30),
          30,
          timeoutSeconds,
        ),
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return damengApi.sessionTest(params as DamengSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => true,
  credentialKind: passwordCredentialKind,
  authRequiredMessage: passwordRequiredMessage,
}
