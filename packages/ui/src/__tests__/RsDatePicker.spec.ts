import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsDatePicker from '../components/RsDatePicker.vue'

describe('RsDatePicker', () => {
  it('renders trigger button with placeholder', () => {
    const wrapper = mount(RsDatePicker, { props: { modelValue: '' } })
    expect(wrapper.find('.rs-date-picker__trigger').exists()).toBe(true)
    expect(wrapper.find('.rs-date-picker__value').text()).toContain('选择日期')
    expect(wrapper.classes()).toContain('rs-field')
  })

  it('shows formatted value on trigger when model is set', () => {
    const wrapper = mount(RsDatePicker, {
      props: { modelValue: '2025-06-16' },
    })
    expect(wrapper.find('.rs-date-picker__trigger--placeholder').exists()).toBe(false)
    expect(wrapper.find('.rs-date-picker__value').text()).toBe('2025-06-16')
  })

  it('renders label, hint, and required marker', () => {
    const wrapper = mount(RsDatePicker, {
      props: {
        modelValue: '',
        label: '生效日期',
        hint: '请选择日期',
        required: true,
      },
    })
    expect(wrapper.find('.rs-field__label').text()).toContain('生效日期')
    expect(wrapper.find('.rs-field__required').exists()).toBe(true)
    expect(wrapper.find('.rs-field__hint').text()).toBe('请选择日期')
  })

  it('applies left label layout class', () => {
    const wrapper = mount(RsDatePicker, {
      props: { modelValue: '', labelPosition: 'left' },
    })
    expect(wrapper.classes()).toContain('rs-field--label-left')
  })

  it('uses single trigger for range mode', () => {
    const wrapper = mount(RsDatePicker, {
      props: { modelValue: { start: '', end: '' }, range: true },
    })
    expect(wrapper.findAll('.rs-date-picker__trigger')).toHaveLength(1)
    expect(wrapper.find('.rs-date-picker__value').text()).toContain('选择日期范围')
  })

  it('shows range label when range model is set', () => {
    const wrapper = mount(RsDatePicker, {
      props: {
        modelValue: { start: '2025-06-01', end: '2025-06-30' },
        range: true,
      },
    })
    expect(wrapper.find('.rs-date-picker__value').text()).toContain('2025')
    expect(wrapper.find('.rs-date-picker__value').text()).toContain('~')
  })

  it('confirms single selection from popover', async () => {
    const wrapper = mount(RsDatePicker, {
      props: { modelValue: '', open: true },
      attachTo: document.body,
    })
    await flushPromises()

    const dayCell = document.body.querySelector('.rs-calendar-grid__cell:not([disabled])') as HTMLElement
    dayCell?.click()
    await flushPromises()

    const confirmBtn = Array.from(document.body.querySelectorAll('.rs-date-picker__confirm')).find(
      (el) => !el.hasAttribute('disabled'),
    ) as HTMLElement | undefined
    confirmBtn?.click()
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('disables trigger when disabled', () => {
    const wrapper = mount(RsDatePicker, {
      props: { modelValue: '2025-06-16', disabled: true },
    })
    expect(wrapper.find('.rs-date-picker__trigger').attributes('disabled')).toBeDefined()
  })
})
