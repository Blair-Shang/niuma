import { sftpApi } from '@/api'
import type { SftpConnectionOptions, SftpSessionTestParams } from '@/api/types/sftp'
import { DEFAULT_SFTP_OPTIONS } from '@/api/types/sftp'
import {
  applyStoredTimeout,
  buildTimeoutSeconds,
} from '@/modules/ops/connection-form/adapter-helpers'
import type { ConnectionFormAdapter, ConnectionTestParams } from '@/modules/ops/connection-form/types'
import {
  cappedTestTimeout,
  readStoredTimeoutSeconds,
} from '@/modules/connection/connection-options'

export const sftpConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    sshAuthType: DEFAULT_SFTP_OPTIONS.auth_type,
    sshPrivateKey: '',
    sshPrivateKeyPath: '',
    sshPassphrase: '',
    sshKeepaliveSeconds: String(DEFAULT_SFTP_OPTIONS.keepalive_seconds),
    sshVerifyHostKey: DEFAULT_SFTP_OPTIONS.verify_host_key ? 'true' : 'false',
    encoding: DEFAULT_SFTP_OPTIONS.encoding,
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as SftpConnectionOptions | undefined
    form.sshAuthType = opts?.auth_type ?? DEFAULT_SFTP_OPTIONS.auth_type
    form.sshPrivateKey = ''
    form.sshPrivateKeyPath = opts?.private_key_path ?? ''
    form.sshPassphrase = opts?.passphrase ?? ''
    form.sshKeepaliveSeconds = String(opts?.keepalive_seconds ?? DEFAULT_SFTP_OPTIONS.keepalive_seconds)
    form.sshVerifyHostKey = opts?.verify_host_key ? 'true' : 'false'
    form.encoding = opts?.encoding === 'gbk' ? 'gbk' : 'utf-8'
    applyStoredTimeout(form, opts as Record<string, unknown> | undefined, DEFAULT_SFTP_OPTIONS.timeout_seconds)
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    const keepalive = Number.parseInt(String(form.sshKeepaliveSeconds ?? ''), 10)
    return {
      ...DEFAULT_SFTP_OPTIONS,
      ...accent,
      auth_type: form.sshAuthType,
      private_key_path: form.sshPrivateKeyPath.trim(),
      passphrase: form.sshPassphrase,
      timeout_seconds: buildTimeoutSeconds(form, DEFAULT_SFTP_OPTIONS.timeout_seconds),
      keepalive_seconds: Number.isFinite(keepalive) && keepalive >= 0
        ? keepalive
        : DEFAULT_SFTP_OPTIONS.keepalive_seconds,
      verify_host_key: form.sshVerifyHostKey === 'true',
      encoding: form.encoding === 'gbk' ? 'gbk' : 'utf-8',
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as SftpConnectionOptions
    return {
      hostAddress: input.hostAddress,
      portNumber: input.portNumber,
      loginAccount: input.loginAccount,
      options: {
        ...opts,
        timeout_seconds: cappedTestTimeout(
          readStoredTimeoutSeconds(opts as unknown as Record<string, unknown>, DEFAULT_SFTP_OPTIONS.timeout_seconds),
          DEFAULT_SFTP_OPTIONS.timeout_seconds,
          timeoutSeconds,
        ),
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return sftpApi.sessionTest(params as SftpSessionTestParams)
  },
  secret({ form }) {
    if (form.sshAuthType === 'private_key') {
      return form.sshPrivateKey.trim()
    }
    if (form.sshAuthType === 'password' || form.sshAuthType === 'keyboard_interactive') {
      return form.password.trim()
    }
    return ''
  },
  secretRequired({ form }) {
    return form.sshAuthType !== 'private_key_file'
  },
  credentialKind({ form }) {
    return form.sshAuthType === 'private_key' ? 'ssh_private_key' : 'password'
  },
  authRequiredMessage(form, t) {
    if (form.sshAuthType === 'private_key') {
      return t('connection.form.privateKeyRequired')
    }
    if (form.sshAuthType === 'private_key_file') {
      return t('connection.form.privateKeyPathRequired')
    }
    return t('opsNav.passwordRequired')
  },
  validate({ form, t }) {
    if (form.sshAuthType === 'private_key_file' && !form.sshPrivateKeyPath.trim()) {
      return t('connection.form.privateKeyPathRequired')
    }
    return null
  },
  applyLoadedSecret(form, secret) {
    if (form.sshAuthType === 'private_key') {
      form.sshPrivateKey = secret
      return
    }
    form.password = secret
  },
}
