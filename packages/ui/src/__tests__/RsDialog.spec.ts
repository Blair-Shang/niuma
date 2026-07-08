import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsConfigProvider from '../components/RsConfigProvider.vue'
import RsDialog from '../components/RsDialog.vue'

describe('RsDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  it('renders title, description, and default slot when open', async () => {
    const wrapper = mount(RsDialog, {
      props: {
        open: true,
        title: '编辑成员',
        description: '修改角色与权限。',
      },
      slots: { default: '<p class="slot-body">正文内容</p>' },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-dialog__content')
    expect(content?.textContent).toContain('编辑成员')
    expect(content?.textContent).toContain('修改角色与权限。')
    expect(document.body.querySelector('.slot-body')?.textContent).toBe('正文内容')
    wrapper.unmount()
  })

  it('applies confirm layout and width classes by default', async () => {
    const wrapper = mount(RsDialog, {
      props: { open: true, title: '测试', width: 'sm' },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-dialog__content')
    expect(content?.classList.contains('rs-dialog__content--confirm')).toBe(true)
    expect(content?.classList.contains('rs-dialog__content--sm')).toBe(true)
    wrapper.unmount()
  })

  it('renders footer slot', async () => {
    const wrapper = mount(RsDialog, {
      props: { open: true, title: '保存' },
      slots: { footer: '<button type="button" class="footer-save">保存</button>' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.rs-dialog__footer .footer-save')?.textContent).toBe('保存')
    wrapper.unmount()
  })

  it('closes when header close button is clicked', async () => {
    const Host = defineComponent({
      components: { RsDialog },
      setup() {
        const open = ref(true)
        return { open }
      },
      template: '<RsDialog v-model:open="open" title="关闭测试" />',
    })
    const wrapper = mount(Host, { attachTo: document.body })
    await flushPromises()
    const closeBtn = document.body.querySelector('.rs-dialog__actions button') as HTMLElement
    await closeBtn.click()
    await flushPromises()
    expect(wrapper.findComponent(RsDialog).props('open')).toBe(false)
    wrapper.unmount()
  })

  it('hides overlay by default', async () => {
    const wrapper = mount(RsDialog, {
      props: { open: true, title: '无遮罩' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.rs-dialog__overlay')).toBeNull()
    wrapper.unmount()
  })

  it('shows overlay when showOverlay is true', async () => {
    const wrapper = mount(RsDialog, {
      props: { open: true, title: '有遮罩', showOverlay: true },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.rs-dialog__overlay')).not.toBeNull()
    wrapper.unmount()
  })

  it('hides close button when showClose is false', async () => {
    const wrapper = mount(RsDialog, {
      props: { open: true, title: '无关闭', showClose: false },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelectorAll('.rs-dialog__actions button').length).toBe(0)
    wrapper.unmount()
  })

  it('applies window layout class and inline size style', async () => {
    const wrapper = mount(RsDialog, {
      props: {
        open: true,
        title: '窗口',
        layout: 'window',
        draggable: true,
        resizable: true,
      },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-dialog__content') as HTMLElement
    expect(content.classList.contains('rs-dialog__content--window')).toBe(true)
    expect(content.style.width).not.toBe('')
    expect(content.style.height).not.toBe('')
    wrapper.unmount()
  })

  it('renders resize handles in resizable window mode', async () => {
    const wrapper = mount(RsDialog, {
      props: {
        open: true,
        title: '可缩放',
        layout: 'window',
        resizable: true,
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelectorAll('.rs-dialog__resize-handle').length).toBe(8)
    wrapper.unmount()
  })

  it('shows fullscreen toggle only in window layout with fullscreenable', async () => {
    const wrapper = mount(RsDialog, {
      props: {
        open: true,
        title: '全屏',
        layout: 'window',
        fullscreenable: true,
      },
      attachTo: document.body,
    })
    await flushPromises()
    const actionButtons = document.body.querySelectorAll('.rs-dialog__actions button')
    expect(actionButtons.length).toBe(2)
    wrapper.unmount()
  })

  it('applies tone modifier class', async () => {
    const wrapper = mount(RsDialog, {
      props: { open: true, title: '警告', tone: 'warning' },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-dialog__content')
    expect(content?.classList.contains('rs-dialog__content--tone-warning')).toBe(true)
    wrapper.unmount()
  })

  it('uses en-US close tooltip inside RsConfigProvider', async () => {
    const Host = defineComponent({
      components: { RsDialog, RsConfigProvider },
      setup() {
        return () =>
          h(RsConfigProvider, { locale: 'en-US' }, {
            default: () => h(RsDialog, { open: true, title: 'Dialog' }),
          })
      },
    })
    const wrapper = mount(Host, { attachTo: document.body })
    await flushPromises()
    const closeBtn = document.body.querySelector('.rs-dialog__actions button') as HTMLElement
    expect(closeBtn.querySelector('.rs-btn__tooltip')?.textContent).toContain('Close')
    wrapper.unmount()
  })
})
