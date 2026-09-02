import { describe, expect, it } from 'vitest'
import {
  defaultEnvironments,
  defaultFolders,
  fileSlug,
  parseCollection,
  parseWorkspace,
  serializeCollection,
  serializeWorkspace,
  uniqueFolderName,
} from './collection-io'
import { newKvRow } from './format'
import type { ApiEnvironment, ApiFolder } from '../types'

function sampleFolders(): ApiFolder[] {
  return [
    {
      id: 'shop',
      name: 'Demo Shop',
      requests: [
        {
          id: 'products',
          name: 'List products',
          method: 'GET',
          url: '{{baseUrl}}/api/products',
          params: [newKvRow('limit', '20')],
          headers: [newKvRow('Accept', 'application/json')],
          body: '',
        },
      ],
    },
  ]
}

function sampleEnvs(): ApiEnvironment[] {
  return [{ id: 'prod', name: 'Production', baseUrl: 'http://127.0.0.1:8080' }]
}

describe('api collection io', () => {
  it('round-trips folders and remints ids on import', () => {
    const demo = sampleFolders()
    const file = serializeCollection(demo)
    const parsed = parseCollection(JSON.stringify(file))
    expect('folders' in parsed).toBe(true)
    if (!('folders' in parsed)) return
    expect(parsed.folders).toHaveLength(demo.length)
    expect(parsed.folders[0]?.name).toBe(demo[0]?.name)
    expect(parsed.folders[0]?.id).not.toBe(demo[0]?.id)
    expect(parsed.folders[0]?.requests[0]?.id).not.toBe(demo[0]?.requests[0]?.id)
    expect(parsed.folders[0]?.requests[0]?.url).toBe(demo[0]?.requests[0]?.url)
    expect(JSON.stringify(file)).not.toContain('history')
  })

  it('rejects unknown kind', () => {
    expect(parseCollection('{"kind":"postman","folders":[]}')).toEqual({ error: 'kind' })
    expect(parseCollection('not-json')).toEqual({ error: 'invalid' })
  })

  it('uniques folder names', () => {
    expect(uniqueFolderName('Folder', [])).toBe('Folder')
    expect(uniqueFolderName('Folder', ['Folder'])).toBe('Folder 1')
    expect(uniqueFolderName('Folder', ['Folder', 'Folder 1'])).toBe('Folder 2')
  })

  it('slugs download names', () => {
    expect(fileSlug('Demo Shop')).toBe('Demo-Shop')
    expect(fileSlug('a/b:c')).toBe('a-b-c')
  })

  it('keeps ids when restoring a workspace snapshot', () => {
    const folders = sampleFolders()
    const environments = sampleEnvs()
    const snap = serializeWorkspace(folders, environments, environments[0]!.id)
    const parsed = parseWorkspace(JSON.stringify(snap))
    expect(parsed?.folders[0]?.id).toBe(folders[0]?.id)
    expect(parsed?.folders[0]?.requests[0]?.id).toBe(folders[0]?.requests[0]?.id)
    expect(parsed?.environments[0]?.id).toBe(environments[0]?.id)
    expect(parsed?.envId).toBe(environments[0]?.id)
  })

  it('returns null for missing or foreign workspace text', () => {
    expect(parseWorkspace(null)).toBeNull()
    expect(parseWorkspace('{"kind":"niuma.api-collection","folders":[]}')).toBeNull()
  })

  it('provides a local default environment', () => {
    expect(defaultEnvironments()[0]?.baseUrl).toBe('127.0.0.1:9000')
  })

  it('seeds one empty default folder', () => {
    const folders = defaultFolders('草稿')
    expect(folders).toHaveLength(1)
    expect(folders[0]?.id).toBe('drafts')
    expect(folders[0]?.name).toBe('草稿')
    expect(folders[0]?.requests).toEqual([])
  })
})
