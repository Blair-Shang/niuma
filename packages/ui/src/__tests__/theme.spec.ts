import { describe, expect, it } from 'vitest'
import { createRsConfigState } from '../composables/useRsConfig'
import { applyTheme } from '../theme/apply'

describe('useRsConfig / theme', () => {
  it('translates by locale', () => {
    const zh = createRsConfigState('dark', 'zh-CN')
    const en = createRsConfigState('dark', 'en-US')
    expect(zh.t('select.placeholder')).toBe('请选择')
    expect(en.t('select.placeholder')).toBe('Select')
    expect(zh.t('input.required')).toBe('此项为必填')
    expect(en.t('input.required')).toBe('This field is required')
    expect(en.t('breadcrumb.label')).toBe('Breadcrumb')
  })

  it('applyTheme sets data-rs-theme on element', () => {
    applyTheme('light')
    expect(document.documentElement.dataset.rsTheme).toBe('light')
    applyTheme('dark')
    expect(document.documentElement.dataset.rsTheme).toBe('dark')
  })
})
