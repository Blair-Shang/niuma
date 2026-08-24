import { sqlserverApi } from '@/api/sqlserver'
import {
  DEFAULT_SQLSERVER_OPTIONS,
  type SqlServerAuthType,
  type SqlServerConnectionOptions,
  type SqlServerEncryptMode,
  type SqlServerSessionTestParams,
  type SqlServerSessionTestResult,
} from '@/api/types/sqlserver'
import { cappedTestTimeout, formatTimeoutFormValue, readStoredTimeoutSeconds } from '@/modules/connection/connection-options'
import { basePasswordSecret, buildTimeoutSeconds, passwordCredentialKind, passwordRequiredMessage } from '@/modules/ops/connection-form/adapter-helpers'
import { formStr, type ConnectionFormAdapter, type ConnectionTestParams } from '@/modules/ops/connection-form/types'

function authType(value: string): SqlServerAuthType {
  switch (value) {
    case 'windows':
    case 'aad_password':
    case 'aad_integrated':
    case 'aad_msi':
    case 'aad_service_principal':
      return value
    default:
      return 'sql'
  }
}

function authNeedsPassword(value: string): boolean {
  const auth = authType(value)
  return auth === 'sql' || auth === 'aad_password' || auth === 'aad_service_principal'
}

function encryptMode(value: string): SqlServerEncryptMode {
  switch (value) {
    case 'disable':
    case 'optional':
    case 'mandatory':
    case 'strict':
      return value
    default:
      return 'optional'
  }
}

function shortVersion(version: string): string {
  const line = version.trim().split(/\r?\n/)[0]?.trim() ?? ''
  if (line.length <= 96) return line
  return `${line.slice(0, 93)}…`
}

function isAzureHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return h.includes('.database.windows.net') || h.includes('.database.chinacloudapi.cn')
}

export const sqlserverConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    ssDatabase: DEFAULT_SQLSERVER_OPTIONS.database,
    ssInstance: DEFAULT_SQLSERVER_OPTIONS.instance,
    ssAuthType: DEFAULT_SQLSERVER_OPTIONS.auth_type,
    ssEncrypt: DEFAULT_SQLSERVER_OPTIONS.encrypt,
    ssTrustServerCertificate: 'false',
    ssHostNameInCertificate: '',
    ssAppName: DEFAULT_SQLSERVER_OPTIONS.application_name,
    ssExcludeSystemSchemas: String(DEFAULT_SQLSERVER_OPTIONS.exclude_system_schemas),
  }),
  applyProfile(form, item) {
    const options = item.connectionOptions as SqlServerConnectionOptions | undefined
    form.ssDatabase = options?.database ?? DEFAULT_SQLSERVER_OPTIONS.database
    form.ssInstance = options?.instance ?? DEFAULT_SQLSERVER_OPTIONS.instance
    form.ssAuthType = authType(String(options?.auth_type ?? 'sql'))
    form.ssEncrypt = encryptMode(options?.encrypt ?? '')
    form.ssTrustServerCertificate = String(options?.trust_server_certificate ?? false)
    form.ssHostNameInCertificate = options?.host_name_in_certificate ?? ''
    form.ssAppName = options?.application_name ?? 'NiuMa'
    form.ssExcludeSystemSchemas = String(options?.exclude_system_schemas ?? true)
    form.connectTimeoutSeconds = formatTimeoutFormValue(
      readStoredTimeoutSeconds(options as Record<string, unknown> | undefined, 10),
      10,
    )
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    const timeout = buildTimeoutSeconds(form, 10)
    const encrypt = encryptMode(formStr(form, 'ssEncrypt'))
    const trustCert = encrypt !== 'disable' && formStr(form, 'ssTrustServerCertificate') === 'true'
    const hostNameInCertificate =
      encrypt === 'disable' ? '' : formStr(form, 'ssHostNameInCertificate').trim()
    return {
      ...DEFAULT_SQLSERVER_OPTIONS,
      ...accent,
      database: formStr(form, 'ssDatabase').trim(),
      instance: formStr(form, 'ssInstance').trim(),
      auth_type: authType(formStr(form, 'ssAuthType')),
      encrypt,
      trust_server_certificate: trustCert,
      host_name_in_certificate: hostNameInCertificate,
      application_name: formStr(form, 'ssAppName').trim() || 'NiuMa',
      exclude_system_schemas: formStr(form, 'ssExcludeSystemSchemas') !== 'false',
      connect_timeout_seconds: timeout,
      timeout_seconds: timeout,
      proxy,
      tunnel,
    }
  },
  validate({ form, t }) {
    const instance = formStr(form, 'ssInstance').trim()
    if (instance && form.tunnelType !== 'none') {
      return t('modules.sqlserver.form.instanceTunnelConflict')
    }
    const auth = authType(formStr(form, 'ssAuthType'))
    if ((auth === 'windows' || auth === 'aad_integrated') && form.tunnelType !== 'none') {
      return t('modules.sqlserver.form.authTunnelConflict')
    }
    const encrypt = encryptMode(formStr(form, 'ssEncrypt'))
    const host = formStr(form, 'hostAddress').trim()
    if (isAzureHost(host) && (encrypt === 'disable' || encrypt === 'optional')) {
      return t('modules.sqlserver.form.azureEncryptRequired')
    }
    const portRaw = formStr(form, 'portNumber').trim()
    if (instance && portRaw !== '' && portRaw !== '0') {
      const port = Number.parseInt(portRaw, 10)
      if (!Number.isFinite(port) || port < 0) {
        return t('modules.sqlserver.form.portInvalid')
      }
    }
    return null
  },
  buildTestParams({ input, timeoutSeconds }) {
    const options = input.connectionOptions as SqlServerConnectionOptions
    return {
      hostAddress: input.hostAddress,
      portNumber: input.portNumber,
      loginAccount: input.loginAccount,
      options: {
        ...options,
        connect_timeout_seconds: cappedTestTimeout(
          readStoredTimeoutSeconds(options as Record<string, unknown>, 10),
          10,
          timeoutSeconds,
        ),
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return sqlserverApi.sessionTest(params as SqlServerSessionTestParams)
  },
  enrichTestMessage(message, ok, t, result) {
    if (ok) {
      const version = (result as SqlServerSessionTestResult | undefined)?.version?.trim()
      if (version) {
        return t('modules.sqlserver.form.testOkWithVersion', { version: shortVersion(version) })
      }
      return message || t('connection.form.testOk')
    }
    const msg = message || ''
    if (/login failed|18456|authentication failed/i.test(msg)) {
      return `${msg}\n${t('modules.sqlserver.form.hintLoginFailed')}`
    }
    if (/certificate|TLS|SSL|encrypt|trust.?server.?certificate|0x8009030d|0x2746/i.test(msg)) {
      return `${msg}\n${t('modules.sqlserver.form.hintCertificate')}`
    }
    if (/sqlserver: ssh tunnel|tunnel|ssh/i.test(msg)) {
      return `${msg}\n${t('modules.sqlserver.form.hintTunnel')}`
    }
    if (/instance|browser|udp|1434|named instance/i.test(msg)) {
      return `${msg}\n${t('modules.sqlserver.form.hintInstance')}`
    }
    if (/timeout|i\/o timeout|deadline exceeded|dial/i.test(msg)) {
      return `${msg}\n${t('modules.sqlserver.form.hintTimeout')}`
    }
    if (/connection refused|actively refused|no such host|cannot connect/i.test(msg)) {
      return `${msg}\n${t('modules.sqlserver.form.hintUnreachable')}`
    }
    if (/not microsoft sql server|not azure sql|use the matching connection kind/i.test(msg)) {
      return `${msg}\n${t('modules.sqlserver.form.hintWrongEngine')}`
    }
    return msg
  },
  secret: basePasswordSecret,
  secretRequired: ({ form }) => authNeedsPassword(formStr(form, 'ssAuthType')),
  credentialKind: passwordCredentialKind,
  authRequiredMessage: (form, t) =>
    authNeedsPassword(formStr(form, 'ssAuthType')) ? passwordRequiredMessage(form, t) : '',
}
