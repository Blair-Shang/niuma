import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import RsBreadcrumb from '../components/RsBreadcrumb.vue'
import RsConfigProvider from '../components/RsConfigProvider.vue'

const threeLevelItems = [
  { label: '首页', href: '/' },
  { label: '应用', href: '/apps' },
  { label: '详情' },
]

describe('RsBreadcrumb', () => {
  it('renders nav with breadcrumb aria-label', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: { items: threeLevelItems },
    })
    expect(wrapper.find('nav.rs-breadcrumb').attributes('aria-label')).toBe('面包屑')
  })

  it('renders all items', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: { items: threeLevelItems },
    })
    expect(wrapper.text()).toContain('首页')
    expect(wrapper.text()).toContain('应用')
    expect(wrapper.text()).toContain('详情')
  })

  it('renders single item without separator', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: { items: [{ label: '仅一项' }] },
    })
    expect(wrapper.findAll('.rs-breadcrumb__item')).toHaveLength(1)
    expect(wrapper.findAll('.rs-breadcrumb__sep')).toHaveLength(0)
    expect(wrapper.text()).toBe('仅一项')
  })

  it('renders empty list when items is empty', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: { items: [] },
    })
    expect(wrapper.findAll('.rs-breadcrumb__item')).toHaveLength(0)
    expect(wrapper.find('.rs-breadcrumb__list').exists()).toBe(true)
  })

  it('renders href items as anchor with correct href', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: {
        items: [
          { label: '首页', href: '/' },
          { label: '当前页' },
        ],
      },
    })
    const anchors = wrapper.findAll('a.rs-breadcrumb__link')
    expect(anchors).toHaveLength(1)
    expect(anchors[0]?.text()).toBe('首页')
    expect(anchors[0]?.attributes('href')).toBe('/')
  })

  it('renders plain items as span without href', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: { items: [{ label: 'A' }, { label: 'B' }] },
    })
    const spans = wrapper.findAll('span.rs-breadcrumb__link')
    expect(spans).toHaveLength(2)
    expect(spans[0]?.text()).toBe('A')
    expect(spans[1]?.text()).toBe('B')
  })

  it('renders anchor when only to is provided', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: {
        items: [{ label: '路由页', to: '/route' }, { label: '当前' }],
      },
    })
    expect(wrapper.findAll('a.rs-breadcrumb__link')).toHaveLength(1)
    expect(wrapper.findAll('span.rs-breadcrumb__link')).toHaveLength(1)
  })

  it('marks last item as current page', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: { items: [{ label: 'A' }, { label: 'B' }] },
    })
    const links = wrapper.findAll('.rs-breadcrumb__link')
    expect(links.at(-1)?.attributes('aria-current')).toBe('page')
  })

  it('does not set aria-current on non-last items', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: { items: threeLevelItems },
    })
    const links = wrapper.findAll('.rs-breadcrumb__link')
    expect(links[0]?.attributes('aria-current')).toBeUndefined()
    expect(links[1]?.attributes('aria-current')).toBeUndefined()
    expect(links[2]?.attributes('aria-current')).toBe('page')
  })

  it('applies current class only to last item', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: { items: threeLevelItems },
    })
    const links = wrapper.findAll('.rs-breadcrumb__link')
    expect(links[0]?.classes()).not.toContain('rs-breadcrumb__link--current')
    expect(links[1]?.classes()).not.toContain('rs-breadcrumb__link--current')
    expect(links[2]?.classes()).toContain('rs-breadcrumb__link--current')
  })

  it('renders separators between items but not after last', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: { items: threeLevelItems },
    })
    expect(wrapper.findAll('.rs-breadcrumb__sep')).toHaveLength(2)
    expect(wrapper.findAll('.rs-breadcrumb__item')).toHaveLength(3)
  })

  it('renders separator icon with accessible label', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: { items: [{ label: 'A' }, { label: 'B' }] },
    })
    const sep = wrapper.find('.rs-breadcrumb__sep')
    expect(sep.exists()).toBe(true)
    expect(sep.attributes('aria-label')).toBe('分隔符')
  })

  it('renders i18n labels in en-US locale', () => {
    const wrapper = mount(RsConfigProvider, {
      props: { locale: 'en-US' },
      slots: {
        default: () =>
          h(RsBreadcrumb, {
            items: [{ label: 'Home', href: '/' }, { label: 'Docs' }],
          }),
      },
    })
    expect(wrapper.find('nav.rs-breadcrumb').attributes('aria-label')).toBe('Breadcrumb')
    expect(wrapper.find('.rs-breadcrumb__sep').attributes('aria-label')).toBe('Separator')
  })

  it('uses href as rendered anchor href when both to and href exist', () => {
    const wrapper = mount(RsBreadcrumb, {
      props: {
        items: [
          { label: 'Entry', to: '/route-target', href: '/href-target' },
          { label: 'Current' },
        ],
      },
    })
    const anchor = wrapper.find('a.rs-breadcrumb__link')
    expect(anchor.exists()).toBe(true)
    expect(anchor.attributes('href')).toBe('/href-target')
  })

  it('updates current item and separators after items prop changes', async () => {
    const wrapper = mount(RsBreadcrumb, {
      props: { items: [{ label: 'Root' }, { label: 'Leaf' }] },
    })
    expect(wrapper.findAll('.rs-breadcrumb__sep')).toHaveLength(1)
    expect(wrapper.findAll('.rs-breadcrumb__link')[1]?.text()).toBe('Leaf')

    await wrapper.setProps({
      items: [{ label: 'Root' }, { label: 'Branch' }, { label: 'Leaf' }],
    })

    const links = wrapper.findAll('.rs-breadcrumb__link')
    expect(wrapper.findAll('.rs-breadcrumb__sep')).toHaveLength(2)
    expect(links[1]?.attributes('aria-current')).toBeUndefined()
    expect(links[2]?.attributes('aria-current')).toBe('page')
    expect(links[2]?.text()).toBe('Leaf')
  })
})
