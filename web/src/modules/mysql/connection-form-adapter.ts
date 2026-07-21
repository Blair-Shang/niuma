import { mysqlApi } from '@/api'
import type { MysqlConnectionOptions, MysqlSSLMode, MysqlSessionTestParams } from '@/api/types/mysql'
import { DEFAULT_MYSQL_OPTIONS } from '@/api/types/mysql'
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
  normalizeMysqlCharset,
  normalizeMysqlCollation,
} from '@/modules/mysql/mysql-charset'

function parseMysqlSslMode(raw: string | undefined): MysqlSSLMode {
  switch (raw) {
    case 'disable':
    case 'preferred':
    case 'require':
    case 'verify-ca':
    case 'verify-identity':
      return raw
    case 'prefer':
    case 'allow':
      return 'preferred'
    case 'verify-full':
      return 'verify-identity'
    default:
      return DEFAULT_MYSQL_OPTIONS.ssl_mode
  }
}

export const mysqlConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    mysqlDatabase: DEFAULT_MYSQL_OPTIONS.database,
    mysqlSslMode: DEFAULT_MYSQL_OPTIONS.ssl_mode,
    mysqlSslCa: DEFAULT_MYSQL_OPTIONS.ssl_ca ?? '',
    mysqlSslCert: DEFAULT_MYSQL_OPTIONS.ssl_cert ?? '',
    mysqlSslKey: DEFAULT_MYSQL_OPTIONS.ssl_key ?? '',
    mysqlCharset: DEFAULT_MYSQL_OPTIONS.charset,
    mysqlCollation: DEFAULT_MYSQL_OPTIONS.collation ?? '',
    mysqlExcludeSystemSchemas: String(DEFAULT_MYSQL_OPTIONS.exclude_system_schemas),
    mysqlAllowNativePasswords: String(DEFAULT_MYSQL_OPTIONS.allowNativePasswords),
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as MysqlConnectionOptions | undefined
    const raw = opts as Record<string, unknown> | undefined
    form.mysqlDatabase = opts?.database ?? ''
    form.mysqlSslMode = parseMysqlSslMode(opts?.ssl_mode)
    form.mysqlSslCa = opts?.ssl_ca ?? ''
    form.mysqlSslCert = opts?.ssl_cert ?? ''
    form.mysqlSslKey = opts?.ssl_key ?? ''
    const charset = normalizeMysqlCharset(opts?.charset, DEFAULT_MYSQL_OPTIONS.charset)
    form.mysqlCharset = charset
    form.mysqlCollation = normalizeMysqlCollation(charset, opts?.collation)
    form.mysqlExcludeSystemSchemas = String(
      opts?.exclude_system_schemas ?? DEFAULT_MYSQL_OPTIONS.exclude_system_schemas,
    )
    form.mysqlAllowNativePasswords = String(
      opts?.allowNativePasswords ?? DEFAULT_MYSQL_OPTIONS.allowNativePasswords,
    )
    const timeout =
      typeof opts?.connect_timeout_seconds === 'number'
        ? opts.connect_timeout_seconds
        : readStoredTimeoutSeconds(raw, DEFAULT_MYSQL_OPTIONS.connect_timeout_seconds)
    form.connectTimeoutSeconds = formatTimeoutFormValue(
      timeout,
      DEFAULT_MYSQL_OPTIONS.connect_timeout_seconds,
    )
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    const timeoutSeconds = buildTimeoutSeconds(form, DEFAULT_MYSQL_OPTIONS.connect_timeout_seconds)
    const charset = normalizeMysqlCharset(
      formStr(form, 'mysqlCharset'),
      DEFAULT_MYSQL_OPTIONS.charset,
    )
    const collation = normalizeMysqlCollation(charset, formStr(form, 'mysqlCollation'))
    return {
      ...DEFAULT_MYSQL_OPTIONS,
      ...accent,
      database: formStr(form, 'mysqlDatabase').trim(),
      charset,
      collation,
      ssl_mode: parseMysqlSslMode(formStr(form, 'mysqlSslMode')),
      ssl_ca: formStr(form, 'mysqlSslCa').trim(),
      ssl_cert: formStr(form, 'mysqlSslCert').trim(),
      ssl_key: formStr(form, 'mysqlSslKey').trim(),
      allowNativePasswords: formStr(form, 'mysqlAllowNativePasswords') !== 'false',
      connect_timeout_seconds: timeoutSeconds,
      timeout_seconds: timeoutSeconds,
      exclude_system_schemas: formStr(form, 'mysqlExcludeSystemSchemas') !== 'false',
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as MysqlConnectionOptions
    const raw = opts as unknown as Record<string, unknown>
    const stored =
      typeof opts.connect_timeout_seconds === 'number'
        ? opts.connect_timeout_seconds
        : readStoredTimeoutSeconds(raw, DEFAULT_MYSQL_OPTIONS.connect_timeout_seconds)
    const capped = cappedTestTimeout(
      stored,
      DEFAULT_MYSQL_OPTIONS.connect_timeout_seconds,
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
    return mysqlApi.sessionTest(params as MysqlSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => true,
  credentialKind: passwordCredentialKind,
  authRequiredMessage: passwordRequiredMessage,
}
