import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsCheckbox from '../components/RsCheckbox.vue'

describe('RsCheckbox', () => {
  it('toggles model on change', async () => {
    const wrapper = mount(RsCheckbox, { props: { modelValue: false } })
    await wrapper.find('input').setValue(true)
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
    expect(wrapper.emitted('change')?.[0]).toEqual([true])
  })

  it('applies checked and size classes', async () => {
    const wrapper = mount(RsCheckbox, {
      props: { modelValue: true, size: 'sm' },
    })
    expect(wrapper.find('.rs-checkbox').classes()).toContain('rs-checkbox--checked')
    expect(wrapper.find('.rs-checkbox').classes()).toContain('rs-checkbox--sm')
  })

  it('supports indeterminate visual state', () => {
    const wrapper = mount(RsCheckbox, {
      props: { modelValue: false, indeterminate: true },
    })
    expect(wrapper.find('.rs-checkbox').classes()).toContain('rs-checkbox--indeterminate')
    expect(wrapper.find('input').attributes('aria-checked')).toBe('mixed')
  })

  it('does not emit when disabled', async () => {
    const wrapper = mount(RsCheckbox, {
      props: { modelValue: false, disabled: true },
    })
    await wrapper.find('input').setValue(true)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
