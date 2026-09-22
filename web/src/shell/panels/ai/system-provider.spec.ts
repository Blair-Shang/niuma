import { describe, expect, it } from 'vitest'
import { systemDefaultFromCatalog, systemModelsFromCatalog } from './system-provider'

describe('systemModelsFromCatalog', () => {
  it('keeps the cloud catalog, including models other than the default', () => {
    expect(
      systemModelsFromCatalog({
        models: [
          { code: 'deepseek-chat', label: 'DeepSeek' },
          { code: 'MiniMax-M3', label: 'MiniMax-M3' },
        ],
      }),
    ).toEqual([
      { code: 'deepseek-chat', label: 'DeepSeek' },
      { code: 'MiniMax-M3', label: 'MiniMax-M3' },
    ])
  })

  it('does not put a removed model back when only the default field still names it', () => {
    expect(
      systemModelsFromCatalog({
        models: [{ code: 'deepseek-chat', label: 'DeepSeek' }],
      }),
    ).toEqual([{ code: 'deepseek-chat', label: 'DeepSeek' }])
  })

  it('returns nothing when the cloud catalog is empty', () => {
    expect(systemModelsFromCatalog({ models: [] })).toEqual([])
  })
})

describe('systemDefaultFromCatalog', () => {
  it('uses the cloud default when that model is still in the catalog', () => {
    expect(
      systemDefaultFromCatalog({ defaultModel: 'MiniMax-M3' }, [
        { code: 'deepseek-chat' },
        { code: 'MiniMax-M3' },
      ]),
    ).toBe('MiniMax-M3')
  })

  it('does not keep a default the catalog has already deleted', () => {
    expect(
      systemDefaultFromCatalog({ defaultModel: 'MiniMax-M3' }, [{ code: 'deepseek-chat' }]),
    ).toBe('deepseek-chat')
  })
})
