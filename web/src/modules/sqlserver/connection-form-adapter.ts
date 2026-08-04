import { sqlserverApi } from '@/api/sqlserver'
import {
  DEFAULT_SQLSERVER_OPTIONS,
  type SqlServerConnectionOptions,
  type SqlServerEncryptMode,
  type SqlServerSessionTestParams,
} from '@/api/types/sqlserver'
import { cappedTestTimeout, formatTimeoutFormValue, readStoredTimeoutSeconds } from '@/modules/connection/connection-options'
import { basePasswordSecret, buildTimeoutSeconds, passwordCredentialKind, passwordRequiredMessage } from '@/modules/ops/connection-form/adapter-helpers'
import { formStr, type ConnectionFormAdapter, type ConnectionTestParams } from '@/modules/ops/connection-form/types'

function authType(value: string): string {
  return value === 'sql' ? 'sql' : DEFAULT_SQLSERVER_OPTIONS.auth_type!
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
    form.ssAuthType = authType(options?.auth_type ?? '')
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
    const trustCert = formStr(form, 'ssTrustServerCertificate') === 'true'
    return {
      ...DEFAULT_SQLSERVER_OPTIONS,
      ...accent,
      database: formStr(form, 'ssDatabase').trim(),
      instance: formStr(form, 'ssInstance').trim(),
      auth_type: authType(formStr(form, 'ssAuthType')),
      encrypt: encryptMode(formStr(form, 'ssEncrypt')),
      trust_server_certificate: trustCert,
      host_name_in_certificate: formStr(form, 'ssHostNameInCertificate').trim(),
      application_name: formStr(form, 'ssAppName').trim() || 'NiuMa',
      exclude_system_schemas: formStr(form, 'ssExcludeSystemSchemas') !== 'false',
      connect_timeout_seconds: timeout,
      timeout_seconds: timeout,
      proxy,
      tunnel,
    }
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
  secret: basePasswordSecret,
  secretRequired: () => true,
  credentialKind: passwordCredentialKind,
  authRequiredMessage: passwordRequiredMessage,
}
