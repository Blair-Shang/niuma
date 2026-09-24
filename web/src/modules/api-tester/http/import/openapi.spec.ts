import { describe, expect, it } from 'vitest'
import { serializeCollection } from '../../utils/collection-io'
import { parseImportedCollection } from './dispatch'
import { importOpenApi } from './openapi'
import type { ApiFolder } from '../../types'

describe('import openapi', () => {
  it('groups tags, rewrites path params, and keeps bearer plus json example', () => {
    const folders = importOpenApi({
      openapi: '3.0.3',
      info: { title: 'Pets', version: '1.0.0' },
      servers: [{ url: 'https://pets.example/v1' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
        schemas: {
          Pet: {
            type: 'object',
            properties: {
              name: { type: 'string', example: 'nori' },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }],
      paths: {
        '/pets/{petId}': {
          get: {
            tags: ['pets'],
            summary: 'Get pet',
            operationId: 'getPet',
            parameters: [
              { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'verbose', in: 'query', schema: { type: 'boolean', example: true } },
            ],
            responses: { '200': { description: 'ok' } },
          },
          post: {
            tags: ['pets'],
            summary: 'Create pet',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
            responses: { '201': { description: 'created' } },
          },
        },
      },
    })
    const root = folders?.[0]
    expect(root?.name).toBe('Pets')
    expect(root?.vars.baseUrl).toBe('https://pets.example/v1')
    const pets = folders?.find((folder) => folder.name === 'pets')
    const getPet = pets?.requests.find((req) => req.name === 'Get pet')
    const create = pets?.requests.find((req) => req.name === 'Create pet')
    expect(getPet?.method).toBe('GET')
    expect(getPet?.url).toBe('{{baseUrl}}/pets/{{petId}}')
    expect(getPet?.params.map((row) => [row.key, row.value])).toEqual([['verbose', 'true']])
    expect(getPet?.auth).toEqual({ type: 'bearer', bearer: { token: '{{token}}' } })
    expect(create?.bodyMode).toBe('json')
    expect(create?.body).toContain('"name": "nori"')
  })

  it('returns null without an OpenAPI paths object', () => {
    expect(importOpenApi({ openapi: '3.0.0', info: { title: 'X' } })).toBeNull()
  })
})

describe('import dispatch', () => {
  it('routes niuma, postman, openapi, and rejects other JSON', () => {
    const niuma = serializeCollection([
      { id: 'f', name: 'Drafts', parentId: null, vars: {}, requests: [] },
    ] as ApiFolder[])
    const native = parseImportedCollection(JSON.stringify(niuma))
    expect('source' in native && native.source).toBe('niuma')

    const postman = parseImportedCollection(JSON.stringify({
      info: { name: 'P', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [],
    }))
    expect('source' in postman && postman.source).toBe('postman')

    const openapi = parseImportedCollection(JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'API' },
      paths: { '/health': { get: { summary: 'Health' } } },
    }))
    expect('source' in openapi && openapi.source).toBe('openapi')

    expect(parseImportedCollection('{"swagger":"2.0"}')).toEqual({ error: 'unsupported' })
    expect(parseImportedCollection('{')).toEqual({ error: 'invalid' })
  })
})
