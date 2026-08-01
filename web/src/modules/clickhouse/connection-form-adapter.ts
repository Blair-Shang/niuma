import { clickhouseApi } from '@/api/clickhouse'
import {
  DEFAULT_CLICKHOUSE_OPTIONS,
  type ClickHouseConnectionOptions,
  type ClickHouseProtocol,
  type ClickHouseSessionTestParams,
} from '@/api/types/clickhouse'
import { cappedTestTimeout, formatTimeoutFormValue, readStoredTimeoutSeconds } from '@/modules/connection/connection-options'
import { basePasswordSecret, buildTimeoutSeconds, passwordCredentialKind, passwordRequiredMessage } from '@/modules/ops/connection-form/adapter-helpers'
import { formStr, type ConnectionFormAdapter, type ConnectionTestParams } from '@/modules/ops/connection-form/types'

function protocol(value: string): ClickHouseProtocol {
  return value === 'http' ? 'http' : 'native'
}

function sslMode(value: string): string {
  return ['disable', 'require', 'verify-ca', 'verify-full'].includes(value)
    ? value
    : DEFAULT_CLICKHOUSE_OPTIONS.ssl_mode!
}

export const clickhouseConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    chDatabase: DEFAULT_CLICKHOUSE_OPTIONS.database,
    chProtocol: DEFAULT_CLICKHOUSE_OPTIONS.protocol,
    chSslMode: DEFAULT_CLICKHOUSE_OPTIONS.ssl_mode,
    chSslCa: '',
    chSslCert: '',
    chSslKey: '',
    chCompress: String(DEFAULT_CLICKHOUSE_OPTIONS.compress),
    chAppName: DEFAULT_CLICKHOUSE_OPTIONS.application_name,
    chExcludeSystemDatabases: String(DEFAULT_CLICKHOUSE_OPTIONS.exclude_system_databases),
    chCluster: '',
    chAltHosts: '',
    chReadTimeoutSeconds: '',
  }),
  applyProfile(form, item) {
    const options = item.connectionOptions as ClickHouseConnectionOptions | undefined
    form.chDatabase = options?.database ?? DEFAULT_CLICKHOUSE_OPTIONS.database
    form.chProtocol = protocol(options?.protocol ?? '')
    form.chSslMode = sslMode(options?.ssl_mode ?? '')
    form.chSslCa = options?.ssl_ca ?? ''
    form.chSslCert = options?.ssl_cert ?? ''
    form.chSslKey = options?.ssl_key ?? ''
    form.chCompress = String(options?.compress ?? true)
    form.chAppName = options?.application_name ?? 'NiuMa'
    form.chExcludeSystemDatabases = String(options?.exclude_system_databases ?? true)
    form.chCluster = options?.cluster ?? ''
    form.chAltHosts = options?.alt_hosts ?? ''
    form.chReadTimeoutSeconds = options?.read_timeout_seconds ? String(options.read_timeout_seconds) : ''
    form.connectTimeoutSeconds = formatTimeoutFormValue(
      readStoredTimeoutSeconds(options as Record<string, unknown> | undefined, 10),
      10,
    )
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    const timeout = buildTimeoutSeconds(form, 10)
    const mode = sslMode(formStr(form, 'chSslMode'))
    const readTimeout = Number.parseInt(formStr(form, 'chReadTimeoutSeconds'), 10)
    return {
      ...DEFAULT_CLICKHOUSE_OPTIONS,
      ...accent,
      database: formStr(form, 'chDatabase').trim() || 'default',
      protocol: protocol(formStr(form, 'chProtocol')),
      secure: mode !== 'disable',
      ssl_mode: mode,
      ssl_ca: formStr(form, 'chSslCa').trim(),
      ssl_cert: formStr(form, 'chSslCert').trim(),
      ssl_key: formStr(form, 'chSslKey').trim(),
      compress: formStr(form, 'chCompress') !== 'false',
      application_name: formStr(form, 'chAppName').trim() || 'NiuMa',
      exclude_system_databases: formStr(form, 'chExcludeSystemDatabases') !== 'false',
      cluster: formStr(form, 'chCluster').trim(),
      alt_hosts: formStr(form, 'chAltHosts').trim(),
      connect_timeout_seconds: timeout,
      read_timeout_seconds: readTimeout > 0 ? readTimeout : undefined,
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const options = input.connectionOptions as ClickHouseConnectionOptions
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
    return clickhouseApi.sessionTest(params as ClickHouseSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => true,
  credentialKind: passwordCredentialKind,
  authRequiredMessage: passwordRequiredMessage,
}
