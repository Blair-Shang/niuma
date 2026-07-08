import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsInput from '../components/RsInput.vue'
import RsLabel from '../components/RsLabel.vue'

describe('RsLabel', () => {
  it('renders slot text', () => {
    const wrapper = mount(RsLabel, {
      slots: { default: '邮箱' },
    })
    expect(wrapper.text()).toContain('邮箱')
  })

  it('shows required marker when required is true', () => {
    const wrapper = mount(RsLabel, {
      props: { required: true },
      slots: { default: '名称' },
    })
    expect(wrapper.find('.rs-label__required').exists()).toBe(true)
    expect(wrapper.find('.rs-label__required').text()).toBe('*')
  })

  it('hides required marker by default', () => {
    const wrapper = mount(RsLabel, {
      slots: { default: '名称' },
    })
    expect(wrapper.find('.rs-label__required').exists()).toBe(false)
  })

  it('marks required asterisk as aria-hidden', () => {
    const wrapper = mount(RsLabel, {
      props: { required: true },
      slots: { default: '密码' },
    })
    expect(wrapper.find('.rs-label__required').attributes('aria-hidden')).toBe('true')
  })

  it('binds for attribute when forId is set', () => {
    const wrapper = mount(RsLabel, {
      props: { forId: 'email' },
      slots: { default: '邮箱' },
    })
    expect(wrapper.attributes('for')).toBe('email')
  })

  it('omits for attribute when forId is not set', () => {
    const wrapper = mount(RsLabel, {
      slots: { default: '说明' },
    })
    expect(wrapper.attributes('for')).toBeUndefined()
  })

  it('renders hint text', () => {
    const wrapper = mount(RsLabel, {
      props: { hint: '用于登录与通知' },
      slots: { default: '邮箱地址' },
    })
    expect(wrapper.find('.rs-label__hint').text()).toBe('用于登录与通知')
  })

  it('does not render hint element when hint is omitted', () => {
    const wrapper = mount(RsLabel, {
      slots: { default: '邮箱地址' },
    })
    expect(wrapper.find('.rs-label__hint').exists()).toBe(false)
  })

  it('applies disabled class when disabled', () => {
    const wrapper = mount(RsLabel, {
      props: { disabled: true },
      slots: { default: '已禁用字段' },
    })
    expect(wrapper.classes()).toContain('rs-label--disabled')
  })

  it('supports required, hint, forId and disabled together', () => {
    const wrapper = mount(RsLabel, {
      props: {
        forId: 'username',
        required: true,
        hint: '3–20 个字符',
        disabled: true,
      },
      slots: { default: '用户名' },
    })
    expect(wrapper.attributes('for')).toBe('username')
    expect(wrapper.classes()).toContain('rs-label--disabled')
    expect(wrapper.find('.rs-label__required').exists()).toBe(true)
    expect(wrapper.find('.rs-label__hint').text()).toBe('3–20 个字符')
    expect(wrapper.text()).toContain('用户名')
  })

  it('links label to input when forId matches input id', () => {
    const wrapper = mount({
      components: { RsLabel, RsInput },
      template: `
        <div>
          <RsLabel for-id="pg-label-input">可点击聚焦</RsLabel>
          <RsInput id="pg-label-input" />
        </div>
      `,
    })
    expect(wrapper.find('label').attributes('for')).toBe('pg-label-input')
    expect(wrapper.find('input').attributes('id')).toBe('pg-label-input')
  })
})
