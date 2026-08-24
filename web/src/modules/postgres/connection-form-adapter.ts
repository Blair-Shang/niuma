import { postgresApi } from '@/api/postgres'
import type { PostgresConnectionOptions, PostgresSessionTestParams, PostgresSSLMode } from '@/api/types/postgres'
import { DEFAULT_POSTGRES_OPTIONS } from '@/api/types/postgres'
import {
  basePasswordSecret,
  buildTimeoutSeconds,
  passwordCredentialKind,
  passwordRequiredMessage,
} from '@/modules/ops/connection-form/adapter-helpers'
import {
  formStr,
  type ConnectionFormAdapter,
  type ConnectionTestParams,
} from '@/modules/ops/connection-form/types'
import {
  cappedTestTimeout,
  formatTimeoutFormValue,
  readStoredTimeoutSeconds,
} from '@/modules/connection/connection-options'
import {
  normalizePostgresClientEncoding,
  parseStatementTimeoutMs,
} from '@/modules/postgres/utils/encoding'

function parseSslMode(raw: string | undefined): PostgresSSLMode {
  switch (raw) {
    case 'disable':
    case 'prefer':
    case 'require':
    case 'verify-ca':
    case 'verify-full':
      return raw
    default:
      return DEFAULT_POSTGRES_OPTIONS.ssl_mode
  }
}

export const postgresConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    pgDatabase: DEFAULT_POSTGRES_OPTIONS.database,
    pgSslMode: DEFAULT_POSTGRES_OPTIONS.ssl_mode,
    pgSslRootCert: DEFAULT_POSTGRES_OPTIONS.ssl_root_cert ?? '',
    pgSslCert: DEFAULT_POSTGRES_OPTIONS.ssl_cert ?? '',
    pgSslKey: DEFAULT_POSTGRES_OPTIONS.ssl_key ?? '',
    pgSearchPath: DEFAULT_POSTGRES_OPTIONS.search_path,
    pgClientEncoding: DEFAULT_POSTGRES_OPTIONS.client_encoding ?? 'UTF8',
    pgExcludeSystemSchemas: String(DEFAULT_POSTGRES_OPTIONS.exclude_system_schemas),
    pgStatementTimeoutMs:
      DEFAULT_POSTGRES_OPTIONS.statement_timeout_ms > 0
        ? String(DEFAULT_POSTGRES_OPTIONS.statement_timeout_ms)
        : '',
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as PostgresConnectionOptions | undefined
    const raw = opts as Record<string, unknown> | undefined
    form.pgDatabase = opts?.database ?? DEFAULT_POSTGRES_OPTIONS.database
    form.pgSslMode = parseSslMode(opts?.ssl_mode)
    form.pgSslRootCert = opts?.ssl_root_cert ?? ''
    form.pgSslCert = opts?.ssl_cert ?? ''
    form.pgSslKey = opts?.ssl_key ?? ''
    form.pgSearchPath = opts?.search_path ?? ''
    form.pgClientEncoding = normalizePostgresClientEncoding(
      opts?.client_encoding ?? DEFAULT_POSTGRES_OPTIONS.client_encoding,
    )
    form.pgExcludeSystemSchemas = String(
      opts?.exclude_system_schemas ?? DEFAULT_POSTGRES_OPTIONS.exclude_system_schemas,
    )
    const stmtMs =
      typeof opts?.statement_timeout_ms === 'number' ? opts.statement_timeout_ms : 0
    form.pgStatementTimeoutMs = stmtMs > 0 ? String(stmtMs) : ''
    const timeout =
      typeof opts?.connect_timeout_seconds === 'number'
        ? opts.connect_timeout_seconds
        : readStoredTimeoutSeconds(raw, DEFAULT_POSTGRES_OPTIONS.connect_timeout_seconds)
    form.connectTimeoutSeconds = formatTimeoutFormValue(
      timeout,
      DEFAULT_POSTGRES_OPTIONS.connect_timeout_seconds,
    )
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    const timeoutSeconds = buildTimeoutSeconds(form, DEFAULT_POSTGRES_OPTIONS.connect_timeout_seconds)
    return {
      ...DEFAULT_POSTGRES_OPTIONS,
      ...accent,
      database: formStr(form, 'pgDatabase').trim() || DEFAULT_POSTGRES_OPTIONS.database,
      ssl_mode: parseSslMode(formStr(form, 'pgSslMode')),
      ssl_root_cert: formStr(form, 'pgSslRootCert').trim(),
      ssl_cert: formStr(form, 'pgSslCert').trim(),
      ssl_key: formStr(form, 'pgSslKey').trim(),
      search_path: formStr(form, 'pgSearchPath').trim(),
      client_encoding: normalizePostgresClientEncoding(formStr(form, 'pgClientEncoding')),
      statement_timeout_ms: parseStatementTimeoutMs(formStr(form, 'pgStatementTimeoutMs')),
      connect_timeout_seconds: timeoutSeconds,
      timeout_seconds: timeoutSeconds,
      exclude_system_schemas: formStr(form, 'pgExcludeSystemSchemas') !== 'false',
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as PostgresConnectionOptions
    const raw = opts as unknown as Record<string, unknown>
    const stored =
      typeof opts.connect_timeout_seconds === 'number'
        ? opts.connect_timeout_seconds
        : readStoredTimeoutSeconds(raw, DEFAULT_POSTGRES_OPTIONS.connect_timeout_seconds)
    const capped = cappedTestTimeout(
      stored,
      DEFAULT_POSTGRES_OPTIONS.connect_timeout_seconds,
      timeoutSeconds,
    )
    return {
      hostAddress: input.hostAddress,
      portNumber: input.portNumber,
      loginAccount: input.loginAccount,
      options: {
        ...opts,
        connect_timeout_seconds: capped,
        timeout_seconds: capped,
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return postgresApi.sessionTest(params as PostgresSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => true,
  credentialKind: passwordCredentialKind,
  authRequiredMessage: passwordRequiredMessage,
}
