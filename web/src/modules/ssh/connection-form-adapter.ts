import { sshApi } from '@/api'
import type { SshConnectionOptions, SshSessionTestParams } from '@/api/types/ssh'
import { DEFAULT_SSH_OPTIONS } from '@/api/types/ssh'
import {
  applyStoredTimeout,
  buildTimeoutSeconds,
} from '@/modules/ops/connection-form/adapter-helpers'
import type { ConnectionFormAdapter, ConnectionTestParams } from '@/modules/ops/connection-form/types'
import {
  cappedTestTimeout,
  readStoredTimeoutSeconds,
} from '@/modules/connection/connection-options'

export const sshConnectionFormAdapter: ConnectionFormAdapter = {
  defaults: () => ({
    sshAuthType: DEFAULT_SSH_OPTIONS.auth_type,
    sshPrivateKey: '',
    sshPrivateKeyPath: '',
    sshPassphrase: '',
  }),
  applyProfile(form, item) {
    const opts = item.connectionOptions as unknown as SshConnectionOptions | undefined
    form.sshAuthType = opts?.auth_type ?? DEFAULT_SSH_OPTIONS.auth_type
    form.sshPrivateKey = ''
    form.sshPrivateKeyPath = opts?.private_key_path ?? ''
    form.sshPassphrase = opts?.passphrase ?? ''
    applyStoredTimeout(form, opts as Record<string, unknown> | undefined, DEFAULT_SSH_OPTIONS.timeout_seconds)
  },
  buildOptions({ form, accent, proxy, tunnel }) {
    return {
      ...DEFAULT_SSH_OPTIONS,
      ...accent,
      auth_type: form.sshAuthType,
      private_key_path: form.sshPrivateKeyPath.trim(),
      passphrase: form.sshPassphrase,
      timeout_seconds: buildTimeoutSeconds(form, DEFAULT_SSH_OPTIONS.timeout_seconds),
      proxy,
      tunnel,
    }
  },
  buildTestParams({ input, timeoutSeconds }) {
    const opts = input.connectionOptions as unknown as SshConnectionOptions
    return {
      hostAddress: input.hostAddress,
      portNumber: input.portNumber,
      loginAccount: input.loginAccount,
      options: {
        ...opts,
        timeout_seconds: cappedTestTimeout(
          readStoredTimeoutSeconds(opts as unknown as Record<string, unknown>, DEFAULT_SSH_OPTIONS.timeout_seconds),
          DEFAULT_SSH_OPTIONS.timeout_seconds,
          timeoutSeconds,
        ),
      },
    }
  },
  callSessionTest(params: ConnectionTestParams) {
    return sshApi.sessionTest(params as SshSessionTestParams)
  },
  secret({ form }) {
    if (form.sshAuthType === 'private_key') {
      return form.sshPrivateKey.trim()
    }
    if (form.sshAuthType === 'password') {
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
