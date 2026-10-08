import { describe, expect, it } from 'vitest'
import { importPostmanEnvironment } from './postman-env'

describe('import postman environment', () => {
  it('keeps enabled values', () => {
    const env = importPostmanEnvironment({
      name: 'Dev',
      values: [
        { key: 'token', value: 'abc', enabled: true },
        { key: 'skip', value: 'no', enabled: false },
      ],
    })
    expect(env).toEqual({ name: 'Dev', vars: { token: 'abc' } })
  })
})
