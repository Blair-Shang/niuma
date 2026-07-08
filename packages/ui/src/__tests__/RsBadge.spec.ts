import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsBadge from '../components/RsBadge.vue'

const variants = ['default', 'primary', 'success', 'warning', 'danger', 'info'] as const

describe('RsBadge', () => {
  it('renders slot text', () => {
    const wrapper = mount(RsBadge, { slots: { default: 'Open' } })
    expect(wrapper.text()).toBe('Open')
  })

  it('renders as span with base class', () => {
    const wrapper = mount(RsBadge, { slots: { default: 'Tag' } })
    expect(wrapper.element.tagName).toBe('SPAN')
    expect(wrapper.classes()).toContain('rs-badge')
  })

  it('uses default variant when variant is omitted', () => {
    const wrapper = mount(RsBadge, { slots: { default: '默认' } })
    expect(wrapper.classes()).toContain('rs-badge--default')
  })

  it.each(variants)('applies %s variant class', (variant) => {
    const wrapper = mount(RsBadge, {
      props: { variant },
      slots: { default: variant },
    })
    expect(wrapper.classes()).toContain(`rs-badge--${variant}`)
  })

  it('renders longer slot content', () => {
    const wrapper = mount(RsBadge, {
      props: { variant: 'warning' },
      slots: { default: '配额已用尽' },
    })
    expect(wrapper.text()).toBe('配额已用尽')
    expect(wrapper.classes()).toContain('rs-badge--warning')
  })
})
