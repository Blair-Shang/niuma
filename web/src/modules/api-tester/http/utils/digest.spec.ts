import { describe, expect, it } from 'vitest'
import { md5Hex } from './md5'
import { buildDigestAuthorization, parseDigestChallenge } from './digest'

describe('digest auth', () => {
  it('hashes the empty string', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
  })

  it('matches the RFC 2617 response', () => {
    const header = buildDigestAuthorization({
      username: 'Mufasa',
      password: 'Circle Of Life',
      method: 'GET',
      uri: '/dir/index.html',
      nc: '00000001',
      cnonce: '0a4f113b',
      challenge: {
        realm: 'testrealm@host.com',
        nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
        opaque: '5ccc069c403ebaf9f0171e9517f40e41',
        qop: 'auth',
        algorithm: 'MD5',
      },
    })
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"')
    expect(parseDigestChallenge('Digest realm="testrealm@host.com", nonce="abc", qop="auth"')?.nonce).toBe('abc')
  })
})
