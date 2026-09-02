import { describe, expect, it } from 'vitest'
import { CloudApiError } from '@/api/cloud/client'
import { shouldClearSessionOnAuthError } from '@/stores/account'

describe('shouldClearSessionOnAuthError', () => {
  it('clears only when the cloud rejects the token', () => {
    expect(shouldClearSessionOnAuthError(new CloudApiError('invalid_refresh', 401))).toBe(true)
    expect(shouldClearSessionOnAuthError(new CloudApiError('unauthorized', 401))).toBe(true)
    expect(shouldClearSessionOnAuthError(new CloudApiError('forbidden', 403))).toBe(true)
  })

  it('keeps the session on network or server errors', () => {
    expect(shouldClearSessionOnAuthError(new CloudApiError('network_error', 0))).toBe(false)
    expect(shouldClearSessionOnAuthError(new CloudApiError('server_error', 500))).toBe(false)
    expect(shouldClearSessionOnAuthError(new Error('offline'))).toBe(false)
  })
})
