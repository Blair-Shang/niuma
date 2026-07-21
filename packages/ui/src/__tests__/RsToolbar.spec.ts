import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsToolbar from '../components/RsToolbar.vue'

const sizes = ['sm', 'md', 'lg'] as const
const borders = ['bottom', 'top', 'both', 'none'] as const

describe('RsToolbar', () => {
  it('renders as header with base class by default', () => {
    const wrapper = mount(RsToolbar)
    expect(wrapper.element.tagName).toBe('HEADER')
    expect(wrapper.classes()).toContain('rs-toolbar')
    expect(wrapper.classes()).toContain('rs-toolbar--md')
    expect(wrapper.classes()).toContain('rs-toolbar--border-bottom')
    expect(wrapper.attributes('role')).toBe('toolbar')
  })

  it('renders custom root tag', () => {
    const wrapper = mount(RsToolbar, { props: { tag: 'div' } })
    expect(wrapper.element.tagName).toBe('DIV')
  })

  it.each(sizes)('applies %s size class', (size) => {
    const wrapper = mount(RsToolbar, { props: { size } })
    expect(wrapper.classes()).toContain(`rs-toolbar--${size}`)
  })

  it.each(borders)('applies %s border class', (border) => {
    const wrapper = mount(RsToolbar, { props: { border } })
    expect(wrapper.classes()).toContain(`rs-toolbar--border-${border}`)
  })

  it('applies elevated and compact modifiers', () => {
    const wrapper = mount(RsToolbar, {
      props: { elevated: true, compact: true },
    })
    expect(wrapper.classes()).toContain('rs-toolbar--elevated')
    expect(wrapper.classes()).toContain('rs-toolbar--compact')
  })

  it('sets aria-label when provided', () => {
    const wrapper = mount(RsToolbar, { props: { label: '查询工具栏' } })
    expect(wrapper.attributes('aria-label')).toBe('查询工具栏')
  })

  it('renders default slot into start region', () => {
    const wrapper = mount(RsToolbar, {
      slots: { default: '<span class="title">标题</span>' },
    })
    expect(wrapper.find('.rs-toolbar__start .title').text()).toBe('标题')
    expect(wrapper.find('.rs-toolbar__end').exists()).toBe(false)
    expect(wrapper.find('.rs-toolbar__center').exists()).toBe(false)
  })

  it('renders left / center / right slots', () => {
    const wrapper = mount(RsToolbar, {
      slots: {
        left: '<span class="left">左</span>',
        center: '<span class="center">中</span>',
        right: '<span class="right">右</span>',
      },
    })
    expect(wrapper.find('.rs-toolbar__start .left').text()).toBe('左')
    expect(wrapper.find('.rs-toolbar__center .center').text()).toBe('中')
    expect(wrapper.find('.rs-toolbar__end .right').text()).toBe('右')
  })

  it('omits start region when no left or default slot', () => {
    const wrapper = mount(RsToolbar, {
      slots: { right: '<button type="button" class="run">运行</button>' },
    })
    expect(wrapper.find('.rs-toolbar__start').exists()).toBe(false)
    expect(wrapper.find('.rs-toolbar__end .run').text()).toBe('运行')
  })
})
