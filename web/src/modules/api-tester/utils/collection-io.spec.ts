import { describe, expect, it } from 'vitest'
import {
  COLLECTION_VERSION,
  defaultAuth,
  defaultEnvironments,
  defaultFolders,
  emptyVars,
  fileSlug,
  minimalRequest,
  mergeWorkspaceFolders,
  parseCollection,
  parseLegacyWorkspaceV2,
  parseWorkspace,
  serializeCollection,
  serializeWorkspace,
  uniqueName,
  WORKSPACE_VERSION,
} from './collection-io'
import { newKvRow } from './format'
import type { ApiEnvironment, ApiFolder } from '../types'

function sampleFolders(): ApiFolder[] {
  return [
    {
      id: 'shop',
      name: 'Demo Shop',
      parentId: null,
      vars: { apiPrefix: '/v1' },
      requests: [
        {
          id: 'products',
          name: 'List products',
          method: 'GET',
          url: '{{baseUrl}}/api/products',
          params: [newKvRow('limit', '20')],
          headers: [newKvRow('Accept', 'application/json')],
          auth: defaultAuth(),
          bodyMode: 'none',
          body: '',
          bodyForm: [],
        },
      ],
    },
  ]
}

function sampleEnvs(): ApiEnvironment[] {
  return [{ id: 'prod', name: 'Production', baseUrl: 'http://127.0.0.1:8080', vars: { baseUrl: 'http://127.0.0.1:8080', token: 'secret' } }]
}

describe('api collection io', () => {
  it('round-trips folders and remints ids on import', () => {
    const demo = sampleFolders()
    const file = serializeCollection(demo)
    expect(file.version).toBe(COLLECTION_VERSION)
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

  it('rejects v1 workspace snapshot', () => {
    const legacy = {
      kind: 'niuma.api-workspace',
      version: 1,
      folders: [
        {
          id: 'f1',
          name: 'Legacy',
          requests: [
            {
              id: 'r1',
              name: 'Hit',
              method: 'POST',
              url: '{{baseUrl}}/x',
              params: [],
              headers: [],
              body: '{"a":1}',
            },
          ],
        },
      ],
      environments: [{ id: 'local', name: 'Local', baseUrl: 'http://127.0.0.1:1' }],
      envId: 'local',
    }
    expect(parseWorkspace(JSON.stringify(legacy))).toBeNull()
  })

  it('rejects collection without v2 version', () => {
    expect(
      parseCollection(
        JSON.stringify({
          kind: 'niuma.api-collection',
          version: 1,
          exportedAt: new Date().toISOString(),
          folders: [],
        }),
      ),
    ).toEqual({ error: 'invalid' })
  })

  it('rejects unknown kind', () => {
    expect(parseCollection('{"kind":"postman","folders":[]}')).toEqual({ error: 'kind' })
    expect(parseCollection('not-json')).toEqual({ error: 'invalid' })
  })

  it('uniques folder names', () => {
    expect(uniqueName('Folder', [])).toBe('Folder')
    expect(uniqueName('Folder', ['Folder'])).toBe('Folder 1')
    expect(uniqueName('Folder', ['Folder', 'Folder 1'])).toBe('Folder 2')
  })

  it('slugs download names', () => {
    expect(fileSlug('Demo Shop')).toBe('Demo-Shop')
    expect(fileSlug('a/b:c')).toBe('a-b-c')
  })

  it('keeps ids when restoring a workspace snapshot', () => {
    const folders = sampleFolders()
    const environments = sampleEnvs()
    const snap = serializeWorkspace(folders, environments[0]!.id, {
      runProfiles: [],
      mockServers: [],
    })
    expect(snap.version).toBe(WORKSPACE_VERSION)
    const parsed = parseWorkspace(JSON.stringify(snap))
    expect(parsed?.folders[0]?.id).toBe(folders[0]?.id)
    expect(parsed?.folders[0]?.requests[0]?.id).toBe(folders[0]?.requests[0]?.id)
    expect(parsed?.folders[0]?.vars).toEqual(emptyVars())
    expect(parsed?.envId).toBe(environments[0]?.id)
    expect(snap).not.toHaveProperty('environments')
    expect(snap).not.toHaveProperty('globals')
  })

  it('round-trips TCP server in workspace v3', () => {
    const folders: ApiFolder[] = [
      {
        id: 'drafts',
        name: 'Drafts',
        parentId: null,
        vars: {},
        requests: [minimalRequest({ id: 'tcp-srv', name: 'TCP Server', method: 'TCP', url: '0.0.0.0:9000' })],
      },
    ]
    const parsed = parseWorkspace(JSON.stringify(serializeWorkspace(folders, 'local')))
    expect(parsed?.folders[0]?.requests[0]?.method).toBe('TCP')
  })

  it('rejects workspace when all folders fail to parse', () => {
    const broken = {
      kind: 'niuma.api-workspace',
      version: WORKSPACE_VERSION,
      folders: [{ id: 'drafts', name: '' }],
      envId: 'local',
    }
    expect(parseWorkspace(JSON.stringify(broken))).toBeNull()
  })

  it('parses legacy v2 workspace for catalog migration', () => {
    const legacy = {
      kind: 'niuma.api-workspace',
      version: 2,
      folders: sampleFolders(),
      environments: sampleEnvs(),
      envId: 'prod',
      globals: { vars: { org: 'demo' } },
    }
    expect(parseWorkspace(JSON.stringify(legacy))).toBeNull()
    const parsed = parseLegacyWorkspaceV2(JSON.stringify(legacy))
    expect(parsed?.environments[0]?.id).toBe('prod')
    expect(parsed?.globals?.vars.org).toBe('demo')
  })

  it('returns null for missing or foreign workspace text', () => {
    expect(parseWorkspace(null)).toBeNull()
    expect(parseWorkspace('{"kind":"niuma.api-collection","folders":[]}')).toBeNull()
  })

  it('provides a local default environment', () => {
    expect(defaultEnvironments()[0]?.baseUrl).toBe('127.0.0.1:9000')
    expect(defaultEnvironments()[0]?.vars.baseUrl).toBe('127.0.0.1:9000')
  })

  it('seeds one empty default folder', () => {
    const folders = defaultFolders('草稿')
    expect(folders).toHaveLength(1)
    expect(folders[0]?.id).toBe('drafts')
    expect(folders[0]?.name).toBe('草稿')
    expect(folders[0]?.parentId).toBeNull()
    expect(folders[0]?.vars).toEqual(emptyVars())
    expect(folders[0]?.requests).toEqual([])
  })

  it('builds minimal request defaults', () => {
    const req = minimalRequest({ body: '{}', bodyMode: 'json' })
    expect(req.auth.type).toBe('none')
    expect(req.bodyMode).toBe('json')
  })

  it('remints nested parentId and flattens cycles on import', () => {
    const file = {
      kind: 'niuma.api-collection',
      version: COLLECTION_VERSION,
      exportedAt: new Date().toISOString(),
      folders: [
        { id: 'root', name: 'Root', parentId: null, vars: {}, requests: [] },
        { id: 'child', name: 'Child', parentId: 'root', vars: { k: 'v' }, requests: [] },
        { id: 'loop-a', name: 'LoopA', parentId: 'loop-b', vars: {}, requests: [] },
        { id: 'loop-b', name: 'LoopB', parentId: 'loop-a', vars: {}, requests: [] },
      ],
    }
    const parsed = parseCollection(JSON.stringify(file))
    expect('folders' in parsed).toBe(true)
    if (!('folders' in parsed)) return
    const child = parsed.folders.find((folder) => folder.name === 'Child')
    const root = parsed.folders.find((folder) => folder.name === 'Root')
    expect(child?.parentId).toBe(root?.id)
    expect(parsed.folders.filter((folder) => folder.name.startsWith('Loop')).every((folder) => {
      const parent = parsed.folders.find((item) => item.id === folder.parentId)
      return !parent || parent.parentId !== folder.id
    })).toBe(true)
  })
})
