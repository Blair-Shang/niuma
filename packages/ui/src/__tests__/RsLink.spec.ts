import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsLink from '../components/RsLink.vue'

describe('RsLink', () => {
  it('renders slot text and href', () => {
    const wrapper = mount(RsLink, {
      props: { href: '/docs' },
      slots: { default: '查看文档' },
    })
    expect(wrapper.text()).toContain('查看文档')
    expect(wrapper.attributes('href')).toBe('/docs')
  })

  it('adds secure rel for target blank', () => {
    const wrapper = mount(RsLink, {
      props: { href: 'https://example.com', target: '_blank' },
    })
    const rel = wrapper.attributes('rel')
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
  })

  it('merges custom rel with secure rel for target blank', () => {
    const wrapper = mount(RsLink, {
      props: { href: 'https://example.com', target: '_blank', rel: 'external' },
    })
    const rel = wrapper.attributes('rel')
    expect(rel).toContain('external')
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
  })

  it('sets disabled accessibility attributes when disabled', () => {
    const wrapper = mount(RsLink, {
      props: { href: '/docs', disabled: true },
    })
    expect(wrapper.attributes('aria-disabled')).toBe('true')
    expect(wrapper.attributes('tabindex')).toBe('-1')
    expect(wrapper.attributes('href')).toBeUndefined()
  })

  it('applies underline variant class', () => {
    const wrapper = mount(RsLink, {
      props: { href: '/docs', underline: 'always' },
    })
    expect(wrapper.classes()).toContain('rs-link--underline-always')
  })
})
