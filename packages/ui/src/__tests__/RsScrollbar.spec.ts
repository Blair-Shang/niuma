import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsScrollbar from '../components/RsScrollbar.vue'
import { ScrollAreaRoot, ScrollAreaScrollbar } from '../components/reka'

describe('RsScrollbar', () => {
  it('renders slot content', () => {
    const wrapper = mount(RsScrollbar, {
      slots: {
        default: '<div class="slot-content">滚动内容</div>',
      },
    })

    expect(wrapper.find('.slot-content').exists()).toBe(true)
    expect(wrapper.find('.rs-scrollbar').exists()).toBe(true)
  })

  it('applies root sizing props', () => {
    const wrapper = mount(RsScrollbar, {
      props: {
        height: '10rem',
        maxHeight: '16rem',
        minHeight: '6rem',
      },
    })

    const style = wrapper.get('.rs-scrollbar').attributes('style')
    expect(style).toContain('height: 10rem;')
    expect(style).toContain('max-height: 16rem;')
    expect(style).toContain('min-height: 6rem;')
  })

  it('renders only vertical bar when orientation is vertical', () => {
    const wrapper = mount(RsScrollbar, {
      props: { orientation: 'vertical' },
    })
    const bars = wrapper.findAllComponents(ScrollAreaScrollbar)
    expect(bars).toHaveLength(1)
    expect(bars[0]?.props('orientation')).toBe('vertical')
  })

  it('forwards scroll behavior props to ScrollAreaRoot', () => {
    const wrapper = mount(RsScrollbar, {
      props: {
        type: 'always',
        scrollHideDelay: 400,
      },
    })
    const root = wrapper.getComponent(ScrollAreaRoot)
    expect(root.props('type')).toBe('always')
    expect(root.props('scrollHideDelay')).toBe(400)
  })
})
