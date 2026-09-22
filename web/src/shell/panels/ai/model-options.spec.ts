import { describe, expect, it } from 'vitest'
import type { AiProvider } from '@/api/types/ai'
import { buildModelSelectOptions, modelsForProvider } from './model-options'

function provider(partial: Partial<AiProvider> & Pick<AiProvider, 'providerId'>): AiProvider {
  return {
    providerName: partial.providerName ?? 'NiuMa',
    providerKind: 'openai',
    baseUrl: '',
    hasApiKey: true,
    defaultModelCode: partial.defaultModelCode ?? '',
    providerOptions: { system: true },
    recordStatus: 'active',
    sortOrder: 0,
    rowVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    models: [],
    ...partial,
  }
}

describe('modelsForProvider', () => {
  it('skips disabled leftover models after cloud catalog update', () => {
    const p = provider({
      providerId: 'niuma-system',
      defaultModelCode: 'new-a',
      models: [
        {
          modelId: '1',
          providerId: 'niuma-system',
          modelCode: 'old-a',
          modelLabel: 'Old A',
          contextWindow: null,
          maxOutputTokens: null,
          modelOptions: {},
          recordStatus: 'disabled',
          sortOrder: 0,
          rowVersion: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          modelId: '2',
          providerId: 'niuma-system',
          modelCode: 'new-a',
          modelLabel: 'New A',
          contextWindow: null,
          maxOutputTokens: null,
          modelOptions: {},
          recordStatus: 'active',
          sortOrder: 0,
          rowVersion: 1,
          createdAt: '2026-01-02T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        },
      ],
    })
    expect(modelsForProvider(p).map((m) => m.modelCode)).toEqual(['new-a'])
  })

  it('does not append a stale selected model into the picker', () => {
    const options = buildModelSelectOptions([
      provider({
        providerId: 'niuma-system',
        defaultModelCode: 'new-a',
        models: [
          {
            modelId: '2',
            providerId: 'niuma-system',
            modelCode: 'new-a',
            modelLabel: 'New A',
            contextWindow: null,
            maxOutputTokens: null,
            modelOptions: {},
            recordStatus: 'active',
            sortOrder: 0,
            rowVersion: 1,
            createdAt: '2026-01-02T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
          },
        ],
      }),
    ])
    expect(options).toEqual([{ value: 'niuma-system::new-a', label: 'NiuMa · new-a' }])
  })
})
