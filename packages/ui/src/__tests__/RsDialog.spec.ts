import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsConfigProvider from '../components/RsConfigProvider.vue'
import RsDialog from '../components/RsDialog.vue'

async function flushAnimationFrames(count = 2): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }
}

describe('RsDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  it('renders title, description, and body slot when open', async () => {
    const wrapper = mount(RsDialog, {
      props: {
        open: true,
        title: '编辑成员',
        description: '修改角色与权限。',
        deferBodyMount: false,
      },
      slots: { body: '<p class="slot-body">正文内容</p>' },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-dialog__content')
    expect(content?.textContent).toContain('编辑成员')
    expect(content?.textContent).toContain('修改角色与权限。')
    expect(document.body.querySelector('.slot-body')?.textContent).toBe('正文内容')
    wrapper.unmount()
  })

  it('defers body slot mount until after paint in window layout', async () => {
    const wrapper = mount(RsDialog, {
      props: { open: true, title: '延后挂载' },
      slots: { body: '<p class="slot-body">正文内容</p>' },
      attachTo: document.body,
    })
    expect(document.body.querySelector('.slot-body')).toBeNull()

    await flushAnimationFrames()
    await flushPromises()
    expect(document.body.querySelector('.slot-body')?.textContent).toBe('正文内容')
    wrapper.unmount()
  })

  it('destroys deferred body content when closed', async () => {
    const Host = defineComponent({
      components: { RsDialog },
      setup() {
        const open = ref(true)
        return { open }
      },
      template: '<RsDialog v-model:open="open" title="关闭销毁"><template #body><p class="slot-body">正文</p></template></RsDialog>',
    })
    const wrapper = mount(Host, { attachTo: document.body })
    await flushAnimationFrames()
    await flushPromises()
    expect(document.body.querySelector('.slot-body')).not.toBeNull()

    await wrapper.findComponent(RsDialog).setValue(false, 'open')
    await flushPromises()
    expect(document.body.querySelector('.slot-body')).toBeNull()
    wrapper.unmount()
  })

  it('applies window layout with resize handles by default', async () => {
    const wrapper = mount(RsDialog, {
      props: { open: true, title: '测试', width: 'sm' },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-dialog__content')
    expect(content?.classList.contains('rs-dialog__content--window')).toBe(true)
    expect(content?.classList.contains('rs-dialog__content--sm')).toBe(true)
    expect(document.body.querySelectorAll('.rs-dialog__resize-handle').length).toBe(8)
    wrapper.unmount()
  })

  it('applies confirm layout when explicitly set', async () => {
    const wrapper = mount(RsDialog, {
      props: { open: true, title: '测试', width: 'sm', layout: 'confirm', resizable: false, fullscreenable: false },
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
      template: '<RsDialog v-model:open="open" title="关闭测试" :fullscreenable="false" />',
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
      props: { open: true, title: '无关闭', showClose: false, fullscreenable: false },
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

  it('toggles fullscreen class and restores window bounds', async () => {
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
    const content = document.body.querySelector('.rs-dialog__content') as HTMLElement
    const fullscreenBtn = document.body.querySelectorAll('.rs-dialog__actions button')[0] as HTMLElement
    const beforeWidth = content.style.width
    const beforeHeight = content.style.height

    await fullscreenBtn.click()
    await flushPromises()
    expect(content.classList.contains('rs-dialog__content--fullscreen')).toBe(true)
    expect(content.style.width).toContain('calc')
    expect(content.classList.contains('rs-dialog__content--bounds-transition')).toBe(false)

    await fullscreenBtn.click()
    await flushPromises()
    expect(content.classList.contains('rs-dialog__content--fullscreen')).toBe(false)
    expect(content.style.width).toBe(beforeWidth)
    expect(content.style.height).toBe(beforeHeight)
    wrapper.unmount()
  })

  it('enables bounds transition when boundsTransition is true', async () => {
    const wrapper = mount(RsDialog, {
      props: {
        open: true,
        title: '全屏动画',
        layout: 'window',
        fullscreenable: true,
        boundsTransition: true,
      },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-dialog__content') as HTMLElement
    const fullscreenBtn = document.body.querySelectorAll('.rs-dialog__actions button')[0] as HTMLElement

    await fullscreenBtn.click()
    await flushPromises()
    expect(content.classList.contains('rs-dialog__content--bounds-transition')).toBe(true)
    wrapper.unmount()
  })

  it('moves window when draggable header is dragged', async () => {
    const wrapper = mount(RsDialog, {
      props: {
        open: true,
        title: '拖拽',
        layout: 'window',
        draggable: true,
        resizable: true,
      },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-dialog__content') as HTMLElement
    const header = document.body.querySelector('.rs-dialog__header') as HTMLElement
    expect(content.classList.contains('rs-dialog__content--draggable')).toBe(true)
    const startLeft = content.style.left
    const startTop = content.style.top

    header.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 120, clientY: 80, bubbles: true, cancelable: true }),
    )
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 180, clientY: 120, bubbles: true, cancelable: true }),
    )
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(content.style.left).not.toBe(startLeft)
    expect(content.style.top).not.toBe(startTop)
    wrapper.unmount()
  })

  it('does not move window when draggable is false', async () => {
    const wrapper = mount(RsDialog, {
      props: {
        open: true,
        title: '不可拖',
        layout: 'window',
        draggable: false,
      },
      attachTo: document.body,
    })
    await flushPromises()
    const content = document.body.querySelector('.rs-dialog__content') as HTMLElement
    const header = document.body.querySelector('.rs-dialog__header') as HTMLElement
    const startLeft = content.style.left
    const startTop = content.style.top

    header.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 120, clientY: 80, bubbles: true, cancelable: true }),
    )
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 180, clientY: 120, bubbles: true, cancelable: true }),
    )
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(content.style.left).toBe(startLeft)
    expect(content.style.top).toBe(startTop)
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
            default: () => h(RsDialog, { open: true, title: 'Dialog', fullscreenable: false }),
          })
      },
    })
    const wrapper = mount(Host, { attachTo: document.body })
    await flushPromises()
    const closeBtn = document.body.querySelector('.rs-dialog__actions button') as HTMLElement
    expect(closeBtn.querySelector('.rs-btn__tooltip')?.textContent).toContain('Close')
    wrapper.unmount()
  })

  it('mounts portal into custom target via teleportTo', async () => {
    const target = document.createElement('div')
    target.id = 'rs-dialog-target'
    document.body.appendChild(target)

    const wrapper = mount(RsDialog, {
      props: {
        open: true,
        title: '挂载目标',
        teleportTo: '#rs-dialog-target',
      },
      attachTo: document.body,
    })

    await flushPromises()
    expect(target.querySelector('.rs-dialog__content')).not.toBeNull()
    wrapper.unmount()
  })

  it('passes modal=false to DialogRoot for non-modal usage', async () => {
    const wrapper = mount(RsDialog, {
      props: {
        open: true,
        title: '非模态',
        modal: false,
      },
      attachTo: document.body,
    })
    await flushPromises()
    const root = wrapper.findComponent({ name: 'DialogRoot' })
    expect(root.props('modal')).toBe(false)
    wrapper.unmount()
  })
})
