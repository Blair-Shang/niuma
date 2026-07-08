import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import RsMenu from '../components/RsMenu.vue'
import RsConfigProvider from '../components/RsConfigProvider.vue'
import type { RsMenuItemGroup } from '../components/menu-utils'

describe('RsMenu', () => {
  const flatItems = [
    { key: 'dashboard', label: '仪表盘', icon: 'layout-dashboard' as const },
    { key: 'chat', label: '对话', icon: 'message-square' as const },
    { key: 'settings', label: '设置', icon: 'settings' as const },
  ]

  const groupedItems: RsMenuItemGroup[] = [
    {
      label: '工作区',
      children: [
        { key: 'projects', label: '项目', icon: 'folder' as const },
        { key: 'docs', label: '文档', icon: 'search' as const },
      ],
    },
    {
      label: '系统',
      children: [{ key: 'settings', label: '设置', icon: 'settings' as const }],
    },
  ]

  const nestedItems = [
    {
      key: 'workspace',
      label: '工作区',
      icon: 'folder' as const,
      children: [
        { key: 'projects', label: '项目' },
        { key: 'archived', label: '归档', disabled: true },
      ],
    },
    { key: 'settings', label: '设置', icon: 'settings' as const },
  ]

  it('renders nav with menu aria-label', () => {
    const wrapper = mount(RsMenu, {
      props: { items: flatItems, modelValue: 'dashboard' },
    })
    expect(wrapper.find('nav.rs-menu').attributes('aria-label')).toBe('导航菜单')
  })

  it('uses en-US aria-label when locale is en-US', () => {
    const wrapper = mount(RsConfigProvider, {
      props: { locale: 'en-US' },
      slots: {
        default: () =>
          h(RsMenu, {
            items: flatItems,
            modelValue: 'dashboard',
          }),
      },
    })
    expect(wrapper.find('nav.rs-menu').attributes('aria-label')).toBe('Navigation menu')
  })

  it('emits select and updates model when item clicked', async () => {
    const wrapper = mount(RsMenu, {
      props: { items: flatItems, modelValue: 'dashboard' },
    })
    const buttons = wrapper.findAll('.rs-menu__item')
    const targetButton = buttons[1]
    expect(targetButton).toBeDefined()
    if (!targetButton) return
    await targetButton.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.pop()).toEqual(['chat'])
    expect(wrapper.emitted('select')?.[0]).toEqual(['chat'])
  })

  it('renders group labels', () => {
    const wrapper = mount(RsMenu, {
      props: { items: groupedItems, modelValue: 'projects' },
    })
    expect(wrapper.find('.rs-menu__group-label').text()).toBe('工作区')
  })

  it('auto-expands parent submenu for active nested item', () => {
    const wrapper = mount(RsMenu, {
      props: {
        items: nestedItems,
        modelValue: 'projects',
        openKeys: [],
      },
    })
    expect(wrapper.emitted('update:openKeys')?.pop()?.[0]).toContain('workspace')
  })

  it('does not emit select for disabled item', async () => {
    const wrapper = mount(RsMenu, {
      props: {
        items: nestedItems,
        modelValue: 'projects',
        openKeys: ['workspace'],
      },
    })
    const disabled = wrapper.find('.rs-menu__item:disabled')
    expect(disabled.exists()).toBe(true)
    await disabled.trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('does not render nested submenu list when collapsed', () => {
    const wrapper = mount(RsMenu, {
      props: {
        items: nestedItems,
        modelValue: 'settings',
        openKeys: ['workspace'],
        collapsed: true,
      },
    })
    expect(wrapper.find('.rs-menu__list--nested').exists()).toBe(false)
  })
})
