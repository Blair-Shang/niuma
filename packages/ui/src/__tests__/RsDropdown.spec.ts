import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsDropdown from '../components/RsDropdown.vue'

describe('RsDropdown', () => {
  const items = [
    { label: '对话', value: 'chat', icon: 'message-square' as const },
    { label: '编程', value: 'code', icon: 'folder' as const },
  ]

  const groupedItems = [
    {
      label: '创作',
      options: [
        { label: '对话', value: 'chat', icon: 'message-square' as const },
        { label: '编程', value: 'code', icon: 'folder' as const },
      ],
    },
    {
      label: '检索',
      options: [{ label: '知识库', value: 'kb', icon: 'search' as const }],
    },
  ]

  it('opens menu on trigger click', async () => {
    const wrapper = mount(RsDropdown, {
      props: { items, modelValue: 'chat' },
      attachTo: document.body,
    })
    expect(document.body.querySelector('.rs-dropdown__content')).toBeNull()
    await wrapper.find('.rs-dropdown__trigger').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.rs-dropdown__content')).not.toBeNull()
    wrapper.unmount()
  })

  it('emits select when flat item chosen', async () => {
    const wrapper = mount(RsDropdown, {
      props: { items, modelValue: 'chat' },
      attachTo: document.body,
    })
    await wrapper.find('.rs-dropdown__trigger').trigger('click')
    await flushPromises()
    const menuItems = document.body.querySelectorAll('.rs-dropdown__item')
    ;(menuItems[1] as HTMLElement).click()
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.pop()).toEqual(['code'])
    expect(wrapper.emitted('select')?.[0]).toEqual(['code'])
    wrapper.unmount()
  })

  it('renders grouped labels and nested items', async () => {
    const wrapper = mount(RsDropdown, {
      props: { items: groupedItems, modelValue: 'chat' },
      attachTo: document.body,
    })
    await wrapper.find('.rs-dropdown__trigger').trigger('click')
    await flushPromises()
    const labels = document.body.querySelectorAll('.rs-dropdown__group-label')
    expect(labels).toHaveLength(2)
    expect(labels[0]?.textContent).toContain('创作')
    expect(labels[1]?.textContent).toContain('检索')
    expect(document.body.querySelectorAll('.rs-dropdown__item')).toHaveLength(3)
    wrapper.unmount()
  })

  it('emits select when grouped item chosen', async () => {
    const wrapper = mount(RsDropdown, {
      props: { items: groupedItems, modelValue: 'chat' },
      attachTo: document.body,
    })
    await wrapper.find('.rs-dropdown__trigger').trigger('click')
    await flushPromises()
    const menuItems = document.body.querySelectorAll('.rs-dropdown__item')
    ;(menuItems[2] as HTMLElement).click()
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.pop()).toEqual(['kb'])
    expect(wrapper.emitted('select')?.[0]).toEqual(['kb'])
    wrapper.unmount()
  })

  it('shows selected label from grouped options', () => {
    const wrapper = mount(RsDropdown, {
      props: { items: groupedItems, modelValue: 'kb' },
    })
    expect(wrapper.find('.rs-dropdown__label').text()).toBe('知识库')
  })

  it('shows placeholder when value not in items', () => {
    const wrapper = mount(RsDropdown, {
      props: { items: groupedItems, modelValue: '', placeholder: '选择模式' },
    })
    expect(wrapper.find('.rs-dropdown__label').text()).toBe('选择模式')
    expect(wrapper.find('.rs-dropdown__label--placeholder').exists()).toBe(true)
  })

  it('keeps trigger label when showSelected is false', async () => {
    const wrapper = mount(RsDropdown, {
      props: {
        items,
        modelValue: 'chat',
        showSelected: false,
        placeholder: '更多操作',
      },
      attachTo: document.body,
    })
    expect(wrapper.find('.rs-dropdown__label').text()).toBe('更多操作')

    await wrapper.find('.rs-dropdown__trigger').trigger('click')
    await flushPromises()
    const menuItems = document.body.querySelectorAll('.rs-dropdown__item')
    ;(menuItems[1] as HTMLElement).click()
    await flushPromises()

    expect(wrapper.find('.rs-dropdown__label').text()).toBe('更多操作')
    expect(wrapper.emitted('select')?.[0]).toEqual(['code'])
    wrapper.unmount()
  })

  it('does not mark checked state in action mode', async () => {
    const wrapper = mount(RsDropdown, {
      props: {
        items,
        modelValue: 'chat',
        showSelected: false,
        placeholder: '操作',
      },
      attachTo: document.body,
    })
    await wrapper.find('.rs-dropdown__trigger').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.rs-dropdown__item[data-state="checked"]')).toBeNull()
    wrapper.unmount()
  })
})
