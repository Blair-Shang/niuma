import { describe, expect, it } from 'vitest'
import { folderDepth } from '../../utils/folder-tree'
import { importPostman } from './postman'

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

describe('import postman', () => {
  it('maps folders, inherited auth, urlencoded body, and collection variables', () => {
    const folders = importPostman({
      info: { name: 'Shop', schema: SCHEMA },
      variable: [{ key: 'baseUrl', value: 'https://shop.example' }],
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
      item: [
        {
          name: 'Orders',
          item: [
            {
              name: 'Create',
              request: {
                method: 'POST',
                header: [{ key: 'Accept', value: 'application/json' }],
                url: {
                  raw: '{{baseUrl}}/orders?verbose=1',
                  query: [{ key: 'verbose', value: '1' }],
                },
                body: {
                  mode: 'urlencoded',
                  urlencoded: [{ key: 'sku', value: 'a' }, { key: 'note', value: 'x', disabled: true }],
                },
              },
            },
          ],
        },
        {
          name: 'Ping',
          request: 'https://shop.example/ping',
        },
      ],
    })
    expect(folders).not.toBeNull()
    const root = folders?.[0]
    expect(root?.name).toBe('Shop')
    expect(root?.vars.baseUrl).toBe('https://shop.example')
    expect(root?.requests[0]?.name).toBe('Ping')
    expect(root?.requests[0]?.auth.type).toBe('bearer')
    const orders = folders?.find((folder) => folder.name === 'Orders')
    const create = orders?.requests[0]
    expect(create?.method).toBe('POST')
    expect(create?.url).toBe('{{baseUrl}}/orders')
    expect(create?.auth.bearer?.token).toBe('{{token}}')
    expect(create?.bodyMode).toBe('urlencoded')
    expect(create?.bodyForm?.map((row) => [row.key, row.enabled])).toEqual([
      ['sku', true],
      ['note', false],
    ])
    expect(create?.headers.some((row) => row.key.toLowerCase() === 'authorization')).toBe(false)
  })

  it('folds requests deeper than three levels into the deepest folder', () => {
    const folders = importPostman({
      info: { name: 'Root', schema: SCHEMA },
      item: [
        {
          name: 'A',
          item: [
            {
              name: 'B',
              item: [
                {
                  name: 'C',
                  item: [{ name: 'Deep', request: { method: 'GET', url: 'https://example.com/deep' } }],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(folders?.map((folder) => folder.name)).toEqual(['Root', 'A', 'B'])
    const leaf = folders?.find((folder) => folder.name === 'B')
    expect(leaf && folderDepth(folders ?? [], leaf.id)).toBe(3)
    expect(leaf?.requests.map((req) => req.name)).toEqual(['Deep'])
  })
})
