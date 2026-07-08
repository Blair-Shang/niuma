import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsContainer from '../components/RsContainer.vue'

const maxWidths = ['sm', 'md', 'lg', 'xl', 'full'] as const
const paddings = ['none', 'sm', 'md', 'lg'] as const

describe('RsContainer', () => {
  it('renders slot content', () => {
    const wrapper = mount(RsContainer, { slots: { default: '页面内容' } })
    expect(wrapper.text()).toBe('页面内容')
  })

  it('renders as div with base class by default', () => {
    const wrapper = mount(RsContainer)
    expect(wrapper.element.tagName).toBe('DIV')
    expect(wrapper.classes()).toContain('rs-container')
    expect(wrapper.classes()).toContain('rs-container--centered')
    expect(wrapper.attributes('style')).toContain('--rs-container-max-current: var(--rs-container-max-lg);')
    expect(wrapper.attributes('style')).toContain('--rs-container-padding-current: var(--rs-space-md);')
  })

  it.each(maxWidths)('applies %s max-width class', (maxWidth) => {
    const wrapper = mount(RsContainer, { props: { maxWidth } })
    expect(wrapper.attributes('style')).toContain(`--rs-container-max-current: var(--rs-container-max-${maxWidth});`)
  })

  it.each(paddings)('applies %s padding class', (padding) => {
    const wrapper = mount(RsContainer, { props: { padding } })
    const expected = padding === 'none' ? '0' : `var(--rs-space-${padding})`
    expect(wrapper.attributes('style')).toContain(`--rs-container-padding-current: ${expected};`)
  })

  it('applies fluid style', () => {
    const wrapper = mount(RsContainer, { props: { fluid: true } })
    expect(wrapper.attributes('style')).toContain('--rs-container-max-current: none;')
  })

  it('omits centered class when centered is false', () => {
    const wrapper = mount(RsContainer, { props: { centered: false } })
    expect(wrapper.classes()).not.toContain('rs-container--centered')
  })

  it('renders custom root tag', () => {
    const wrapper = mount(RsContainer, { props: { tag: 'section' } })
    expect(wrapper.element.tagName).toBe('SECTION')
  })

  it('supports responsive maxWidth and padding', () => {
    const wrapper = mount(RsContainer, {
      props: {
        maxWidth: { sm: 'sm', md: 'md', lg: 'xl' },
        padding: { sm: 'sm', md: 'md', lg: 'lg' },
      },
    })
    const style = wrapper.attributes('style')
    expect(style).toContain('--rs-container-max-sm: var(--rs-container-max-sm);')
    expect(style).toContain('--rs-container-max-md: var(--rs-container-max-md);')
    expect(style).toContain('--rs-container-max-lg: var(--rs-container-max-xl);')
    expect(style).toContain('--rs-container-padding-sm: var(--rs-space-sm);')
    expect(style).toContain('--rs-container-padding-md: var(--rs-space-md);')
    expect(style).toContain('--rs-container-padding-lg: var(--rs-space-lg);')
  })

  it('enables grid layout with default columns and gap', () => {
    const wrapper = mount(RsContainer, { props: { grid: true } })
    expect(wrapper.classes()).toContain('rs-container--grid')
    const style = wrapper.attributes('style')
    expect(style).toContain('--rs-container-columns-current: 12;')
    expect(style).toContain('--rs-container-gap-current: var(--rs-space-md);')
  })

  it('supports responsive columns and gap', () => {
    const wrapper = mount(RsContainer, {
      props: {
        grid: true,
        columns: { sm: 4, md: 8, lg: 12 },
        gap: { sm: 'xs', md: 'sm', lg: 'lg' },
      },
    })
    const style = wrapper.attributes('style')
    expect(style).toContain('--rs-container-columns-sm: 4;')
    expect(style).toContain('--rs-container-columns-md: 8;')
    expect(style).toContain('--rs-container-columns-lg: 12;')
    expect(style).toContain('--rs-container-gap-sm: var(--rs-space-xs);')
    expect(style).toContain('--rs-container-gap-md: var(--rs-space-sm);')
    expect(style).toContain('--rs-container-gap-lg: var(--rs-space-lg);')
  })
})
