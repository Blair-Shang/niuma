import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsStatCard from '../components/RsStatCard.vue'

const accents = ['primary', 'success', 'warning', 'danger', 'info'] as const

describe('RsStatCard', () => {
  it('renders label and value', () => {
    const wrapper = mount(RsStatCard, {
      props: { label: '今日调用', value: 12480 },
    })
    expect(wrapper.find('.rs-stat-card__label').text()).toBe('今日调用')
    expect(wrapper.find('.rs-stat-card__value').text()).toBe('12480')
  })

  it('renders as section with base class', () => {
    const wrapper = mount(RsStatCard, {
      props: { label: '指标', value: 1 },
    })
    expect(wrapper.element.tagName).toBe('SECTION')
    expect(wrapper.classes()).toContain('rs-stat-card')
  })

  it('uses primary accent by default', () => {
    const wrapper = mount(RsStatCard, {
      props: { label: '指标', value: 1 },
    })
    expect(wrapper.classes()).toContain('rs-stat-card--primary')
  })

  it.each(accents)('applies %s accent class', (accent) => {
    const wrapper = mount(RsStatCard, {
      props: { label: '指标', value: 1, accent },
    })
    expect(wrapper.classes()).toContain(`rs-stat-card--${accent}`)
  })

  it('renders description when provided', () => {
    const wrapper = mount(RsStatCard, {
      props: {
        label: '错误率',
        value: '0.12%',
        description: '过去 24 小时',
      },
    })
    expect(wrapper.find('.rs-stat-card__description').text()).toBe('过去 24 小时')
  })

  it('omits description when not provided', () => {
    const wrapper = mount(RsStatCard, {
      props: { label: '指标', value: 1 },
    })
    expect(wrapper.find('.rs-stat-card__description').exists()).toBe(false)
  })

  it('shows skeleton instead of value when loading', () => {
    const wrapper = mount(RsStatCard, {
      props: { label: '活跃用户', value: 3842, loading: true },
    })
    expect(wrapper.find('.rs-stat-card__skeleton').exists()).toBe(true)
    expect(wrapper.find('.rs-stat-card__value').exists()).toBe(false)
  })

  it('renders value slot', () => {
    const wrapper = mount(RsStatCard, {
      props: { label: '营收' },
      slots: { value: '<span class="custom-value">¥ 128万</span>' },
    })
    expect(wrapper.find('.custom-value').text()).toBe('¥ 128万')
  })

  it('renders default slot for extra content', () => {
    const wrapper = mount(RsStatCard, {
      props: { label: '存储', value: '68%' },
      slots: { default: '<div class="extra">进度条</div>' },
    })
    expect(wrapper.find('.extra').text()).toBe('进度条')
  })
})
