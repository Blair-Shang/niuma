import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RsPopover from '../components/RsPopover.vue'

describe('RsPopover', () => {
  it('opens content on trigger click', async () => {
    const wrapper = mount(RsPopover, {
      slots: {
        default: '<button type="button" class="trigger">Open</button>',
        content: '<p class="panel">Popover body</p>',
      },
      attachTo: document.body,
    })
    expect(document.body.querySelector('.rs-popover__content')).toBeNull()
    await wrapper.find('.trigger').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.rs-popover__content')).not.toBeNull()
    expect(document.body.textContent).toContain('Popover body')
    wrapper.unmount()
  })

  it('supports v-model:open', async () => {
    const wrapper = mount(RsPopover, {
      props: { open: true },
      slots: {
        default: '<button type="button" class="trigger">Open</button>',
        content: '<p class="panel">Controlled</p>',
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.rs-popover__content')).not.toBeNull()
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(document.body.querySelector('.rs-popover__content')).toBeNull()
    wrapper.unmount()
  })

  it('applies width modifier class', async () => {
    const wrapper = mount(RsPopover, {
      props: { open: true, width: 'lg' },
      slots: {
        default: '<button type="button" class="trigger">Open</button>',
        content: '<p>Wide panel</p>',
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.rs-popover__content--lg')).not.toBeNull()
    wrapper.unmount()
  })

  it('lazy-mounts content when closed by default', async () => {
    const wrapper = mount(RsPopover, {
      slots: {
        default: '<button type="button" class="trigger">Open</button>',
        content: '<p class="marker">Lazy content</p>',
      },
      attachTo: document.body,
    })
    expect(document.body.querySelector('.marker')).toBeNull()
    wrapper.unmount()
  })

  it('unmounts content after close with default lazyMount', async () => {
    const wrapper = mount(RsPopover, {
      slots: {
        default: '<button type="button" class="trigger">Open</button>',
        content: '<p class="marker">Toggle content</p>',
      },
      attachTo: document.body,
    })
    await wrapper.find('.trigger').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.marker')).not.toBeNull()
    await wrapper.find('.trigger').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.marker')).toBeNull()
    wrapper.unmount()
  })

  it('keeps content mounted when lazyMount is false and closed', async () => {
    const wrapper = mount(RsPopover, {
      props: { lazyMount: false },
      slots: {
        default: '<button type="button" class="trigger">Open</button>',
        content: '<p class="marker">Eager content</p>',
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.marker')).not.toBeNull()
    wrapper.unmount()
  })

  it('keeps content mounted when forceMount is true and closed', async () => {
    const wrapper = mount(RsPopover, {
      props: { forceMount: true },
      slots: {
        default: '<button type="button" class="trigger">Open</button>',
        content: '<p class="marker">Forced content</p>',
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.marker')).not.toBeNull()
    wrapper.unmount()
  })

  it('retains eager content in DOM after close when lazyMount is false', async () => {
    const wrapper = mount(RsPopover, {
      props: { lazyMount: false, open: true },
      slots: {
        default: '<button type="button" class="trigger">Open</button>',
        content: '<p class="marker">Persistent content</p>',
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.marker')).not.toBeNull()
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(document.body.querySelector('.marker')).not.toBeNull()
    wrapper.unmount()
  })
})
