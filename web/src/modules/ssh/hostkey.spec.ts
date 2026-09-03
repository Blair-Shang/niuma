import { describe, expect, it } from 'vitest'
import { parseHostKeyRejected } from './hostkey'

describe('parseHostKeyRejected', () => {
  it('parses ssh and sftp error strings', () => {
    const ssh = parseHostKeyRejected(
      'ssh: host key rejected for example.com:22 fingerprint=SHA256:abc algo=ssh-ed25519 reason=unknown',
    )
    expect(ssh).toEqual({
      host: 'example.com',
      port: 22,
      fingerprint: 'SHA256:abc',
      algorithm: 'ssh-ed25519',
      reason: 'unknown',
    })
    const sftp = parseHostKeyRejected(
      'sftp: host key rejected for 10.0.0.1:2222 fingerprint=SHA256:xyz algo=ssh-rsa reason=changed',
    )
    expect(sftp?.host).toBe('10.0.0.1')
    expect(sftp?.reason).toBe('changed')
  })

  it('returns null for other errors', () => {
    expect(parseHostKeyRejected('authentication failed')).toBeNull()
  })
})
