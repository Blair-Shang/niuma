import { describe, expect, it } from 'vitest'
import { mergeMessages } from '../locale/merge-messages'
import { i18n } from '../locale'

describe('locale module split', () => {
  it('mergeMessages deep-merges modules', () => {
    const merged = mergeMessages(
      { modules: { placeholder: 'x', database: { title: 'db' } } },
      { modules: { ssh: { title: 'SSH' } } },
      { modules: { vastbase: { title: 'VB' } } },
    )
    expect(merged).toEqual({
      modules: {
        placeholder: 'x',
        database: { title: 'db' },
        ssh: { title: 'SSH' },
        vastbase: { title: 'VB' },
      },
    })
  })

  it('registers module keys from split locale files', () => {
    const zh = i18n.global.getLocaleMessage('zh-CN') as Record<string, any>
    expect(zh.modules?.placeholder).toBeTruthy()
    expect(zh.modules?.ssh?.title).toBe('SSH')
    expect(zh.modules?.ftp?.title).toBe('FTP')
    expect(zh.modules?.redis?.title).toBe('Redis')
    expect(zh.modules?.mongodb?.title).toBe('MongoDB')
    expect(zh.modules?.mysql?.title).toBe('MySQL')
    expect(zh.modules?.vastbase?.title).toBe('Vastbase')
    expect(zh.modules?.database?.title).toBeTruthy()
    expect(zh.modules?.api?.title).toBe('API 测试')
    expect(zh.modules?.api?.send).toBe('发送')
    expect(zh.modules?.api?.history).toBe('历史')
    expect(zh.fileEditor?.title).toBeTruthy()

    const en = i18n.global.getLocaleMessage('en-US') as Record<string, any>
    expect(en.modules?.vastbase?.title).toBe('Vastbase')
    expect(en.modules?.mongodb?.title).toBe('MongoDB')
  })
})
