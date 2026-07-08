import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsVirtualList from '../components/RsVirtualList.vue'
import { resolveItemSize, resolveVirtualListHeight } from '../components/virtual-list-utils'

describe('virtual-list-utils', () => {
  it('resolves item size from number or function', () => {
    expect(resolveItemSize(32)).toBe(32)
    expect(resolveItemSize((index) => index * 10 + 20, 2)).toBe(40)
  })

  it('resolves list height', () => {
    expect(resolveVirtualListHeight(240)).toBe('240px')
    expect(resolveVirtualListHeight('50%')).toBe('50%')
  })
})

describe('RsVirtualList', () => {
  const items = Array.from({ length: 500 }, (_, index) => `Row ${index}`)

  it('renders subset of items for large lists', () => {
    const wrapper = mount(RsVirtualList, {
      props: { items, height: 200, itemSize: 32 },
      slots: {
        default: `<div class="item">{{ item }}</div>`,
      },
    })
    expect(wrapper.findAll('.item').length).toBeLessThan(items.length)
  })

  it('passes index to default slot', () => {
    const wrapper = mount(RsVirtualList, {
      props: { items: ['A', 'B', 'C'], height: 96, itemSize: 32 },
      slots: {
        default: `<div class="cell">{{ index }}-{{ item }}</div>`,
      },
    })
    expect(wrapper.text()).toContain('0-A')
  })

  it('marks active row with activeIndex', () => {
    const wrapper = mount(RsVirtualList, {
      props: { items: ['A', 'B', 'C', 'D'], height: 128, itemSize: 32, activeIndex: 2 },
      slots: {
        default: `<div class="cell">{{ index }}</div>`,
      },
    })
    expect(wrapper.find('.rs-virtual-list__item--active').exists()).toBe(true)
    expect(wrapper.find('.rs-virtual-list__item--active').text()).toBe('2')
  })

  it('scrolls active row into view on mount', async () => {
    const items = Array.from({ length: 100 }, (_, index) => `Row ${index}`)
    const wrapper = mount(RsVirtualList, {
      props: { items, height: 200, itemSize: 40, activeIndex: 50 },
      slots: {
        default: `<div class="cell">{{ index }}</div>`,
      },
      attachTo: document.body,
    })
    const listEl = wrapper.find('.rs-virtual-list').element as HTMLElement
    Object.defineProperty(listEl, 'clientHeight', { configurable: true, value: 200 })
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(listEl.scrollTop).toBeGreaterThan(0)
    wrapper.unmount()
  })
})
