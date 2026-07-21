import { vastbaseApi } from '@/api'
import type { VastConnectionOptions, VastSSLMode, VastSessionTestParams } from '@/api/types/vastbase'
import { DEFAULT_VAST_OPTIONS } from '@/api/types/vastbase'
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
  normalizeVastClientEncoding,
  parseStatementTimeoutMs,
} from '@/modules/vastbase/vast-encoding'

function parseVastSslMode(raw: string | undefined): VastSSLMode {
  switch (raw) {
    case 'disable':
    case 'prefer':
    case 'require':
    case 'verify-ca':
    case 'verify-full':
      return raw
    default:
      return DEFAULT_VAST_OPTIONS.ssl_mode
  }
}

export const vastbaseConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    vastDatabase: DEFAULT_VAST_OPTIONS.database,
    vastSslMode: DEFAULT_VAST_OPTIONS.ssl_mode,
    vastSslRootCert: DEFAULT_VAST_OPTIONS.ssl_root_cert ?? '',
    vastSslCert: DEFAULT_VAST_OPTIONS.ssl_cert ?? '',
    vastSslKey: DEFAULT_VAST_OPTIONS.ssl_key ?? '',
    vastSearchPath: DEFAULT_VAST_OPTIONS.search_path,
    vastClientEncoding: DEFAULT_VAST_OPTIONS.client_encoding ?? 'UTF8',
    vastExcludeSystemSchemas: String(DEFAULT_VAST_OPTIONS.exclude_system_schemas),
    vastStatementTimeoutMs:
      DEFAULT_VAST_OPTIONS.statement_timeout_ms > 0
        ? String(DEFAULT_VAST_OPTIONS.statement_timeout_ms)
        : '',
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as VastConnectionOptions | undefined
    const raw = opts as Record<string, unknown> | undefined
    form.vastDatabase = opts?.database ?? DEFAULT_VAST_OPTIONS.database
    form.vastSslMode = parseVastSslMode(opts?.ssl_mode)
    form.vastSslRootCert = opts?.ssl_root_cert ?? ''
    form.vastSslCert = opts?.ssl_cert ?? ''
    form.vastSslKey = opts?.ssl_key ?? ''
    form.vastSearchPath = opts?.search_path ?? ''
    form.vastClientEncoding = normalizeVastClientEncoding(
      opts?.client_encoding ?? DEFAULT_VAST_OPTIONS.client_encoding,
    )
    form.vastExcludeSystemSchemas = String(
      opts?.exclude_system_schemas ?? DEFAULT_VAST_OPTIONS.exclude_system_schemas,
    )
    const stmtMs =
      typeof opts?.statement_timeout_ms === 'number' ? opts.statement_timeout_ms : 0
    form.vastStatementTimeoutMs = stmtMs > 0 ? String(stmtMs) : ''
    const timeout =
      typeof opts?.connect_timeout_seconds === 'number'
        ? opts.connect_timeout_seconds
        : readStoredTimeoutSeconds(raw, DEFAULT_VAST_OPTIONS.connect_timeout_seconds)
    form.connectTimeoutSeconds = formatTimeoutFormValue(
      timeout,
      DEFAULT_VAST_OPTIONS.connect_timeout_seconds,
    )
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    const timeoutSeconds = buildTimeoutSeconds(form, DEFAULT_VAST_OPTIONS.connect_timeout_seconds)
    return {
      ...DEFAULT_VAST_OPTIONS,
      ...accent,
      database: formStr(form, 'vastDatabase').trim() || DEFAULT_VAST_OPTIONS.database,
      ssl_mode: parseVastSslMode(formStr(form, 'vastSslMode')),
      ssl_root_cert: formStr(form, 'vastSslRootCert').trim(),
      ssl_cert: formStr(form, 'vastSslCert').trim(),
      ssl_key: formStr(form, 'vastSslKey').trim(),
      search_path: formStr(form, 'vastSearchPath').trim(),
      client_encoding: normalizeVastClientEncoding(formStr(form, 'vastClientEncoding')),
      statement_timeout_ms: parseStatementTimeoutMs(formStr(form, 'vastStatementTimeoutMs')),
      connect_timeout_seconds: timeoutSeconds,
      timeout_seconds: timeoutSeconds,
      exclude_system_schemas: formStr(form, 'vastExcludeSystemSchemas') !== 'false',
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as VastConnectionOptions
    const raw = opts as unknown as Record<string, unknown>
    const stored =
      typeof opts.connect_timeout_seconds === 'number'
        ? opts.connect_timeout_seconds
        : readStoredTimeoutSeconds(raw, DEFAULT_VAST_OPTIONS.connect_timeout_seconds)
    const capped = cappedTestTimeout(
      stored,
      DEFAULT_VAST_OPTIONS.connect_timeout_seconds,
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
    return vastbaseApi.sessionTest(params as VastSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => true,
  credentialKind: passwordCredentialKind,
  authRequiredMessage: passwordRequiredMessage,
}
