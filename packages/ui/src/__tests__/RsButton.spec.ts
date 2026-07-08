import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsButton from '../components/RsButton.vue'

describe('RsButton', () => {
  it('renders slot', () => {
    const wrapper = mount(RsButton, {
      slots: { default: '确定' },
    })
    expect(wrapper.text()).toContain('确定')
  })

  it('applies size class', () => {
    const wrapper = mount(RsButton, {
      props: { size: 'lg' },
    })
    expect(wrapper.classes()).toContain('rs-btn--lg')
  })

  it('applies default variant class', () => {
    const wrapper = mount(RsButton, {
      props: { variant: 'default' },
    })
    expect(wrapper.classes()).toContain('rs-btn--default')
  })

  it('applies variant class', () => {
    const wrapper = mount(RsButton, {
      props: { variant: 'ghost' },
    })
    expect(wrapper.classes()).toContain('rs-btn--ghost')
  })

  it('renders prefix icon', () => {
    const wrapper = mount(RsButton, {
      props: { icon: 'plus' },
      slots: { default: '新建' },
    })
    expect(wrapper.find('.rs-btn__icon').exists()).toBe(true)
    expect(wrapper.text()).toContain('新建')
  })

  it('iconOnly with tooltip sets aria-label', () => {
    const wrapper = mount(RsButton, {
      props: { icon: 'search', iconOnly: true, tooltip: '搜索' },
    })
    expect(wrapper.classes()).toContain('rs-btn--icon-only')
    expect(wrapper.find('.rs-btn__tooltip').text()).toBe('搜索')
    expect(wrapper.attributes('aria-label')).toBe('搜索')
  })

  it('iconOnly uses slot text in floating tooltip when tooltip omitted', () => {
    const wrapper = mount(RsButton, {
      props: { icon: 'message-square', iconOnly: true },
      slots: { default: '消息' },
    })
    expect(wrapper.find('.rs-btn__label').exists()).toBe(false)
    expect(wrapper.find('.rs-btn__tooltip').text()).toBe('消息')
  })

  it('reveal-label mode keeps label in dom with reveal class', () => {
    const wrapper = mount(RsButton, {
      props: { icon: 'plus', revealLabel: true },
      slots: { default: '新建对话' },
    })
    expect(wrapper.classes()).toContain('rs-btn--reveal-label')
    expect(wrapper.find('.rs-btn__label--reveal').exists()).toBe(true)
    expect(wrapper.text()).toContain('新建对话')
  })

  it('shows tooltip when tooltip prop is set with label', () => {
    const wrapper = mount(RsButton, {
      props: { icon: 'plus', tooltip: 'Ctrl+N' },
      slots: { default: '新建' },
    })
    expect(wrapper.find('.rs-btn__tooltip').text()).toBe('Ctrl+N')
  })

  it('loading: applies class, keeps enabled, shows inline spinner and label', async () => {
    const wrapper = mount(RsButton, {
      props: { loading: true, variant: 'secondary' },
      slots: { default: '测试连接' },
    })
    const btn = wrapper.find('button')
    expect(btn.classes()).toContain('rs-btn--loading')
    expect(btn.attributes('disabled')).toBeUndefined()
    expect(btn.attributes('aria-busy')).toBe('true')
    expect(btn.find('.rs-btn__spinner-ring').exists()).toBe(true)
    expect(btn.text()).toContain('测试连接')
  })

  it('loading: locks min-width to avoid layout shift', async () => {
    const wrapper = mount(RsButton, {
      props: { loading: false, variant: 'default' },
      slots: { default: '测试连接' },
      attachTo: document.body,
    })
    const btn = wrapper.find('button').element as HTMLButtonElement
    Object.defineProperty(btn, 'offsetWidth', { configurable: true, value: 120 })
    await wrapper.setProps({ loading: true })
    await wrapper.vm.$nextTick()
    expect(btn.style.minWidth).toBe('120px')
    await wrapper.setProps({ loading: false })
    await wrapper.vm.$nextTick()
    expect(btn.style.minWidth).toBe('')
    wrapper.unmount()
  })
})
