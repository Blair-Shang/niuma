import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsContextMenu from '../components/RsContextMenu.vue'

describe('RsContextMenu', () => {
  const items = [
    { key: 'open', label: '打开', icon: 'folder-open' },
    { key: 'rename', label: '重命名', icon: 'pen-line' },
  ]

  it('opens menu on contextmenu', async () => {
    const wrapper = mount(RsContextMenu, {
      props: { items },
      slots: { default: '<div class="trigger">Right click</div>' },
      attachTo: document.body,
    })
    expect(document.body.querySelector('.rs-context-menu__content')).toBeNull()
    await wrapper.find('.trigger').trigger('contextmenu')
    await flushPromises()
    expect(document.body.querySelector('.rs-context-menu__content')).not.toBeNull()
    wrapper.unmount()
  })

  it('emits select with item key', async () => {
    const wrapper = mount(RsContextMenu, {
      props: { items },
      slots: { default: '<div class="trigger">Right click</div>' },
      attachTo: document.body,
    })
    await wrapper.find('.trigger').trigger('contextmenu')
    await flushPromises()
    const menuItems = document.body.querySelectorAll('.rs-context-menu__item')
    ;(menuItems[1] as HTMLElement).click()
    await flushPromises()
    expect(wrapper.emitted('select')?.[0]).toEqual(['rename'])
    wrapper.unmount()
  })

  it('renders separator and danger item', async () => {
    const wrapper = mount(RsContextMenu, {
      props: {
        items: [
          { key: 'edit', label: '编辑' },
          { key: 'sep', label: '', separator: true },
          { key: 'delete', label: '删除', danger: true },
        ],
      },
      slots: { default: '<div class="trigger">Right click</div>' },
      attachTo: document.body,
    })
    await wrapper.find('.trigger').trigger('contextmenu')
    await flushPromises()
    expect(document.body.querySelector('.rs-context-menu__separator')).not.toBeNull()
    const danger = document.body.querySelector('.rs-context-menu__item--danger')
    expect(danger?.textContent).toContain('删除')
    wrapper.unmount()
  })

  it('renders submenu trigger', async () => {
    const wrapper = mount(RsContextMenu, {
      props: {
        items: [
          {
            key: 'share',
            label: '分享',
            children: [{ key: 'link', label: '复制链接' }],
          },
        ],
      },
      slots: { default: '<div class="trigger">Right click</div>' },
      attachTo: document.body,
    })
    await wrapper.find('.trigger').trigger('contextmenu')
    await flushPromises()
    expect(document.body.textContent).toContain('分享')
    wrapper.unmount()
  })
})
