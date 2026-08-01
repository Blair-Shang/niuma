import { kingbaseApi } from '@/api/kingbase'
import type { KingbaseConnectionOptions, KingbaseSessionTestParams, KingbaseSSLMode } from '@/api/types/kingbase'
import { DEFAULT_KINGBASE_OPTIONS } from '@/api/types/kingbase'
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
  normalizeKingbaseClientEncoding,
  parseStatementTimeoutMs,
} from '@/modules/kingbase/utils/encoding'

function parseSslMode(raw: string | undefined): KingbaseSSLMode {
  switch (raw) {
    case 'disable':
    case 'prefer':
    case 'require':
    case 'verify-ca':
    case 'verify-full':
      return raw
    default:
      return DEFAULT_KINGBASE_OPTIONS.ssl_mode
  }
}

export const kingbaseConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    kbDatabase: DEFAULT_KINGBASE_OPTIONS.database,
    kbSslMode: DEFAULT_KINGBASE_OPTIONS.ssl_mode,
    kbSslRootCert: DEFAULT_KINGBASE_OPTIONS.ssl_root_cert ?? '',
    kbSslCert: DEFAULT_KINGBASE_OPTIONS.ssl_cert ?? '',
    kbSslKey: DEFAULT_KINGBASE_OPTIONS.ssl_key ?? '',
    kbSearchPath: DEFAULT_KINGBASE_OPTIONS.search_path,
    kbClientEncoding: DEFAULT_KINGBASE_OPTIONS.client_encoding ?? 'UTF8',
    kbExcludeSystemSchemas: String(DEFAULT_KINGBASE_OPTIONS.exclude_system_schemas),
    kbStatementTimeoutMs:
      DEFAULT_KINGBASE_OPTIONS.statement_timeout_ms > 0
        ? String(DEFAULT_KINGBASE_OPTIONS.statement_timeout_ms)
        : '',
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as KingbaseConnectionOptions | undefined
    const raw = opts as Record<string, unknown> | undefined
    form.kbDatabase = opts?.database ?? DEFAULT_KINGBASE_OPTIONS.database
    form.kbSslMode = parseSslMode(opts?.ssl_mode)
    form.kbSslRootCert = opts?.ssl_root_cert ?? ''
    form.kbSslCert = opts?.ssl_cert ?? ''
    form.kbSslKey = opts?.ssl_key ?? ''
    form.kbSearchPath = opts?.search_path ?? ''
    form.kbClientEncoding = normalizeKingbaseClientEncoding(
      opts?.client_encoding ?? DEFAULT_KINGBASE_OPTIONS.client_encoding,
    )
    form.kbExcludeSystemSchemas = String(
      opts?.exclude_system_schemas ?? DEFAULT_KINGBASE_OPTIONS.exclude_system_schemas,
    )
    const stmtMs =
      typeof opts?.statement_timeout_ms === 'number' ? opts.statement_timeout_ms : 0
    form.kbStatementTimeoutMs = stmtMs > 0 ? String(stmtMs) : ''
    const timeout =
      typeof opts?.connect_timeout_seconds === 'number'
        ? opts.connect_timeout_seconds
        : readStoredTimeoutSeconds(raw, DEFAULT_KINGBASE_OPTIONS.connect_timeout_seconds)
    form.connectTimeoutSeconds = formatTimeoutFormValue(
      timeout,
      DEFAULT_KINGBASE_OPTIONS.connect_timeout_seconds,
    )
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    const timeoutSeconds = buildTimeoutSeconds(form, DEFAULT_KINGBASE_OPTIONS.connect_timeout_seconds)
    return {
      ...DEFAULT_KINGBASE_OPTIONS,
      ...accent,
      database: formStr(form, 'kbDatabase').trim() || DEFAULT_KINGBASE_OPTIONS.database,
      ssl_mode: parseSslMode(formStr(form, 'kbSslMode')),
      ssl_root_cert: formStr(form, 'kbSslRootCert').trim(),
      ssl_cert: formStr(form, 'kbSslCert').trim(),
      ssl_key: formStr(form, 'kbSslKey').trim(),
      search_path: formStr(form, 'kbSearchPath').trim(),
      client_encoding: normalizeKingbaseClientEncoding(formStr(form, 'kbClientEncoding')),
      statement_timeout_ms: parseStatementTimeoutMs(formStr(form, 'kbStatementTimeoutMs')),
      connect_timeout_seconds: timeoutSeconds,
      timeout_seconds: timeoutSeconds,
      exclude_system_schemas: formStr(form, 'kbExcludeSystemSchemas') !== 'false',
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as KingbaseConnectionOptions
    const raw = opts as unknown as Record<string, unknown>
    const stored =
      typeof opts.connect_timeout_seconds === 'number'
        ? opts.connect_timeout_seconds
        : readStoredTimeoutSeconds(raw, DEFAULT_KINGBASE_OPTIONS.connect_timeout_seconds)
    const capped = cappedTestTimeout(
      stored,
      DEFAULT_KINGBASE_OPTIONS.connect_timeout_seconds,
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
    return kingbaseApi.sessionTest(params as KingbaseSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => true,
  credentialKind: passwordCredentialKind,
  authRequiredMessage: passwordRequiredMessage,
}
