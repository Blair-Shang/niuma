import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsCard from '../components/RsCard.vue'

describe('RsCard', () => {
  it('renders default slot in body', () => {
    const wrapper = mount(RsCard, {
      slots: { default: '<p>正文</p>' },
    })
    expect(wrapper.find('.rs-card__body').html()).toContain('正文')
  })

  it('renders as section by default', () => {
    const wrapper = mount(RsCard, { slots: { default: '内容' } })
    expect(wrapper.element.tagName).toBe('SECTION')
    expect(wrapper.classes()).toContain('rs-card')
  })

  it('renders custom as element', () => {
    const wrapper = mount(RsCard, {
      props: { as: 'article' },
      slots: { default: '内容' },
    })
    expect(wrapper.element.tagName).toBe('ARTICLE')
  })

  it('renders title and description in header', () => {
    const wrapper = mount(RsCard, {
      props: { title: '标题', description: '描述文字' },
      slots: { default: '正文' },
    })
    expect(wrapper.find('.rs-card__title').text()).toBe('标题')
    expect(wrapper.find('.rs-card__description').text()).toBe('描述文字')
    expect(wrapper.find('header.rs-card__header').exists()).toBe(true)
  })

  it('omits header when no title, description, or header slot', () => {
    const wrapper = mount(RsCard, { slots: { default: '仅正文' } })
    expect(wrapper.find('header').exists()).toBe(false)
  })

  it('renders header slot instead of default heading', () => {
    const wrapper = mount(RsCard, {
      slots: {
        header: '<div class="custom-h">自定义</div>',
        default: '正文',
      },
    })
    expect(wrapper.find('.custom-h').text()).toBe('自定义')
    expect(wrapper.find('.rs-card__title').exists()).toBe(false)
  })

  it('renders actions slot in header', () => {
    const wrapper = mount(RsCard, {
      props: { title: '卡片' },
      slots: {
        actions: '<button type="button">操作</button>',
        default: '正文',
      },
    })
    expect(wrapper.find('.rs-card__actions button').text()).toBe('操作')
  })

  it('applies padded body class by default', () => {
    const wrapper = mount(RsCard, { slots: { default: '内容' } })
    expect(wrapper.find('.rs-card__body').classes()).toContain('rs-card__body--padded')
  })

  it('omits padded class when padding is false', () => {
    const wrapper = mount(RsCard, {
      props: { padding: false },
      slots: { default: '内容' },
    })
    expect(wrapper.find('.rs-card__body').classes()).not.toContain('rs-card__body--padded')
  })

  it('applies elevated class when elevated is true', () => {
    const wrapper = mount(RsCard, {
      props: { elevated: true },
      slots: { default: '内容' },
    })
    expect(wrapper.classes()).toContain('rs-card--elevated')
  })
})
