import { ftpApi } from '@/api'
import type { FtpConnectionOptions, FtpSessionTestParams } from '@/api/types/ftp'
import { DEFAULT_FTP_OPTIONS } from '@/api/types/ftp'
import {
  applyStoredTimeout,
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
  readStoredTimeoutSeconds,
} from '@/modules/connection/connection-options'

export const ftpConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    protocol: 'ftp',
    ftpTlsMode: 'explicit',
    ftpTlsVerify: 'true',
    passive: 'true',
    encoding: 'utf-8',
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as FtpConnectionOptions | undefined
    form.protocol = opts?.protocol ?? 'ftp'
    form.ftpTlsMode = opts?.tls_mode === 'implicit' ? 'implicit' : 'explicit'
    form.ftpTlsVerify = String(opts?.tls_verify ?? true)
    form.passive = String(opts?.passive ?? true)
    form.encoding = opts?.encoding ?? 'utf-8'
    applyStoredTimeout(form, opts as Record<string, unknown> | undefined, DEFAULT_FTP_OPTIONS.timeout_seconds)
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    const protocol = formStr(form, 'protocol', 'ftp') as 'ftp' | 'ftps'
    return {
      ...DEFAULT_FTP_OPTIONS,
      ...accent,
      protocol,
      tls_mode:
        protocol === 'ftps'
          ? (formStr(form, 'ftpTlsMode', 'explicit') as 'explicit' | 'implicit')
          : 'none',
      tls_verify: protocol === 'ftps' ? formStr(form, 'ftpTlsVerify') !== 'false' : true,
      passive: formStr(form, 'passive') === 'true',
      encoding: formStr(form, 'encoding', 'utf-8'),
      timeout_seconds: buildTimeoutSeconds(form, DEFAULT_FTP_OPTIONS.timeout_seconds),
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as FtpConnectionOptions
    return {
      hostAddress: input.hostAddress,
      portNumber: input.portNumber,
      loginAccount: input.loginAccount,
      options: {
        ...opts,
        timeout_seconds: cappedTestTimeout(
          readStoredTimeoutSeconds(opts as unknown as Record<string, unknown>, DEFAULT_FTP_OPTIONS.timeout_seconds),
          DEFAULT_FTP_OPTIONS.timeout_seconds,
          timeoutSeconds,
        ),
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return ftpApi.sessionTest(params as FtpSessionTestParams)
  },
  secret: basePasswordSecret,
  secretRequired: () => true,
  credentialKind: passwordCredentialKind,
  authRequiredMessage: passwordRequiredMessage,
}
