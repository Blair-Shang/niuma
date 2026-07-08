import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsDateTimePicker from '../components/RsDateTimePicker.vue'

describe('RsDateTimePicker', () => {
  it('renders popover trigger with datetime placeholder', () => {
    const wrapper = mount(RsDateTimePicker, { props: { modelValue: '' } })
    expect(wrapper.find('.rs-date-picker__trigger').exists()).toBe(true)
    expect(wrapper.find('.rs-date-picker__value').text()).toContain('选择日期时间')
    expect(wrapper.classes()).toContain('rs-field')
  })

  it('shows formatted datetime on trigger when model is set', () => {
    const wrapper = mount(RsDateTimePicker, {
      props: { modelValue: '2025-06-16 14:30:00' },
    })
    expect(wrapper.find('.rs-date-picker__trigger--placeholder').exists()).toBe(false)
    expect(wrapper.find('.rs-date-picker__value').text()).toBe('2025-06-16 14:30:00')
  })

  it('renders label, hint, and required marker', () => {
    const wrapper = mount(RsDateTimePicker, {
      props: {
        modelValue: '',
        label: '截止时间',
        hint: '请选择日期时间',
        required: true,
      },
    })
    expect(wrapper.find('.rs-field__label').text()).toContain('截止时间')
    expect(wrapper.find('.rs-field__required').exists()).toBe(true)
    expect(wrapper.find('.rs-field__hint').text()).toBe('请选择日期时间')
  })

  it('applies left label layout class', () => {
    const wrapper = mount(RsDateTimePicker, {
      props: { modelValue: '', labelPosition: 'left' },
    })
    expect(wrapper.classes()).toContain('rs-field--label-left')
  })

  it('uses single trigger for range mode', () => {
    const wrapper = mount(RsDateTimePicker, {
      props: { modelValue: { start: '', end: '' }, range: true },
    })
    expect(wrapper.findAll('.rs-date-picker__trigger')).toHaveLength(1)
    expect(wrapper.find('.rs-date-picker__value').text()).toContain('选择日期时间范围')
  })

  it('opens panel with calendar and embedded time picker', async () => {
    const wrapper = mount(RsDateTimePicker, {
      props: { modelValue: '', open: true },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.rs-date-picker__content')).not.toBeNull()
    expect(document.body.querySelector('.rs-date-picker__time-row')).not.toBeNull()
    expect(document.body.querySelector('.rs-time-picker__trigger--embedded')).not.toBeNull()
    expect(document.body.querySelector('.rs-time-columns')).toBeNull()
    wrapper.unmount()
  })

  it('disables trigger when disabled', () => {
    const wrapper = mount(RsDateTimePicker, {
      props: { modelValue: '2025-06-16 14:30:00', disabled: true },
    })
    expect(wrapper.find('.rs-date-picker__trigger').attributes('disabled')).toBeDefined()
  })
})
