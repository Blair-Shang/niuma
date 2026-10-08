import { describe, expect, it } from 'vitest'
import { minimalRequest } from '../../utils/collection-io'
import { importPostman } from '../import/postman'
import { exportPostmanCollection } from './postman'

describe('export postman', () => {
  it('round-trips a request script through postman v2.1', () => {
    const text = exportPostmanCollection([{
      id: 'f',
      name: 'Shop',
      parentId: null,
      vars: { baseUrl: 'https://shop.example' },
      requests: [minimalRequest({
        name: 'Ping',
        method: 'GET',
        url: '{{baseUrl}}/ping',
        preRequestScript: "pm.environment.set('a', '1')",
        testScript: "pm.test('ok', () => pm.response.to.have.status(200))",
      })],
    }], 'Shop')
    const parsed = JSON.parse(text) as Record<string, unknown>
    const folders = importPostman(parsed) ?? []
    const request = folders.flatMap((folder) => folder.requests).find((item) => item.name === 'Ping')
    const shop = folders.find((folder) => folder.vars.baseUrl)
    expect(request?.preRequestScript).toContain("pm.environment.set('a', '1')")
    expect(request?.testScript).toContain('pm.test')
    expect(shop?.vars.baseUrl).toBe('https://shop.example')
  })
})
