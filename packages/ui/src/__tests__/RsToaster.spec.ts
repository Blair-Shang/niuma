import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsToaster from '../components/RsToaster.vue'
import { RS_TOAST_DEFAULT_POSITION } from '../components/overlay-utils'
import { useRsToast } from '../composables/useRsToast'

describe('RsToaster', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders sonner toaster with rs-toaster class', async () => {
    const wrapper = mount(RsToaster, { attachTo: document.body })
    await flushPromises()
    expect(document.body.querySelector('.rs-toaster')).toBeTruthy()
    wrapper.unmount()
  })

  it('defaults position to top-center', () => {
    const wrapper = mount(RsToaster)
    expect(wrapper.props('position')).toBe(RS_TOAST_DEFAULT_POSITION)
    wrapper.unmount()
  })

  it('defaults closeButton to true and richColors to false', () => {
    const wrapper = mount(RsToaster)
    expect(wrapper.props('closeButton')).toBe(true)
    expect(wrapper.props('richColors')).toBe(false)
    wrapper.unmount()
  })

  it('accepts custom position and closeButton props', async () => {
    const wrapper = mount(RsToaster, {
      props: { position: 'bottom-right', closeButton: false, richColors: true },
      attachTo: document.body,
    })
    await flushPromises()
    expect(wrapper.props('position')).toBe('bottom-right')
    expect(wrapper.props('closeButton')).toBe(false)
    expect(wrapper.props('richColors')).toBe(true)
    expect(document.body.querySelector('[data-sonner-toaster]')).toBeTruthy()
    wrapper.unmount()
  })
})

describe('useRsToast', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it.each(['success', 'error', 'info', 'warning'] as const)(
    'shows %s toast with semantic class',
    async (type) => {
      mount(RsToaster, { attachTo: document.body })
      const api = useRsToast()
      api[type](`${type} 消息`)
      await flushPromises()
      const toastEl = document.body.querySelector(`.rs-toast--${type}`)
      expect(toastEl?.textContent).toContain(`${type} 消息`)
    },
  )

  it('shows title and description', async () => {
    mount(RsToaster, { attachTo: document.body })
    const { success } = useRsToast()
    success({
      title: '保存成功',
      description: '更改已同步到云端。',
    })
    await flushPromises()
    const root = document.body.querySelector('.rs-toast--success')
    expect(root?.querySelector('.rs-toast__title')?.textContent).toBe('保存成功')
    expect(root?.querySelector('.rs-toast__description')?.textContent).toBe('更改已同步到云端。')
  })

  it('accepts string shorthand', async () => {
    mount(RsToaster, { attachTo: document.body })
    const { info } = useRsToast()
    info('简短提示')
    await flushPromises()
    expect(document.body.querySelector('.rs-toast--info')?.textContent).toContain('简短提示')
  })

  it('dismiss removes visible toasts', async () => {
    mount(RsToaster, { attachTo: document.body })
    const { success, dismiss } = useRsToast()
    success('待关闭')
    await flushPromises()
    expect(document.body.querySelector('.rs-toast')).toBeTruthy()
    dismiss()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()
    expect(document.body.querySelector('.rs-toast[data-visible="true"]')).toBeFalsy()
  })
})
