import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import RsPagination from '../components/RsPagination.vue'
import RsConfigProvider from '../components/RsConfigProvider.vue'
import RsSelect from '../components/RsSelect.vue'

describe('RsPagination', () => {
  it('renders nav with pagination aria-label', () => {
    const wrapper = mount(RsPagination, {
      props: { total: 100, page: 1, pageSize: 10 },
    })
    expect(wrapper.find('nav.rs-pagination').attributes('aria-label')).toBe('分页')
  })

  it('uses en-US aria-label when locale is en-US', () => {
    const wrapper = mount(RsConfigProvider, {
      props: { locale: 'en-US' },
      slots: {
        default: () =>
          h(RsPagination, {
            total: 100,
            page: 1,
            pageSize: 10,
          }),
      },
    })
    expect(wrapper.find('nav.rs-pagination').attributes('aria-label')).toBe('Pagination')
  })

  it('renders summary text with total', () => {
    const wrapper = mount(RsPagination, {
      props: { total: 86, page: 1, pageSize: 20 },
    })
    expect(wrapper.find('.rs-pagination__summary').text()).toBe('共 86 条')
  })

  it('hides summary when showSummary is false', () => {
    const wrapper = mount(RsPagination, {
      props: { total: 86, page: 1, showSummary: false },
    })
    expect(wrapper.find('.rs-pagination__summary').exists()).toBe(false)
  })

  it('emits update:page when next is clicked', async () => {
    const wrapper = mount(RsPagination, {
      props: { total: 100, page: 1, pageSize: 10 },
    })
    const buttons = wrapper.findAll('button')
    await buttons.at(-1)?.trigger('click')
    expect(wrapper.emitted('update:page')?.[0]).toEqual([2])
  })

  it('emits update:page when a page number is clicked', async () => {
    const wrapper = mount(RsPagination, {
      props: { total: 50, page: 1, pageSize: 10 },
    })
    const pageButton = wrapper.findAll('button').find((btn) => btn.text() === '3')
    expect(pageButton).toBeDefined()
    await pageButton?.trigger('click')
    expect(wrapper.emitted('update:page')?.pop()).toEqual([3])
  })

  it('disables prev on first page', () => {
    const wrapper = mount(RsPagination, {
      props: { total: 100, page: 1, pageSize: 10 },
    })
    expect(wrapper.findAll('button')[0].attributes('disabled')).toBeDefined()
  })

  it('disables next on last page', () => {
    const wrapper = mount(RsPagination, {
      props: { total: 100, page: 10, pageSize: 10 },
    })
    const buttons = wrapper.findAll('button')
    expect(buttons.at(-1)?.attributes('disabled')).toBeDefined()
  })

  it('renders ellipsis for large page counts', () => {
    const wrapper = mount(RsPagination, {
      props: { total: 500, page: 12, pageSize: 20 },
    })
    expect(wrapper.find('.rs-pagination__ellipsis').exists()).toBe(true)
  })

  it('renders RsSelect for page size when showPageSize is true', () => {
    const wrapper = mount(RsPagination, {
      props: { total: 100, page: 1, pageSize: 20, showPageSize: true },
    })
    expect(wrapper.find('.rs-pagination__size .rs-select').exists()).toBe(true)
  })

  it('emits update:pageSize when page size changes', async () => {
    const wrapper = mount(RsPagination, {
      props: { total: 100, page: 1, pageSize: 20, showPageSize: true },
    })
    await wrapper.findComponent(RsSelect).setValue('50')
    expect(wrapper.emitted('update:pageSize')?.pop()).toEqual([50])
  })

  it('clamps page when page size increases', async () => {
    const wrapper = mount(RsPagination, {
      props: { total: 100, page: 5, pageSize: 10, showPageSize: true },
    })
    await wrapper.findComponent(RsSelect).setValue('50')
    expect(wrapper.emitted('update:page')?.pop()).toEqual([2])
  })

  it('does not emit update:page when disabled', async () => {
    const wrapper = mount(RsPagination, {
      props: { total: 100, page: 1, pageSize: 10, disabled: true },
    })
    await wrapper.findAll('button').at(-1)?.trigger('click')
    expect(wrapper.emitted('update:page')).toBeUndefined()
  })

  it('renders quick jumper when showQuickJumper is true', () => {
    const wrapper = mount(RsPagination, {
      props: { total: 100, page: 1, pageSize: 10, showQuickJumper: true },
    })
    expect(wrapper.find('.rs-pagination__jumper').exists()).toBe(true)
    expect(wrapper.find('.rs-pagination__jumper-input input').exists()).toBe(true)
  })

  it('hides quick jumper when only one page exists', () => {
    const wrapper = mount(RsPagination, {
      props: { total: 8, page: 1, pageSize: 10, showQuickJumper: true },
    })
    expect(wrapper.find('.rs-pagination__jumper').exists()).toBe(false)
  })

  it('jumps to page when confirm is clicked', async () => {
    const wrapper = mount(RsPagination, {
      props: { total: 100, page: 1, pageSize: 10, showQuickJumper: true },
    })
    const input = wrapper.find('.rs-pagination__jumper-input input')
    await input.setValue('7')
    const jumperBtn = wrapper
      .findAll('button')
      .find((btn) => btn.text() === '确定')
    expect(jumperBtn).toBeDefined()
    await jumperBtn?.trigger('click')
    expect(wrapper.emitted('update:page')?.pop()).toEqual([7])
  })

  it('clamps jump target to valid page range', async () => {
    const wrapper = mount(RsPagination, {
      props: { total: 100, page: 1, pageSize: 10, showQuickJumper: true },
    })
    const input = wrapper.find('.rs-pagination__jumper-input input')
    await input.setValue('99')
    const jumperBtn = wrapper
      .findAll('button')
      .find((btn) => btn.text() === '确定')
    await jumperBtn?.trigger('click')
    expect(wrapper.emitted('update:page')?.pop()).toEqual([10])
  })
})
