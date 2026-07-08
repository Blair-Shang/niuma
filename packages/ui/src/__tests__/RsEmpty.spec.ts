import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RsEmpty from '../components/RsEmpty.vue'

describe('RsEmpty', () => {
  it('renders required description', () => {
    const wrapper = mount(RsEmpty, {
      props: { description: '暂无数据' },
    })
    expect(wrapper.find('.rs-empty__description').text()).toBe('暂无数据')
  })

  it('renders title when provided', () => {
    const wrapper = mount(RsEmpty, {
      props: { title: '还没有项目', description: '创建第一个项目。' },
    })
    expect(wrapper.find('.rs-empty__title').text()).toBe('还没有项目')
  })

  it('omits title element when title is not provided', () => {
    const wrapper = mount(RsEmpty, {
      props: { description: '暂无数据' },
    })
    expect(wrapper.find('.rs-empty__title').exists()).toBe(false)
  })

  it('applies description offset class when title is present', () => {
    const wrapper = mount(RsEmpty, {
      props: { title: '标题', description: '描述' },
    })
    expect(wrapper.find('.rs-empty__description').classes()).toContain('rs-empty__description--offset')
  })

  it('does not apply description offset class without title', () => {
    const wrapper = mount(RsEmpty, {
      props: { description: '描述' },
    })
    expect(wrapper.find('.rs-empty__description').classes()).not.toContain('rs-empty__description--offset')
  })

  it('renders icon slot', () => {
    const wrapper = mount(RsEmpty, {
      props: { description: '空状态' },
      slots: { icon: '<span class="custom-icon">icon</span>' },
    })
    expect(wrapper.find('.rs-empty__icon .custom-icon').text()).toBe('icon')
  })

  it('renders default slot for actions', () => {
    const wrapper = mount(RsEmpty, {
      props: { description: '空状态' },
      slots: { default: '<button type="button" class="action-btn">新建</button>' },
    })
    expect(wrapper.find('.action-btn').text()).toBe('新建')
  })

  it('renders root container with base class', () => {
    const wrapper = mount(RsEmpty, {
      props: { description: '空状态' },
    })
    expect(wrapper.classes()).toContain('rs-empty')
    expect(wrapper.find('.rs-empty__text').exists()).toBe(true)
    expect(wrapper.find('.rs-empty__icon').exists()).toBe(true)
  })
})
