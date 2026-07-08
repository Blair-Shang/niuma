import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsTimePicker from '../components/RsTimePicker.vue'

describe('RsTimePicker', () => {
  it('renders popover trigger with placeholder', () => {
    const wrapper = mount(RsTimePicker, { props: { modelValue: '' } })
    expect(wrapper.find('.rs-time-picker__trigger').exists()).toBe(true)
    expect(wrapper.find('.rs-time-picker__value').text()).toContain('选择时间')
    expect(wrapper.classes()).toContain('rs-field')
  })

  it('shows preset value on trigger when model is set', () => {
    const wrapper = mount(RsTimePicker, {
      props: { modelValue: '14:30' },
    })
    expect(wrapper.find('.rs-time-picker__trigger--placeholder').exists()).toBe(false)
    expect(wrapper.find('.rs-time-picker__value').text()).toBe('14:30')
  })

  it('renders label, hint, and required marker', () => {
    const wrapper = mount(RsTimePicker, {
      props: {
        modelValue: '',
        label: '签到时间',
        hint: '请选择时间',
        required: true,
      },
    })
    expect(wrapper.find('.rs-field__label').text()).toContain('签到时间')
    expect(wrapper.find('.rs-field__required').exists()).toBe(true)
    expect(wrapper.find('.rs-field__hint').text()).toBe('请选择时间')
  })

  it('applies left label layout class', () => {
    const wrapper = mount(RsTimePicker, {
      props: { modelValue: '', labelPosition: 'left' },
    })
    expect(wrapper.classes()).toContain('rs-field--label-left')
  })

  it('uses single trigger for range mode', () => {
    const wrapper = mount(RsTimePicker, {
      props: { modelValue: { start: '', end: '' }, range: true },
    })
    expect(wrapper.findAll('.rs-time-picker__trigger')).toHaveLength(1)
    expect(wrapper.find('.rs-time-picker__value').text()).toContain('选择时间范围')
  })

  it('shows range label when range model is set', () => {
    const wrapper = mount(RsTimePicker, {
      props: {
        modelValue: { start: '09:00', end: '18:00' },
        range: true,
      },
    })
    expect(wrapper.find('.rs-time-picker__value').text()).toContain('09:00')
    expect(wrapper.find('.rs-time-picker__value').text()).toContain('18:00')
  })

  it('opens panel with scroll columns', async () => {
    const wrapper = mount(RsTimePicker, {
      props: { modelValue: '', open: true },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.rs-time-columns')).not.toBeNull()
    wrapper.unmount()
  })

  it('disables trigger when disabled', () => {
    const wrapper = mount(RsTimePicker, {
      props: { modelValue: '10:00', disabled: true },
    })
    expect(wrapper.find('.rs-time-picker__trigger').attributes('disabled')).toBeDefined()
  })
})
