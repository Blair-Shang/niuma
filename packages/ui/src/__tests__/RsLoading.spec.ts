import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { mount } from '@vue/test-utils'
import RsConfigProvider from '../components/RsConfigProvider.vue'
import RsLoading from '../components/RsLoading.vue'

describe('RsLoading', () => {
  it('renders spinner by default', () => {
    const wrapper = mount(RsLoading)
    expect(wrapper.find('.rs-loading__spinner').exists()).toBe(true)
    expect(wrapper.classes()).toContain('rs-loading')
  })

  it('renders dots variant', () => {
    const wrapper = mount(RsLoading, { props: { variant: 'dots' } })
    expect(wrapper.find('.rs-loading__dots').exists()).toBe(true)
    expect(wrapper.findAll('.rs-loading__dot')).toHaveLength(3)
  })

  it('renders skeleton variant with default line count', () => {
    const wrapper = mount(RsLoading, { props: { variant: 'skeleton' } })
    expect(wrapper.find('.rs-loading__skeleton').exists()).toBe(true)
    expect(wrapper.findAll('.rs-loading__skeleton-line')).toHaveLength(4)
  })

  it('respects skeletonLines prop', () => {
    const wrapper = mount(RsLoading, {
      props: { variant: 'skeleton', skeletonLines: 2 },
    })
    expect(wrapper.findAll('.rs-loading__skeleton-line')).toHaveLength(2)
  })

  it.each(['sm', 'md', 'lg'] as const)('applies %s size class on spinner', (size) => {
    const wrapper = mount(RsLoading, { props: { size } })
    expect(wrapper.find('.rs-loading__spinner').classes()).toContain(`rs-loading__spinner--${size}`)
  })

  it.each(['default', 'primary'] as const)('applies %s tone class on spinner', (tone) => {
    const wrapper = mount(RsLoading, { props: { tone } })
    expect(wrapper.find('.rs-loading__spinner').classes()).toContain(`rs-loading__spinner--${tone}`)
  })

  it('hides root when loading is false', () => {
    const wrapper = mount(RsLoading, { props: { loading: false } })
    expect(wrapper.find('.rs-loading').exists()).toBe(false)
  })

  it('applies block and overlay modifier classes', () => {
    const wrapper = mount(RsLoading, { props: { block: true, overlay: true } })
    expect(wrapper.classes()).toContain('rs-loading--block')
    expect(wrapper.classes()).toContain('rs-loading--overlay')
  })

  it('exposes status role and default zh-CN aria-label', () => {
    const wrapper = mount(RsLoading)
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.attributes('aria-label')).toBe('加载中')
  })

  it('shows label when showLabel is true', () => {
    const wrapper = mount(RsLoading, { props: { showLabel: true } })
    expect(wrapper.find('.rs-loading__label').text()).toBe('加载中')
  })

  it('uses custom label for visible text and aria-label', () => {
    const wrapper = mount(RsLoading, {
      props: { showLabel: true, label: '正在同步…' },
    })
    expect(wrapper.find('.rs-loading__label').text()).toBe('正在同步…')
    expect(wrapper.attributes('aria-label')).toBe('正在同步…')
  })

  it('uses en-US aria-label inside RsConfigProvider', () => {
    const wrapper = mount(RsConfigProvider, {
      props: { locale: 'en-US' },
      slots: {
        default: () => h(RsLoading, { showLabel: true }),
      },
    })
    const loading = wrapper.find('.rs-loading')
    expect(loading.attributes('aria-label')).toBe('Loading')
    expect(loading.find('.rs-loading__label').text()).toBe('Loading')
  })
})
