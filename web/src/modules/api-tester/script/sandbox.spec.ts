import { describe, expect, it } from 'vitest'
import { runPreRequestScript, runTestScript } from './sandbox'

describe('api script sandbox', () => {
  it('writes environment variables before send', async () => {
    const bag = { environment: { token: '' }, globals: {}, collection: {} }
    const outcome = await runPreRequestScript(`pm.environment.set('token', 'abc')`, bag)
    expect(bag.environment.token).toBe('abc')
    expect(outcome.writes).toEqual([{ scope: 'environment', key: 'token', value: 'abc' }])
  })

  it('records passing and failing tests', async () => {
    const bag = { environment: {}, globals: {}, collection: {} }
    const outcome = await runTestScript(
      `
        pm.test('status', () => pm.response.to.have.status(200))
        pm.test('body', () => pm.expect(pm.response.text()).to.include('ok'))
        pm.test('slow', () => pm.expect(pm.response.responseTime).to.be.below(10))
      `,
      bag,
      { status: 200, statusText: 'OK', body: 'ok', headers: [], durationMs: 40 },
    )
    expect(outcome.checks.map((item) => item.ok)).toEqual([true, true, false])
  })

  it('reads collection variables ahead of globals', async () => {
    const bag = { environment: { seen: '' }, globals: { name: 'g' }, collection: { name: 'c' } }
    await runPreRequestScript(`pm.environment.set('seen', pm.variables.get('name'))`, bag)
    expect(bag.environment.seen).toBe('c')
  })
})
