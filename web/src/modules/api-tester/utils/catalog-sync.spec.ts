import { describe, expect, it } from 'vitest'
import type { ApiCatalogVariable } from '@/api/types/api-catalog'
import { catalogToTypedRecord, recordToVariableInputs } from './catalog-sync'

function catalogVar(partial: Partial<ApiCatalogVariable> & Pick<ApiCatalogVariable, 'variableName'>): ApiCatalogVariable {
  return {
    variableId: partial.variableId ?? partial.variableName,
    workspaceId: 'ws',
    variableScope: partial.variableScope ?? 'global',
    scopeRefId: partial.scopeRefId ?? '',
    variableName: partial.variableName,
    variableKind: partial.variableKind ?? 'string',
    initialValue: partial.initialValue ?? '',
    currentValue: partial.currentValue ?? partial.initialValue ?? '',
    sortOrder: partial.sortOrder ?? 0,
    createdAt: '',
    updatedAt: '',
  }
}

describe('catalog-sync', () => {
  it('writes variableKind for backend replaceScope', () => {
    const inputs = recordToVariableInputs(
      { token: 'abc', count: '1', baseUrl: 'http://x' },
      { token: 'secret', count: 'counter' },
    )
    expect(inputs).toEqual([
      { variableName: 'token', variableKind: 'secret', initialValue: 'abc', currentValue: 'abc', sortOrder: 0 },
      { variableName: 'count', variableKind: 'counter', initialValue: '1', currentValue: '1', sortOrder: 1 },
    ])
  })

  it('loads kinds from catalog rows', () => {
    const typed = catalogToTypedRecord(
      [
        catalogVar({ variableName: 'token', variableKind: 'secret', currentValue: 'abc' }),
        catalogVar({ variableName: 'flag', variableKind: 'boolean', currentValue: 'false' }),
      ],
      'global',
    )
    expect(typed.vars).toEqual({ token: 'abc', flag: 'false' })
    expect(typed.kinds).toEqual({ token: 'secret', flag: 'boolean' })
  })
})
