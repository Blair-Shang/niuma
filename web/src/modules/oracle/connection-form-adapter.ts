import { oracleApi } from '@/api/oracle'
import {
  DEFAULT_ORACLE_OPTIONS,
  type OracleConnectionOptions,
  type OracleRole,
  type OracleSessionTestParams,
  type OracleSSLMode,
} from '@/api/types/oracle'
import { cappedTestTimeout, formatTimeoutFormValue, readStoredTimeoutSeconds } from '@/modules/connection/connection-options'
import { basePasswordSecret, buildTimeoutSeconds, passwordCredentialKind, passwordRequiredMessage } from '@/modules/ops/connection-form/adapter-helpers'
import { formStr, type ConnectionFormAdapter, type ConnectionFormState, type ConnectionTestParams } from '@/modules/ops/connection-form/types'
import { isOracleClientMissingError } from '@/modules/oracle/utils/tool-paths'

function role(value: string): OracleRole {
  return ['normal', 'sysdba', 'sysoper'].includes(value)
    ? value as OracleRole
    : DEFAULT_ORACLE_OPTIONS.role!
}

function sslMode(value: string): OracleSSLMode {
  if (value === 'require' || value === 'verify-full') return value
  return 'disable'
}

function connectAs(form: ConnectionFormState): 'service' | 'sid' {
  if (form.oracleConnectAs === 'sid' || form.oracleConnectAs === 'service') {
    return form.oracleConnectAs
  }
  const sid = formStr(form, 'oracleSid').trim()
  const service = formStr(form, 'oracleServiceName').trim()
  if (sid && !service) return 'sid'
  return 'service'
}

export const oracleConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    oracleConnectAs: 'service',
    oracleSchema: '',
    oracleServiceName: '',
    oracleSid: '',
    oracleRole: DEFAULT_ORACLE_OPTIONS.role,
    oracleSslMode: DEFAULT_ORACLE_OPTIONS.ssl_mode,
    oracleWalletPath: '',
    oracleWalletPassword: '',
    oracleAppName: DEFAULT_ORACLE_OPTIONS.application_name,
    oracleExcludeSystemSchemas: String(DEFAULT_ORACLE_OPTIONS.exclude_system_schemas),
  }),
  applyProfile(form, item) {
    const options = item.connectionOptions as OracleConnectionOptions | undefined
    form.oracleSchema = options?.schema ?? ''
    form.oracleServiceName = options?.service_name ?? ''
    form.oracleSid = options?.sid ?? ''
    form.oracleConnectAs =
      (options?.sid && !options?.service_name) ? 'sid' : 'service'
    form.oracleRole = role(options?.role ?? '')
    form.oracleSslMode = sslMode(options?.ssl_mode ?? 'disable')
    form.oracleWalletPath = options?.wallet_path ?? ''
    form.oracleWalletPassword = options?.wallet_password ?? ''
    form.oracleAppName = options?.application_name ?? options?.appName ?? 'NiuMa'
    form.oracleExcludeSystemSchemas = String(options?.exclude_system_schemas ?? true)
    form.connectTimeoutSeconds = formatTimeoutFormValue(
      readStoredTimeoutSeconds(options as Record<string, unknown> | undefined, 30), 30,
    )
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    const timeout = buildTimeoutSeconds(form, 30)
    const as = connectAs(form)
    const mode = sslMode(formStr(form, 'oracleSslMode'))
    return {
      ...DEFAULT_ORACLE_OPTIONS, ...accent,
      schema: formStr(form, 'oracleSchema').trim(),
      service_name: as === 'service' ? formStr(form, 'oracleServiceName').trim() : '',
      sid: as === 'sid' ? formStr(form, 'oracleSid').trim() : '',
      role: role(formStr(form, 'oracleRole')),
      ssl_mode: mode,
      wallet_path: mode === 'disable' ? '' : formStr(form, 'oracleWalletPath').trim(),
      wallet_password: mode === 'disable' ? '' : formStr(form, 'oracleWalletPassword'),
      application_name: formStr(form, 'oracleAppName').trim() || 'NiuMa',
      appName: formStr(form, 'oracleAppName').trim() || 'NiuMa',
      exclude_system_schemas: formStr(form, 'oracleExcludeSystemSchemas') !== 'false',
      connect_timeout_seconds: timeout, timeout_seconds: timeout, proxy, tunnel,
    }
  },
  validate({ form, t }) {
    const as = connectAs(form)
    if (as === 'service' && !formStr(form, 'oracleServiceName').trim()) {
      return t('modules.oracle.form.serviceNameRequired')
    }
    if (as === 'sid' && !formStr(form, 'oracleSid').trim()) {
      return t('modules.oracle.form.sidRequired')
    }
    if (sslMode(formStr(form, 'oracleSslMode')) === 'verify-full'
      && !formStr(form, 'oracleWalletPath').trim()) {
      return t('modules.oracle.form.walletPathRequired')
    }
    return null
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
  enrichTestMessage(message, ok, t) {
    if (ok) return message
    if (isOracleClientMissingError(message)) {
      return `${message}\n${t('modules.oracle.clientMissingHint')}`
    }
    if (/ORA-12514|ORA-12505|service name or SID required/i.test(message)) {
      return `${message}\n${t('modules.oracle.listenerHint')}`
    }
    if (/SSH tunnel is not supported/i.test(message)) {
      return `${message}\n${t('modules.oracle.tunnelUnsupportedHint')}`
    }
    if (/wallet path required|ORA-28759|ORA-28862|ORA-29024/i.test(message)) {
      return `${message}\n${t('modules.oracle.sslHint')}`
    }
    return message
  },
  secret: basePasswordSecret,
  secretRequired: () => true,
  credentialKind: passwordCredentialKind,
  authRequiredMessage: passwordRequiredMessage,
}
