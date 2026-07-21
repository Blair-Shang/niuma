import { describe, expect, it } from 'vitest'
import {
  connKindHasTree,
  ensureConnKind,
  ensureConnKindForm,
  isConnKindLoaded,
  registerConnKindLoader,
} from '@/modules/ops/conn-kind-loaders'
import { getConnectionFormAdapter, registerConnectionFormAdapter } from '@/modules/ops/connection-form/registry'
import { getConnTreeProvider } from '@/modules/ops/conn-tree/registry'
import { mysqlConnectionFormAdapter } from '@/modules/mysql/connection-form-adapter'
import { registerBuiltinConnKindLoaders } from '@/modules/ops/register-builtin-conn-kinds'
import type { ConnKind } from '@/modules/ops/types'

describe('conn kind lazy registration', () => {
  it('registers builtin loaders with tree metadata', () => {
    registerBuiltinConnKindLoaders()
    expect(connKindHasTree('mysql')).toBe(true)
    expect(connKindHasTree('ssh')).toBe(false)
    expect(connKindHasTree('ftp')).toBe(false)
    expect(connKindHasTree('vastbase')).toBe(true)
  })

  it('ensureConnKindForm loads adapter without tree provider', async () => {
    let formCalls = 0
    let fullCalls = 0
    const kind = 'mysql' as ConnKind
    registerConnKindLoader(kind, {
      tree: true,
      loadForm: async () => {
        formCalls += 1
        registerConnectionFormAdapter('mysql', mysqlConnectionFormAdapter)
      },
      load: async () => {
        fullCalls += 1
      },
    })
    await ensureConnKindForm(kind)
    await ensureConnKindForm(kind)
    expect(formCalls).toBe(1)
    expect(fullCalls).toBe(0)
    expect(getConnectionFormAdapter('mysql').defaults().mysqlSslMode).toBe('preferred')
    expect(getConnTreeProvider('mysql')).toBeUndefined()
  })

  it('isConnKindLoaded tracks full ensure only', async () => {
    const kind = 'test-lazy-full' as ConnKind
    registerConnKindLoader(kind, {
      tree: true,
      loadForm: async () => {},
      load: async () => {},
    })
    expect(isConnKindLoaded(kind)).toBe(false)
    await ensureConnKindForm(kind)
    expect(isConnKindLoaded(kind)).toBe(false)
    await ensureConnKind(kind)
    expect(isConnKindLoaded(kind)).toBe(true)
  })
  it('mysql adapter lives in module (no ops/builtin-adapters)', () => {
    expect(mysqlConnectionFormAdapter.defaults().mysqlCharset).toBe('utf8mb4')
  })
})
