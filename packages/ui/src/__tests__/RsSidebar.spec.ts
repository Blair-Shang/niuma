import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import RsSidebar from '../components/RsSidebar.vue'
import RsSidebarGroup from '../components/RsSidebarGroup.vue'
import RsSidebarItem from '../components/RsSidebarItem.vue'

describe('RsSidebar', () => {
  it('renders aside with title and subtitle', () => {
    const wrapper = mount(RsSidebar, {
      props: { title: '弱水', subtitle: 'Studio' },
    })
    expect(wrapper.element.tagName).toBe('ASIDE')
    expect(wrapper.find('.rs-sidebar__title').text()).toBe('弱水')
    expect(wrapper.find('.rs-sidebar__subtitle').text()).toBe('Studio')
  })

  it.each(['sm', 'md', 'lg'] as const)('applies %s width class', (width) => {
    const wrapper = mount(RsSidebar, { props: { width } })
    expect(wrapper.classes()).toContain(`rs-sidebar--${width}`)
  })

  it('toggles collapsed via collapse button', async () => {
    const wrapper = mount(RsSidebar, {
      props: { title: '弱水', collapsible: true, collapsed: false },
    })
    expect(wrapper.classes()).not.toContain('rs-sidebar--collapsed')
    await wrapper.find('.rs-sidebar__collapse').trigger('click')
    expect(wrapper.emitted('update:collapsed')?.pop()).toEqual([true])
  })

  it('hides subtitle when collapsed', () => {
    const wrapper = mount(RsSidebar, {
      props: { title: '弱水', subtitle: 'Studio', collapsed: true },
    })
    expect(wrapper.classes()).toContain('rs-sidebar--collapsed')
    expect(wrapper.find('.rs-sidebar__subtitle').exists()).toBe(false)
  })

  it('renders custom header slot', () => {
    const wrapper = mount(RsSidebar, {
      slots: { header: '<div class="custom-header">自定义顶栏</div>' },
    })
    expect(wrapper.find('.custom-header').text()).toBe('自定义顶栏')
    expect(wrapper.find('.rs-sidebar__title').exists()).toBe(false)
  })

  it('renders footer slot with collapsed scope', () => {
    const wrapper = mount(RsSidebar, {
      props: { collapsed: true },
      slots: {
        footer: ({ collapsed }: { collapsed: boolean }) =>
          h('div', { class: 'footer-state' }, collapsed ? 'folded' : 'open'),
      },
    })
    expect(wrapper.find('.footer-state').text()).toBe('folded')
  })

  it('passes collapsed to default slot scope', () => {
    const wrapper = mount(RsSidebar, {
      props: { collapsed: true },
      slots: {
        default: ({ collapsed }: { collapsed: boolean }) =>
          h('div', { class: 'body-state' }, collapsed ? 'yes' : 'no'),
      },
    })
    expect(wrapper.find('.body-state').text()).toBe('yes')
  })
})

describe('RsSidebarGroup', () => {
  it('renders group title', () => {
    const wrapper = mount(RsSidebarGroup, {
      props: { title: '导航' },
      slots: { default: '<button class="item">项</button>' },
    })
    expect(wrapper.find('.rs-sidebar-group__title').text()).toBe('导航')
  })

  it('hides group title when collapsed', () => {
    const wrapper = mount(RsSidebarGroup, {
      props: { title: '导航', collapsed: true },
    })
    expect(wrapper.find('.rs-sidebar-group__title').exists()).toBe(false)
  })
})

describe('RsSidebarItem', () => {
  it('renders label and icon', () => {
    const wrapper = mount(RsSidebarItem, {
      props: { label: '仪表盘', icon: 'layout-dashboard' },
    })
    expect(wrapper.find('.rs-sidebar-item__label').text()).toBe('仪表盘')
    expect(wrapper.find('.rs-sidebar-item__icon').exists()).toBe(true)
  })

  it('applies active class', () => {
    const wrapper = mount(RsSidebarItem, {
      props: { label: '仪表盘', active: true },
    })
    expect(wrapper.classes()).toContain('rs-sidebar-item--active')
  })

  it('disables interaction when disabled', () => {
    const wrapper = mount(RsSidebarItem, {
      props: { label: '不可用', disabled: true },
    })
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })

  it('hides label and sets title when collapsed', () => {
    const wrapper = mount(RsSidebarItem, {
      props: { label: '设置', collapsed: true },
    })
    expect(wrapper.find('.rs-sidebar-item__label').exists()).toBe(false)
    expect(wrapper.attributes('title')).toBe('设置')
    expect(wrapper.classes()).toContain('rs-sidebar-item--collapsed')
  })
})
