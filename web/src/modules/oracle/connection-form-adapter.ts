import { oracleApi } from '@/api/oracle'
import { DEFAULT_ORACLE_OPTIONS, type OracleConnectionOptions, type OracleRole, type OracleSessionTestParams } from '@/api/types/oracle'
import { cappedTestTimeout, formatTimeoutFormValue, readStoredTimeoutSeconds } from '@/modules/connection/connection-options'
import { basePasswordSecret, buildTimeoutSeconds, passwordCredentialKind, passwordRequiredMessage } from '@/modules/ops/connection-form/adapter-helpers'
import { formStr, type ConnectionFormAdapter, type ConnectionTestParams } from '@/modules/ops/connection-form/types'

function role(value: string): OracleRole {
  return ['normal', 'sysdba', 'sysoper'].includes(value)
    ? value as OracleRole
    : DEFAULT_ORACLE_OPTIONS.role!
}

export const oracleConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    oracleSchema: '',
    oracleServiceName: '',
    oracleSid: '',
    oracleRole: DEFAULT_ORACLE_OPTIONS.role,
    oracleSslMode: DEFAULT_ORACLE_OPTIONS.ssl_mode,
    oracleWalletPath: '',
    oracleAppName: DEFAULT_ORACLE_OPTIONS.application_name,
    oracleExcludeSystemSchemas: String(DEFAULT_ORACLE_OPTIONS.exclude_system_schemas),
  }),
  applyProfile(form, item) {
    const options = item.connectionOptions as OracleConnectionOptions | undefined
    form.oracleSchema = options?.schema ?? ''
    form.oracleServiceName = options?.service_name ?? ''
    form.oracleSid = options?.sid ?? ''
    form.oracleRole = role(options?.role ?? '')
    form.oracleSslMode = options?.ssl_mode ?? 'disable'
    form.oracleWalletPath = options?.wallet_path ?? ''
    form.oracleAppName = options?.application_name ?? options?.appName ?? 'NiuMa'
    form.oracleExcludeSystemSchemas = String(options?.exclude_system_schemas ?? true)
    form.connectTimeoutSeconds = formatTimeoutFormValue(
      readStoredTimeoutSeconds(options as Record<string, unknown> | undefined, 30), 30,
    )
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    const timeout = buildTimeoutSeconds(form, 30)
    return {
      ...DEFAULT_ORACLE_OPTIONS, ...accent,
      schema: formStr(form, 'oracleSchema').trim(),
      service_name: formStr(form, 'oracleServiceName').trim(),
      sid: formStr(form, 'oracleSid').trim(),
      role: role(formStr(form, 'oracleRole')),
      ssl_mode: formStr(form, 'oracleSslMode') === 'require' ? 'require' : 'disable',
      wallet_path: formStr(form, 'oracleWalletPath').trim(),
      application_name: formStr(form, 'oracleAppName').trim() || 'NiuMa',
      appName: formStr(form, 'oracleAppName').trim() || 'NiuMa',
      exclude_system_schemas: formStr(form, 'oracleExcludeSystemSchemas') !== 'false',
      connect_timeout_seconds: timeout, timeout_seconds: timeout, proxy, tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const options = input.connectionOptions as OracleConnectionOptions
    return {
      hostAddress: input.hostAddress, portNumber: input.portNumber, loginAccount: input.loginAccount,
      options: {
        ...options,
        connect_timeout_seconds: cappedTestTimeout(
          readStoredTimeoutSeconds(options as Record<string, unknown>, 30), 30, timeoutSeconds,
        ),
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return oracleApi.sessionTest(params as OracleSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => true,
  credentialKind: passwordCredentialKind,
  authRequiredMessage: passwordRequiredMessage,
}
