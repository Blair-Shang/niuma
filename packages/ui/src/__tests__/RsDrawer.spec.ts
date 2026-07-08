import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsConfigProvider from '../components/RsConfigProvider.vue'
import RsDrawer from '../components/RsDrawer.vue'

describe('RsDrawer', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders title, description, and default slot when open', async () => {
    const wrapper = mount(RsDrawer, {
      props: {
        open: true,
        title: '筛选条件',
        description: '按状态与时间过滤。',
      },
      slots: { default: '<p class="slot-body">正文内容</p>' },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-drawer__content')
    expect(content?.textContent).toContain('筛选条件')
    expect(content?.textContent).toContain('按状态与时间过滤。')
    expect(document.body.querySelector('.slot-body')?.textContent).toBe('正文内容')
    wrapper.unmount()
  })

  it('applies default right side and md size classes', async () => {
    const wrapper = mount(RsDrawer, {
      props: { open: true, title: '测试' },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-drawer__content')
    expect(content?.classList.contains('rs-drawer__content--right')).toBe(true)
    expect(content?.classList.contains('rs-drawer__content--md')).toBe(true)
    wrapper.unmount()
  })

  it('applies custom side and size classes', async () => {
    const wrapper = mount(RsDrawer, {
      props: { open: true, title: '左侧', side: 'left', size: 'lg' },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-drawer__content')
    expect(content?.classList.contains('rs-drawer__content--left')).toBe(true)
    expect(content?.classList.contains('rs-drawer__content--lg')).toBe(true)
    wrapper.unmount()
  })

  it('renders footer slot', async () => {
    const wrapper = mount(RsDrawer, {
      props: { open: true, title: '保存' },
      slots: { footer: '<button type="button" class="footer-save">保存</button>' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.rs-drawer__footer .footer-save')?.textContent).toBe('保存')
    wrapper.unmount()
  })

  it('renders custom header slot', async () => {
    const wrapper = mount(RsDrawer, {
      props: { open: true },
      slots: {
        header: '<div class="custom-header">自定义标题</div>',
        default: '正文',
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.custom-header')?.textContent).toBe('自定义标题')
    expect(document.body.querySelector('.rs-drawer__title')).toBeNull()
    wrapper.unmount()
  })

  it('closes when header close button is clicked', async () => {
    const Host = defineComponent({
      components: { RsDrawer },
      setup() {
        const open = ref(true)
        return { open }
      },
      template: '<RsDrawer v-model:open="open" title="关闭测试" />',
    })
    const wrapper = mount(Host, { attachTo: document.body })
    await flushPromises()
    const closeBtn = document.body.querySelector('.rs-drawer__header button') as HTMLElement
    await closeBtn.click()
    await flushPromises()
    expect(wrapper.findComponent(RsDrawer).props('open')).toBe(false)
    wrapper.unmount()
  })

  it('hides overlay when showOverlay is false', async () => {
    const wrapper = mount(RsDrawer, {
      props: { open: true, title: '无遮罩', showOverlay: false },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.rs-drawer__overlay')).toBeNull()
    wrapper.unmount()
  })

  it('hides close button when showClose is false', async () => {
    const wrapper = mount(RsDrawer, {
      props: { open: true, title: '无关闭', showClose: false },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelectorAll('.rs-drawer__header button').length).toBe(0)
    wrapper.unmount()
  })

  it('omits header when no title, description, close, or header slot', async () => {
    const wrapper = mount(RsDrawer, {
      props: { open: true, showClose: false },
      slots: { default: '仅正文' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.rs-drawer__header')).toBeNull()
    wrapper.unmount()
  })

  it('uses en-US close tooltip inside RsConfigProvider', async () => {
    const Host = defineComponent({
      components: { RsDrawer, RsConfigProvider },
      setup() {
        return () =>
          h(RsConfigProvider, { locale: 'en-US' }, {
            default: () => h(RsDrawer, { open: true, title: 'Drawer' }),
          })
      },
    })
    const wrapper = mount(Host, { attachTo: document.body })
    await flushPromises()
    const closeBtn = document.body.querySelector('.rs-drawer__header button') as HTMLElement
    expect(closeBtn.querySelector('.rs-btn__tooltip')?.textContent).toContain('Close')
    wrapper.unmount()
  })
})
